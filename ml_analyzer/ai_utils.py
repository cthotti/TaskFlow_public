
# ai_utils.py  (modified additions included)
from __future__ import print_function
import os
import time
import json
import re
from typing import List, Dict, Any, Tuple

import google.generativeai as genai

# Import your existing model_utils (must be in same package or Python path)
import model_utils

# Choose model: gemini-1.5-flash is a good free-tier default for extraction
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
API_KEY = os.getenv("GEMINI_API_KEY", None)

# small safety defaults
REQUEST_SLEEP_SECONDS = 1.0  # throttle between requests
MAX_RETRIES = 2
OUTPUT_FILE = "tasks_extracted.json"

if not API_KEY:
    raise RuntimeError("Please set the GEMINI_API_KEY environment variable before running ai_utils.py")

# configure client
genai.configure(api_key=API_KEY)
model = genai.GenerativeModel(GEMINI_MODEL)


def _safe_json_extract(text: str) -> Any:
    """
    Try to find and parse the first top-level JSON (array or object) in the text.
    Returns parsed JSON or raises ValueError.
    """
    text = text.strip()
    # quick attempt: if entire text is JSON
    try:
        return json.loads(text)
    except Exception:
        pass

    # find first '[' ... matching ']' (array) or '{' ... matching '}'
    for open_ch, close_ch in (('[', ']'), ('{', '}')):
        start = text.find(open_ch)
        if start == -1:
            continue
        stack = 0
        for i in range(start, len(text)):
            if text[i] == open_ch:
                stack += 1
            elif text[i] == close_ch:
                stack -= 1
                if stack == 0:
                    candidate = text[start:i+1]
                    try:
                        return json.loads(candidate)
                    except Exception:
                        # continue searching (maybe nested garbage)
                        break
    raise ValueError("No valid JSON found in model output")

def _clean_model_response(raw: str) -> str:
    """
    Basic cleanup for model output before JSON parsing:
    - Remove code fences ``` ``` and leading/trailing backticks
    - Normalize whitespace
    """
    # remove triple backtick code fences
    cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE)
    cleaned = cleaned.replace("```", "").strip()
    # remove single backticks
    cleaned = cleaned.strip("` \n\t")
    # collapse multiple newlines/spaces
    cleaned = re.sub(r'\r\n', '\n', cleaned)
    cleaned = re.sub(r'\n{2,}', '\n', cleaned)
    return cleaned.strip()

PROMPT_TEMPLATE = """
You are an assistant that extracts actionable tasks and events from email text.

Each object must include:
- "type": either "task", "event", or "null"
- "title": short title (5-10 words max)
- "description": one-sentence description
- "date": ISO 8601 date (YYYY-MM-DD) or null
- "time": HH:MM 24h format or null

Rules:
1. Do not include items with "null" type.
2. If an item has no date, exclude it UNLESS it relates to internships, applications, or scholarships.
3. All other items without dates should be excluded.

If the email contains no valid tasks or events, return an empty array: [].

Email subject:
{subject}

Email content:
{content}

Return JSON ONLY (no extra commentary).
"""

