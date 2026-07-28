# Automated Risk Intelligence Analyst

**An end-to-end market risk surveillance platform that ingests live market and news data, quantifies systemic risk into a single 0-100 score, and publishes an automated daily risk briefing in the format a sell-side or buy-side risk desk would actually consume.**

The system replicates the daily workflow of a junior risk analyst: pull the tape, read the news flow, classify each headline by risk type and severity, score the aggregate exposure, and write the morning briefing. It runs unattended on a 30-minute ingestion cycle with a scheduled daily report.

Repository: https://github.com/thedeepakreddy/Automated-Risk-Intelligence-Analyst

---

## Dashboard

[![Global Macro Risk Intelligence Dashboard](./image.png)](./image.png)

*Full dashboard view: master risk gauge, 7-day score timeline, sentiment trend by asset class, risk heatmap, AI-generated daily briefing, and the classified intelligence feed.*

---

## Why This Project

Risk desks do not fail for lack of data; they fail because unstructured news flow is not converted into a comparable, time-series metric fast enough to act on. This project addresses that gap directly:

- **Unstructured to structured.** Every headline is classified into a standard risk taxonomy (Market, Credit, Geopolitical, Liquidity, Regulatory, Operational) with an affected-asset mapping and a 1-10 severity score.
- **A single defensible number.** Severity, sentiment, and realized cross-asset volatility are normalized and combined into one Master Risk Score, so risk is trackable over time rather than assessed anecdotally.
- **Analyst output, not just a chart.** The system produces a written Executive Summary, Top 3 Risks, Most Affected Asset Classes, Trend Analysis, and a Strategic Recommendation each morning.

---

## Risk Methodology

The Master Risk Score is a transparent, weighted composite on a 0-100 scale. Nothing in the score is a black box.

| Component | Weight | Derivation |
|---|---|---|
| News Severity | 40% | Mean AI-assigned severity across risk-bearing articles, normalized to 0-100 |
| Sentiment Risk | 30% | VADER compound polarity across the corpus, inverted and rescaled so negative tone raises risk |
| Realized Volatility | 30% | Mean absolute daily percentage move across the tracked asset basket, capped at 100 |

```
MasterRiskScore = 0.40 * NormalizedSeverity
                + 0.30 * NormalizedSentimentRisk
                + 0.30 * NormalizedVolatility
```

**Tracked asset basket (cross-asset by design):**

| Asset Class | Instrument | Symbol |
|---|---|---|
| Equities | S&P 500 Index | `^GSPC` |
| Commodities | Gold Futures | `GC=F` |
| Energy | Crude Oil Futures | `CL=F` |
| Digital Assets | Bitcoin | `BTC-USD` |
| FX | EUR/USD | `EURUSD=X` |

Every scoring run persists its inputs (`avgSeverity`, `avgSentiment`, `avgVolatility`) alongside the output score, so any historical reading can be decomposed and audited after the fact.

---

## System Architecture

```
                  Yahoo Finance API              NewsAPI (business headlines)
                          |                                  |
                          v                                  v
              +-------------------------------------------------------+
              |            INGESTION CYCLE (every 30 minutes)         |
              |  - Cross-asset price and % change capture             |
              |  - VADER sentiment polarity per article               |
              |  - Gemini 2.5 Flash risk classification (JSON schema) |
              |  - Weighted Master Risk Score computation             |
              +-------------------------------------------------------+
                                       |
                                       v
                    SQLite: market_prices | articles | risk_scores | reports
                                       |
                       +---------------+---------------+
                       v                               v
          REPORTER (daily 08:00)              FastAPI  /api/data
          Gemini-authored risk briefing        React 19 + Recharts dashboard
```

**Data model:** four normalized tables (`market_prices`, `articles`, `risk_scores`, `reports`) with a full timestamped history, enabling the 7-day score timeline, the day-by-hour risk heatmap, and per-asset sentiment trends.

**Resilience:** the pipeline degrades gracefully rather than failing. If the news API key is absent or the LLM quota is exhausted (HTTP 429), the system falls back to deterministic keyword-based classification and a templated briefing structure, so the dashboard and the scheduled cycle continue to operate. This was a deliberate design choice: a risk system that goes dark under load is worse than one that reports with a known, disclosed methodology downgrade.

---

## Key Features

