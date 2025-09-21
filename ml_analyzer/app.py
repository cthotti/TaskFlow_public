# app.py
from fastapi import FastAPI, Request, Query
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import json
import os
import logging

import model_utils  # safe to import; model_utils handles DB connectivity errors gracefully

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
    Returns: { "auth_url": "...", "state": "..." }
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
    OAuth redirect URI
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
        # import ai_utils lazily to avoid circular import at module import time
        import ai_utils

        # 1) fetch emails via model_utils (may return missing_auth list)
        result = model_utils.fetch_for_emails(emails, max_results=20)
        missing = result.get("missing_auth", [])
        if missing:
            logger.info(f"/analyze: missing auth for {missing}")
            return JSONResponse({"missing_auth": missing}, status_code=200)

        # 2) determine extraction function
        extract_fn = getattr(ai_utils, "extract_tasks_from_emails", None)
        if extract_fn:
            logger.info("Using ai_utils.extract_tasks_from_emails")
        else:
            logger.warning("ai_utils.extract_tasks_from_emails not found — falling back to simple conversion")

        # 3) connect to Mongo (use MONGO_URI env)
        from pymongo import MongoClient
        from bson import ObjectId

        mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        try:
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            db = client["gmail-analyzer"]
            tasks_col = db["extractedtasks"]
            accounts_col = db["extractedaccounts"]
            logger.info(f"Connected to MongoDB at {mongo_uri}")
        except Exception as e:
            logger.exception(f"Could not connect to Mongo for /analyze: {e}")
            return JSONResponse({"error": "MongoDB connection failed"}, status_code=500)

        all_inserted = []

        for acct, account_emails in result["emails_by_account"].items():
            if not account_emails:
                continue

            try:
                if extract_fn:
                    tasks = extract_fn(account_emails, acct)
                else:
                    # fallback: create simple tasks from subjects
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

            # Upsert each task using (_source_account, source_email_ts) as de-dupe key
            for t in tasks:
                t["_source_account"] = acct
                t.setdefault("_id", str(ObjectId()))
                key = {"_source_account": acct, "source_email_ts": t.get("source_email_ts")}
                try:
                    tasks_col.update_one(key, {"$set": t}, upsert=True)
                    all_inserted.append(t)
                except Exception as e:
                    logger.exception(f"Failed to upsert task for {acct}: {e}")

            # Update account lastEmailTs
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


@app.get("/date")
def get_current_date():
    now = datetime.now()
    return {"date": now.strftime("%A, %B %d, %Y"), "time": now.strftime("%I:%M %p")}
