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
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

BLOCKED_SENDERS = ["nytimes.com", "substack.com", "noreply@ucsd.edu", "bankofamerica.com"]

# Env vars
MONGO_URI = os.getenv("MONGO_URI", os.getenv("MONGOD_URI", "mongodb://localhost:27017"))
CLIENT_SECRETS_FILE = os.getenv("CLIENT_SECRETS_FILE", "credentials.json")
BACKEND_BASE = os.getenv("BACKEND_URL", "https://gmail-ai-analyzer.onrender.com").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://gmail-ai-analyzer.vercel.app").rstrip("/")

logger.info(f"model_utils starting. MONGO_URI={MONGO_URI}, BACKEND_BASE={BACKEND_BASE}, FRONTEND_URL={FRONTEND_URL}")

# DB setup (connect but don't crash — set collections to None if connection fails)
client = None
db = None
tokens_col = None
state_col = None
oauth_col = None
accounts_col = None

try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")  # surface connection errors now
    db = client["gmail-analyzer"]
    tokens_col = db["tokens"]        # { email, creds_json }
    state_col = db["states"]         # { email, last_ts }
    oauth_col = db["oauth_states"]   # { state, email, created_at }
    accounts_col = db["extractedaccounts"]  # { email, lastEmailTs }
    logger.info("Connected to MongoDB successfully in model_utils.")
except Exception as e:
    logger.exception(f"Could not connect to MongoDB at {MONGO_URI}. Continuing with DB disabled. Error: {e}")
    client = None
    db = None
    tokens_col = None
    state_col = None
    oauth_col = None
    accounts_col = None

def safe_filename(email):
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', email)

# ---------- TOKEN MANAGEMENT ----------
def ensure_creds(email: str, force_reauth: bool = False):
    """
    Attempt to load stored credentials from tokens collection, refresh if needed.
    Returns google.oauth2.credentials.Credentials or None.
    """
    if tokens_col is None:
        logger.warning("ensure_creds: tokens_col not available — no DB. Returning None.")
        return None

    try:
        doc = tokens_col.find_one({"email": email})
    except Exception as e:
        logger.exception(f"ensure_creds: DB read failed for {email}: {e}")
        return None

    if not doc:
        logger.info(f"ensure_creds: no token found for {email}")
        return None

    try:
        creds = Credentials.from_authorized_user_info(doc["creds_json"], SCOPES)
    except Exception as e:
        logger.exception(f"ensure_creds: failed to build Credentials for {email}: {e}")
        return None

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # Save refreshed token back to DB (best-effort)
                if tokens_col is not None:
                    try:
                        tokens_col.update_one({"email": email}, {"$set": {"creds_json": json.loads(creds.to_json())}}, upsert=True)
                    except Exception as e:
                        logger.exception(f"ensure_creds: failed to save refreshed token for {email}: {e}")
                return creds
            except Exception as e:
                logger.exception(f"ensure_creds: refresh failed for {email}: {e}")
                return None
        else:
            return None

    return creds

def generate_authorization_url(email: str):
    """
    Build authorization URL and persist a state->email mapping (best-effort).
    Also ensures an account document exists (best-effort).
    """
    redirect_uri = f"{BACKEND_BASE}/oauth2callback"

    # Ensure account entry exists (non-fatal)
    if accounts_col is not None:
        try:
            accounts_col.update_one({"email": email}, {"$setOnInsert": {"lastEmailTs": None}}, upsert=True)
        except Exception as e:
            logger.exception(f"generate_authorization_url: failed to create account record for {email}: {e}")
    else:
        logger.debug("generate_authorization_url: accounts_col not available (DB disabled).")

    flow = Flow.from_client_secrets_file(CLIENT_SECRETS_FILE, scopes=SCOPES, redirect_uri=redirect_uri)
    auth_url, state = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent", login_hint=email)

    # Persist oauth state mapping (non-fatal)
    if oauth_col is not None:
        try:
            oauth_col.update_one({"state": state}, {"$set": {"email": email, "created_at": datetime.utcnow().isoformat()}}, upsert=True)
        except Exception as e:
            logger.exception(f"generate_authorization_url: failed to save oauth state for {email}: {e}")
    else:
        logger.debug("generate_authorization_url: oauth_col not available (DB disabled).")

    logger.info(f"generate_authorization_url: created auth URL for {email}; state={state}")
    return auth_url, state

