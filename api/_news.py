"""Live news ingestion from free, keyless RSS feeds.

Replaces the hardcoded three-article mock. Each cycle pulls the most recent
headlines from the configured sources, normalizes them into a common shape, and
assigns a stable deduplication key so the same story is never ingested (or
classified, or scored) twice.
"""

import hashlib
import logging
import re
import unicodedata
from datetime import datetime, timezone
from itertools import zip_longest
from typing import Dict, Iterable, List, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import requests

from api._config import (
    HTTP_TIMEOUT_SECONDS,
    HTTP_USER_AGENT,
    NewsFeed,
    get_feeds,
    max_articles_per_cycle,
    max_articles_per_feed,
)

log = logging.getLogger("ari.news")

# Query parameters that identify a campaign rather than a document.
_TRACKING_PARAMS = re.compile(r"^(utm_|ito$|ns_|cmp$|cmpid$|src$|ref$|fbclid$|gclid$|taid$)", re.I)
_PUNCTUATION = re.compile(r"[^\w\s]", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")
_HTML_TAG = re.compile(r"<[^>]+>")


def canonical_url(url: str) -> str:
    """Strip the parts of a URL that vary between syndications of one story."""
    if not url:
        return ""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return url.strip().casefold()
    if not parts.netloc:
        return url.strip().casefold()

    netloc = parts.netloc.casefold()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    query = urlencode([
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not _TRACKING_PARAMS.match(k)
    ])
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("https", netloc, path, query, ""))


def normalize_title(title: str) -> str:
    """Casefold, strip accents/punctuation and collapse whitespace.

    Two wire services running the same story rarely agree on punctuation or
    capitalisation, so the normalized title is the primary dedupe signal.
    """
    if not title:
        return ""
    text = unicodedata.normalize("NFKD", title)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = _PUNCTUATION.sub(" ", text.casefold())
    return _WHITESPACE.sub(" ", text).strip()


def dedupe_key(title: str, url: str) -> str:
    """Stable identity for a story: normalized title, falling back to the URL."""
    basis = normalize_title(title) or canonical_url(url)
    return hashlib.sha1(basis.encode("utf-8")).hexdigest()


def _clean_summary(raw: str, limit: int = 400) -> str:
    if not raw:
        return ""
    text = _HTML_TAG.sub(" ", raw)
    text = _WHITESPACE.sub(" ", text).strip()
    return text[:limit]


def _published_at(entry) -> str:
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if parsed:
        try:
            return datetime(*parsed[:6], tzinfo=timezone.utc).isoformat()
        except (TypeError, ValueError):
            pass
    return datetime.now(timezone.utc).isoformat()


def fetch_feed(feed: NewsFeed, limit: int, session: Optional[requests.Session] = None) -> List[Dict]:
    """Fetch and normalize one feed. Never raises -- a dead source returns []."""
    getter = session.get if session else requests.get
    try:
        response = getter(
            feed.url,
            headers={"User-Agent": HTTP_USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        log.warning("[INGESTION] feed %s unavailable: %s", feed.name, exc)
        return []

    parsed = feedparser.parse(response.content)
    if parsed.bozo and not parsed.entries:
        log.warning("[INGESTION] feed %s returned unparseable content: %s", feed.name, parsed.bozo_exception)
        return []

    articles = []
    for entry in parsed.entries[:limit]:
        title = (entry.get("title") or "").strip()
        if not title:
            continue
        url = (entry.get("link") or "").strip()
        articles.append({
            "title": title,
            "url": url,
            "urlCanonical": canonical_url(url),
            "summary": _clean_summary(entry.get("summary") or entry.get("description") or ""),
            "source": feed.name,
            "publishedAt": _published_at(entry),
            "dedupeKey": dedupe_key(title, url),
        })

    log.info("[INGESTION] feed %s returned %d headlines", feed.name, len(articles))
    return articles


def _interleave(batches: Iterable[List[Dict]]) -> List[Dict]:
    """Round-robin across sources so no single feed dominates a cycle."""
    merged: List[Dict] = []
    for rank in zip_longest(*[list(b) for b in batches if b]):
        merged.extend(article for article in rank if article is not None)
    return merged


def dedupe_batch(articles: Iterable[Dict], seen_keys: Iterable[str] = (), seen_urls: Iterable[str] = ()) -> List[Dict]:
    """Drop articles already ingested (``seen_*``) and repeats within the batch."""
    keys = set(seen_keys)
    urls = {u for u in seen_urls if u}
    unique = []
    for article in articles:
        key = article.get("dedupeKey") or dedupe_key(article.get("title", ""), article.get("url", ""))
        canonical = article.get("urlCanonical") or canonical_url(article.get("url", ""))
        if key in keys or (canonical and canonical in urls):
            continue
        keys.add(key)
        if canonical:
            urls.add(canonical)
        unique.append(article)
    return unique


def fetch_headlines(limit: Optional[int] = None) -> List[Dict]:
    """Pull the latest headlines across every configured feed, deduplicated."""
    limit = limit if limit is not None else max_articles_per_cycle()
    per_feed = max_articles_per_feed()

    with requests.Session() as session:
        batches = [fetch_feed(feed, per_feed, session) for feed in get_feeds()]

    headlines = dedupe_batch(_interleave(batches))[:limit]
    if not headlines:
        log.error("[INGESTION] no headlines retrieved from any configured feed")
    return headlines
