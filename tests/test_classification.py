"""Classification must match the agreed schema, or the article is dropped."""

import json

import pytest

from api import _classifier
from api._classifier import (
    Classification,
    SchemaValidationError,
    classify_article,
    classify_with_keywords,
    parse_classification,
    validate_classification,
)
from api._config import ASSET_CLASSES, MODE_DEGRADED_KEYWORD, MODE_GEMINI, RISK_TYPES
from conftest import FakeGeminiClient

ARTICLE = {
    "title": "Central bank signals further tightening as inflation stays elevated",
    "summary": "Bond yields rose after policymakers flagged additional rate increases.",
    "source": "Test Wire",
}

VALID_PAYLOAD = {
    "risk_type": "Market Risk",
    "severity": 7,
    "sentiment_score": -0.62,
    "affected_assets": ["Bonds", "Equities"],
}


def assert_matches_schema(result: Classification):
    """The contract every stored classification must satisfy."""
    assert isinstance(result, Classification)
    assert result.risk_type in RISK_TYPES
    assert isinstance(result.severity, int) and 0 <= result.severity <= 10
    assert isinstance(result.sentiment_score, float) and -1.0 <= result.sentiment_score <= 1.0
    assert isinstance(result.affected_assets, list)
    assert all(a in ASSET_CLASSES for a in result.affected_assets)
    assert result.mode in (MODE_GEMINI, MODE_DEGRADED_KEYWORD)
    # severity 0 is reserved for "No Risk" and vice versa
    assert (result.severity == 0) == (result.risk_type == "No Risk")


def test_valid_response_matches_schema():
    result = parse_classification(json.dumps(VALID_PAYLOAD), model="gemini-2.5-flash")

    assert_matches_schema(result)
    assert result.risk_type == "Market Risk"
    assert result.severity == 7
    assert result.sentiment_score == -0.62
    assert result.affected_assets == ["Bonds", "Equities"]
    assert result.mode == MODE_GEMINI
    assert result.model == "gemini-2.5-flash"


def test_row_serialization_matches_schema():
    row = parse_classification(json.dumps(VALID_PAYLOAD), model="gemini-2.5-flash").as_row()

    assert row["riskType"] == "Market Risk"
    assert row["riskSeverity"] == 7
    assert row["sentimentScore"] == -0.62
    assert json.loads(row["affectedAssets"]) == ["Bonds", "Equities"]
    assert row["classificationMode"] == MODE_GEMINI


def test_fenced_json_is_tolerated():
    fenced = "```json\n" + json.dumps(VALID_PAYLOAD) + "\n```"
    assert_matches_schema(parse_classification(fenced))


def test_shorthand_risk_type_is_normalized():
    payload = dict(VALID_PAYLOAD, risk_type="geopolitical")
    result = validate_classification(payload)

    assert result.risk_type == "Geopolitical Risk"
    assert_matches_schema(result)


def test_unknown_asset_labels_are_dropped_not_fatal():
    result = validate_classification(dict(VALID_PAYLOAD, affected_assets=["Bonds", "Tulips"]))

    assert result.affected_assets == ["Bonds"]
    assert_matches_schema(result)


def test_no_risk_forces_zero_severity():
    result = validate_classification(dict(VALID_PAYLOAD, risk_type="No Risk", severity=6))

    assert result.severity == 0
    assert_matches_schema(result)


@pytest.mark.parametrize("payload, reason", [
    ({}, "missing keys"),
    (dict(VALID_PAYLOAD, risk_type="Reputational Risk"), "risk type outside taxonomy"),
    (dict(VALID_PAYLOAD, severity=11), "severity above range"),
    (dict(VALID_PAYLOAD, severity=0), "severity 0 without No Risk"),
    (dict(VALID_PAYLOAD, severity="high"), "severity not numeric"),
    (dict(VALID_PAYLOAD, severity=6.5), "severity not a whole number"),
    (dict(VALID_PAYLOAD, sentiment_score=-4), "sentiment outside range"),
    (dict(VALID_PAYLOAD, sentiment_score="bearish"), "sentiment not numeric"),
    (dict(VALID_PAYLOAD, affected_assets="Bonds"), "assets not a list"),
    (dict(VALID_PAYLOAD, affected_assets=[7]), "assets not strings"),
    ([VALID_PAYLOAD], "not an object"),
])
def test_schema_violations_are_rejected(payload, reason):
    with pytest.raises(SchemaValidationError):
        validate_classification(payload)


@pytest.mark.parametrize("raw", ["", "   ", "not json at all", "{unclosed", "null"])
def test_unparseable_bodies_are_rejected(raw):
    with pytest.raises(SchemaValidationError):
        parse_classification(raw)


def test_gemini_path_returns_validated_classification():
    client = FakeGeminiClient(text=json.dumps(VALID_PAYLOAD))

    result = classify_article(ARTICLE, client)

    assert_matches_schema(result)
    assert result.mode == MODE_GEMINI
    assert client.models.calls, "the Gemini client must actually be called"
    assert ARTICLE["title"] in client.models.calls[0]["contents"]


def test_schema_failure_drops_the_article_instead_of_guessing():
    """A malformed model response must not be laundered into keyword output."""
    client = FakeGeminiClient(text='{"risk_type": "Vibes", "severity": 99}')

    assert classify_article(ARTICLE, client) is None


def test_api_failure_falls_back_to_labelled_degraded_mode():
    client = FakeGeminiClient(exc=RuntimeError("429 RESOURCE_EXHAUSTED"))

    result = classify_article(ARTICLE, client)

    assert_matches_schema(result)
    assert result.mode == MODE_DEGRADED_KEYWORD, "degraded output must be distinguishable"
    assert result.model is None