def exchange_code_for_token(state: str, code: str):
    """
    Exchange oauth code for tokens, save tokens mapped to email via oauth_col.
    Returns the email associated with the state.
    """
    if oauth_col is None:
        logger.error("exchange_code_for_token: oauth_col not available — cannot map state to email.")
        raise RuntimeError("OAuth state DB unavailable")

    mapping = oauth_col.find_one({"state": state})
    if not mapping:
        logger.error("exchange_code_for_token: unknown state %s", state)
        raise RuntimeError("Unknown OAuth state")

    email = mapping.get("email")
    redirect_uri = f"{BACKEND_BASE}/oauth2callback"
    flow = Flow.from_client_secrets_file(CLIENT_SECRETS_FILE, scopes=SCOPES, state=state, redirect_uri=redirect_uri)
    flow.fetch_token(code=code)
    creds = flow.credentials

    # Save token (best-effort)
    if tokens_col is not None:
        try:
            tokens_col.update_one({"email": email}, {"$set": {"creds_json": json.loads(creds.to_json())}}, upsert=True)
            logger.info(f"exchange_code_for_token: token saved for {email}")
        except Exception as e:
            logger.exception(f"exchange_code_for_token: failed to save token for {email}: {e}")
    else:
        logger.warning("exchange_code_for_token: tokens_col not available (DB disabled).")

    # Cleanup oauth state mapping
    try:
        oauth_col.delete_one({"state": state})
    except Exception as e:
        logger.exception(f"exchange_code_for_token: failed to delete oauth state {state}: {e}")

    # Ensure account entry exists
    if accounts_col is not None:
        try:
            accounts_col.update_one({"email": email}, {"$set": {"lastEmailTs": None}}, upsert=True)
        except Exception as e:
            logger.exception(f"exchange_code_for_token: failed to upsert account for {email}: {e}")

    return email

# ---------- EMAIL FETCHING ----------
def is_blocked(sender):
    try:
        return any(b in sender.lower() for b in BLOCKED_SENDERS)
    except Exception:
        return False

def fetch_latest_emails(service, email, max_results=20):
    results = service.users().messages().list(userId=email, q="in:inbox", maxResults=max_results).execute()
    messages = results.get("messages", []) or []
    emails = []
    for msg in messages:
        msg_data = service.users().messages().get(userId=email, id=msg["id"], format="full").execute()
        headers = msg_data.get("payload", {}).get("headers", [])
        subject = next((h["value"] for h in headers if h.get("name") == "Subject"), "(no subject)")
        sender = next((h["value"] for h in headers if h.get("name") == "From"), "(unknown)")
        date_hdr = next((h["value"] for h in headers if h.get("name") == "Date"), "(no date)")
        ts = datetime.fromtimestamp(int(msg_data.get("internalDate", 0)) / 1000, tz=timezone.utc).astimezone()
        if is_blocked(sender):
            continue

        body = ""
        payload = msg_data.get("payload", {})
        if payload.get("parts"):
            for part in payload["parts"]:
                if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
                    body = base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", "ignore")
                    break
        elif payload.get("body", {}).get("data"):
            body = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", "ignore")

        emails.append({
            "subject": subject,
            "from": sender,
            "date": ts.isoformat(),
            "date_header": date_hdr,
            "content": body.strip() if body else "(no content)"
        })
    return emails

def filter_new_emails(email, emails):
    """
    Filter emails newer than last seen timestamp. Update state_col and accounts_col if available.
    """
    if state_col is None:
        logger.warning("filter_new_emails: state_col not available - treating all emails as new and attempting to update accounts_col only.")
        max_ts = None
        for e in emails:
            try:
                t = e.get("date")
                if not max_ts or t > max_ts:
                    max_ts = t
            except Exception:
                pass
        if max_ts and accounts_col is not None:
            try:
                accounts_col.update_one({"email": email}, {"$set": {"lastEmailTs": max_ts}}, upsert=True)
            except Exception as e:
                logger.exception(f"filter_new_emails: failed to update account lastEmailTs for {email}: {e}")
        return emails

    try:
        doc = state_col.find_one({"email": email})
    except Exception as e:
        logger.exception(f"filter_new_emails: DB read failed for {email}: {e}")
        doc = None

    last_seen = doc.get("last_ts") if doc else None
    new_emails = []
    max_ts = last_seen
    for e in emails:
        ts = datetime.fromisoformat(e["date"])
        if (last_seen is None) or (ts.isoformat() > last_seen):
            new_emails.append(e)
            if (max_ts is None) or (ts.isoformat() > max_ts):
                max_ts = ts.isoformat()

    if max_ts:
        try:
            state_col.update_one({"email": email}, {"$set": {"last_ts": max_ts}}, upsert=True)
            if accounts_col is not None:
                accounts_col.update_one({"email": email}, {"$set": {"lastEmailTs": max_ts}}, upsert=True)
        except Exception as e:
            logger.exception(f"filter_new_emails: failed to update state/account for {email}: {e}")

    return new_emails

# ---------- HIGH-LEVEL ----------
def fetch_for_emails(email_list, max_results=20):
    emails_by_account = {}
    missing_auth = []

    for email in email_list:
        try:
            creds = ensure_creds(email)
            if not creds:
                logger.info(f"fetch_for_emails: no creds for {email}")
                missing_auth.append(email)
                continue

            service = build("gmail", "v1", credentials=creds)
            latest = fetch_latest_emails(service, email, max_results=max_results)
            filtered = filter_new_emails(email, latest)
            emails_by_account[email] = filtered
        except Exception as e:
            logger.exception(f"Error fetching {email}: {e}")
            missing_auth.append(email)

    return {"emails_by_account": emails_by_account, "missing_auth": missing_auth}

if __name__ == "__main__":
    emails = input("Enter emails: ").split(",")
    print(fetch_for_emails([e.strip() for e in emails if e.strip()]))
