from __future__ import print_function
import os
import re
import json
from datetime import datetime, timezone
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

# Gmail Readonly scope
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']

# List of blocked domains or senders you don't want to analyze
BLOCKED_SENDERS = [
    "nytimes.com",
    "substack.com",
]

def safe_filename(email):
    """Sanitize email so we can use it as a filename."""
    return re.sub(r'[^a-zA-Z0-9_.-]', '_', email)

def ensure_creds(email):
    """Ensure credentials exist for the given email."""
    os.makedirs("tokens", exist_ok=True)
    token_path = os.path.join("tokens", f"{safe_filename(email)}.json")
    
    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                'credentials.json', SCOPES
            )
            creds = flow.run_local_server(port=0)
        with open(token_path, 'w') as f:
            f.write(creds.to_json())
    return creds

def is_blocked(sender):
    """Check if the sender's email or domain is in the blocked list."""
    sender = sender.lower()
    return any(blocked in sender for blocked in BLOCKED_SENDERS)

def fetch_latest_emails(service, max_results=5):
    """Fetch metadata of the latest emails (subject, from, date)."""

    # Try primary inbox first
    results = service.users().messages().list(
        userId='me',
        q='in:inbox category:primary',
        maxResults=max_results
    ).execute()

    messages = results.get('messages', [])

    # If no messages found (common in school accounts), fallback to plain inbox
    if not messages:
        results = service.users().messages().list(
            userId='me',
            q='in:inbox',
            maxResults=max_results
        ).execute()
        messages = results.get('messages', [])

    emails = []
    for msg in messages:
        msg_data = service.users().messages().get(
            userId='me', id=msg['id'], format='metadata',
            metadataHeaders=['Subject', 'From', 'Date']
        ).execute()

        headers = msg_data['payload']['headers']
        subject = next((h['value'] for h in headers if h['name'] == 'Subject'), '(no subject)')
        sender = next((h['value'] for h in headers if h['name'] == 'From'), '(unknown sender)')
        date_hdr = next((h['value'] for h in headers if h['name'] == 'Date'), '(no date)')

        ts = datetime.fromtimestamp(int(msg_data['internalDate'])/1000, tz=timezone.utc).astimezone()

        # ✅ Skip blocked senders
        if is_blocked(sender):
            continue

        emails.append({
            "subject": subject,
            "from": sender,
            "date": ts.isoformat(),
            "date_header": date_hdr
        })
    return emails

def main():
    raw_input = input("Enter email addresses (comma separated): ").strip()
    email_list = [e.strip() for e in raw_input.split(",") if e.strip()]

    if not email_list:
        print("No emails entered.")
        return

    for email in email_list:
        print(f"\n🔑 Authorizing and fetching emails for: {email}")
        creds = ensure_creds(email)
        service = build('gmail', 'v1', credentials=creds)

        latest_emails = fetch_latest_emails(service, max_results=5)

        if not latest_emails:
            print("No relevant emails found.")
        else:
            print(f"\n📨 Latest filtered emails for {email}:\n")
            print(json.dumps(latest_emails, indent=2))  # ✅ JSON format for ai_utils

    # ✅ Return value for ai_utils
    return latest_emails if email_list else []

if __name__ == '__main__':
    emails_for_ai = main()
