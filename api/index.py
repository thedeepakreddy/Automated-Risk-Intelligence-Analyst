import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from api._config import gemini_api_key, gemini_model, get_feeds
from api._db import get_dashboard_data, get_db, init_db
from api._ingestion import run_ingestion_cycle
from api._reporter import generate_daily_report
from api._scoring import methodology

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("ari.api")

INGESTION_INTERVAL_SECONDS = int(os.environ.get("INGESTION_INTERVAL_SECONDS", 1800))  # 30 minutes
REPORT_INTERVAL_SECONDS = int(os.environ.get("REPORT_INTERVAL_SECONDS", 86400))  # 24 hours

# Cycles touch the network and the LLM, so they are run off the event loop and
# serialized against each other -- a manual trigger never races the scheduler.
_ingestion_lock = asyncio.Lock()
_report_lock = asyncio.Lock()


async def _ingest() -> Dict[str, Any]:
    async with _ingestion_lock:
        return await asyncio.to_thread(run_ingestion_cycle)


async def _report() -> Dict[str, Any]:
    async with _report_lock:
        return await asyncio.to_thread(generate_daily_report)


async def periodic_ingestion() -> None:
    while True:
        try:
            await _ingest()
        except Exception as exc:
            log.exception("Error in ingestion process: %s", exc)
        await asyncio.sleep(INGESTION_INTERVAL_SECONDS)


async def periodic_reporter() -> None:
    while True:
        try:
            await _report()
        except Exception as exc:
            log.exception("Error in reporter process: %s", exc)
        await asyncio.sleep(REPORT_INTERVAL_SECONDS)


async def _seed_if_empty() -> None:
    """First-run seed. Runs in the background so startup is never blocked."""
    conn = get_db()
    try:
        count = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    finally:
        conn.close()
    if count:
        return
    log.info("Database is empty, running initial ingestion and briefing...")
    try:
        await _ingest()
        await _report()
    except Exception as exc:
        log.exception("Initial seed failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if not gemini_api_key():
        log.warning(
            "GEMINI_API_KEY is not set. Classification and briefings will run in "
            "DEGRADED mode and are labelled as such in the stored data."
        )
    tasks = [
        asyncio.create_task(_seed_if_empty()),
        asyncio.create_task(periodic_ingestion()),
        asyncio.create_task(periodic_reporter()),
    ]
    try:
        yield
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="Risk Intelligence API", lifespan=lifespan)

# Setup CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
@app.get("/api/status")
def status() -> Dict[str, Any]:
    """Service identity plus the honest state of every dependency."""
    return {
        "status": "ok",
        "backend": "python - fastapi",
        "aiInference": {
            "configured": bool(gemini_api_key()),
            "model": gemini_model(),
            "mode": "gemini" if gemini_api_key() else "degraded-keyword",
        },
        "newsSources": len(get_feeds()),
        "ingestionIntervalSeconds": INGESTION_INTERVAL_SECONDS,
    }


@app.get("/api/methodology")
def get_methodology() -> Dict[str, Any]:
    """The scoring weights and formula, so the dashboard can show its working."""
    return methodology()


@app.get("/api/data")
def get_data() -> Any:
    try:
        return get_dashboard_data()
    except Exception as e:
        log.exception("Failed to build dashboard payload")
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/trigger-ingestion")
async def trigger_ingestion() -> Any:
    try:
        summary = await _ingest()
        return {"success": True, **summary}
    except Exception as e:
        log.exception("Manual ingestion failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


@app.post("/api/trigger-report")
async def trigger_report() -> Any:
    try:
        summary = await _report()
        return {"success": True, **summary}
    except Exception as e:
        log.exception("Manual report generation failed")
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})


# Serve React Frontend (For Render/Docker deployment)
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
