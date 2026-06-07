from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any

from api.db import init_db, get_dashboard_data
from api.ingestion import run_ingestion_cycle
from api.reporter import generate_daily_report

app = FastAPI(title="Risk Intelligence API")

# Setup CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize the SQLite Database (stored in /tmp/ for serverless environments)
init_db()

@app.get("/api/health")
@app.get("/api/status")
def status() -> Dict[str, str]:
    return {"status": "ok", "backend": "python - fastapi"}

@app.get("/api/data")
def get_data() -> Any:
    try:
        return get_dashboard_data()
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/trigger-ingestion")
def trigger_ingestion(background_tasks: BackgroundTasks) -> Dict[str, bool]:
    # We run it inline for simplicity, but in a real app you'd use background_tasks.add_task(run_ingestion_cycle)
    run_ingestion_cycle()
    return {"success": True}

@app.post("/api/trigger-report")
def trigger_report() -> Dict[str, bool]:
    generate_daily_report()
    return {"success": True}
