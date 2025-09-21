# app.py
from fastapi import FastAPI, Request, Query
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import json
import os
import logging

# Import ai_utils and model_utils
import ai_utils
import model_utils

app = FastAPI()

# configure logging
logging.basicConfig(level=logging.INFO)

# allow both local dev and production origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:8000",
        "https://gmail-ai-analyzer.vercel.app",
        "https://gmail-ai-analyzer.onrender.com",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

EMAIL_STATE_FILE = os.path.join(os.path.dirname(__file__), "email_state.json")


@app.post("/start_auth")
async def start_auth(request: Request):
    """
    Request body JSON: { "email": "user@example.com" }
    Returns: { "auth_url": "https://accounts.google.com/...", "state": "..." }
    """
    try:
        data = await request.json()
        email = data.get("email")
        logging.info(f"📩 /start_auth called with: {email}")

        if not email:
            logging.error("❌ Missing email in request")
            return JSONResponse({"error": "email required"}, status_code=400)

        auth_url, state = model_utils.generate_authorization_url(email)
        logging.info(f"✅ Generated auth URL for {email}")

        return JSONResponse({"auth_url": auth_url, "state": state}, status_code=200)

    except Exception as e:
        logging.exception("🔥 Error in /start_auth")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/oauth2callback")
def oauth2callback(code: str = Query(None), state: str = Query(None)):
    if not code or not state:
        return HTMLResponse("<h1>Missing code/state</h1>", status_code=400)
    try:
        email = model_utils.exchange_code_for_token(state, code)
        frontend = os.getenv("FRONTEND_URL", "https://gmail-ai-analyzer.vercel.app")
        redirect_to = f"{frontend}/?auth=success&email={email}"
        logging.info(f"✅ OAuth success for {email}, redirecting to {redirect_to}")
        return RedirectResponse(redirect_to)
    except Exception as e:
        logging.exception("🔥 OAuth callback failed")
        return HTMLResponse(f"<h1>Auth failed: {e}</h1>", status_code=500)


@app.post("/analyze")
async def analyze(request: Request):
    try:
        payload = await request.json()
        emails = payload.get("emails", [])
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    if not emails or not isinstance(emails, list):
        return JSONResponse({"error": "emails list required"}, status_code=400)

    try:
        result = model_utils.fetch_for_emails(emails, max_results=20)
        missing = result.get("missing_auth", [])
        if missing:
            return JSONResponse({"missing_auth": missing}, status_code=200)

        from ai_utils import extract_tasks_from_emails
        from pymongo import MongoClient
        from bson import ObjectId

        client = MongoClient(os.getenv("MONGO_URI", "mongodb://localhost:27017"))
        db = client["gmail_ai"]
        tasks_col = db["extractedtasks"]
        accounts_col = db["extractedaccounts"]

        all_inserted = []

        for acct, emails in result["emails_by_account"].items():
            tasks = extract_tasks_from_emails(emails, acct)
            if not tasks:
                continue

            for t in tasks:
                t["_source_account"] = acct
                t.setdefault("_id", str(ObjectId()))
                tasks_col.update_one(
                    {"_source_account": acct, "source_email_ts": t.get("source_email_ts")},
                    {"$set": t},
                    upsert=True
                )
                all_inserted.append(t)

            if emails:
                last_ts = max(e["date"] for e in emails)
                accounts_col.update_one(
                    {"email": acct},
                    {"$set": {"lastEmailTs": last_ts}},
                    upsert=True
                )

        return JSONResponse({"inserted": len(all_inserted)}, status_code=200)

    except Exception as e:
        logging.exception("🔥 ERROR in /analyze")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/email_state")
def get_email_state():
    if not os.path.exists(EMAIL_STATE_FILE):
        return JSONResponse(
            content={"error": "No email_state.json found. Run /analyze first."},
            status_code=404,
        )
    try:
        with open(EMAIL_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return JSONResponse(content=data, status_code=200)
    except Exception as e:
        return JSONResponse(
            content={"error": f"Failed to load email_state.json: {str(e)}"},
            status_code=500,
        )


@app.patch("/email_state")
async def patch_email_state(request: Request):
    try:
        body = await request.json()
        item_id = body.get("id")
        if not item_id:
            return JSONResponse({"error": "id required"}, status_code=400)

        with open(EMAIL_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        updated = False
        for account, items in data.items():
            for it in items:
                if str(it.get("_id")) == str(item_id):
                    it["addedToCalendar"] = bool(body.get("addedToCalendar", True))
                    updated = True
                    break
            if updated:
                break

        if updated:
            with open(EMAIL_STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return JSONResponse({"ok": True}, status_code=200)
        else:
            return JSONResponse({"error": "item not found"}, status_code=404)

    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/email_state")
def delete_email_state(id: str = Query(None)):
    if not id:
        return JSONResponse({"error": "id query param required"}, status_code=400)

    if not os.path.exists(EMAIL_STATE_FILE):
        return JSONResponse({"error": "no email_state file"}, status_code=404)

    try:
        with open(EMAIL_STATE_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)

        removed = False
        for account, items in list(data.items()):
            new_items = [it for it in items if str(it.get("_id")) != str(id)]
            if len(new_items) != len(items):
                data[account] = new_items
                removed = True

        if removed:
            with open(EMAIL_STATE_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return JSONResponse({"ok": True}, status_code=200)
        else:
            return JSONResponse({"error": "id not found"}, status_code=404)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/date")
def get_current_date():
    now = datetime.now()
    return {
        "date": now.strftime("%A, %B %d, %Y"),
        "time": now.strftime("%I:%M %p"),
    }
