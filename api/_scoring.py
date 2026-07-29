"""The Master Risk Score.

A transparent weighted composite on a 0-100 scale, computed over the trailing
24 hours of classified articles. There is no randomness anywhere in this module:
the same corpus always produces the same score, and every input that went into a
reading is persisted alongside it so the number can be decomposed after the fact.

    MasterRiskScore = 0.40*NormalizedSeverity
                    + 0.30*NormalizedSentimentRisk
                    + 0.30*NormalizedNewsVolatility

Components
----------
NormalizedSeverity
    Mean AI-assigned severity across risk-bearing articles, rescaled 0-10 -> 0-100.

NormalizedSentimentRisk
    Mean sentiment polarity across the corpus, inverted and rescaled so that
    negative tone raises risk: -1 -> 100, 0 -> 50, +1 -> 0.

NormalizedNewsVolatility
    Realized volatility of the news flow itself. Mean severity is bucketed by
    hour to form a series, first differences are taken (the analogue of
    returns), and the population standard deviation of those differences is
    scaled against VOLATILITY_SCALE severity points. A desk that sees severity
    lurch between calm and severe hour to hour is in a more volatile regime than
    one sitting at a constant elevated level.

A component with insufficient data is marked unavailable and dropped, and the
remaining weights are renormalized to sum to 1. That avoids the cold-start
artifact of scoring a component as zero simply because no history exists yet.
"""

import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Dict, Iterable, List, Optional

from api._config import (
    SCORE_FORMULA,
    SCORE_WEIGHTS,
    VOLATILITY_MIN_BUCKETS,
    VOLATILITY_SCALE,
    VOLATILITY_WINDOW_HOURS,
)


@dataclass
class Component:
    name: str
    value: float          # normalized 0-100
    weight: float         # nominal weight from SCORE_WEIGHTS
    available: bool
    detail: str

    def as_dict(self, effective_weight: float) -> Dict:
        return {
            "name": self.name,
            "normalized": round(self.value, 2),
            "weight": self.weight,
            "effectiveWeight": round(effective_weight, 4),
            "contribution": round(self.value * effective_weight, 2),
            "available": self.available,
            "detail": self.detail,
        }


@dataclass
class ScoreBreakdown:
    score: float
    components: List[Dict] = field(default_factory=list)
    inputs: Dict = field(default_factory=dict)
    weights: Dict = field(default_factory=lambda: dict(SCORE_WEIGHTS))
    formula: str = SCORE_FORMULA
    notes: List[str] = field(default_factory=list)

    def as_dict(self) -> Dict:
        return {
            "score": self.score,
            "components": self.components,
            "inputs": self.inputs,
            "weights": self.weights,
            "formula": self.formula,
            "notes": self.notes,
        }


