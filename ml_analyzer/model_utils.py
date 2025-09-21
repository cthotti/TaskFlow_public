# model_utils.py
from __future__ import print_function
import os
import re
import json
import base64
from datetime import datetime, timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from pymongo import MongoClient
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Gmail scope
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

BLOCKED_SENDERS = [
    "nytimes.com",
    "substack.com",
    "noreply@ucsd.edu",
    "bankofamerica.com",
]

# Env vars (use same var everywhere)
MONGO_URI = os.getenv("MONGO_URI", os.getenv("MONGOD_URI", "mongodb://localhost:27017"))
CLIENT_SECRETS_FILE = os.getenv("CLIENT_SECRETS_FILE", "credentials.json")
BACKEND_BASE = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

logger.info(f"model_utils: MONGO_URI={MONGO_URI}, BACKEND_BASE={BACKEND_BASE}, FRONTEND_URL={FRONTEND_URL}")

# Try to create a global connection — but be tolerant (some environments may not be ready)
def connect_mongo():
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.admin.command("ping")
        db = client["gmail_ai"]
        return client, db
    except Exception as e:
        logger.exception(f"connect_mongo: cannot connect to MongoDB at {MONGO_URI}: {e}")
        return None, None

_client, _db = connect_mongo()
if _db:
    tokens_col = _db["tokens"]
    state_col = _db["states"]
    oauth_col = _db["oauth_states"]
    accounts_col = _db["extractedaccounts"]  # note: Next.js Mongoose model may create 'extractedaccounts' — keep consistent
    logger.info("model_utils: connected to Mongo collections.")
else:
    tokens_col = state_col = oauth_col = accounts_col = None
    logger.warning("model_utils: Mongo collections are UNAVAILABLE - operations will attempt a fresh connection per-call.")

def safe_filename(email):
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', email)

# ---------- Helper to get a collection (best-effort) ----------
def _get_collection(name):
    global _client, _db, tokens_col, state_col, oauth_col, accounts_col
    if _db is not None:
        return _db[name]
    # try to connect on demand
    client, db = connect_mongo()
    if db:
        _client, _db = client, db
        tokens_col = _db["tokens"]
        state_col = _db["states"]
        oauth_col = _db["oauth_states"]
        accounts_col = _db["extractedaccounts"]
        return _db[name]
    else:
        logger.warning(f"_get_collection: cannot obtain collection {name} (no DB).")
        return None

# ---------- TOKEN MANAGEMENT ----------
def ensure_creds(email: str, force_reauth: bool = False):
    """
    Try to load credentials for an email and refresh if needed.
    Returns google.oauth2.credentials.Credentials or None.
    """
    col = tokens_col or _get_collection("tokens")
    if col is None:
        logger.warning("ensure_creds: tokens collection not available.")
        return None

    try:
        doc = col.find_one({"email": email})
    except Exception as e:
        logger.exception(f"ensure_creds: DB read failed for {email}: {e}")
        return None

    if not doc:
        logger.info(f"ensure_creds: no token doc for {email}")
        return None

    try:
        creds = Credentials.from_authorized_user_info(doc["creds_json"], SCOPES)
    except Exception as e:
        logger.exception(f"ensure_creds: building Credentials failed for {email}: {e}")
        return None

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # save updated token
                try:
                    col.update_one(
                        {"email": email},
                        {"$set": {"creds_json": json.loads(creds.to_json())}},
                        upsert=True,
                    )
                    logger.info(f"ensure_creds: refreshed and saved token for {email}")
                except Exception as e:
                    logger.exception(f"ensure_creds: failed to save refreshed token for {email}: {e}")
                return creds
            except Exception as e:
                logger.exception(f"ensure_creds: refresh failed for {email}: {e}")
                return None
        return None
    return creds

