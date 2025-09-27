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

# Senders or domains to ignore
BLOCKED_SENDERS = ["nytimes.com", "substack.com", "noreply@ucsd.edu", "bankofamerica.com"]

# Environment variables (use MONGO_URI consistently)
MONGO_URI = os.getenv("MONGO_URI", os.getenv("MONGO_URI", "mongodb://localhost:27017"))
CLIENT_SECRETS_FILE = os.getenv("CLIENT_SECRETS_FILE", "credentials.json")
BACKEND_BASE = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

logger.info(f"model_utils initializing. MONGO_URI={MONGO_URI}, BACKEND_BASE={BACKEND_BASE}, FRONTEND_URL={FRONTEND_URL}")

# Try to connect to Mongo but don't crash the process if it's unavailable.
client = None
db = None
tokens_col = None
state_col = None
oauth_col = None
accounts_col = None

try:
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    client.admin.command("ping")
    db = client["gmail_analyzer"]
    tokens_col = db["tokens"]
    state_col = db["states"]
    oauth_col = db["oauth_states"]
    accounts_col = db["extractedaccounts"]
    logger.info("Connected to MongoDB from model_utils.")
except Exception as e:
    logger.exception(f"Could not connect to MongoDB at {MONGO_URI}. DB writes will be disabled. Error: {e}")
    client = None
    db = None
    tokens_col = None
    state_col = None
    oauth_col = None
    accounts_col = None


def safe_filename(email: str) -> str:
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', email)


# ---------- TOKEN MANAGEMENT ----------
def ensure_creds(email: str, force_reauth: bool = False):
    """
    Return google Credentials object if found and usable, otherwise None.
    """
    if tokens_col is None:
        logger.warning("ensure_creds: tokens_col not available; cannot load creds.")
        return None

    try:
        doc = tokens_col.find_one({"email": email})
    except Exception as e:
        logger.exception(f"ensure_creds: DB read failed for {email}: {e}")
        return None

    if not doc:
        logger.info(f"ensure_creds: no token doc for {email}")
        return None

    try:
        creds = Credentials.from_authorized_user_info(doc["creds_json"], SCOPES)
    except Exception as e:
        logger.exception(f"ensure_creds: failed to construct Credentials for {email}: {e}")
        return None

    # attempt refresh if possible
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # persist refreshed token
                try:
                    tokens_col.update_one({"email": email}, {"$set": {"creds_json": json.loads(creds.to_json())}}, upsert=True)
                    logger.info(f"ensure_creds: refreshed and saved token for {email}")
                except Exception as e:
                    logger.exception(f"ensure_creds: failed to save refreshed token for {email}: {e}")
                return creds
            except Exception as e:
                logger.exception(f"ensure_creds: token refresh failed for {email}: {e}")
                return None
        else:
            return None

    return creds


def generate_authorization_url(email: str):
    """
    Start OAuth flow: ensure account doc exists (best-effort), create authorization URL
    and persist state->email mapping (best-effort).
    """
    redirect_uri = f"{BACKEND_BASE}/oauth2callback"

    # Ensure accounts collection has the email (best-effort)
    if accounts_col is not None:
        try:
            accounts_col.update_one({"email": email}, {"$setOnInsert": {"lastEmailTs": None}}, upsert=True)
            logger.info(f"generate_authorization_url: ensured account record for {email}")
        except Exception as e:
            logger.exception(f"generate_authorization_url: failed to upsert account {email}: {e}")
    else:
        logger.debug("generate_authorization_url: accounts_col not present (DB disabled)")

    # Build OAuth flow from credentials file
    flow = Flow.from_client_secrets_file(CLIENT_SECRETS_FILE, scopes=SCOPES, redirect_uri=redirect_uri)
    auth_url, state = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent", login_hint=email)

    # Save oauth state -> email mapping (best-effort)
    if oauth_col is not None:
        try:
            oauth_col.update_one({"state": state}, {"$set": {"email": email, "created_at": datetime.utcnow().isoformat()}}, upsert=True)
            logger.info(f"generate_authorization_url: saved oauth state for {email} state={state}")
        except Exception as e:
            logger.exception(f"generate_authorization_url: failed to save oauth state mapping for {email}: {e}")
    else:
        logger.debug("generate_authorization_url: oauth_col not present (DB disabled)")

    return auth_url, state