def parse_timestamp(value) -> Optional[datetime]:
    """Parse the ISO-8601 timestamps written by the ingestion cycle."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _severity(article: Dict) -> float:
    try:
        return float(article.get("riskSeverity") or 0)
    except (TypeError, ValueError):
        return 0.0


def _is_risk_bearing(article: Dict) -> bool:
    return article.get("riskType") not in (None, "", "No Risk") and _severity(article) > 0


def _severity_component(articles: List[Dict]) -> Component:
    risk_bearing = [_severity(a) for a in articles if _is_risk_bearing(a)]
    if not risk_bearing:
        return Component(
            "NormalizedSeverity", 0.0, SCORE_WEIGHTS["severity"], True,
            "no risk-bearing articles in window",
        )
    mean_severity = statistics.fmean(risk_bearing)
    return Component(
        "NormalizedSeverity", mean_severity / 10 * 100, SCORE_WEIGHTS["severity"], True,
        f"mean severity {mean_severity:.2f}/10 across {len(risk_bearing)} risk-bearing articles",
    )


def _sentiment_component(articles: List[Dict]) -> Component:
    polarities = []
    for article in articles:
        value = article.get("sentimentScore")
        if value is None:
            continue
        try:
            polarities.append(float(value))
        except (TypeError, ValueError):
            continue
    if not polarities:
        return Component(
            "NormalizedSentimentRisk", 50.0, SCORE_WEIGHTS["sentiment"], False,
            "no sentiment readings in window",
        )
    mean_sentiment = statistics.fmean(polarities)
    return Component(
        "NormalizedSentimentRisk", (-mean_sentiment + 1) / 2 * 100, SCORE_WEIGHTS["sentiment"], True,
        f"mean polarity {mean_sentiment:+.3f} across {len(polarities)} articles",
    )


def hourly_severity_series(articles: Iterable[Dict]) -> List[float]:
    """Mean severity per hour, chronological, skipping hours with no news."""
    buckets: Dict[datetime, List[float]] = {}
    for article in articles:
        stamp = parse_timestamp(article.get("timestamp"))
        if stamp is None:
            continue
        hour = stamp.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        buckets.setdefault(hour, []).append(_severity(article))
    return [statistics.fmean(buckets[hour]) for hour in sorted(buckets)]


def _volatility_component(articles: List[Dict]) -> Component:
    series = hourly_severity_series(articles)
    if len(series) < VOLATILITY_MIN_BUCKETS:
        return Component(
            "NormalizedNewsVolatility", 0.0, SCORE_WEIGHTS["volatility"], False,
            f"needs {VOLATILITY_MIN_BUCKETS} hourly buckets, have {len(series)}",
        )
    changes = [b - a for a, b in zip(series, series[1:])]
    realized = statistics.pstdev(changes)
    return Component(
        "NormalizedNewsVolatility", min(realized / VOLATILITY_SCALE, 1.0) * 100,
        SCORE_WEIGHTS["volatility"], True,
        f"stdev of hourly severity changes {realized:.2f} over {len(series)} buckets",
    )


def window_articles(articles: Iterable[Dict], now: Optional[datetime] = None,
                    hours: int = VOLATILITY_WINDOW_HOURS) -> List[Dict]:
    """Restrict a corpus to the trailing scoring window."""
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=hours)
    selected = []
    for article in articles:
        stamp = parse_timestamp(article.get("timestamp"))
        if stamp is not None and stamp >= cutoff:
            selected.append(article)
    return selected


def compute_master_risk_score(articles: Iterable[Dict], now: Optional[datetime] = None,
                              window_hours: int = VOLATILITY_WINDOW_HOURS) -> ScoreBreakdown:
    """Compute the Master Risk Score over the trailing window of articles."""
    corpus = window_articles(articles, now=now, hours=window_hours)

    components = [
        _severity_component(corpus),
        _sentiment_component(corpus),
        _volatility_component(corpus),
    ]

    available = [c for c in components if c.available]
    total_weight = sum(c.weight for c in available)

    notes: List[str] = []
    if not available or total_weight <= 0:
        notes.append("no scoreable data in window; score reported as 0.0")
        score = 0.0
        effective = {c.name: 0.0 for c in components}
    else:
        effective = {
            c.name: (c.weight / total_weight if c.available else 0.0)
            for c in components
        }
        score = sum(c.value * effective[c.name] for c in components)
        if len(available) < len(components):
            dropped = ", ".join(c.name for c in components if not c.available)
            notes.append(f"weights renormalized over available components; excluded: {dropped}")

    degraded = sum(1 for a in corpus if a.get("classificationMode") and a["classificationMode"] != "gemini")
    risk_bearing = [a for a in corpus if _is_risk_bearing(a)]

    return ScoreBreakdown(
        score=round(score, 1),
        components=[c.as_dict(effective[c.name]) for c in components],
        inputs={
            "windowHours": window_hours,
            "articleCount": len(corpus),
            "riskBearingCount": len(risk_bearing),
            "degradedClassifications": degraded,
            "avgSeverity": round(statistics.fmean([_severity(a) for a in risk_bearing]), 3) if risk_bearing else 0.0,
            "avgSentiment": round(statistics.fmean(
                [float(a["sentimentScore"]) for a in corpus if a.get("sentimentScore") is not None]
            ), 4) if any(a.get("sentimentScore") is not None for a in corpus) else None,
            "newsVolatility": next(
                (round(c.value / 100 * VOLATILITY_SCALE, 3) for c in components
                 if c.name == "NormalizedNewsVolatility" and c.available), None,
            ),
        },
        notes=notes,
    )


def methodology() -> Dict:
    """Machine-readable description of how the score is built, for the API."""
    return {
        "scale": "0-100",
        "formula": SCORE_FORMULA,
        "weights": dict(SCORE_WEIGHTS),
        "windowHours": VOLATILITY_WINDOW_HOURS,
        "components": [
            {
                "name": "NormalizedSeverity",
                "weight": SCORE_WEIGHTS["severity"],
                "derivation": "Mean AI-assigned severity across risk-bearing articles in the window, rescaled 0-10 -> 0-100.",
            },
            {
                "name": "NormalizedSentimentRisk",
                "weight": SCORE_WEIGHTS["sentiment"],
                "derivation": "Mean sentiment polarity across the window, inverted and rescaled so -1 -> 100, 0 -> 50, +1 -> 0.",
            },
            {
                "name": "NormalizedNewsVolatility",
                "weight": SCORE_WEIGHTS["volatility"],
                "derivation": (
                    "Population standard deviation of hour-over-hour changes in mean severity, "
                    f"capped at {VOLATILITY_SCALE} severity points and rescaled to 0-100. "
                    f"Requires at least {VOLATILITY_MIN_BUCKETS} hourly buckets."
                ),
            },
        ],
        "renormalization": (
            "Components without sufficient data are excluded and the remaining weights are "
            "renormalized to sum to 1, so a cold start does not read as artificially low risk."
        ),
        "determinism": "No randomness. The same corpus always yields the same score.",
    }
