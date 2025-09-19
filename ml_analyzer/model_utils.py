# model_utils.py
from __future__ import print_function
import os
import re
import json
import google.auth
import base64
from google.auth.exceptions import RefreshError
from googleapiclient.errors import HttpError
from datetime import datetime, timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

# Gmail Readonly scope
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

# List of blocked domains or senders you don't want to analyze
BLOCKED_SENDERS = [
    "nytimes.com",
    "substack.com",
    "noreply@ucsd.edu",
    "bankofamerica.com",
]

STATE_FILE = "email_state.json"
TOKENS_DIR = "tokens"
OAUTH_STATE_FILE = "oauth_state.json"
CLIENT_SECRETS_FILE = "credentials.json"
BACKEND_BASE = os.getenv("BACKEND_URL", "http://localhost:8000")  # used for redirect_uri

def safe_filename(email):
    """Sanitize email so we can use it as a filename."""
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', email)

def load_state():
    if os.path.exists(STATE_FILE):
        with open(STATE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_state(state):
    with open(STATE_FILE, "w") as f:
        json.dump(state, f)

def _token_path_for(email):
    os.makedirs(TOKENS_DIR, exist_ok=True)
    return os.path.join(TOKENS_DIR, f"{safe_filename(email)}.json")

def _oauth_state_load():
    if os.path.exists(OAUTH_STATE_FILE):
        with open(OAUTH_STATE_FILE, "r") as f:
            return json.load(f)
    return {}

def _oauth_state_save(state_map):
    with open(OAUTH_STATE_FILE, "w") as f:
        json.dump(state_map, f)

def ensure_creds(email: str, force_reauth: bool = False):
    """
    Non-interactive: attempt to load saved credentials for email and refresh them.
    Returns Credentials if valid, otherwise None (so caller can trigger web auth).
    """
    token_path = _token_path_for(email)
    creds = None
    if os.path.exists(token_path) and not force_reauth:
        try:
            creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        except Exception:
            creds = None

    if not creds:
        return None

    if not creds.valid:
        # Try to refresh if possible
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                # save updated token
                with open(token_path, "w") as f:
                    f.write(creds.to_json())
                return creds
            except Exception:
                return None
        else:
            return None

    return creds

def generate_authorization_url(email: str):
    """
    Create an OAuth authorization URL for the given email. Save state->email mapping.
    Returns (auth_url, state).
    """
    redirect_uri = BACKEND_BASE.rstrip("/") + "/oauth2callback"
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        redirect_uri=redirect_uri
    )
    auth_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        prompt='consent'
    )

    # persist state -> email mapping so callback can save the right token
    state_map = _oauth_state_load()
    state_map[state] = email
    _oauth_state_save(state_map)

    return auth_url, state

def exchange_code_for_token(state: str, code: str):
    """
    Exchange code from oauth callback for tokens and save to tokens/<email>.json
    Returns the email for which token was saved.
    """
    state_map = _oauth_state_load()
    email = state_map.get(state)
    if not email:
        raise RuntimeError("Unknown OAuth state")

    redirect_uri = BACKEND_BASE.rstrip("/") + "/oauth2callback"
    flow = Flow.from_client_secrets_file(
        CLIENT_SECRETS_FILE,
        scopes=SCOPES,
        state=state,
        redirect_uri=redirect_uri
    )
    # exchange token
    flow.fetch_token(code=code)
    creds = flow.credentials
    token_path = _token_path_for(email)
    with open(token_path, "w") as f:
        f.write(creds.to_json())

    # Optionally remove the state mapping (cleanup)
    try:
        del state_map[state]
        _oauth_state_save(state_map)
    except Exception:
        pass

    return email

def is_blocked(sender):
    """Check if the sender's email or domain is in the blocked list."""
    sender = sender.lower()
    return any(blocked in sender for blocked in BLOCKED_SENDERS)