def analyze_single_email(email_record: Dict[str, Any], retries: int = MAX_RETRIES) -> List[Dict[str, Any]]:
    """
    Send a single email to Gemini and return parsed JSON list of extracted items.
    email_record must contain 'subject' and 'content' keys (if content missing, an empty string will be passed).
    """
    subject = email_record.get("subject", "")
    content = email_record.get("content", "") or email_record.get("body", "") or ""
    prompt = PROMPT_TEMPLATE.format(subject=subject, content=content)

    attempt = 0
    last_exception = None
    while attempt <= retries:
        attempt += 1
        try:
            # Use the generative model interface; this returns a response-like object
            resp = model.generate_content(prompt)
            # resp.text or resp.content may exist depending on client version; convert robustly
            raw_text = ""
            if hasattr(resp, "text"):
                raw_text = resp.text
            elif hasattr(resp, "content"):
                raw_text = resp.content
            else:
                raw_text = str(resp)

            cleaned = _clean_model_response(raw_text)

            parsed = _safe_json_extract(cleaned)
            # ensure the parsed result is a list
            if isinstance(parsed, dict):
                parsed = [parsed]
            if not isinstance(parsed, list):
                raise ValueError("Model returned JSON not an array")
            # Add missing metadata fields from email_record to each extracted item if absent
            for item in parsed:
                item.setdefault("source_subject", subject)
                item.setdefault("source_from", email_record.get("from", ""))
                item.setdefault("confidence", item.get("confidence", 0.9))
                # normalize date/time nulls
                if item.get("date") is None:
                    item["date"] = None
                if item.get("time") is None:
                    item["time"] = None
            # Respect rate limit pause
            time.sleep(REQUEST_SLEEP_SECONDS)
            return parsed
        except Exception as e:
            last_exception = e
            print(f"Warning: model parse attempt {attempt} failed: {e}")
            # backoff then retry
            time.sleep(REQUEST_SLEEP_SECONDS * attempt)
    # if we get here, all retries failed
    print("ERROR: Failed to parse model output into JSON. Returning empty list.")
    # As a fallback, return empty list (could also return raw_text if you want)
    return []

# ---------- New: analyze_for_emails ----------

def analyze_for_emails(email_list, save_output: bool = True) -> dict:
    """
    Non-interactive analysis for a list of emails.
    Calls model_utils.fetch_for_emails to get data per account,
    then runs Gemini extraction.
    """
    fetch_result = model_utils.fetch_for_emails(email_list)
    emails_by_account = fetch_result.get("emails_by_account", {})
    missing_auth = fetch_result.get("missing_auth", [])

    if missing_auth:
        return {"missing_auth": missing_auth}

    result: Dict[str, List[Dict[str, Any]]] = {}
    for account, emails in emails_by_account.items():
        result[account] = []
        for email_record in emails:
            extracted = analyze_single_email(email_record)
            for item in extracted:
                item["_source_account"] = account
            result[account].extend(extracted)

    if save_output:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    return result



def analyze_all_from_model_utils(save_output: bool = True) -> Dict[str, List[Dict[str, Any]]]:
    """
    Calls model_utils.main() to obtain the email JSON output, analyzes each email with Gemini,
    and returns a dict mapping source accounts (if available) to lists of extracted tasks/events.

    model_utils.main() may return:
      - a list of email dicts (flattened across accounts)
      - OR a dict { account_email: [email_dicts...] }
    """

    # 1) run model_utils and get email JSON
    print("Running model_utils to fetch emails (you may be prompted to authenticate)...")
    fetched = model_utils.main()  # interactive; returns data

    # Normalize to a dict per-account: if list → use fallback key "all_accounts"
    emails_by_account: Dict[str, List[Dict[str, Any]]] = {}
    if isinstance(fetched, dict):
        # assume structure { account_email: [email_dicts...] }
        emails_by_account = {k: v if isinstance(v, list) else [] for k, v in fetched.items()}
    elif isinstance(fetched, list):
        emails_by_account["all_accounts"] = fetched
    else:
        raise RuntimeError("Unexpected return type from model_utils.main(): " + str(type(fetched)))

    # 2) Analyze each email
    result: Dict[str, List[Dict[str, Any]]] = {}
    for account, emails in emails_by_account.items():
        print(f"\nAnalyzing {len(emails)} emails for account: {account}")
        result[account] = []
        for idx, email_record in enumerate(emails, start=1):
            print(f"  → Analyzing email #{idx}: {email_record.get('subject', '(no subject)')[:80]}")
            extracted = analyze_single_email(email_record)
            # attach extracted items, optionally include a pointer to the original email
            for item in extracted:
                item["_source_account"] = account
            result[account].extend(extracted)

    # 3) Save output
    if save_output:
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print(f"\nSaved extracted tasks/events to {OUTPUT_FILE}")

    # 4) Pretty-print to terminal
    for account, items in result.items():
        print(f"\n--- Extracted for {account} ({len(items)} items) ---")
        for it in items:
            print(json.dumps(it, ensure_ascii=False, indent=2))

    return result