def exchange_code_for_token(state: str, code: str):
    """
    Exchange code for token and save token mapped to the email saved in oauth_col.
    Returns the email that was authorized.
    """
    if oauth_col is None:
        logger.error("exchange_code_for_token: oauth_col not available - cannot map state")
        raise RuntimeError("OAuth state DB unavailable")

    mapping = oauth_col.find_one({"state": state})
    if not mapping:
        logger.error("exchange_code_for_token: unknown oauth state %s", state)
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
            logger.info(f"exchange_code_for_token: saved token for {email}")
        except Exception as e:
            logger.exception(f"exchange_code_for_token: failed to save token for {email}: {e}")
    else:
        logger.warning("exchange_code_for_token: tokens_col not available - token not persisted.")

    # Clean up state mapping (best-effort)
    try:
        oauth_col.delete_one({"state": state})
    except Exception as e:
        logger.exception(f"exchange_code_for_token: failed to delete oauth state {state}: {e}")

    # Ensure account doc exists
    if accounts_col is not None:
        try:
            accounts_col.update_one({"email": email}, {"$set": {"lastEmailTs": None}}, upsert=True)
            logger.info(f"exchange_code_for_token: ensured account for {email}")
        except Exception as e:
            logger.exception(f"exchange_code_for_token: failed to upsert account for {email}: {e}")

    return email


# ---------- EMAIL FETCHING ----------
def is_blocked(sender: str) -> bool:
    try:
        lower = sender.lower()
        return any(b in lower for b in BLOCKED_SENDERS)
    except Exception:
        return False


def fetch_latest_emails(service, email, max_results=20):
    """
    Fetch latest emails from the primary inbox only and return list of email dicts:
      {subject, from, date, date_header, content}
    Uses Gmail search: in:inbox category:primary
    """
    # Only fetch the primary category to avoid social/promotions
    q = "in:inbox category:primary"

    try:
        results = service.users().messages().list(userId=email, q=q, maxResults=max_results).execute()
    except Exception as e:
        logger.exception(f"fetch_latest_emails: failed to list messages for {email}: {e}")
        return []

    messages = results.get("messages", []) or []
    emails = []
    for msg in messages:
        try:
            msg_data = service.users().messages().get(userId=email, id=msg["id"], format="full").execute()
            headers = msg_data.get("payload", {}).get("headers", [])
            subject = next((h["value"] for h in headers if h.get("name") == "Subject"), "(no subject)")
            sender = next((h["value"] for h in headers if h.get("name") == "From"), "(unknown)")
            date_hdr = next((h["value"] for h in headers if h.get("name") == "Date"), "(no date)")
            ts = datetime.fromtimestamp(int(msg_data.get("internalDate", 0)) / 1000, tz=timezone.utc).astimezone()

            if is_blocked(sender):
                logger.debug(f"fetch_latest_emails: skipping blocked sender {sender}")
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
        except Exception as e:
            logger.exception(f"fetch_latest_emails: failed to fetch message {msg} for {email}: {e}")

    return emails


def filter_new_emails(email, emails):
    """
    Filter out emails already seen (using state_col). Also update state_col and accounts_col.
    Returns only new emails.
    """
    if state_col is None:
        logger.warning("filter_new_emails: state_col not available; returning all emails and attempting to update accounts_col only.")
        max_ts = None
        for e in emails:
            try:
                d = e.get("date")
                if not max_ts or d > max_ts:
                    max_ts = d
            except Exception:
                pass
        if max_ts and accounts_col is not None:
            try:
                accounts_col.update_one({"email": email}, {"$set": {"lastEmailTs": max_ts}}, upsert=True)
            except Exception as e:
                logger.exception(f"filter_new_emails: failed to update lastEmailTs for {email}: {e}")
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


def fetch_for_emails(email_list, max_results=20):
    """
    Fetch new emails for each account using stored tokens.
    Returns { "emails_by_account": {...}, "missing_auth": [...] }
    """
    emails_by_account = {}
    missing_auth = []

    for email in email_list:
        try:
            creds = ensure_creds(email)
            if not creds:
                logger.info(f"fetch_for_emails: no credentials for {email}")
                missing_auth.append(email)
                continue

            service = build("gmail", "v1", credentials=creds)
            latest = fetch_latest_emails(service, email, max_results=max_results)
            filtered = filter_new_emails(email, latest)
            emails_by_account[email] = filtered
            logger.info(f"fetch_for_emails: fetched {len(filtered)} new emails for {email}")
        except Exception as e:
            logger.exception(f"fetch_for_emails: error fetching {email}: {e}")
            missing_auth.append(email)

    return {"emails_by_account": emails_by_account, "missing_auth": missing_auth}


if __name__ == "__main__":
    # quick manual test
    emails = input("Enter emails (comma separated): ").split(",")
    emails = [e.strip() for e in emails if e.strip()]
    print(json.dumps(fetch_for_emails(emails), indent=2))