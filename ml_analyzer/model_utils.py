# model_utils.py
from __future__ import print_function
import os
import re
import json
import base64
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from pymongo import MongoClient
import logging
import html

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Gmail scope
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

# Senders or domains to ignore
BLOCKED_SENDERS = ["nytimes.com", "substack.com", "noreply@ucsd.edu", "bankofamerica.com"]

# Environment variables
MONGO_URI = os.getenv("MONGO_URI", os.getenv("MONGOD_URI", "mongodb://localhost:27017"))
CLIENT_SECRETS_FILE = os.getenv("CLIENT_SECRETS_FILE", "credentials.json")
BACKEND_BASE = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
DB_NAME = os.getenv("DB_NAME", "gmail-analyzer")

logger.info(f"model_utils initializing. MONGO_URI={MONGO_URI}, BACKEND_BASE={BACKEND_BASE}, FRONTEND_URL={FRONTEND_URL}, DB_NAME={DB_NAME}")

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
    db = client[DB_NAME]
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


def _b64_urlsafe_decode(s: str) -> str:
    """
    Decode base64 URL-safe string with padding fix, return unicode string.
    """
    if not s:
        return ""
    s2 = s.replace("-", "+").replace("_", "/")
    padding = len(s2) % 4
    if padding:
        s2 += "=" * (4 - padding)
    try:
        return base64.b64decode(s2).decode("utf-8", "ignore")
    except Exception:
        try:
            return base64.urlsafe_b64decode(s).decode("utf-8", "ignore")
        except Exception:
            return ""


def _extract_text_from_payload(payload: Dict[str, Any]) -> str:
    """
    Recursively walk payload parts and prefer text/plain, else fall back to text/html (stripped).
    Returns combined text (first matching plain text found preferred).
    """
    if not payload:
        return ""

    # Direct body on payload
    body = payload.get("body", {})
    data = body.get("data")
    mime = payload.get("mimeType", "").lower()

    if mime.startswith("text/plain") and data:
        return _b64_urlsafe_decode(data).strip()

    if mime.startswith("text/html") and data:
        raw_html = _b64_urlsafe_decode(data)
        # unescape HTML entities and remove tags
        text = html.unescape(re.sub(r"<[^>]+>", " ", raw_html))
        return re.sub(r"\s+", " ", text).strip()

    # If there are parts, try to find text/plain first
    parts = payload.get("parts") or []
    plain_chunks = []
    html_chunks = []
    for part in parts:
        part_mime = (part.get("mimeType") or "").lower()
        if part_mime.startswith("text/plain"):
            txt = _extract_text_from_payload(part)
            if txt:
                plain_chunks.append(txt)
        elif part_mime.startswith("text/html"):
            txt = _extract_text_from_payload(part)
            if txt:
                html_chunks.append(txt)
        else:
            # nested multiparts
            txt = _extract_text_from_payload(part)
            if txt:
                plain_chunks.append(txt)

    if plain_chunks:
        return "\n\n".join(plain_chunks).strip()
    if html_chunks:
        # prefer HTML->text if no plain parts
        return "\n\n".join(html_chunks).strip()

    return ""


def fetch_latest_emails(service, email: str, max_results: int = 20) -> List[Dict[str, Any]]:
    """
    Robustly fetch latest emails from the account's inbox, using fallbacks for accounts
    that don't have a 'primary' category (e.g., some org/school accounts).

    Returns list of dicts:
      { subject, from, date, date_header, content }
    """
    # Candidate queries / list strategies in order of preference
    strategies = [
        {"q": "in:inbox category:primary"},  # personal Gmail - primary only
        {"q": "in:inbox"},                   # all messages in inbox
        {"labelIds": ["INBOX"]},             # label-based fetch
        {}                                   # generic list (last resort)
    ]

    messages = []
    for strat in strategies:
        try:
            # build call
            call_kwargs = {"userId": email, "maxResults": max_results}
            call_kwargs.update({k: v for k, v in strat.items() if v is not None})

            # messages.list accepts labelIds (list) OR q (string); ignore empty keys
            resp = service.users().messages().list(**call_kwargs).execute()
            msgs = resp.get("messages", []) or []
            if msgs:
                messages = msgs
                logger.debug(f"fetch_latest_emails: strategy succeeded for {email}: {strat}")
                break
            else:
                logger.debug(f"fetch_latest_emails: strategy returned 0 messages for {email}: {strat}")
        except Exception as e:
            logger.debug(f"fetch_latest_emails: strategy {strat} failed for {email}: {e}")
            # try next strategy

    if not messages:
        logger.info(f"fetch_latest_emails: no messages found for {email} with any strategy")
        return []

    result_emails = []
    for msg in messages:
        try:
            msg_id = msg.get("id")
            if not msg_id:
                continue
            msg_data = service.users().messages().get(userId=email, id=msg_id, format="full").execute()
            headers = msg_data.get("payload", {}).get("headers", [])
            subject = next((h["value"] for h in headers if h.get("name", "").lower() == "subject"), "(no subject)")
            sender = next((h["value"] for h in headers if h.get("name", "").lower() == "from"), "(unknown)")
            date_hdr = next((h["value"] for h in headers if h.get("name", "").lower() == "date"), "(no date)")

            # convert internalDate (ms since epoch) to ISO
            ts_val = msg_data.get("internalDate")
            if ts_val:
                try:
                    ts = datetime.fromtimestamp(int(ts_val) / 1000, tz=timezone.utc).astimezone()
                    iso_ts = ts.isoformat()
                except Exception:
                    iso_ts = None
            else:
                iso_ts = None

            # extract body content robustly
            payload = msg_data.get("payload", {}) or {}
            content = _extract_text_from_payload(payload)
            # If no content from payload attempt snippet
            if not content:
                content = msg_data.get("snippet", "") or ""

            # final cleanup whitespace
            content = re.sub(r'\s+', ' ', content).strip()
            result_emails.append({
                "subject": subject,
                "from": sender,
                "date": iso_ts or datetime.utcnow().isoformat(),
                "date_header": date_hdr,
                "content": content if content else "(no content)"
            })
        except Exception as e:
            logger.exception(f"fetch_latest_emails: failed to fetch message {msg} for {email}: {e}")

    return result_emails


def filter_new_emails(email: str, emails: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
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
        try:
            ts = datetime.fromisoformat(e["date"])
        except Exception:
            # if date parsing fails default to adding the email (safer)
            new_emails.append(e)
            continue

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


def fetch_for_emails(email_list: List[str], max_results: int = 20) -> Dict[str, Any]:
    """
    Fetch new emails for each account using stored tokens.
    Returns { "emails_by_account": {...}, "missing_auth": [...] }
    """
    emails_by_account: Dict[str, List[Dict[str, Any]]] = {}
    missing_auth: List[str] = []

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
