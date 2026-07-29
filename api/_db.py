"""SQLite persistence for the risk intelligence pipeline.

The schema carries the provenance of every reading: how each article was
classified (real inference vs. degraded keyword mode), and the full component
decomposition of every Master Risk Score, so a historical number can always be
explained rather than just displayed.
"""

import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

log = logging.getLogger("ari.db")

# Use /tmp for Vercel Serverless environment where root filesystem is read-only
# Locally, it will also just use the /tmp directory
DB_PATH = os.environ.get("DB_PATH", "/tmp/risk.db")

ARTICLE_COLUMNS = {
    "title": "TEXT",
    "url": "TEXT",
    "urlCanonical": "TEXT",
    "summary": "TEXT",
    "source": "TEXT",
    "dedupeKey": "TEXT",
    "timestamp": "DATETIME",
    "publishedAt": "DATETIME",
    "riskType": "TEXT",
    "riskSeverity": "INTEGER",
    "sentimentScore": "REAL",
    "affectedAssets": "TEXT",
    "classificationMode": "TEXT",
    "classificationModel": "TEXT",
}

SCORE_COLUMNS = {"timestamp": "DATETIME", "score": "REAL", "details": "TEXT"}

REPORT_COLUMNS = {
    "date": "DATETIME",
    "content": "TEXT",
    "mode": "TEXT",
    "masterRiskScore": "REAL",
    "articleCount": "INTEGER",
}


def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _existing_columns(conn: sqlite3.Connection, table: str) -> set:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_missing_columns(conn: sqlite3.Connection, table: str, columns: Dict[str, str]) -> None:
    """Bring an older database up to the current schema without losing history."""
    present = _existing_columns(conn, table)
    for name, sql_type in columns.items():
        if name not in present:
            log.info("[DB] migrating %s: adding column %s", table, name)
            conn.execute(f'ALTER TABLE {table} ADD COLUMN "{name}" {sql_type}')


def _backfill_dedupe_keys(conn: sqlite3.Connection) -> None:
    from api._news import canonical_url, dedupe_key

    rows = conn.execute(
        "SELECT id, title, url FROM articles WHERE dedupeKey IS NULL OR dedupeKey = ''"
    ).fetchall()
    if not rows:
        return
    log.info("[DB] backfilling dedupe keys for %d legacy rows", len(rows))
    conn.executemany(
        "UPDATE articles SET dedupeKey = ?, urlCanonical = COALESCE(NULLIF(urlCanonical, ''), ?) WHERE id = ?",
        [
            (dedupe_key(r["title"] or "", r["url"] or ""), canonical_url(r["url"] or ""), r["id"])
            for r in rows
        ],
    )


def _enforce_unique_articles(conn: sqlite3.Connection) -> None:
    """Guarantee one row per story. Collapses duplicates left by earlier runs."""
    try:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_dedupe ON articles(dedupeKey)")
        return
    except sqlite3.IntegrityError:
        pass

    removed = conn.execute(
        """DELETE FROM articles WHERE id NOT IN (
               SELECT MIN(id) FROM articles GROUP BY dedupeKey
           )"""
    ).rowcount
    log.warning("[DB] collapsed %d duplicate article rows from a pre-dedupe database", removed)
    try:
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_dedupe ON articles(dedupeKey)")
    except sqlite3.IntegrityError as exc:  # pragma: no cover - defensive
        log.error("[DB] could not enforce article uniqueness (%s); falling back to a plain index", exc)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_articles_dedupe ON articles(dedupeKey)")


