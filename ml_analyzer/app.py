from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

app = FastAPI()

app.add_middleware(
    CORSMiddleware, 
    allow_origins = ["http://localhost:3000",
                     "https://gmail-ai-analyzer.vercel.app",],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/analyze")
async def analyze(request: Request): 
    try: 
        data = await request.json()
        return {"message": "hellow world?"}
    except Exception: 
        return JSONResponse(content={"error": "Invalid or missing JSON body"}, status_code=400)
    
@app.get("/date")
def get_current_date():
    now = datetime.now()
    return {
        "date": now.strftime("%A, %B %d, %Y"),
        "time": now.strftime("%I:%M %p")
    }