def fetch_latest_emails(service, email, max_results=20):
    """Fetch metadata + body of the latest emails (unchanged from your version)."""
    results = service.users().messages().list(
        userId=email,
        q='in:inbox',
        maxResults=max_results
    ).execute()

    messages = results.get('messages', [])
    emails = []

    for msg in messages:
        msg_data = service.users().messages().get(
            userId=email, id=msg['id'], format='full'
        ).execute()

        headers = msg_data['payload']['headers']
        subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '(no subject)')
        sender = next((h['value'] for h in headers if h['name'] == 'From'), '(unknown sender)')
        date_hdr = next((h['value'] for h in headers if h['name'] == 'Date'), '(no date)')

        ts = datetime.fromtimestamp(
            int(msg_data['internalDate'])/1000, tz=timezone.utc
        ).astimezone()

        if is_blocked(sender):
            continue

        body = ""
        if 'parts' in msg_data['payload']:
            for part in msg_data['payload']['parts']:
                if part.get('mimeType') == 'text/plain' and 'data' in part.get('body', {}):
                    body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors="ignore")
                    break
        elif 'body' in msg_data['payload'] and 'data' in msg_data['payload']['body']:
            body = base64.urlsafe_b64decode(msg_data['payload']['body']['data']).decode('utf-8', errors="ignore")

        emails.append({
            "subject": subject,
            "from": sender,
            "date": ts.isoformat(),
            "date_header": date_hdr,
            "content": body.strip() if body else "(no content)"
        })
    return emails

def filter_new_emails(email, emails, state):
    """Filter emails newer than last seen timestamp (not just today)."""
    last_seen = state.get(email, None)

    new_emails = []
    max_ts = last_seen

    for e in emails:
        ts = datetime.fromisoformat(e["date"])
        if not last_seen or ts.isoformat() > last_seen:
            new_emails.append(e)
            if not max_ts or ts.isoformat() > max_ts:
                max_ts = ts.isoformat()

    # ✅ Update last seen timestamp
    if max_ts:
        state[email] = max_ts

    return new_emails

# ---------- New programmatic fetch function ----------
def fetch_for_emails(email_list, max_results=20):
    """
    Non-interactive fetch for a list of emails.
    Returns {"emails_by_account": {email: [email_dicts...]}, "missing_auth": [emails...]}
    """
    state = load_state()
    emails_by_account = {}
    missing_auth = []

    for email in email_list:
        try:
            creds = ensure_creds(email)
            if not creds:
                missing_auth.append(email)
                continue

            service = build('gmail', 'v1', credentials=creds)
            latest_emails = fetch_latest_emails(service, email, max_results=max_results)
            filtered = filter_new_emails(email, latest_emails, state)
            emails_by_account[email] = filtered
        except Exception as e:
            print(f"Error fetching emails for {email}: {e}")
            missing_auth.append(email)

    save_state(state)
    return {"emails_by_account": emails_by_account, "missing_auth": missing_auth}

# Keep your old CLI-style `main()` for local usage (unchanged or lightly tweaked).
def main():
    """
    Interactive CLI entry retained for local debugging.
    When running via backend / frontend, prefer fetch_for_emails().
    """
    state = load_state()
    raw_input = input("Enter email addresses (comma separated): ").strip()
    email_list = [e.strip() for e in raw_input.split(",") if e.strip()]

    if not email_list:
        print("No emails entered.")
        return []

    all_emails = []
    for email in email_list:
        print(f"\n🔑 Authorizing and fetching emails for: {email}")

        # Interactive fallback: if no saved token, perform local server flow
        creds = ensure_creds(email)
        if not creds:
            # fallback to interactive flow
            flow = Flow.from_client_secrets_file(CLIENT_SECRETS_FILE, scopes=SCOPES)
            creds = flow.run_local_server(port=0)
            token_path = _token_path_for(email)
            os.makedirs(TOKENS_DIR, exist_ok=True)
            with open(token_path, 'w') as f:
                f.write(creds.to_json())

        service = build('gmail', 'v1', credentials=creds)
        latest_emails = fetch_latest_emails(service, email, max_results=20)
        filtered_emails = filter_new_emails(email, latest_emails, state)

        if not filtered_emails:
            print("No new relevant emails found for today.")
        else:
            print(f"\n📨 New emails for {email}:\n")
            print(json.dumps(filtered_emails, indent=2))

        all_emails.extend(filtered_emails)

    save_state(state)
    return all_emails

if __name__ == '__main__':
    emails_for_ai = main()
