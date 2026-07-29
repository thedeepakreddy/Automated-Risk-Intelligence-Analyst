"""Central configuration for the risk intelligence pipeline.

Everything that a reviewer might want to audit or tune -- the news sources, the
risk taxonomy, the scoring weights -- lives here rather than being scattered
through the pipeline modules.
"""

import os
from typing import List, NamedTuple


class NewsFeed(NamedTuple):
    name: str
    url: str


# Free, keyless RSS sources. Feeds are best-effort: a source that 403s, times
# out or retires its feed is logged and skipped, and the cycle continues on the
# remaining sources. Override with the RSS_FEEDS env var (comma-separated, each
# entry either "Name|https://..." or a bare URL).
DEFAULT_FEEDS: List[NewsFeed] = [
    NewsFeed("Reuters Business", "https://www.reuters.com/arc/outboundfeeds/rss/category/business/?outputType=xml"),
    NewsFeed("Bloomberg Markets", "https://feeds.bloomberg.com/markets/news.rss"),
    NewsFeed("CNBC Top News", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"),
    NewsFeed("CNBC Business", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10001147"),
    NewsFeed("CNBC Economy", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
    NewsFeed("CNBC Finance", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"),
    NewsFeed("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
    NewsFeed("MarketWatch Top Stories", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    NewsFeed("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml"),
]


def _parse_feed_env(raw: str) -> List[NewsFeed]:
    feeds = []
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if "|" in entry:
            name, _, url = entry.partition("|")
            feeds.append(NewsFeed(name.strip(), url.strip()))
        else:
            feeds.append(NewsFeed(entry, entry))
    return feeds


def get_feeds() -> List[NewsFeed]:
    raw = os.environ.get("RSS_FEEDS", "").strip()
    return _parse_feed_env(raw) if raw else list(DEFAULT_FEEDS)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# How many headlines to admit per ingestion cycle, and how many to take from any
# single source before moving on (keeps one prolific feed from crowding out the
# rest -- sources are interleaved round-robin).
def max_articles_per_cycle() -> int:
    return _env_int("MAX_ARTICLES_PER_CYCLE", 20)


def max_articles_per_feed() -> int:
    return _env_int("MAX_ARTICLES_PER_FEED", 10)


HTTP_TIMEOUT_SECONDS = 15
HTTP_USER_AGENT = "AutomatedRiskIntelligenceAnalyst/1.0 (+https://github.com/thedeepakreddy/Automated-Risk-Intelligence-Analyst)"


# ---------------------------------------------------------------------------
# Risk taxonomy
# ---------------------------------------------------------------------------

RISK_TYPES = (
    "Market Risk",
    "Credit Risk",
    "Geopolitical Risk",
    "Liquidity Risk",
    "Regulatory Risk",
    "Operational Risk",
    "No Risk",
)

# Tolerated shorthand from the model ("Market" -> "Market Risk"). Anything that
# does not resolve to a taxonomy member is a schema violation.
RISK_TYPE_ALIASES = {r.replace(" Risk", "").casefold(): r for r in RISK_TYPES}
RISK_TYPE_ALIASES.update({r.casefold(): r for r in RISK_TYPES})
RISK_TYPE_ALIASES.update({
    "none": "No Risk",
    "no": "No Risk",
    "macroeconomic": "Market Risk",
    "macroeconomic risk": "Market Risk",
    "macro": "Market Risk",
    "commodity": "Market Risk",
    "commodity risk": "Market Risk",
})

ASSET_CLASSES = ("Equities", "Bonds", "Commodities", "Crypto", "FX", "Real Estate")
ASSET_CLASS_ALIASES = {a.casefold(): a for a in ASSET_CLASSES}
ASSET_CLASS_ALIASES.update({
    "equity": "Equities",
    "stocks": "Equities",
    "bond": "Bonds",
    "fixed income": "Bonds",
    "credit": "Bonds",
    "commodity": "Commodities",
    "energy": "Commodities",
    "oil": "Commodities",
    "gold": "Commodities",
    "cryptocurrency": "Crypto",
    "digital assets": "Crypto",
    "currencies": "FX",
    "forex": "FX",
    "foreign exchange": "FX",
    "real estate": "Real Estate",
    "property": "Real Estate",
})


# ---------------------------------------------------------------------------
# Master Risk Score
# ---------------------------------------------------------------------------

# Documented prior, not a calibrated fit. Exposed on /api/methodology and
# persisted with every score so any historical reading can be decomposed.
SCORE_WEIGHTS = {
    "severity": 0.40,
    "sentiment": 0.30,
    "volatility": 0.30,
}

SCORE_FORMULA = (
    "MasterRiskScore = 0.40*NormalizedSeverity + 0.30*NormalizedSentimentRisk "
    "+ 0.30*NormalizedNewsVolatility"
)

# News-flow volatility is read off hourly buckets of mean severity over a
# trailing window; see api/_scoring.py for the derivation.
VOLATILITY_WINDOW_HOURS = 24
VOLATILITY_MIN_BUCKETS = 3
VOLATILITY_SCALE = 3.0  # severity-point stdev of hourly changes treated as "100"


# ---------------------------------------------------------------------------
# Gemini
# ---------------------------------------------------------------------------

def gemini_model() -> str:
    return os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def gemini_api_key() -> str:
    return (os.environ.get("GEMINI_API_KEY") or "").strip()


# Provenance recorded on every stored article and report, so a degraded reading
# is never mistaken for a real one.
MODE_GEMINI = "gemini"
MODE_DEGRADED_KEYWORD = "degraded-keyword"
MODE_DEGRADED_TEMPLATE = "degraded-template"

DEGRADED_REPORT_BANNER = (
    "> **Degraded mode.** This briefing was assembled deterministically from the "
    "day's classified data because the AI inference layer was unavailable. The "
    "figures are real; the narrative is templated."
)
