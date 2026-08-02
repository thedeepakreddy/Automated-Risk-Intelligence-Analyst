"""Risk classification of headlines.

Primary path: Gemini, prompted for strict JSON and validated against the risk
taxonomy before anything is stored.

Two failure modes are handled deliberately differently:

* **Schema violation** -- the model answered, but not in the contract. The
  article is logged and *dropped*. Silently substituting keyword output here
  would put a guess in the database wearing the label of a real classification.
* **Transport failure** (no API key, quota exhausted, network error) -- no
  answer at all. The article falls through to the deterministic keyword
  classifier and is stored with ``classificationMode = 'degraded-keyword'`` so
  the downgrade is visible in the data, the API and the dashboard.
"""

import json
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from api._config import (
    ASSET_CLASS_ALIASES,
    ASSET_CLASSES,
    MODE_DEGRADED_KEYWORD,
    MODE_GEMINI,
    RISK_TYPE_ALIASES,
    RISK_TYPES,
    gemini_api_key,
    gemini_breaker_threshold,
    gemini_max_retries,
    gemini_max_rpm,
    gemini_model,
)

log = logging.getLogger("ari.classifier")


class SchemaValidationError(ValueError):
    """The model replied, but not in the agreed schema."""


@dataclass
class Classification:
    risk_type: str
    severity: int
    sentiment_score: float
    affected_assets: List[str] = field(default_factory=list)
    mode: str = MODE_GEMINI
    model: Optional[str] = None

    def as_row(self) -> Dict:
        return {
            "riskType": self.risk_type,
            "riskSeverity": self.severity,
            "sentimentScore": self.sentiment_score,
            "affectedAssets": json.dumps(self.affected_assets),
            "classificationMode": self.mode,
            "classificationModel": self.model or "",
        }


# ---------------------------------------------------------------------------
# Prompt + response contract
# ---------------------------------------------------------------------------

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "risk_type": {"type": "string", "enum": list(RISK_TYPES)},
        "severity": {"type": "integer", "minimum": 0, "maximum": 10},
        "sentiment_score": {"type": "number"},
        "affected_assets": {
            "type": "array",
            "items": {"type": "string", "enum": list(ASSET_CLASSES)},
        },
    },
    "required": ["risk_type", "severity", "sentiment_score", "affected_assets"],
}

SYSTEM_INSTRUCTION = (
    "You are a risk analyst on a markets desk. You classify financial news "
    "headlines into a fixed risk taxonomy. You answer only with JSON matching "
    "the requested schema, with no prose and no code fences."
)

PROMPT_TEMPLATE = """Classify this financial news item.

Title: {title}
Summary: {summary}
Source: {source}

Return JSON with exactly these keys:
  "risk_type": one of {risk_types}. Use "No Risk" for items with no
      material risk implication for financial markets.
  "severity": integer 1-10 for the market impact of the risk (10 = systemic).
      Use 0 if and only if risk_type is "No Risk".
  "sentiment_score": number from -1.0 (maximally negative for risk assets) to
      1.0 (maximally positive).
  "affected_assets": array drawn from {assets}. Empty array if none apply.
"""


def build_prompt(article: Dict) -> str:
    return PROMPT_TEMPLATE.format(
        title=article.get("title", ""),
        summary=article.get("summary") or "(no summary provided)",
        source=article.get("source") or "unknown",
        risk_types=", ".join(f'"{r}"' for r in RISK_TYPES),
        assets=", ".join(f'"{a}"' for a in ASSET_CLASSES),
    )


# ---------------------------------------------------------------------------
# Strict validation
# ---------------------------------------------------------------------------

def _coerce_risk_type(value) -> str:
    if not isinstance(value, str):
        raise SchemaValidationError(f"risk_type must be a string, got {type(value).__name__}")
    resolved = RISK_TYPE_ALIASES.get(value.strip().casefold())
    if resolved is None:
        raise SchemaValidationError(f"risk_type {value!r} is outside the taxonomy")
    return resolved


