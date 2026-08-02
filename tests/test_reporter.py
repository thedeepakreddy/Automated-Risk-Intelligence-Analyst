"""The briefing must be built from the day's real data on both paths."""

import json
from datetime import datetime, timedelta, timezone

from api import _reporter
from api._config import MODE_DEGRADED_TEMPLATE, MODE_GEMINI
from api._reporter import build_context, build_prompt, generate_daily_report, render_fallback_report
from conftest import FakeGeminiClient

ARTICLES = [
    {
        "title": "Sanctions widen against a major energy exporter",
        "source": "Test Wire", "timestamp": "2026-07-29T09:00:00+00:00",
        "riskType": "Geopolitical Risk", "riskSeverity": 9, "sentimentScore": -0.82,
        "affectedAssets": json.dumps(["Commodities", "Equities"]), "classificationMode": "gemini",
    },
    {
        "title": "Regional lender misses a covenant test",
        "source": "Test Wire", "timestamp": "2026-07-29T10:00:00+00:00",
        "riskType": "Credit Risk", "riskSeverity": 7, "sentimentScore": -0.55,
        "affectedAssets": json.dumps(["Bonds"]), "classificationMode": "gemini",
    },
    {
        "title": "Quarterly results beat expectations across large-cap tech",
        "source": "Test Wire", "timestamp": "2026-07-29T11:00:00+00:00",
        "riskType": "No Risk", "riskSeverity": 0, "sentimentScore": 0.61,
        "affectedAssets": json.dumps(["Equities"]), "classificationMode": "gemini",
    },
]

SCORES = [
    {"timestamp": "2026-07-29T11:30:00+00:00", "score": 64.2},
    {"timestamp": "2026-07-28T11:30:00+00:00", "score": 51.0},
]

# The fixtures are fixed points in time, so "now" must be too -- otherwise the
# 24h trend lookup drifts out of the fixture window as the wall clock moves.
NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)


def test_context_is_derived_from_the_articles():
    context = build_context(ARTICLES, SCORES, now=NOW)

    assert context["articleCount"] == 3
    assert context["riskBearingCount"] == 2
    assert context["highSeverityCount"] == 1
    assert [r["title"] for r in context["topRisks"]] == [
        "Sanctions widen against a major energy exporter",
        "Regional lender misses a covenant test",
    ]
    assert context["currentScore"] == 64.2
    assert context["scoreDelta"] == 13.2
    assert context["trend"] == "deteriorating"
    assert {row["asset"] for row in context["assetExposure"]} == {"Commodities", "Equities", "Bonds"}


def test_prompt_carries_the_real_headlines_and_score():
    prompt = build_prompt(build_context(ARTICLES, SCORES, now=NOW), ARTICLES)

    assert "Sanctions widen against a major energy exporter" in prompt
    assert "Regional lender misses a covenant test" in prompt
    assert "64.2" in prompt
    for heading in _reporter.SECTIONS:
        assert heading in prompt


def test_fallback_report_cites_this_day_s_specifics():
    report = render_fallback_report(build_context(ARTICLES, SCORES, now=NOW))

    assert "Sanctions widen against a major energy exporter" in report
    assert "Regional lender misses a covenant test" in report
    assert "64.2" in report
    assert "Geopolitical Risk" in report and "Credit Risk" in report
    assert "Degraded mode" in report
    for heading in _reporter.SECTIONS:
        assert f"### {heading}" in report
    # The briefing this replaced was a fixed paragraph about trade tensions.
    assert "semiconductor giants" not in report


def test_fallback_differs_as_the_data_differs():
    other = [dict(ARTICLES[0], title="Port strike halts container traffic",
                  riskType="Operational Risk", riskSeverity=6)]

    first = render_fallback_report(build_context(ARTICLES, SCORES, now=NOW))
    second = render_fallback_report(build_context(other, [{"timestamp": "2026-07-29T11:30:00+00:00", "score": 22.0}], now=NOW))

    assert first != second
    assert "Port strike halts container traffic" in second
    assert "22.0" in second


def _seed(db, articles):
    conn = db.get_db()
    try:
        db.insert_articles(conn, [
            {
                "title": a["title"], "url": f"https://example.com/{i}",
                "urlCanonical": f"https://example.com/{i}", "summary": "", "source": a["source"],
                "dedupeKey": f"key-{i}", "timestamp": a["timestamp"], "publishedAt": a["timestamp"],
                "riskType": a["riskType"], "riskSeverity": a["riskSeverity"],
                "sentimentScore": a["sentimentScore"], "affectedAssets": a["affectedAssets"],
                "classificationMode": a["classificationMode"], "classificationModel": "test",
            }
            for i, a in enumerate(articles)
        ])
        db.insert_score(conn, "2026-07-29T11:30:00+00:00", 64.2, {"score": 64.2})
        conn.commit()
    finally:
        conn.close()


def _fresh(articles):
    """Re-stamp the fixture into the reporter's trailing window."""
    now = datetime.now(timezone.utc)
    return [dict(a, timestamp=(now - timedelta(hours=i + 1)).isoformat())
            for i, a in enumerate(articles)]


def test_gemini_path_is_used_and_recorded(temp_db, monkeypatch):
    _seed(temp_db, _fresh(ARTICLES))
    client = FakeGeminiClient(text="### Executive Summary\nSanctions dominate the tape.")
    monkeypatch.setattr(_reporter, "build_client", lambda: client)

    summary = generate_daily_report()

    assert summary["mode"] == MODE_GEMINI
    assert summary["degraded"] is False
    assert client.models.calls, "Gemini must actually be called"
    assert "Sanctions widen against a major energy exporter" in client.models.calls[0]["contents"]

    conn = temp_db.get_db()
    try:
        row = conn.execute("SELECT * FROM reports ORDER BY date DESC LIMIT 1").fetchone()
    finally:
        conn.close()
    assert row["mode"] == MODE_GEMINI
    assert "Sanctions dominate the tape." in row["content"]


def test_api_failure_falls_back_and_labels_the_report(temp_db, monkeypatch):
    _seed(temp_db, _fresh(ARTICLES))
    monkeypatch.setattr(_reporter, "build_client",
                        lambda: FakeGeminiClient(exc=RuntimeError("429 RESOURCE_EXHAUSTED")))

    summary = generate_daily_report()

    assert summary["mode"] == MODE_DEGRADED_TEMPLATE
    assert summary["degraded"] is True

    conn = temp_db.get_db()
    try:
        row = conn.execute("SELECT * FROM reports ORDER BY date DESC LIMIT 1").fetchone()
    finally:
        conn.close()
    assert row["mode"] == MODE_DEGRADED_TEMPLATE
    assert "Degraded mode" in row["content"]
    assert "Sanctions widen against a major energy exporter" in row["content"]


def test_empty_window_produces_an_honest_notice(temp_db, monkeypatch):
    monkeypatch.setattr(_reporter, "build_client", lambda: FakeGeminiClient(text="should not be used"))

    summary = generate_daily_report()

    assert summary["mode"] == MODE_DEGRADED_TEMPLATE
    assert summary["articleCount"] == 0

    conn = temp_db.get_db()
    try:
        content = conn.execute("SELECT content FROM reports ORDER BY date DESC LIMIT 1").fetchone()["content"]
    finally:
        conn.close()
    assert "No articles were ingested" in content