def test_missing_client_uses_degraded_mode():
    result = classify_article(ARTICLE, client=None)

    assert_matches_schema(result)
    assert result.mode == MODE_DEGRADED_KEYWORD


def test_throttled_calls_are_retried_before_giving_up(monkeypatch):
    """A single 429 should not cost the article its real classification."""
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_MAX_RETRIES", "2")
    monkeypatch.setattr(_classifier.time, "sleep", lambda _s: None)

    calls = {"n": 0}

    def flaky(*, model, contents, config=None):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("429 RESOURCE_EXHAUSTED")
        return SimpleNamespace(text=json.dumps(VALID_PAYLOAD))

    client = FakeGeminiClient()
    client.models.generate_content = flaky

    result = classify_article(ARTICLE, client)

    assert calls["n"] == 2, "the throttled call must be retried"
    assert result.mode == MODE_GEMINI, "a retried success is not a degraded reading"
    assert_matches_schema(result)


def test_quota_breaker_stops_calling_once_the_quota_is_spent(monkeypatch):
    """Past the threshold the cycle stops asking instead of retrying every article."""
    monkeypatch.setenv("GEMINI_BREAKER_THRESHOLD", "3")
    monkeypatch.setattr(_classifier.time, "sleep", lambda _s: None)
    _classifier.reset_quota_breaker()

    client = FakeGeminiClient(exc=RuntimeError("429 RESOURCE_EXHAUSTED"))

    for _ in range(3):
        assert classify_article(ARTICLE, client).mode == MODE_DEGRADED_KEYWORD
    assert _classifier.quota_breaker_open()

    calls_before = len(client.models.calls)
    result = classify_article(ARTICLE, client)

    assert result.mode == MODE_DEGRADED_KEYWORD
    assert len(client.models.calls) == calls_before, "breaker open: no further API calls"

    _classifier.reset_quota_breaker()
    assert not _classifier.quota_breaker_open()


def test_a_success_re_arms_the_breaker(monkeypatch):
    monkeypatch.setattr(_classifier.time, "sleep", lambda _s: None)
    _classifier.reset_quota_breaker()

    classify_article(ARTICLE, FakeGeminiClient(exc=RuntimeError("429 RESOURCE_EXHAUSTED")))
    classify_article(ARTICLE, FakeGeminiClient(text=json.dumps(VALID_PAYLOAD)))

    assert not _classifier.quota_breaker_open()


def test_a_retired_model_is_not_retried(monkeypatch):
    """404 is configuration, not weather -- retrying it only wastes the cycle."""
    monkeypatch.setenv("GEMINI_MAX_RETRIES", "3")
    monkeypatch.setattr(_classifier.time, "sleep", lambda _s: None)

    client = FakeGeminiClient(exc=RuntimeError(
        "404 NOT_FOUND. {'error': {'code': 404, 'message': 'This model "
        "models/gemini-2.5-flash is no longer available to new users.'}}"
    ))

    result = classify_article(ARTICLE, client)

    assert result.mode == MODE_DEGRADED_KEYWORD
    assert len(client.models.calls) == 1, "a dead model name must not be retried"
    assert not _classifier.quota_breaker_open(), "a 404 is not a quota failure"


def test_verify_model_reports_an_uncallable_model(monkeypatch, caplog):
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_MODEL", "gemini-retired-9000")
    client = FakeGeminiClient()
    client.models.list = lambda: [
        SimpleNamespace(name="models/gemini-real-a", supported_actions=["generateContent"]),
        SimpleNamespace(name="models/gemini-real-b", supported_actions=["generateContent"]),
        SimpleNamespace(name="models/embed-only", supported_actions=["embedContent"]),
    ]

    with caplog.at_level("ERROR"):
        assert _classifier.verify_model(client) is False

    assert "gemini-retired-9000" in caplog.text
    assert "gemini-real-a" in caplog.text
    assert "embed-only" not in caplog.text, "only generateContent models are offered"


def test_verify_model_passes_for_a_callable_model(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setenv("GEMINI_MODEL", "gemini-real-a")
    client = FakeGeminiClient()
    client.models.list = lambda: [
        SimpleNamespace(name="models/gemini-real-a", supported_actions=["generateContent"]),
    ]

    assert _classifier.verify_model(client) is True


def test_verify_model_is_permissive_when_the_list_call_fails():
    """An unlistable key is not proof of a bad model; do not block the cycle."""
    client = FakeGeminiClient()

    def boom():
        raise RuntimeError("403 permission denied on models.list")

    client.models.list = boom

    assert _classifier.verify_model(client) is True


def test_keyword_fallback_is_deterministic_and_uses_real_sentiment():
    negative = classify_with_keywords({
        "title": "Sanctions escalate as conflict disrupts oil supply",
        "summary": "Crude surged on fears of a prolonged embargo.",
    })
    positive = classify_with_keywords({
        "title": "Strong earnings lift stocks to record highs",
        "summary": "Investors cheered excellent results and raised guidance.",
    })

    assert_matches_schema(negative)
    assert_matches_schema(positive)
    assert negative.risk_type == "Geopolitical Risk"
    assert "Commodities" in negative.affected_assets
    assert negative.sentiment_score < positive.sentiment_score
    # Deterministic: the old implementation used random.randint here.
    assert classify_with_keywords({"title": "Sanctions escalate as conflict disrupts oil supply",
                                  "summary": "Crude surged on fears of a prolonged embargo."}) == negative
