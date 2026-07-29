"""The ingestion cycle.

Fetch live headlines -> drop anything already ingested -> classify each new one
with Gemini -> persist -> recompute the Master Risk Score over the trailing
window. Nothing in this path is mocked and nothing is random.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from api._classifier import build_client, classify_article
from api._config import MODE_GEMINI, VOLATILITY_WINDOW_HOURS, max_articles_per_cycle
from api._db import (
    get_db,
    insert_articles,
    insert_score,
    known_article_keys,
    recent_articles,
)
from api._news import dedupe_batch, fetch_headlines
from api._scoring import compute_master_risk_score

log = logging.getLogger("ari.ingestion")


def _to_row(article: Dict, classification, ingested_at: str) -> Dict:
    row = {
        "title": article["title"],
        "url": article.get("url", ""),
        "urlCanonical": article.get("urlCanonical", ""),
        "summary": article.get("summary", ""),
        "source": article.get("source", ""),
        "dedupeKey": article["dedupeKey"],
        "timestamp": ingested_at,
        "publishedAt": article.get("publishedAt"),
    }
    row.update(classification.as_row())
    return row


def run_ingestion_cycle(limit: Optional[int] = None) -> Dict:
    """Run one full cycle. Returns a summary suitable for an API response."""
    started = datetime.now(timezone.utc)
    ingested_at = started.isoformat()
    limit = limit if limit is not None else max_articles_per_cycle()
    log.info("[INGESTION] starting cycle at %s", ingested_at)

    headlines = fetch_headlines(limit=limit)
    fetched = len(headlines)

    conn = get_db()
    try:
        seen_keys, seen_urls = known_article_keys(conn)
        fresh = dedupe_batch(headlines, seen_keys=seen_keys, seen_urls=seen_urls)
        duplicates = fetched - len(fresh)
        log.info("[INGESTION] %d headlines fetched, %d new, %d duplicates dropped",
                 fetched, len(fresh), duplicates)

        client = build_client()
        rows: List[Dict] = []
        dropped = 0
        degraded = 0

        for article in fresh:
            classification = classify_article(article, client)
            if classification is None:
                dropped += 1
                continue
            if classification.mode != MODE_GEMINI:
                degraded += 1
            rows.append(_to_row(article, classification, ingested_at))

        stored = insert_articles(conn, rows)
        if dropped:
            log.warning("[INGESTION] %d article(s) dropped on schema validation failure", dropped)
        if degraded:
            log.warning("[INGESTION] %d article(s) classified in DEGRADED keyword mode", degraded)

        corpus = recent_articles(conn, hours=VOLATILITY_WINDOW_HOURS, limit=2000)
        breakdown = compute_master_risk_score(corpus, now=started)
        insert_score(conn, ingested_at, breakdown.score, breakdown.as_dict())
        conn.commit()
    finally:
        conn.close()

    summary = {
        "timestamp": ingested_at,
        "fetched": fetched,
        "new": len(fresh),
        "duplicatesSkipped": duplicates,
        "stored": stored,
        "droppedOnValidation": dropped,
        "degradedClassifications": degraded,
        "masterRiskScore": breakdown.score,
        "scoreBreakdown": breakdown.as_dict(),
        "durationSeconds": round((datetime.now(timezone.utc) - started).total_seconds(), 2),
    }
    log.info("[INGESTION] cycle complete: stored=%d, Master Risk Score=%.1f",
             stored, breakdown.score)
    return summary
