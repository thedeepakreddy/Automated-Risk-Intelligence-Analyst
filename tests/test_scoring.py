"""The Master Risk Score must be a reproducible function of its inputs."""

from datetime import datetime, timezone

import pytest

from api._config import SCORE_WEIGHTS
from api._scoring import compute_master_risk_score, hourly_severity_series, methodology

NOW = datetime(2026, 7, 29, 12, 0, tzinfo=timezone.utc)


def article(hour, severity, sentiment, risk_type="Market Risk", minute=0):
    return {
        "title": f"headline {hour}:{minute:02d} sev{severity}",
        "timestamp": datetime(2026, 7, 29, hour, minute, tzinfo=timezone.utc).isoformat(),
        "riskType": risk_type,
        "riskSeverity": severity,
        "sentimentScore": sentiment,
        "classificationMode": "gemini",
    }


# Three hourly buckets -> the volatility component is available.
#   09:00 severities 8, 6 -> mean 7.0
#   10:00 severity  4     -> mean 4.0
#   11:00 severity  6     -> mean 6.0
THREE_BUCKET_CORPUS = [
    article(9, 8, -0.8), article(9, 6, -0.4, minute=30),
    article(10, 4, 0.2),
    article(11, 6, -0.2),
]

# Two hourly buckets -> volatility is unavailable, weights renormalize.
TWO_BUCKET_CORPUS = [
    article(10, 8, -0.8), article(10, 6, -0.4, minute=30),
    article(11, 4, 0.2), article(11, 6, -0.2, minute=30),
]


def test_known_inputs_produce_the_documented_score():
    """Hand-computed from the published formula.

    NormalizedSeverity      mean severity 6.0/10            -> 60.0
    NormalizedSentimentRisk mean polarity -0.3, inverted    -> 65.0
    NormalizedNewsVolatility hourly means [7.0, 4.0, 6.0],
        changes [-3.0, +2.0], pstdev 2.5, capped at 3.0     -> 83.33
    score = 0.40*60.0 + 0.30*65.0 + 0.30*83.33 = 68.5
    """
    result = compute_master_risk_score(THREE_BUCKET_CORPUS, now=NOW)

    assert result.score == 68.5

    by_name = {c["name"]: c for c in result.components}
    assert by_name["NormalizedSeverity"]["normalized"] == 60.0
    assert by_name["NormalizedSentimentRisk"]["normalized"] == 65.0
    assert by_name["NormalizedNewsVolatility"]["normalized"] == pytest.approx(83.33, abs=0.01)
    assert all(c["available"] for c in result.components)
    assert result.inputs["avgSeverity"] == 6.0
    assert result.inputs["avgSentiment"] == -0.3
    assert result.inputs["articleCount"] == 4


def test_weights_renormalize_when_volatility_has_no_history():
    """(0.40*60.0 + 0.30*65.0) / 0.70 = 62.1 -- not 43.5."""
    result = compute_master_risk_score(TWO_BUCKET_CORPUS, now=NOW)

    assert result.score == 62.1
    by_name = {c["name"]: c for c in result.components}
    assert by_name["NormalizedNewsVolatility"]["available"] is False
    assert by_name["NormalizedNewsVolatility"]["contribution"] == 0.0
    assert by_name["NormalizedSeverity"]["effectiveWeight"] == pytest.approx(0.4 / 0.7, abs=1e-4)
    assert any("renormalized" in note for note in result.notes)


def test_benign_corpus_scores_far_below_the_old_random_band():
    """The old implementation returned random.uniform(70, 85) regardless of input."""
    calm = [
        article(9, 0, 0.6, risk_type="No Risk"),
        article(10, 0, 0.6, risk_type="No Risk"),
        article(11, 0, 0.6, risk_type="No Risk"),
    ]

    result = compute_master_risk_score(calm, now=NOW)

    assert result.score == 6.0
    assert result.score < 70


def test_severe_corpus_scores_high():
    severe = [
        article(9, 10, -0.9, risk_type="Geopolitical Risk"),
        article(10, 9, -0.85, risk_type="Credit Risk"),
        article(11, 10, -0.95, risk_type="Liquidity Risk"),
    ]

    result = compute_master_risk_score(severe, now=NOW)

    by_name = {c["name"]: c for c in result.components}
    assert by_name["NormalizedSeverity"]["normalized"] > 95
    assert by_name["NormalizedSentimentRisk"]["normalized"] > 90
    assert result.score > 75


def test_a_churning_regime_scores_above_a_pinned_one():
    """Volatility means volatility: severity pinned at 10 is not *volatile*.

    A regime that lurches between calm and severe carries a higher composite
    than one sitting at a constant elevated level with the same mean severity.
    """
    pinned = [article(9, 6, -0.5), article(10, 6, -0.5), article(11, 6, -0.5)]
    churning = [article(9, 2, -0.5), article(10, 10, -0.5), article(11, 6, -0.5)]

    pinned_result = compute_master_risk_score(pinned, now=NOW)
    churning_result = compute_master_risk_score(churning, now=NOW)

    # Identical mean severity and identical sentiment; only the path differs.
    assert pinned_result.inputs["avgSeverity"] == churning_result.inputs["avgSeverity"] == 6.0
    assert churning_result.score > pinned_result.score


def test_score_is_deterministic():
    first = compute_master_risk_score(THREE_BUCKET_CORPUS, now=NOW)
    second = compute_master_risk_score(list(reversed(THREE_BUCKET_CORPUS)), now=NOW)

    assert first.score == second.score
    assert first.as_dict()["components"] == second.as_dict()["components"]


def test_articles_outside_the_window_are_excluded():
    stale = dict(article(9, 10, -1.0), timestamp="2026-07-20T09:00:00+00:00")

    result = compute_master_risk_score(THREE_BUCKET_CORPUS + [stale], now=NOW)

    assert result.inputs["articleCount"] == 4
    assert result.score == 68.5


def test_empty_corpus_scores_zero_with_a_note():
    result = compute_master_risk_score([], now=NOW)

    assert result.score == 0.0
    assert result.notes


def test_breakdown_exposes_weights_and_formula():
    result = compute_master_risk_score(THREE_BUCKET_CORPUS, now=NOW).as_dict()

    assert result["weights"] == SCORE_WEIGHTS
    assert "0.40*NormalizedSeverity" in result["formula"]
    assert sum(c["contribution"] for c in result["components"]) == pytest.approx(result["score"], abs=0.05)


def test_hourly_series_skips_hours_without_news():
    series = hourly_severity_series(THREE_BUCKET_CORPUS)

    assert series == [7.0, 4.0, 6.0]


def test_methodology_is_self_describing():
    spec = methodology()

    assert spec["weights"] == SCORE_WEIGHTS
    assert sum(spec["weights"].values()) == pytest.approx(1.0)
    assert {c["name"] for c in spec["components"]} == {
        "NormalizedSeverity", "NormalizedSentimentRisk", "NormalizedNewsVolatility",
    }
