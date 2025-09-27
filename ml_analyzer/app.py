
# app.py
from fastapi import FastAPI, Request, Query
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import json
import os
import logging

import model_utils  # safe import (handles DB connectivity gracefully)

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
        logger.info(f"✅ Generated auth URL for {email}: {auth_url} (state={state})")
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
        frontend = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
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
    Uses ai_utils to analyze the emails (ai_utils will call model_utils.fetch_for_emails).
    Persists extracted tasks to Mongo.
    """
    try:
        payload = await request.json()
        emails = payload.get("emails", [])
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    if not emails or not isinstance(emails, list):
        return JSONResponse({"error": "emails list required"}, status_code=400)

    try:
        # lazy import to avoid circular imports at module import time
        import ai_utils

        # Call ai_utils high-level analysis. This will call model_utils.fetch_for_emails internally.
        # ai_utils.analyze_for_emails returns either {"missing_auth": [...] } or { acct_email: [items...] }
        logger.info(f"/analyze: starting AI analysis for {len(emails)} accounts")
        analysis_result = ai_utils.analyze_for_emails(emails, save_output=False)

        if not analysis_result:
            # empty result (no items) is acceptable
            logger.info("/analyze: ai_utils returned empty result")
            return JSONResponse({"inserted": 0}, status_code=200)

        if isinstance(analysis_result, dict) and analysis_result.get("missing_auth"):
            missing = analysis_result.get("missing_auth", [])
            logger.info(f"/analyze: missing auth for accounts: {missing}")
            return JSONResponse({"missing_auth": missing}, status_code=200)

        # analysis_result is expected to be { account_email: [extracted_items...] }
        from pymongo import MongoClient
        from bson import ObjectId

        mongo_uri = os.getenv("MONGO_URI", "mongodb://localhost:27017")
        try:
            client = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)
            client.admin.command("ping")
            db = client["gmail-analyzer"]
            tasks_col = db["extractedtasks"]
            accounts_col = db["extractedaccounts"]
            logger.info(f"/analyze: connected to Mongo at {mongo_uri}")
        except Exception as e:
            logger.exception(f"/analyze: could not connect to Mongo: {e}")
            return JSONResponse({"error": "MongoDB connection failed"}, status_code=500)

        all_inserted = []

        # Persist extracted items per account
        for acct, items in analysis_result.items():
            if not isinstance(items, list) or len(items) == 0:
                continue

            for item in items:
                # attach metadata
                item["_source_account"] = acct
                # ensure _id
                item.setdefault("_id", str(ObjectId()))
                # Dedup/Upsert key:
                if item.get("source_email_ts"):
                    key = {"_source_account": acct, "source_email_ts": item.get("source_email_ts")}
                else:
                    # fallback key using subject/title; this may create duplicates if not unique
                    key = {"_source_account": acct, "title": item.get("title"), "source_subject": item.get("source_subject")}
                try:
                    tasks_col.update_one(key, {"$set": item}, upsert=True)
                    all_inserted.append(item)
                except Exception as e:
                    logger.exception(f"/analyze: failed to upsert task for {acct} item={item}: {e}")

            # Try update account lastEmailTs from model_utils state if possible (model_utils updates it on fetch)
            try:
                # If model_utils updated accounts_col, this will succeed; if not present, no-op.
                # We attempt a best-effort read of the lastEmailTs from model_utils.accounts_col if available.
                if getattr(model_utils, "accounts_col", None) is not None:
                    acct_doc = model_utils.accounts_col.find_one({"email": acct})
                    if acct_doc and acct_doc.get("lastEmailTs"):
                        accounts_col.update_one({"email": acct}, {"$set": {"lastEmailTs": acct_doc.get("lastEmailTs")}}, upsert=True)
                        logger.info(f"/analyze: synced lastEmailTs for {acct}: {acct_doc.get('lastEmailTs')}")
            except Exception as e:
                logger.exception(f"/analyze: failed to sync account lastEmailTs for {acct}: {e}")

        logger.info(f"/analyze: inserted/updated {len(all_inserted)} extracted items")
        return JSONResponse({"inserted": len(all_inserted)}, status_code=200)

    except Exception as e:
        logger.exception("🔥 ERROR in /analyze")
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/date")
def get_current_date():
    now = datetime.now()
    return {"date": now.strftime("%A, %B %d, %Y"), "time": now.strftime("%I:%M %p")}