def generate_authorization_url(email: str):
    """
    Returns (auth_url, state). Also ensures the account doc exists and saves oauth state -> email.
    Non-fatal if DB is down; all DB operations are best-effort.
    """
    redirect_uri = f"{BACKEND_BASE}/oauth2callback"

    # Ensure account doc exists
    try:
        col = accounts_col or _get_collection("extractedaccounts")
        if col:
            col.update_one(
                {"email": email},
                {"$setOnInsert": {"lastEmailTs": None}},
                upsert=True,
            )
            logger.info(f"generate_authorization_url: ensured account doc for {email}")
        else:
            logger.warning("generate_authorization_url: accounts_col unavailable; skipping account creation")
    except Exception as e:
        logger.exception(f"generate_authorization_url: failed to upsert account for {email}: {e}")

    # Build OAuth flow
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )

    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        login_hint=email,
    )

    # Save state -> email mapping (best-effort)
    try:
        ocol = oauth_col or _get_collection("oauth_states")
        if ocol:
            ocol.update_one(
                {"state": state},
                {"$set": {"email": email, "created_at": datetime.utcnow().isoformat()}},
                upsert=True,
            )
            logger.info(f"generate_authorization_url: saved oauth state for {email} (state={state})")
        else:
            logger.warning("generate_authorization_url: oauth_col unavailable; cannot persist state mapping")
    except Exception as e:
        logger.exception(f"generate_authorization_url: failed to save oauth state: {e}")

    return auth_url, state

def exchange_code_for_token(state: str, code: str):
    """
    Exchange code for token and persist token and account entry.
    Returns the email for which tokens were saved.
    Raises RuntimeError on unknown state.
    """
    ocol = oauth_col or _get_collection("oauth_states")
    if ocol is None:
        logger.error("exchange_code_for_token: oauth_col is unavailable - cannot map state to email")
        raise RuntimeError("OAuth state DB unavailable")

    mapping = ocol.find_one({"state": state})
    if not mapping:
        logger.error(f"exchange_code_for_token: unknown state {state}")
        raise RuntimeError("Unknown OAuth state")
    email = mapping.get("email")
    if not email:
        logger.error(f"exchange_code_for_token: state mapping missing email for state {state}")
        raise RuntimeError("State mapping missing email")

    redirect_uri = f"{BACKEND_BASE}/oauth2callback"
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        state=state,
        redirect_uri=redirect_uri,
    )
    flow.fetch_token(code=code)
    creds = flow.credentials

    # Save token (best-effort)
    try:
        tcol = tokens_col or _get_collection("tokens")
        if tcol:
            tcol.update_one(
                {"email": email},
                {"$set": {"creds_json": json.loads(creds.to_json())}},
                upsert=True,
            )
            logger.info(f"exchange_code_for_token: saved token for {email}")
        else:
            logger.warning("exchange_code_for_token: tokens_col unavailable; cannot save credentials")
    except Exception as e:
        logger.exception(f"exchange_code_for_token: failed to write tokens for {email}: {e}")

    # Remove oauth state mapping (best-effort)
    try:
        ocol.delete_one({"state": state})
    except Exception as e:
        logger.exception(f"exchange_code_for_token: failed to delete oauth state {state}: {e}")

    # Ensure account doc exists and mark as authenticated
    try:
        acol = accounts_col or _get_collection("extractedaccounts")
        if acol:
            acol.update_one(
                {"email": email},
                {"$set": {"lastEmailTs": None, "authenticated": True}},
                upsert=True,
            )
            logger.info(f"exchange_code_for_token: ensured account saved and marked authenticated for {email}")
        else:
            logger.warning("exchange_code_for_token: accounts_col unavailable; cannot upsert account entry")
    except Exception as e:
        logger.exception(f"exchange_code_for_token: failed to upsert account for {email}: {e}")

    return email

# ---------- EMAIL FETCHING ----------
def is_blocked(sender):
    return any(b in sender.lower() for b in BLOCKED_SENDERS)

