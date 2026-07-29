"""Ingestion must never store the same story twice."""

import feedparser
import pytest

from api import _ingestion, _news
from api._news import canonical_url, dedupe_batch, dedupe_key, fetch_feed, normalize_title

RSS_FIXTURE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test Business Wire</title>
  <item>
    <title>Oil jumps as supply disruption hits exports</title>
    <link>https://example.com/markets/oil-jumps?utm_source=rss&amp;utm_medium=feed</link>
    <description>&lt;p&gt;Crude rose sharply on   supply fears.&lt;/p&gt;</description>
    <pubDate>Wed, 29 Jul 2026 08:15:00 GMT</pubDate>
  </item>
  <item>
    <title>Central bank holds rates steady</title>
    <link>https://example.com/economy/rates-hold</link>
    <description>Policymakers left the benchmark unchanged.</description>
    <pubDate>Wed, 29 Jul 2026 07:40:00 GMT</pubDate>
  </item>
</channel></rss>"""


class FakeResponse:
    def __init__(self, content):
        self.content = content

    def raise_for_status(self):
        return None


# ---------------------------------------------------------------------------
# Dedupe primitives
# ---------------------------------------------------------------------------

def test_titles_are_normalized_before_comparison():
    assert normalize_title("Oil Jumps, as Supply-Disruption Hits!") == "oil jumps as supply disruption hits"
    assert normalize_title("Café  crisis") == normalize_title("Cafe crisis")


def test_tracking_parameters_do_not_make_a_url_unique():
    assert (canonical_url("https://www.example.com/a/b/?utm_source=rss&id=7")
            == canonical_url("http://example.com/a/b?id=7"))


def test_dedupe_key_is_stable_across_syndications():
    assert dedupe_key("Oil Jumps as Supply Disruption Hits", "https://a.com/1?utm_source=x") == \
           dedupe_key("Oil jumps, as supply disruption hits.", "https://b.com/2")


def test_dedupe_batch_drops_repeats_within_a_batch():
    batch = [
        {"title": "Rates held steady", "url": "https://a.com/1", "dedupeKey": dedupe_key("Rates held steady", "")},
        {"title": "Rates Held Steady!", "url": "https://b.com/2", "dedupeKey": dedupe_key("Rates Held Steady!", "")},
        {"title": "Oil jumps", "url": "https://a.com/3", "dedupeKey": dedupe_key("Oil jumps", "")},
    ]

    result = dedupe_batch(batch)

    assert [a["title"] for a in result] == ["Rates held steady", "Oil jumps"]


def test_dedupe_batch_drops_articles_already_ingested():
    seen = dedupe_key("Rates held steady", "")
    batch = [
        {"title": "Rates held steady", "url": "https://a.com/1", "dedupeKey": seen},
        {"title": "Oil jumps", "url": "https://a.com/3", "dedupeKey": dedupe_key("Oil jumps", "")},
    ]

    assert [a["title"] for a in dedupe_batch(batch, seen_keys={seen})] == ["Oil jumps"]


def test_dedupe_batch_matches_on_canonical_url_when_titles_differ():
    batch = [{
        "title": "Oil jumps on supply fears",
        "url": "https://www.example.com/a?utm_campaign=x",
        "urlCanonical": canonical_url("https://www.example.com/a?utm_campaign=x"),
        "dedupeKey": dedupe_key("Oil jumps on supply fears", ""),
    }]

    assert dedupe_batch(batch, seen_urls={canonical_url("https://example.com/a/")}) == []


# ---------------------------------------------------------------------------
# Feed parsing
# ---------------------------------------------------------------------------

def test_feed_entries_are_normalized(monkeypatch):
    monkeypatch.setattr(_news.requests, "get", lambda *a, **k: FakeResponse(RSS_FIXTURE))

    articles = fetch_feed(_news.NewsFeed("Test Wire", "https://example.com/rss"), limit=10)

    assert len(articles) == 2
    first = articles[0]
    assert first["title"] == "Oil jumps as supply disruption hits exports"
    assert first["source"] == "Test Wire"
    assert first["summary"] == "Crude rose sharply on supply fears."  # HTML stripped, whitespace collapsed
    assert first["urlCanonical"] == "https://example.com/markets/oil-jumps"
    assert first["publishedAt"].startswith("2026-07-29T08:15:00")
    assert first["dedupeKey"] == dedupe_key(first["title"], first["url"])


def test_a_dead_feed_is_skipped_not_fatal(monkeypatch):
    def boom(*args, **kwargs):
        raise _news.requests.RequestException("403 Forbidden")

    monkeypatch.setattr(_news.requests, "get", boom)

    assert fetch_feed(_news.NewsFeed("Dead Wire", "https://example.com/rss"), limit=10) == []


def test_feed_limit_is_respected(monkeypatch):
    monkeypatch.setattr(_news.requests, "get", lambda *a, **k: FakeResponse(RSS_FIXTURE))

    assert len(fetch_feed(_news.NewsFeed("Test Wire", "https://x/rss"), limit=1)) == 1


# ---------------------------------------------------------------------------
# End-to-end: a repeated cycle must not duplicate anything
# ---------------------------------------------------------------------------

@pytest.fixture
def headline_batch():
    parsed = feedparser.parse(RSS_FIXTURE)
    return [
        {
            "title": entry.title,
            "url": entry.link,
            "urlCanonical": canonical_url(entry.link),
            "summary": entry.description,
            "source": "Test Wire",
            "publishedAt": "2026-07-29T08:15:00+00:00",
            "dedupeKey": dedupe_key(entry.title, entry.link),
        }
        for entry in parsed.entries
    ]


def test_repeated_cycles_do_not_duplicate_articles(temp_db, monkeypatch, headline_batch):
    monkeypatch.setattr(_ingestion, "fetch_headlines", lambda limit=None: list(headline_batch))

    first = _ingestion.run_ingestion_cycle()
    second = _ingestion.run_ingestion_cycle()

    assert first["fetched"] == 2 and first["new"] == 2 and first["stored"] == 2
    assert second["fetched"] == 2, "the feed still serves the same headlines"
    assert second["new"] == 0, "but none of them are new"
    assert second["stored"] == 0
    assert second["duplicatesSkipped"] == 2

    conn = temp_db.get_db()
    try:
        titles = [r["title"] for r in conn.execute("SELECT title FROM articles ORDER BY id")]
    finally:
        conn.close()

    assert len(titles) == 2 == len(set(titles))


def test_a_new_headline_is_ingested_alongside_known_ones(temp_db, monkeypatch, headline_batch):
    monkeypatch.setattr(_ingestion, "fetch_headlines", lambda limit=None: list(headline_batch))
    _ingestion.run_ingestion_cycle()

    fresh = dict(headline_batch[0],
                 title="Sanctions widen against major energy exporter",
                 url="https://example.com/geo/sanctions",
                 urlCanonical=canonical_url("https://example.com/geo/sanctions"),
                 dedupeKey=dedupe_key("Sanctions widen against major energy exporter", ""))
    monkeypatch.setattr(_ingestion, "fetch_headlines", lambda limit=None: headline_batch + [fresh])

    second = _ingestion.run_ingestion_cycle()

    assert second["fetched"] == 3
    assert second["new"] == 1
    assert second["stored"] == 1
    assert second["duplicatesSkipped"] == 2


def test_the_unique_index_is_the_final_guarantee(temp_db, headline_batch):
    """Even a caller that bypasses the pre-filter cannot double-insert."""
    rows = [
        {
            "title": a["title"], "url": a["url"], "urlCanonical": a["urlCanonical"],
            "summary": a["summary"], "source": a["source"], "dedupeKey": a["dedupeKey"],
            "timestamp": "2026-07-29T09:00:00+00:00", "publishedAt": a["publishedAt"],
            "riskType": "Market Risk", "riskSeverity": 5, "sentimentScore": -0.1,
            "affectedAssets": "[]", "classificationMode": "gemini", "classificationModel": "test",
        }
        for a in headline_batch
    ]

    conn = temp_db.get_db()
    try:
        assert temp_db.insert_articles(conn, rows) == 2
        assert temp_db.insert_articles(conn, rows) == 0
        conn.commit()
        assert conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0] == 2
    finally:
        conn.close()


def test_ingestion_persists_a_real_score_and_provenance(temp_db, monkeypatch, headline_batch):
    monkeypatch.setattr(_ingestion, "fetch_headlines", lambda limit=None: list(headline_batch))

    summary = _ingestion.run_ingestion_cycle()

    conn = temp_db.get_db()
    try:
        score_row = temp_db.latest_score(conn)
        modes = {r["classificationMode"] for r in conn.execute("SELECT classificationMode FROM articles")}
    finally:
        conn.close()

    assert score_row["score"] == summary["masterRiskScore"]
    assert 0 <= score_row["score"] <= 100
    # No Gemini key in the test environment, so every article is honestly labelled.
    assert modes == {"degraded-keyword"}
    assert summary["degradedClassifications"] == 2


def test_migration_collapses_duplicates_from_a_pre_dedupe_database(tmp_path, monkeypatch):
    """Older databases were filled with the same three mock rows every cycle."""
    import sqlite3

    from api import _db

    path = str(tmp_path / "legacy.db")
    monkeypatch.setattr(_db, "DB_PATH", path)

    legacy = sqlite3.connect(path)
    legacy.executescript("""
        CREATE TABLE articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, url TEXT, timestamp DATETIME,
            riskType TEXT, riskSeverity INTEGER, sentimentScore REAL, affectedAssets TEXT
        );
        CREATE TABLE system_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME, score REAL);
        CREATE TABLE reports (id INTEGER PRIMARY KEY AUTOINCREMENT, date DATETIME, content TEXT);
    """)
    legacy.executemany(
        "INSERT INTO articles (title, url, timestamp, riskType, riskSeverity, sentimentScore, affectedAssets)"
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
        [("Global markets tumble as trade tensions escalate", "https://example.com/1",
          "2026-07-29T09:00:00+00:00", "Geopolitical Risk", 9, -0.8, "[]")] * 5,
    )
    legacy.commit()
    legacy.close()

    _db.init_db()

    conn = _db.get_db()
    try:
        rows = conn.execute("SELECT COUNT(*) FROM articles").fetchone()[0]
        keys = conn.execute("SELECT COUNT(DISTINCT dedupeKey) FROM articles").fetchone()[0]
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(articles)")}
    finally:
        conn.close()

    assert rows == 1, "five copies of one headline collapse to one"
    assert keys == 1
    assert {"dedupeKey", "classificationMode", "summary", "source"} <= columns