def init_db() -> None:
    conn = get_db()
    try:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT,
                url TEXT,
                urlCanonical TEXT,
                summary TEXT,
                source TEXT,
                dedupeKey TEXT,
                timestamp DATETIME,
                publishedAt DATETIME,
                riskType TEXT,
                riskSeverity INTEGER,
                sentimentScore REAL,
                affectedAssets TEXT,
                classificationMode TEXT,
                classificationModel TEXT
            );
            CREATE TABLE IF NOT EXISTS system_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME,
                score REAL,
                details TEXT
            );
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                date DATETIME,
                content TEXT,
                mode TEXT,
                masterRiskScore REAL,
                articleCount INTEGER
            );
        ''')
        _add_missing_columns(conn, "articles", ARTICLE_COLUMNS)
        _add_missing_columns(conn, "system_scores", SCORE_COLUMNS)
        _add_missing_columns(conn, "reports", REPORT_COLUMNS)
        _backfill_dedupe_keys(conn)
        _enforce_unique_articles(conn)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_articles_timestamp ON articles(timestamp)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_scores_timestamp ON system_scores(timestamp)")
        conn.commit()
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Ingestion helpers
# ---------------------------------------------------------------------------

def known_article_keys(conn: sqlite3.Connection) -> tuple:
    """Every dedupe key and canonical URL already ingested."""
    keys = {r[0] for r in conn.execute("SELECT dedupeKey FROM articles WHERE dedupeKey IS NOT NULL")}
    urls = {r[0] for r in conn.execute("SELECT urlCanonical FROM articles WHERE urlCanonical IS NOT NULL AND urlCanonical != ''")}
    return keys, urls


def insert_articles(conn: sqlite3.Connection, rows: Iterable[Dict]) -> int:
    """Insert classified articles. Returns the number actually written.

    ``INSERT OR IGNORE`` against the unique dedupe index is the final guarantee:
    even if a caller skipped the pre-filter, a story is stored at most once.
    """
    columns = list(ARTICLE_COLUMNS)
    placeholders = ", ".join("?" for _ in columns)
    statement = f'INSERT OR IGNORE INTO articles ({", ".join(columns)}) VALUES ({placeholders})'
    written = 0
    for row in rows:
        cursor = conn.execute(statement, [row.get(c) for c in columns])
        written += cursor.rowcount
    return written


def insert_score(conn: sqlite3.Connection, timestamp: str, score: float, details: Dict) -> None:
    conn.execute(
        "INSERT INTO system_scores (timestamp, score, details) VALUES (?, ?, ?)",
        (timestamp, score, json.dumps(details)),
    )


def insert_report(conn: sqlite3.Connection, date: str, content: str, mode: str,
                  master_risk_score: Optional[float], article_count: int) -> None:
    conn.execute(
        "INSERT INTO reports (date, content, mode, masterRiskScore, articleCount) VALUES (?, ?, ?, ?, ?)",
        (date, content, mode, master_risk_score, article_count),
    )


def recent_articles(conn: sqlite3.Connection, hours: int = 24, limit: int = 500) -> List[Dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    rows = conn.execute(
        "SELECT * FROM articles WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT ?",
        (cutoff, limit),
    ).fetchall()
    return [dict(r) for r in rows]


def latest_score(conn: sqlite3.Connection) -> Optional[Dict]:
    row = conn.execute("SELECT * FROM system_scores ORDER BY timestamp DESC LIMIT 1").fetchone()
    return dict(row) if row else None


# ---------------------------------------------------------------------------
# API payload
# ---------------------------------------------------------------------------

def _decode_details(raw) -> Optional[Dict]:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return None


def get_dashboard_data() -> Dict:
    from api._config import get_feeds
    from api._scoring import methodology

    conn = get_db()
    try:
        articles = [dict(r) for r in conn.execute(
            "SELECT * FROM articles ORDER BY timestamp DESC LIMIT 50"
        ).fetchall()]

        # Newest first: the dashboard reverses this into chronological order.
        week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
        scores = [dict(r) for r in conn.execute(
            "SELECT * FROM system_scores WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 400",
            (week_ago,),
        ).fetchall()]

        report_row = conn.execute("SELECT * FROM reports ORDER BY date DESC LIMIT 1").fetchone()
        day = recent_articles(conn, hours=24, limit=2000)
        total_articles = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
    finally:
        conn.close()

    for score in scores:
        score["details"] = _decode_details(score.get("details"))

    latest = scores[0] if scores else None

    return {
        "articles": articles,
        "scores": scores,
        "latestReport": dict(report_row) if report_row else None,
        "scoreBreakdown": latest["details"] if latest else None,
        "methodology": methodology(),
        "stats": {
            "totalArticles": total_articles,
            "articlesLast24h": len(day),
            "highSeverityLast24h": sum(1 for a in day if (a.get("riskSeverity") or 0) >= 8),
            "degradedLast24h": sum(1 for a in day if a.get("classificationMode") and a["classificationMode"] != "gemini"),
            "currentScore": latest["score"] if latest else None,
        },
        "sources": [{"name": f.name, "url": f.url} for f in get_feeds()],
    }
