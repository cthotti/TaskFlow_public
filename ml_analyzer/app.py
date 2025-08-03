from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

@app.post("/analyze")
async def analyze(request: Request): 
    try: 
        data = await request.json()
        return {"message": "Hello World"}
    except Exception: 
        return JSONResponse(content={"error": "Invalid or missing JSON body"}, status_code=400)

app.add_middleware(
    CORSMiddleware, 
    allow_origins = ["http://localhost:3000",
                     "https://gmail-ai-analyzer.vercel.app",],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)