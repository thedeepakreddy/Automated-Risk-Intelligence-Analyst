"""The daily risk briefing.

Gemini is given the day's actual classified articles and the actual computed
Master Risk Score, and writes the briefing from that data. If the model cannot
be reached, the briefing is still assembled -- deterministically, from the same
real numbers -- and is stamped ``degraded-template`` with a visible banner so a
reader is never shown a templated narrative believing it to be analysis.
"""

import json
import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from api._classifier import build_client
from api._config import (
    DEGRADED_REPORT_BANNER,
    MODE_DEGRADED_TEMPLATE,
    MODE_GEMINI,
    SCORE_FORMULA,
    SCORE_WEIGHTS,
    gemini_model,
)
from api._db import get_db, insert_report, recent_articles
from api._scoring import parse_timestamp

log = logging.getLogger("ari.reporter")

REPORT_WINDOW_HOURS = 24
SECTIONS = (
    "Executive Summary",
    "Top 3 Risks Identified Today",
    "Most Affected Asset Classes",
    "Risk Score Trend Analysis",
    "Strategic Recommendation",
)


# ---------------------------------------------------------------------------
# Context assembled from real data
# ---------------------------------------------------------------------------

def _assets(article: Dict) -> List[str]:
    raw = article.get("affectedAssets")
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def build_context(articles: List[Dict], scores: List[Dict], now: Optional[datetime] = None) -> Dict:
    """Summarize the day's real data into the facts both report paths use."""
    now = now or datetime.now(timezone.utc)
    risk_bearing = [a for a in articles if a.get("riskType") not in (None, "", "No Risk")]
    ranked = sorted(risk_bearing, key=lambda a: (a.get("riskSeverity") or 0), reverse=True)

    asset_sentiment = defaultdict(list)
    for article in articles:
        sentiment = article.get("sentimentScore")
        for asset in _assets(article):
            asset_sentiment[asset].append(float(sentiment) if sentiment is not None else 0.0)

    current = scores[0]["score"] if scores else None
    day_ago_cutoff = now - timedelta(hours=REPORT_WINDOW_HOURS)
    previous = next(
        (s["score"] for s in scores
         if (parse_timestamp(s.get("timestamp")) or now) <= day_ago_cutoff),
        scores[-1]["score"] if len(scores) > 1 else None,
    )
    delta = round(current - previous, 1) if current is not None and previous is not None else None

    return {
        "generatedAt": now.isoformat(),
        "currentScore": current,
        "previousScore": previous,
        "scoreDelta": delta,
        "trend": ("deteriorating" if delta and delta > 1 else
                  "improving" if delta and delta < -1 else "broadly stable"),
        "articleCount": len(articles),
        "riskBearingCount": len(risk_bearing),
        "highSeverityCount": sum(1 for a in risk_bearing if (a.get("riskSeverity") or 0) >= 8),
        "riskTypeCounts": Counter(a["riskType"] for a in risk_bearing).most_common(),
        "topRisks": [
            {
                "title": a.get("title", ""),
                "riskType": a.get("riskType", ""),
                "severity": a.get("riskSeverity") or 0,
                "source": a.get("source", ""),
                "sentiment": a.get("sentimentScore"),
                "assets": _assets(a),
            }
            for a in ranked[:3]
        ],
        "assetExposure": sorted(
            (
                {
                    "asset": asset,
                    "mentions": len(values),
                    "avgSentiment": round(sum(values) / len(values), 3),
                }
                for asset, values in asset_sentiment.items()
            ),
            key=lambda d: d["mentions"], reverse=True,
        ),
        "degradedClassifications": sum(
            1 for a in articles
            if a.get("classificationMode") and a["classificationMode"] != MODE_GEMINI
        ),
    }


# ---------------------------------------------------------------------------
# Gemini path
# ---------------------------------------------------------------------------

def build_prompt(context: Dict, articles: List[Dict]) -> str:
    feed_lines = "\n".join(
        f"- [{a.get('riskType', 'Unclassified')} | severity {a.get('riskSeverity') or 0}/10 | "
        f"sentiment {a.get('sentimentScore')} | {a.get('source', 'unknown')}] {a.get('title', '')}"
        for a in sorted(articles, key=lambda x: (x.get("riskSeverity") or 0), reverse=True)[:40]
    ) or "- (no articles ingested in the window)"

    exposure = "\n".join(
        f"- {row['asset']}: {row['mentions']} mentions, mean sentiment {row['avgSentiment']:+.3f}"
        for row in context["assetExposure"]
    ) or "- (no asset attributions)"

    return f"""You are a senior risk analyst writing the morning briefing for a markets desk.

Write the briefing **only** from the data below. Do not invent events, numbers,
tickers or price levels that do not appear here. If the data is thin, say so
plainly rather than padding the report.

## Master Risk Score
Current: {context['currentScore']} / 100
Prior reading (~24h): {context['previousScore']}
Change: {context['scoreDelta']}
Methodology: {SCORE_FORMULA}
Weights: {json.dumps(SCORE_WEIGHTS)}

## Corpus ({context['articleCount']} articles in the last {REPORT_WINDOW_HOURS}h)
Risk-bearing: {context['riskBearingCount']}
High severity (>=8): {context['highSeverityCount']}
Risk type distribution: {context['riskTypeCounts']}

## Asset exposure
{exposure}

## Classified headlines (severity-ranked)
{feed_lines}

Produce Markdown with exactly these level-3 headings, in this order:
### {SECTIONS[0]}
### {SECTIONS[1]}
### {SECTIONS[2]}
### {SECTIONS[3]}
### {SECTIONS[4]}

Requirements:
- Reference specific headlines from the corpus above by their substance.
- "{SECTIONS[1]}" must be a numbered list of three, each naming the risk type
  and its severity out of 10.
- "{SECTIONS[3]}" must cite the current score and the direction of travel.
- "{SECTIONS[4]}" must be actionable and tied to the exposures listed above.
- Keep it under 500 words. No preamble, no sign-off."""


