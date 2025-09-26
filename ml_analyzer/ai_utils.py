# ai_utils.py  (updated)
from __future__ import print_function
import os
import time
import json
import re
from typing import List, Dict, Any, Optional

import google.generativeai as genai

# Import your existing model_utils (must be in same package or Python path)
import model_utils

# Choose model: gemini-1.5-flash is a good default
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
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass

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
                        break
    raise ValueError("No valid JSON found in model output")


def _clean_model_response(raw: str) -> str:
    cleaned = re.sub(r"```(?:json)?", "", raw, flags=re.IGNORECASE)
    cleaned = cleaned.replace("```", "").strip()
    cleaned = cleaned.strip("` \n\t")
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
    subject = email_record.get("subject", "")
    content = email_record.get("content", "") or email_record.get("body", "") or ""
    prompt = PROMPT_TEMPLATE.format(subject=subject, content=content)

    attempt = 0
    while attempt <= retries:
        attempt += 1
        try:
            resp = model.generate_content(prompt)
            raw_text = ""
            if hasattr(resp, "text"):
                raw_text = resp.text
            elif hasattr(resp, "content"):
                raw_text = resp.content
            else:
                raw_text = str(resp)

            cleaned = _clean_model_response(raw_text)
            parsed = _safe_json_extract(cleaned)
            if isinstance(parsed, dict):
                parsed = [parsed]
            if not isinstance(parsed, list):
                raise ValueError("Model returned JSON not an array")

            for item in parsed:
                item.setdefault("source_subject", subject)
                item.setdefault("source_from", email_record.get("from", ""))
                item.setdefault("confidence", item.get("confidence", 0.9))
                if item.get("date") is None:
                    item["date"] = None
                if item.get("time") is None:
                    item["time"] = None

            time.sleep(REQUEST_SLEEP_SECONDS)
            return parsed
        except Exception as e:
            print(f"Warning: model parse attempt {attempt} failed: {e}")
            time.sleep(REQUEST_SLEEP_SECONDS * attempt)

    print("ERROR: Failed to parse model output into JSON. Returning empty list.")
    return []


def analyze_for_emails(email_list: List[str], owner: Optional[str] = None, save_output: bool = True) -> Dict[str, Any]:
    """
    High-level: fetch emails (owner-aware) and analyze each email with Gemini.
    Returns either {"missing_auth": [...]} or { account_email: [items...] }.
    """
    fetch_result = model_utils.fetch_for_emails(email_list, owner=owner)
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
                if owner:
                    item["owner"] = owner
            result[account].extend(extracted)

    if save_output:
        try:
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Warning: failed to persist ai output to {OUTPUT_FILE}: {e}")

    return result


def analyze_all_from_model_utils(save_output: bool = True) -> Dict[str, List[Dict[str, Any]]]:
    fetched = model_utils.main()
    emails_by_account = {}
    if isinstance(fetched, dict):
        emails_by_account = {k: v if isinstance(v, list) else [] for k, v in fetched.items()}
    elif isinstance(fetched, list):
        emails_by_account["all_accounts"] = fetched
    else:
        raise RuntimeError("Unexpected return type from model_utils.main(): " + str(type(fetched)))

    result: Dict[str, List[Dict[str, Any]]] = {}
    for account, emails in emails_by_account.items():
        result[account] = []
        for email_record in emails:
            extracted = analyze_single_email(email_record)
            for item in extracted:
                item["_source_account"] = account
            result[account].extend(extracted)

    if save_output:
        try:
            with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
                json.dump(result, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"Warning: failed to persist ai output to {OUTPUT_FILE}: {e}")

    return result
