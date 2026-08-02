import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def _no_ambient_api_key(monkeypatch):
    """Tests must never depend on (or spend) a real Gemini key."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("RSS_FEEDS", raising=False)
    # Pacing is a production concern; sleeping 6s between fake calls is not.
    monkeypatch.setenv("GEMINI_MAX_RPM", "0")
    monkeypatch.setenv("GEMINI_MAX_RETRIES", "0")

    from api import _classifier
    _classifier.reset_quota_breaker()


@pytest.fixture
def temp_db(tmp_path, monkeypatch):
    """A throwaway SQLite database wired into the module under test."""
    from api import _db

    monkeypatch.setattr(_db, "DB_PATH", str(tmp_path / "test-risk.db"))
    _db.init_db()
    return _db


class FakeModels:
    """Stand-in for ``client.models`` that records calls."""

    def __init__(self, text=None, exc=None):
        self._text = text
        self._exc = exc
        self.calls = []

    def generate_content(self, *, model, contents, config=None):
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self._exc is not None:
            raise self._exc
        return SimpleNamespace(text=self._text)


class FakeGeminiClient:
    def __init__(self, text=None, exc=None):
        self.models = FakeModels(text=text, exc=exc)
