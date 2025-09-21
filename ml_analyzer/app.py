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
logger = logging.getLogger(__name__)

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
        logger.info(f"📩 /start_auth called with: {email}")

        if not email:
            logger.error("❌ Missing email in request")
            return JSONResponse({"error": "email required"}, status_code=400)

        auth_url, state = model_utils.generate_authorization_url(email)
        logger.info(f"✅ Generated auth URL for {email}: {auth_url}")

        return JSONResponse({"auth_url": auth_url, "state": state}, status_code=200)

    except Exception as e:
        logger.exception("🔥 Error in /start_auth")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/oauth2callback")
def oauth2callback(code: str = Query(None), state: str = Query(None)):
    """
    OAuth redirect URI: google will redirect here with code & state.
    We exchange the code for tokens and save them for the mapped email.
    After successful exchange we redirect users to the frontend (or show success page).
    """
    if not code or not state:
        return HTMLResponse("<h1>Missing code/state</h1>", status_code=400)
    try:
        email = model_utils.exchange_code_for_token(state, code)
        frontend = os.getenv("FRONTEND_URL", "https://gmail-ai-analyzer.vercel.app").rstrip("/")
        redirect_to = f"{frontend}/?auth=success&email={email}"
        logger.info(f"✅ OAuth success for {email}, redirecting to {redirect_to}")
        return RedirectResponse(redirect_to)
    except Exception as e:
        logger.exception("🔥 OAuth callback failed")
        return HTMLResponse(f"<h1>Auth failed: {e}</h1>", status_code=500)


@app.post("/analyze")
async def analyze(request: Request):
    """
    POST body: { "emails": ["a@x.com","b@y.com"] }
    Uses saved tokens to fetch Gmail, extract tasks, and persist them to Mongo.
    """
    try:
        payload = await request.json()
        emails = payload.get("emails", [])
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    if not emails or not isinstance(emails, list):
        return JSONResponse({"error": "emails list required"}, status_code=400)

    try:
        # 1) ask model_utils to fetch for the given accounts (returns missing_auth if any)
        result = model_utils.fetch_for_emails(emails, max_results=20)
        missing = result.get("missing_auth", [])
        if missing:
            logger.info(f"/analyze: missing auth for {missing}")
            return JSONResponse({"missing_auth": missing}, status_code=200)

        # 2) Try to import the AI extraction function; if not present, fallback to simple converter
        extract_fn = None
        try:
            extract_fn = getattr(ai_utils, "extract_tasks_from_emails")
            logger.info("Using ai_utils.extract_tasks_from_emails")
        except Exception:
            logger.warning("ai_utils.extract_tasks_from_emails not found — falling back to simple conversion")

        # 3) Connect to Mongo for persistence (use MONGO_URI env var)
        from pymongo import MongoClient
        from bson import ObjectId

        mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        try:
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            db = client["gmail_ai"]
            tasks_col = db["extractedtasks"]
            accounts_col = db["extractedaccounts"]
            logger.info(f"Connected to MongoDB at {mongo_uri}")
        except Exception as e:
            logger.exception(f"Could not connect to Mongo for /analyze: {e}")
            # fail early, because we can't persist results reliably
            return JSONResponse({"error": "MongoDB connection failed"}, status_code=500)

        all_inserted = []

        # iterate over accounts -> emails
        for acct, account_emails in result["emails_by_account"].items():
            if not account_emails:
                continue

            # call AI extraction (or fallback)
            try:
                if extract_fn:
                    tasks = extract_fn(account_emails, acct)
                else:
                    # fallback: make simple tasks from email subjects
                    tasks = []
                    for em in account_emails:
                        title = em.get("subject", "(no subject)")
                        snippet = (em.get("content") or "")[:400]
                        tasks.append({
                            "title": title,
                            "description": snippet,
                            "source_subject": em.get("subject"),
                            "source_from": em.get("from"),
                            "source_email_ts": em.get("date"),
                            "confidence": 1.0,
                        })
            except Exception as e:
                logger.exception(f"AI extraction failed for account {acct}: {e}")
                continue

            if not tasks:
                continue

            # upsert each task (use source_email_ts + account as de-dup key)
            for t in tasks:
                t["_source_account"] = acct
                # make a Mongo ObjectId string if not present
                t.setdefault("_id", str(ObjectId()))
                key = {"_source_account": acct, "source_email_ts": t.get("source_email_ts")}
                try:
                    tasks_col.update_one(key, {"$set": t}, upsert=True)
                    all_inserted.append(t)
                except Exception as e:
                    logger.exception(f"Failed to upsert task for {acct}: {e}")

            # update lastEmailTs for account (persist where possible)
            try:
                last_ts = max(e.get("date") for e in account_emails)
                accounts_col.update_one({"email": acct}, {"$set": {"lastEmailTs": last_ts}}, upsert=True)
            except Exception as e:
                logger.exception(f"Failed to update account lastEmailTs for {acct}: {e}")

        logger.info(f"/analyze: inserted {len(all_inserted)} tasks")
        return JSONResponse({"inserted": len(all_inserted)}, status_code=200)

    except Exception as e:
        logger.exception("🔥 ERROR in /analyze")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/email_state")
def get_email_state():
    """
    Return the most recent extracted email tasks/events,
    if email_state.json exists. Kept for backwards compatibility.
    """
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
    """
    Body example: { "id": "<item_id>", "addedToCalendar": true }
    Updates the in-file object only (no DB).
    """
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
