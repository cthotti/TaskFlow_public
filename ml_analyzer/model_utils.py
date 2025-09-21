# model_utils.py
from __future__ import print_function
import os, re, json, base64
from datetime import datetime, timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from pymongo import MongoClient

# Gmail scope
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

BLOCKED_SENDERS = ["nytimes.com", "substack.com", "noreply@ucsd.edu", "bankofamerica.com"]

# Env vars
MONGOD_URI = os.getenv("MONGOD_URI", "mongodb://localhost:27017")
CLIENT_SECRETS_FILE = os.getenv("CLIENT_SECRETS_FILE", "credentials.json")
BACKEND_BASE = os.getenv("BACKEND_URL", "https://gmail-ai-analyzer.onrender.com")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://gmail-ai-analyzer.vercel.app")

# DB setup
client = MongoClient(MONGOD_URI)
db = client["gmail_ai"]
tokens_col = db["tokens"]        # { email, creds_json }
state_col = db["states"]         # { email, last_ts }
oauth_col = db["oauth_states"]   # { state, email, created_at }
accounts_col = db["extractedaccounts"]  # { email, lastEmailTs }

def safe_filename(email): 
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', email)

# ---------- TOKEN MANAGEMENT ----------
def ensure_creds(email: str, force_reauth: bool = False):
    doc = tokens_col.find_one({"email": email})
    if not doc:
        return None
    try:
        creds = Credentials.from_authorized_user_info(doc["creds_json"], SCOPES)
    except Exception:
        return None
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                tokens_col.update_one(
                    {"email": email},
                    {"$set": {"creds_json": json.loads(creds.to_json())}},
                    upsert=True
                )
                return creds
            except Exception:
                return None
        return None
    return creds

def generate_authorization_url(email: str):
    """Start OAuth flow and make sure account is saved in DB."""
    redirect_uri = BACKEND_BASE.rstrip("/") + "/oauth2callback"

    # --- ensure account exists first ---
    accounts_col.update_one(
        {"email": email},
        {"$setOnInsert": {"lastEmailTs": None}},
        upsert=True
    )

    # --- build OAuth flow ---
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE, scopes=SCOPES, redirect_uri=redirect_uri
    )
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        login_hint=email
    )

    # --- save mapping state → email ---
    oauth_col.update_one(
        {"state": state},
        {"$set": {"email": email, "created_at": datetime.utcnow().isoformat()}},
        upsert=True
    )
    return auth_url, state

def exchange_code_for_token(state: str, code: str):
    mapping = oauth_col.find_one({"state": state})
    if not mapping:
        raise RuntimeError("Unknown OAuth state")
    email = mapping["email"]

    redirect_uri = BACKEND_BASE.rstrip("/") + "/oauth2callback"
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE, scopes=SCOPES, state=state, redirect_uri=redirect_uri
    )
    flow.fetch_token(code=code)
    creds = flow.credentials

    # --- save token ---
    tokens_col.update_one(
        {"email": email},
        {"$set": {"creds_json": json.loads(creds.to_json())}},
        upsert=True
    )

    # cleanup state
    oauth_col.delete_one({"state": state})

    # ensure account is present (in case frontend skipped POST /accounts)
    accounts_col.update_one(
        {"email": email},
        {"$set": {"lastEmailTs": None}},
        upsert=True
    )

    return email

# ---------- EMAIL FETCHING ----------
def is_blocked(sender): 
    return any(b in sender.lower() for b in BLOCKED_SENDERS)

def fetch_latest_emails(service, email, max_results=20):
    results = service.users().messages().list(userId=email, q="in:inbox", maxResults=max_results).execute()
    messages = results.get("messages", [])
    emails = []
    for msg in messages:
        msg_data = service.users().messages().get(userId=email, id=msg["id"], format="full").execute()
        headers = msg_data["payload"].get("headers", [])
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
    doc = state_col.find_one({"email": email})
    last_seen = doc["last_ts"] if doc else None
    new_emails, max_ts = [], last_seen
    for e in emails:
        ts = datetime.fromisoformat(e["date"])
        if not last_seen or ts.isoformat() > last_seen:
            new_emails.append(e)
            if not max_ts or ts.isoformat() > max_ts:
                max_ts = ts.isoformat()
    if max_ts:
        state_col.update_one({"email": email}, {"$set": {"last_ts": max_ts}}, upsert=True)
        accounts_col.update_one({"email": email}, {"$set": {"lastEmailTs": max_ts}}, upsert=True)
    return new_emails

# ---------- HIGH-LEVEL ----------
def fetch_for_emails(email_list, max_results=20):
    emails_by_account, missing_auth = {}, []
    for email in email_list:
        try:
            creds = ensure_creds(email)
            if not creds:
                missing_auth.append(email)
                continue
            service = build("gmail", "v1", credentials=creds)
            latest = fetch_latest_emails(service, email, max_results=max_results)
            filtered = filter_new_emails(email, latest)
            emails_by_account[email] = filtered
        except Exception as e:
            print(f"Error fetching {email}: {e}")
            missing_auth.append(email)
    return {"emails_by_account": emails_by_account, "missing_auth": missing_auth}

if __name__ == "__main__":
    emails = input("Enter emails: ").split(",")
    print(fetch_for_emails([e.strip() for e in emails if e.strip()]))
