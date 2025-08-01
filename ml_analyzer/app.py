from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

app = FastAPI()

@app.post("/analyze")
async def analyze(request: Request):
    try:
        data = await request.json()
        return {"received_data": data}
    except Exception:
        return JSONResponse(content={"error": "Invalid or missing JSON body"}, status_code=400)