def _generate_with_gemini(client, prompt: str) -> str:
    from google.genai import types

    response = client.models.generate_content(
        model=gemini_model(),
        contents=prompt,
        config=types.GenerateContentConfig(temperature=0.4, max_output_tokens=2048),
    )
    return (response.text or "").strip()


# ---------------------------------------------------------------------------
# Deterministic fallback (still built from the day's real data)
# ---------------------------------------------------------------------------

def render_fallback_report(context: Dict) -> str:
    score = context["currentScore"]
    score_text = f"{score:.1f}" if isinstance(score, (int, float)) else "unavailable"

    if not context["articleCount"]:
        return (
            f"{DEGRADED_REPORT_BANNER}\n\n"
            "### Executive Summary\n"
            "No articles were ingested in the last 24 hours, so no briefing can be "
            "produced. Check the ingestion cycle and the configured news feeds.\n"
        )

    band = ("elevated" if isinstance(score, (int, float)) and score >= 70 else
            "moderate" if isinstance(score, (int, float)) and score >= 40 else "contained")
    dominant = context["riskTypeCounts"][0][0] if context["riskTypeCounts"] else "no dominant category"

    top_risks = "\n".join(
        f"{i}. **{r['riskType']} - {r['severity']}/10.** {r['title']} ({r['source']})"
        for i, r in enumerate(context["topRisks"], start=1)
    ) or "No risk-bearing headlines were classified in the window."

    exposure = "\n".join(
        f"- **{row['asset']}**: {row['mentions']} mention(s), mean sentiment "
        f"{row['avgSentiment']:+.2f} ({'negative' if row['avgSentiment'] < -0.05 else 'positive' if row['avgSentiment'] > 0.05 else 'neutral'} tone)."
        for row in context["assetExposure"][:6]
    ) or "- No asset attributions in the window."

    delta = context["scoreDelta"]
    delta_text = (f"{delta:+.1f} points against the reading ~24h ago "
                  f"({context['previousScore']})") if delta is not None else "no comparable prior reading"

    recommendation = (
        "Reduce gross exposure and hold elevated cash. Prioritise hedges on the asset "
        "classes listed above, and re-evaluate on the next cycle."
        if band == "elevated" else
        "Maintain current positioning with hedges on the most-mentioned asset classes. "
        "No wholesale de-risking is indicated by today's flow."
        if band == "moderate" else
        "Risk conditions are contained. Normal positioning; monitor for a change in the "
        "severity distribution rather than acting on single headlines."
    )

    return f"""{DEGRADED_REPORT_BANNER}

### Executive Summary
The Master Risk Score stands at **{score_text}/100** ({band}). {context['articleCount']} headlines were
ingested in the last {REPORT_WINDOW_HOURS} hours, of which {context['riskBearingCount']} carried a material risk
signal and {context['highSeverityCount']} scored 8/10 or above. The dominant category today is **{dominant}**.

### Top 3 Risks Identified Today
{top_risks}

### Most Affected Asset Classes
{exposure}

### Risk Score Trend Analysis
Current score **{score_text}**, {delta_text}. The trend is **{context['trend']}**.
Score composition: {SCORE_FORMULA}.

### Strategic Recommendation
{recommendation}
"""


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def generate_daily_report() -> Dict:
    """Generate and persist the daily briefing. Returns a summary."""
    now = datetime.now(timezone.utc)
    log.info("[REPORTER] generating daily briefing for %s", now.isoformat())

    conn = get_db()
    try:
        articles = recent_articles(conn, hours=REPORT_WINDOW_HOURS, limit=2000)
        week_ago = (now - timedelta(days=7)).isoformat()
        scores = [dict(r) for r in conn.execute(
            "SELECT * FROM system_scores WHERE timestamp >= ? ORDER BY timestamp DESC LIMIT 400",
            (week_ago,),
        ).fetchall()]
    finally:
        conn.close()

    context = build_context(articles, scores, now=now)
    client = build_client()
    content, mode = "", MODE_DEGRADED_TEMPLATE

    if client is not None and articles:
        try:
            content = _generate_with_gemini(client, build_prompt(context, articles))
            if content:
                mode = MODE_GEMINI
            else:
                log.warning("[REPORTER] Gemini returned an empty body - using the degraded template")
        except Exception as exc:
            detail = str(exc)
            if "429" in detail or "RESOURCE_EXHAUSTED" in detail:
                log.warning("[REPORTER] Gemini quota exhausted - FALLING BACK to the degraded template")
            else:
                log.warning("[REPORTER] Gemini call failed (%s) - FALLING BACK to the degraded template",
                            detail[:200])
    elif client is None:
        log.warning("[REPORTER] no Gemini client available - FALLING BACK to the degraded template")
    else:
        log.warning("[REPORTER] no articles in the window - FALLING BACK to the degraded template")

    if mode != MODE_GEMINI:
        content = render_fallback_report(context)

    conn = get_db()
    try:
        insert_report(conn, now.isoformat(), content, mode,
                      context["currentScore"], context["articleCount"])
        conn.commit()
    finally:
        conn.close()

    log.info("[REPORTER] briefing stored (mode=%s, articles=%d, score=%s)",
             mode, context["articleCount"], context["currentScore"])
    return {
        "date": now.isoformat(),
        "mode": mode,
        "masterRiskScore": context["currentScore"],
        "articleCount": context["articleCount"],
        "degraded": mode != MODE_GEMINI,
    }
