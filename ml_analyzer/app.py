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
    Request body JSON: { "email": "user@example.com", "owner": "<optional user id/username>" }
    Returns: { "auth_url": "...", "state": "..." }
    """
    try:
        data = await request.json()
        email = (data.get("email") or "").strip()
        owner = data.get("owner")  # may be None
        logger.info(f"📩 /start_auth called with: {email} owner={owner}")

        if not email:
            logger.error("❌ Missing email in request")
            return JSONResponse({"error": "email required"}, status_code=400)

        # pass owner through to model_utils so oauth mapping / account docs are owner-aware
        auth_url, state = model_utils.generate_authorization_url(email, owner=owner)
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
        # model_utils.exchange_code_for_token now returns a dict {"email": ..., "owner": ...}
        mapping = model_utils.exchange_code_for_token(state, code)
        if isinstance(mapping, dict):
            email = mapping.get("email")
            owner = mapping.get("owner")
        else:
            # backward compat: if it returns email string
            email = mapping
            owner = None

        frontend = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
        # include owner if present
        qs = f"?auth=success&email={email}"
        if owner:
            qs += f"&owner={owner}"
        redirect_to = f"{frontend}/{qs}"
        logger.info(f"✅ OAuth success for {email}, redirecting to {redirect_to}")
        return RedirectResponse(redirect_to)
    except Exception as e:
        logger.exception("🔥 OAuth callback failed")
        return HTMLResponse(f"<h1>Auth failed: {e}</h1>", status_code=500)


@app.post("/analyze")
async def analyze(request: Request):
    """
    POST body: { "emails": ["a@x.com","b@y.com"], "owner": "<optional user id/username>" }
    Uses ai_utils to analyze the emails (ai_utils will call model_utils.fetch_for_emails).
    Persists extracted tasks to Mongo; saved docs will include `owner` when provided.
    """
    try:
        payload = await request.json()
        emails = payload.get("emails", [])
        owner = payload.get("owner")
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    if not emails or not isinstance(emails, list):
        return JSONResponse({"error": "emails list required"}, status_code=400)

    try:
        # lazy import to avoid circular imports
        import ai_utils

        logger.info(f"/analyze: starting AI analysis for {len(emails)} accounts owner={owner}")

        # pass owner into ai_utils so fetch/save paths can be owner-aware
        analysis_result = ai_utils.analyze_for_emails(emails, owner=owner, save_output=False)

        if not analysis_result:
            logger.info("/analyze: ai_utils returned empty result")
            return JSONResponse({"inserted": 0}, status_code=200)

        if isinstance(analysis_result, dict) and analysis_result.get("missing_auth"):
            missing = analysis_result.get("missing_auth", [])
            logger.info(f"/analyze: missing auth for accounts: {missing}")
            return JSONResponse({"missing_auth": missing}, status_code=200)

        # connect to Mongo to persist results
        from pymongo import MongoClient

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
        # analysis_result expected: { acct_email: [items...] }
        for acct, items in analysis_result.items():
            if not isinstance(items, list) or len(items) == 0:
                continue

            for item in items:
                # ensure metadata fields
                item["_source_account"] = acct
                if owner:
                    item["owner"] = owner

                # remove incoming _id so Mongo generates a proper ObjectId
                item.pop("_id", None)

                # construct dedupe key that includes owner if present to ensure per-user isolation
                if item.get("source_email_ts"):
                    key = {"_source_account": acct, "source_email_ts": item.get("source_email_ts")}
                else:
                    key = {"_source_account": acct, "title": item.get("title"), "source_subject": item.get("source_subject")}

                # include owner in dedupe query if present
                if owner:
                    key["owner"] = owner

                try:
                    tasks_col.update_one(
                        key,
                        {"$set": item, "$setOnInsert": {"createdAt": datetime.utcnow()}},
                        upsert=True,
                    )
                    all_inserted.append(item)
                except Exception as e:
                    logger.exception(f"/analyze: failed to upsert task for {acct} item={item}: {e}")

            # Sync lastEmailTs from model_utils.accounts_col if available and attach owner
            try:
                if getattr(model_utils, "accounts_col", None) is not None:
                    acct_doc = model_utils.accounts_col.find_one({"email": acct})
                    if acct_doc and acct_doc.get("lastEmailTs"):
                        q = {"email": acct}
                        if owner:
                            q["owner"] = owner
                        accounts_col.update_one(q, {"$set": {"lastEmailTs": acct_doc.get("lastEmailTs"), "owner": owner}}, upsert=True)
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
