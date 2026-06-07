from fastapi import FastAPI, BackgroundTasks
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict, Any
import asyncio
import os

from api._db import init_db, get_dashboard_data, get_db
from api._ingestion import run_ingestion_cycle
from api._reporter import generate_daily_report

app = FastAPI(title="Risk Intelligence API")

# Setup CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

async def periodic_ingestion():
    while True:
        try:
            run_ingestion_cycle()
        except Exception as e:
            print("Error in ingestion process:", e)
        await asyncio.sleep(1800)  # Every 30 minutes

async def periodic_reporter():
    while True:
        try:
            generate_daily_report()
        except Exception as e:
            print("Error in reporter process:", e)
        await asyncio.sleep(86400) # Every 24 hours

@app.on_event("startup")
async def startup_event():
    # Initialize the SQLite Database (stored in /tmp/ for serverless environments)
    init_db()
    
    # Check if database is empty to immediately seed some data
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    conn.close()
    
    if count == 0:
        print("Database is empty, running initial seed...")
        run_ingestion_cycle()
        generate_daily_report()
    
    # Start periodic background tasks
    asyncio.create_task(periodic_ingestion())
    asyncio.create_task(periodic_reporter())

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

# Serve React Frontend (For Render/Docker deployment)
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "dist")

if os.path.exists(DIST_DIR):
    # Mount the assets directory (CSS, JS, images from Vite)
    assets_dir = os.path.join(DIST_DIR, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")
    
    # Catch-all to serve index.html for React Router / specific files
    @app.get("/{full_path:path}")
    def serve_react_app(full_path: str):
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