def fetch_latest_emails(service, email, max_results=20):
    """
    Returns list of emails metadata/content from Gmail API.
    """
    try:
        results = service.users().messages().list(userId=email, q='in:inbox', maxResults=max_results).execute()
        messages = results.get('messages', []) or []
    except Exception as e:
        logger.exception(f"fetch_latest_emails: Gmail list failed for {email}: {e}")
        return []

    emails = []
    for msg in messages:
        try:
            msg_data = service.users().messages().get(userId=email, id=msg['id'], format='full').execute()
            headers = msg_data.get('payload', {}).get('headers', [])
            subject = next((h['value'] for h in headers if h.get('name') == 'Subject'), '(no subject)')
            sender = next((h['value'] for h in headers if h.get('name') == 'From'), '(unknown sender)')
            date_hdr = next((h['value'] for h in headers if h.get('name') == 'Date'), '(no date)')
            ts = datetime.fromtimestamp(int(msg_data.get('internalDate', 0))/1000, tz=timezone.utc).astimezone()

            if is_blocked(sender):
                continue

            body = ""
            payload = msg_data.get('payload', {})
            parts = payload.get('parts')
            if parts:
                for part in parts:
                    if part.get('mimeType') == 'text/plain' and part.get('body', {}).get('data'):
                        body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                        break
            elif payload.get('body', {}).get('data'):
                body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='ignore')

            emails.append({
                "subject": subject,
                "from": sender,
                "date": ts.isoformat(),
                "date_header": date_hdr,
                "content": body.strip() if body else "(no content)"
            })
        except Exception as e:
            logger.exception(f"fetch_latest_emails: failed to fetch message {msg.get('id')} for {email}: {e}")
            continue

    return emails

def filter_new_emails(email, emails):
    """
    Compare with last seen timestamp saved in 'states' collection and return only new emails.
    Also updates both 'states' and 'extractedaccounts' lastEmailTs.
    """
    scol = state_col or _get_collection("states")
    acol = accounts_col or _get_collection("extractedaccounts")

    if scol is None:
        logger.warning("filter_new_emails: state_col not available - returning all emails as new")
        # try to update accounts_col lastEmailTs
        max_ts = None
        for e in emails:
            try:
                t = e.get("date")
                if not max_ts or (t and t > max_ts):
                    max_ts = t
            except Exception:
                pass
        if max_ts and acol:
            try:
                acol.update_one({"email": email}, {"$set": {"lastEmailTs": max_ts}}, upsert=True)
            except Exception as e:
                logger.exception(f"filter_new_emails: failed to update accounts_col for {email}: {e}")
        return emails

    try:
        doc = scol.find_one({"email": email})
    except Exception as e:
        logger.exception(f"filter_new_emails: DB read failed for {email}: {e}")
        doc = None

    last_seen = doc["last_ts"] if doc else None
    new_emails = []
    max_ts = last_seen
    for e in emails:
        try:
            ts = datetime.fromisoformat(e["date"])
            if not last_seen or ts.isoformat() > last_seen:
                new_emails.append(e)
                if not max_ts or ts.isoformat() > max_ts:
                    max_ts = ts.isoformat()
        except Exception:
            # If parsing fails, treat as new
            new_emails.append(e)

    if max_ts:
        try:
            scol.update_one({"email": email}, {"$set": {"last_ts": max_ts}}, upsert=True)
            if acol:
                acol.update_one({"email": email}, {"$set": {"lastEmailTs": max_ts}}, upsert=True)
        except Exception as e:
            logger.exception(f"filter_new_emails: failed to update state/account for {email}: {e}")

    return new_emails

# ---------- HIGH-LEVEL ----------
def fetch_for_emails(email_list, max_results=20):
    """
    Returns {"emails_by_account": {email: [emails...]}, "missing_auth": [email,...]}
    """
    emails_by_account = {}
    missing_auth = []
    for email in email_list:
        try:
            creds = ensure_creds(email)
            if not creds:
                logger.info(f"fetch_for_emails: missing creds for {email}")
                missing_auth.append(email)
                continue
            service = build("gmail", "v1", credentials=creds)
            latest = fetch_latest_emails(service, email, max_results=max_results)
            filtered = filter_new_emails(email, latest)
            emails_by_account[email] = filtered
        except Exception as e:
            logger.exception(f"fetch_for_emails: error fetching {email}: {e}")
            missing_auth.append(email)
    return {"emails_by_account": emails_by_account, "missing_auth": missing_auth}

if __name__ == "__main__":
    emails = input("Enter emails (comma separated): ").split(",")
    print(fetch_for_emails([e.strip() for e in emails if e.strip()]))