- **Master Risk Gauge** with a critical-threshold alert that fires when the composite score crosses 70.
- **7-Day Score Timeline** to distinguish a genuine regime shift from single-headline noise.
- **Day-by-Hour Risk Heatmap** surfacing when critical events cluster across the week.
- **Sentiment Trend by Asset Class**, tracking tone separately for Equities, Commodities, FX, Bonds, and Crypto.
- **News Volume by Risk Category**, showing where the risk concentration sits today.
- **Classified Intelligence Feed** with per-headline risk type, severity (1-10), and timestamp.
- **Daily AI Briefing** rendered as Markdown in the analyst's standard report structure.
- **Manual override endpoints** to force an ingestion cycle or regenerate the briefing on demand.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS 4, Recharts, Lucide |
| Backend | Python 3.11, FastAPI, Uvicorn, asyncio background schedulers |
| Node service layer | TypeScript ingestion and reporting workers, `node-cron` |
| Data | SQLite (`better-sqlite3` on Node, `sqlite3` on Python) |
| Quant / NLP | VADER sentiment analysis, Google Gemini 2.5 Flash (structured JSON output) |
| Market Data | `yahoo-finance2`, NewsAPI |
| Deployment | Multi-stage Docker build, Render-ready, Vercel configuration included |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service health and backend identity |
| `GET` | `/api/data` | Dashboard payload: latest articles, score history, current briefing |
| `POST` | `/api/trigger-ingestion` | Force an out-of-cycle ingestion and rescore |
| `POST` | `/api/trigger-report` | Force regeneration of the daily executive briefing |

---

## Running Locally

**Prerequisites:** Node.js 18+, Python 3.11+, a Google Gemini API key. A NewsAPI key is optional; without it the system runs on its fallback corpus.

**1. Environment**

```bash
git clone https://github.com/thedeepakreddy/Automated-Risk-Intelligence-Analyst.git
cd Automated-Risk-Intelligence-Analyst
```

Create a `.env` file in the project root:

```env
GEMINI_API_KEY=your_gemini_api_key_here
NEWS_API_KEY=your_news_api_key_here
```

**2. Frontend**

```bash
npm install
npm run dev
```

**3. Backend**

```bash
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
npm run dev:python                # or: uvicorn api.index:app --reload --port 8000
```

The API serves on `http://localhost:8000`. On first start the backend seeds the database and begins the 30-minute ingestion loop automatically.

---

## Deployment

The application ships as a single multi-stage Docker image: the React bundle is built and then served as static assets by FastAPI alongside the API, so the whole stack runs as one web service.

1. Create a new Web Service on Render and connect this repository.
2. Select the Docker runtime.
3. Set `GEMINI_API_KEY` and `NEWS_API_KEY` as environment variables.
4. Deploy. Background ingestion and the daily reporter start with the service.

---

## Additional Views

**Visual analytics** - news volume by category, sentiment trend by asset class, and the 7-day risk heatmap:

![Visual Summary and Risk Heatmap](./assets/123.png)

**Risk metrics and timeline** - master risk gauge, high-anomaly count, processed article volume, and the trailing 7-day score:

![Risk Metrics and Score Timeline](./assets/456.png)

**System status** - data ingestion sources, processing engines, AI inference layer, and the critical risk alert banner:

![System Status and Intelligence Overview](./assets/789.png)

**Briefing and intelligence feed** - the daily AI briefing beside the classified, severity-ranked headline feed:

![Risk Intelligence Dashboard - Main View](./assets/000.png)

---

## Design Decisions and Known Limitations

Stated openly, because a risk model that hides its assumptions is not a risk model.

- **SQLite over a hosted database.** Chosen for zero-configuration reproducibility and single-container deployment. A production deployment would move to PostgreSQL or a time-series store for concurrent writes and longer retention.
- **The composite weights (40/30/30) are a documented prior, not a calibrated fit.** They are deliberately exposed in one place so they can be back-tested and re-estimated against realized drawdowns.
- **LLM classification is non-deterministic.** Output is constrained to a strict JSON schema with a fixed risk taxonomy, and a deterministic keyword classifier backs it up under quota failure. Severity scores should be read as an ordinal ranking, not a cardinal measurement.
- **Sentiment uses VADER**, a lexicon tuned for general English rather than financial text. A finance-specific model (for example, FinBERT) would be the natural next upgrade.
- **Coverage is headline-level.** The system reads titles and summaries, not full article bodies or filings.

---

## Roadmap

- Back-test the Master Risk Score against realized volatility and equity drawdowns to calibrate the component weights empirically.
- Replace VADER with a finance-domain sentiment model.
- Add value-at-risk and stress-scenario modules driven by the same ingested price history.
- Extend coverage to fixed income, credit spreads, and central bank communications.
- Migrate persistence to PostgreSQL with a time-series retention policy.

---

## Author

**Deepak Reddy** - built as a demonstration of end-to-end risk analytics engineering: data ingestion, quantitative scoring methodology, NLP-driven classification, and the analyst-facing reporting layer that sits on top of them.

GitHub: [thedeepakreddy](https://github.com/thedeepakreddy)