def _coerce_severity(value, risk_type: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaValidationError(f"severity must be a number, got {type(value).__name__}")
    if isinstance(value, float) and not value.is_integer():
        raise SchemaValidationError(f"severity must be a whole number, got {value}")
    severity = int(value)
    if not 0 <= severity <= 10:
        raise SchemaValidationError(f"severity {severity} outside 0-10")
    if risk_type == "No Risk":
        return 0
    if severity == 0:
        raise SchemaValidationError("severity 0 is only valid for risk_type 'No Risk'")
    return severity


def _coerce_sentiment(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaValidationError(f"sentiment_score must be a number, got {type(value).__name__}")
    sentiment = float(value)
    if not -1.0 <= sentiment <= 1.0:
        raise SchemaValidationError(f"sentiment_score {sentiment} outside -1..1")
    return round(sentiment, 4)


def _coerce_assets(value) -> List[str]:
    """Assets are validated leniently: unrecognized labels are dropped rather
    than failing the whole article, since they do not feed the score."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise SchemaValidationError(f"affected_assets must be a list, got {type(value).__name__}")
    assets = []
    for item in value:
        if not isinstance(item, str):
            raise SchemaValidationError("affected_assets must contain only strings")
        resolved = ASSET_CLASS_ALIASES.get(item.strip().casefold())
        if resolved is None:
            log.debug("dropping unrecognized asset class %r", item)
            continue
        if resolved not in assets:
            assets.append(resolved)
    return assets


def validate_classification(payload, *, mode: str = MODE_GEMINI, model: Optional[str] = None) -> Classification:
    """Validate a decoded model response, raising SchemaValidationError."""
    if not isinstance(payload, dict):
        raise SchemaValidationError(f"expected a JSON object, got {type(payload).__name__}")

    missing = [k for k in ("risk_type", "severity", "sentiment_score", "affected_assets") if k not in payload]
    if missing:
        raise SchemaValidationError(f"missing required keys: {', '.join(missing)}")

    risk_type = _coerce_risk_type(payload["risk_type"])
    return Classification(
        risk_type=risk_type,
        severity=_coerce_severity(payload["severity"], risk_type),
        sentiment_score=_coerce_sentiment(payload["sentiment_score"]),
        affected_assets=_coerce_assets(payload["affected_assets"]),
        mode=mode,
        model=model,
    )


def parse_classification(raw_text: str, *, model: Optional[str] = None) -> Classification:
    """Decode and validate a raw model response body."""
    if not raw_text or not raw_text.strip():
        raise SchemaValidationError("empty response body")
    text = raw_text.strip()
    if text.startswith("```"):  # occasional fenced output despite the instruction
        text = text.strip("`")
        text = text.split("\n", 1)[1] if text.lower().startswith("json") else text
    try:
        payload = json.loads(text)
    except json.JSONDecodeError as exc:
        raise SchemaValidationError(f"response was not valid JSON: {exc}") from exc
    return validate_classification(payload, mode=MODE_GEMINI, model=model)


# ---------------------------------------------------------------------------
# Deterministic fallback (degraded mode)
# ---------------------------------------------------------------------------

_KEYWORD_RULES = (
    (("sanction", "tariff", "trade war", "invasion", "military", "conflict", "geopolit",
      "embargo", "opec", "border", "strait", "election"), "Geopolitical Risk", 8),
    (("default", "downgrade", "bankrupt", "insolven", "credit rating", "delinquen",
      "restructur", "bond covenant", "spreads widen"), "Credit Risk", 8),
    (("liquidity", "bank run", "redemption", "margin call", "funding stress",
      "repo market", "withdrawal"), "Liquidity Risk", 8),
    (("regulat", "sec ", "antitrust", "lawsuit", "probe", "investigation", "fine",
      "compliance", "ban ", "legislation"), "Regulatory Risk", 6),
    (("outage", "cyber", "hack", "breach", "recall", "disruption", "supply chain",
      "strike", "shutdown"), "Operational Risk", 6),
    (("inflation", "rate hike", "rate cut", "central bank", "fed ", "recession",
      "selloff", "plunge", "tumble", "crash", "volatil", "yield", "earnings",
      "gdp", "jobs report"), "Market Risk", 6),
)


_ANALYZER = None


def _vader_sentiment(text: str) -> float:
    """VADER compound polarity. Neutral 0.0 if the analyzer is unavailable."""
    global _ANALYZER
    if _ANALYZER is None:
        try:
            from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
        except ImportError:  # pragma: no cover - declared in requirements.txt
            log.warning("vaderSentiment not installed; degraded sentiment defaults to neutral")
            return 0.0
        _ANALYZER = SentimentIntensityAnalyzer()
    return round(float(_ANALYZER.polarity_scores(text)["compound"]), 4)


def classify_with_keywords(article: Dict) -> Classification:
    """Last-resort deterministic classifier, used only when Gemini is unreachable.

    Sentiment is real VADER polarity rather than a canned constant, but the
    result is still tagged ``degraded-keyword`` -- it is a rule-based guess, and
    the stored data says so.
    """
    title = article.get("title", "") or ""
    summary = article.get("summary", "") or ""
    haystack = f"{title} {summary}".casefold()

    risk_type, severity = "No Risk", 0
    for keywords, mapped_type, mapped_severity in _KEYWORD_RULES:
        if any(k in haystack for k in keywords):
            risk_type, severity = mapped_type, mapped_severity
            break

    sentiment = _vader_sentiment(f"{title}. {summary}")
    if risk_type != "No Risk":
        # Strongly negative tone nudges severity up, positive tone nudges it down.
        severity = max(1, min(10, severity + (1 if sentiment <= -0.5 else -1 if sentiment >= 0.5 else 0)))

    assets = [
        asset for asset, keywords in (
            ("Equities", ("stock", "equit", "shares", "s&p", "nasdaq", "dow", "earnings", "index")),
            ("Bonds", ("bond", "yield", "treasur", "credit", "rate", "gilt", "debt")),
            ("Commodities", ("oil", "crude", "gold", "commodit", "gas", "metal", "wheat", "opec")),
            ("Crypto", ("crypto", "bitcoin", "ethereum", "token", "stablecoin")),
            ("FX", ("dollar", "currency", "euro", "yen", "forex", "exchange rate")),
            ("Real Estate", ("housing", "real estate", "mortgage", "property")),
        ) if any(k in haystack for k in keywords)
    ]

    return Classification(
        risk_type=risk_type,
        severity=severity,
        sentiment_score=sentiment,
        affected_assets=assets,
        mode=MODE_DEGRADED_KEYWORD,
        model=None,
    )


# ---------------------------------------------------------------------------
# Gemini client
# ---------------------------------------------------------------------------

def build_client():
    """Return a Gemini client, or None when no API key is configured."""
    key = gemini_api_key()
    if not key:
        log.warning("[CLASSIFIER] GEMINI_API_KEY is not set - running in degraded keyword mode")
        return None
    try:
        from google import genai
        return genai.Client(api_key=key)
    except Exception as exc:  # SDK missing or client construction failed
        log.error("[CLASSIFIER] could not construct Gemini client (%s) - degraded keyword mode", exc)
        return None


def _generate(client, prompt: str, model: str) -> str:
    from google.genai import types

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            response_schema=RESPONSE_SCHEMA,
            temperature=0.2,
        ),
    )
    return response.text or ""


# ---------------------------------------------------------------------------
# Pacing, retries and the quota circuit breaker
#
# A cycle classifies up to 20 headlines. Fired back-to-back that exceeds the
# free tier's ~10 requests/minute within seconds, and every 429 lands silently
# in degraded keyword mode -- the pipeline keeps working but stops using the
# model it is built around. So calls are spaced, throttled responses are
# retried with backoff, and once the quota is genuinely spent the cycle stops
# asking rather than retrying every remaining article.
# ---------------------------------------------------------------------------

_last_call_at = 0.0
_consecutive_quota_failures = 0
_model_unavailable_logged = False


def reset_quota_breaker() -> None:
    """Re-arm the breaker. Called at the start of each ingestion cycle."""
    global _consecutive_quota_failures, _model_unavailable_logged
    _consecutive_quota_failures = 0
    _model_unavailable_logged = False


def quota_breaker_open() -> bool:
    return _consecutive_quota_failures >= gemini_breaker_threshold()


def _is_throttled(detail: str) -> bool:
    return "429" in detail or "RESOURCE_EXHAUSTED" in detail


def _is_model_unavailable(detail: str) -> bool:
    """A dead or inaccessible model name -- configuration, not weather."""
    return "404" in detail and ("NOT_FOUND" in detail or "model" in detail.lower())


def list_available_models(client) -> List[str]:
    """Model ids this API key can actually call for generateContent."""
    try:
        names = []
        for model in client.models.list():
            actions = getattr(model, "supported_actions", None)
            if actions and "generateContent" not in actions:
                continue
            name = getattr(model, "name", "") or ""
            names.append(name[len("models/"):] if name.startswith("models/") else name)
        return sorted(n for n in names if n)
    except Exception as exc:
        log.warning("[CLASSIFIER] could not list available models: %s", str(exc)[:200])
        return []


def verify_model(client) -> bool:
    """Check the configured model at startup rather than per-article.

    Google retires models for new API keys, and the resulting 404 is a config
    error dressed as a runtime failure -- without this it surfaces only as one
    quiet fallback line per article, forever.
    """
    if client is None:
        return False
    model = gemini_model()
    available = list_available_models(client)
    if not available:
        log.info("[CLASSIFIER] model list unavailable; proceeding with %s", model)
        return True
    if model in available:
        log.info("[CLASSIFIER] model %s is available to this API key", model)
        return True
    log.error(
        "[CLASSIFIER] GEMINI_MODEL=%r is NOT callable by this API key - every "
        "classification will fall back to degraded keyword mode. Set GEMINI_MODEL "
        "to one of: %s",
        model, ", ".join(available[:25]) or "(none returned)",
    )
    return False


def _is_transient(detail: str) -> bool:
    return _is_throttled(detail) or any(c in detail for c in ("500", "502", "503", "504", "UNAVAILABLE"))


def _throttle() -> None:
    """Space calls out to the configured requests-per-minute ceiling."""
    global _last_call_at
    rpm = gemini_max_rpm()
    if rpm <= 0:
        return
    wait = (60.0 / rpm) - (time.monotonic() - _last_call_at)
    if wait > 0:
        time.sleep(wait)
    _last_call_at = time.monotonic()


def _generate_with_retry(client, prompt: str, model: str) -> str:
    global _consecutive_quota_failures
    attempts = gemini_max_retries() + 1
    last_detail = ""

    for attempt in range(attempts):
        _throttle()
        try:
            raw = _generate(client, prompt, model)
            _consecutive_quota_failures = 0
            return raw
        except Exception as exc:
            last_detail = str(exc)
            if _is_throttled(last_detail):
                _consecutive_quota_failures += 1
            if attempt == attempts - 1 or not _is_transient(last_detail):
                raise
            backoff = 2.0 ** attempt
            log.info("[CLASSIFIER] transient error (%s), retrying in %.0fs",
                     last_detail[:120], backoff)
            time.sleep(backoff)

    raise RuntimeError(last_detail)  # pragma: no cover - loop always returns or raises


def classify_article(article: Dict, client=None) -> Optional[Classification]:
    """Classify one headline.

    Returns ``None`` when the model answered off-contract -- the caller drops
    the article. Returns a ``degraded-keyword`` classification when the model
    could not be reached at all.
    """
    if client is None:
        return classify_with_keywords(article)

    if quota_breaker_open():
        return classify_with_keywords(article)

    model = gemini_model()
    try:
        raw = _generate_with_retry(client, build_prompt(article), model)
    except Exception as exc:
        detail = str(exc)
        if _is_throttled(detail):
            log.warning(
                "[CLASSIFIER] Gemini quota exhausted after %d attempt(s) - degraded keyword mode. "
                "Lower MAX_ARTICLES_PER_CYCLE, raise INGESTION_INTERVAL_SECONDS, or set "
                "GEMINI_MAX_RPM to match your tier. Detail: %s",
                gemini_max_retries() + 1, detail[:200],
            )
            if quota_breaker_open():
                log.error("[CLASSIFIER] quota breaker OPEN - remaining articles this cycle "
                          "will be keyword-classified without calling Gemini")
        elif _is_model_unavailable(detail):
            # Configuration, not weather: retrying will never help, so say so
            # once per cycle with the fix rather than once per article.
            global _model_unavailable_logged
            if not _model_unavailable_logged:
                _model_unavailable_logged = True
                log.error(
                    "[CLASSIFIER] model %r is not callable by this API key - EVERY article this "
                    "cycle will be keyword-classified. Set GEMINI_MODEL to a model your key "
                    "supports; list them with: curl -s "
                    "'https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY'. "
                    "Detail: %s",
                    model, detail[:200],
                )
        else:
            log.warning("[CLASSIFIER] Gemini call failed (%s) - falling back to degraded keyword mode", detail[:200])
        return classify_with_keywords(article)

    try:
        return parse_classification(raw, model=model)
    except SchemaValidationError as exc:
        log.error(
            "[CLASSIFIER] dropping article %r: response failed schema validation (%s). Raw: %s",
            article.get("title", "")[:80], exc, raw[:300],
        )
        return None
