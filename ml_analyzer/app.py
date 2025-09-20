# app.py
from fastapi import FastAPI, Request, Query
from fastapi.responses import JSONResponse, RedirectResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime
import json
import os
import uuid

# Import ai_utils and model_utils
import ai_utils
import model_utils

app = FastAPI()

# allow both local dev and production origins; ensure you add your actual origins on Render env if needed
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
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)

    email = data.get("email")
    if not email:
        return JSONResponse({"error": "email required"}, status_code=400)

    try:
        auth_url, state = model_utils.generate_authorization_url(email)
        return JSONResponse({"auth_url": auth_url, "state": state}, status_code=200)
    except Exception as e:
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
        # Redirect back to frontend (adjust FRONTEND_URL if needed)
        frontend = os.getenv("FRONTEND_URL", "https://gmail-ai-analyzer.vercel.app")
        redirect_to = f"{frontend}/?auth=success&email={email}"
        return RedirectResponse(redirect_to)
    except Exception as e:
        return HTMLResponse(f"<h1>Auth failed: {e}</h1>", status_code=500)

@app.post("/analyze")
async def analyze(request: Request):
    """
    POST body: { "emails": ["a@x.com","b@y.com"] }
    If emails array present, run programmatic extraction for those accounts.
    If some accounts need auth, returns {"missing_auth": [emails...]}.
    Otherwise returns mapping { account_email: [extracted_items...] } and saves to file.
    """
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    emails = payload.get("emails", None)

    try:
        if emails and isinstance(emails, list):
            # programmatic fetch for these specific emails
            result = ai_utils.analyze_for_emails(emails, save_output=False)
        else:
            # fallback: old behavior (interactive/automatic); may call CLI flow in ai_utils
            result = ai_utils.analyze_all_from_model_utils(save_output=False)

        # If result signals missing auth, forward that to client
        if isinstance(result, dict) and result.get("missing_auth"):
            return JSONResponse({"missing_auth": result["missing_auth"]}, status_code=200)

        # Normalize and add IDs, then persist to EMAIL_STATE_FILE
        saved = {}
        for account, items in result.items():
            saved_list = []
            for it in items:
                it.setdefault("_id", uuid.uuid4().hex)
                it.setdefault("addedToCalendar", False)
                saved_list.append(it)
            saved[account] = saved_list

        with open(EMAIL_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(saved, f, ensure_ascii=False, indent=2)

        return JSONResponse(saved, status_code=200)

    except Exception as e:
        print(f"ERROR in /analyze: {e}")
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/email_state")
def get_email_state():
    """
    Return the most recent extracted email tasks/events,
    if email_state.json exists.
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
    """
    Delete an extracted item by its id.
    """
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
