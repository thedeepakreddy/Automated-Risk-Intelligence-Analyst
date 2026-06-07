import YahooFinance from 'yahoo-finance2';
import db from '../lib/db.js';
import { GoogleGenAI } from '@google/genai';
import vader from 'vader-sentiment';

const yahooFinance = new YahooFinance();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const ASSETS = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: 'GC=F', name: 'Gold' },
  { symbol: 'CL=F', name: 'Oil' },
  { symbol: 'BTC-USD', name: 'Bitcoin' },
  { symbol: 'EURUSD=X', name: 'EUR/USD' }
];

export async function runIngestionCycle() {
  const timestamp = Date.now();
  console.log(`[INGESTION] Starting cycle at ${new Date(timestamp).toISOString()}`);

  // 1. Fetch Market Prices
  let totalVolatility = 0;
  for (const asset of ASSETS) {
    try {
      const quote = await yahooFinance.quote(asset.symbol);
      const price = quote.regularMarketPrice || 0;
      const changePercent = quote.regularMarketChangePercent || 0;
      totalVolatility += Math.abs(changePercent);

      db.prepare(`INSERT INTO market_prices (symbol, price, changePercent, timestamp) VALUES (?, ?, ?, ?)`).run(
        asset.name, price, changePercent, timestamp
      );
    } catch (e) {
      console.error(`Failed to fetch price for ${asset.symbol}:`, e);
    }
  }

  const avgVolatility = totalVolatility / ASSETS.length;

  // 2. Fetch News Articles from NewsAPI
  let articles: any[] = [];
  const newsApiKey = process.env.NEWS_API_KEY;
  if (newsApiKey) {
    try {
      const response = await fetch(`https://newsapi.org/v2/top-headlines?category=business&language=en&pageSize=100&apiKey=${newsApiKey}`);
      const data = await response.json();
      if (data.articles && data.articles.length > 0) {
        articles = data.articles;
      } else if (data.status === 'error' && data.code === 'apiKeyInvalid') {
        console.warn("[INGESTION] NewsAPI key invalid or missing. Using fallback mock articles.");
      } else {
        console.warn(`[INGESTION] NewsAPI returned no articles or an error: ${data.message || data.status || 'unknown'}`);
      }
    } catch (e) {
      console.error(`Failed to fetch from NewsAPI:`, e);
    }
  } else {
    console.warn("[INGESTION] No NEWS_API_KEY provided. Skipping NewsAPI fetch.");
  }

  // Fallback data if no articles were fetched (e.g. invalid API key)
  if (articles.length === 0) {
    console.log("[INGESTION] Using mock articles as fallback");
    articles = [
      {
        title: "Global markets tumble as trade tensions escalate between major economies",
        description: "Equities took a hit today after new tariffs were announced...",
        url: "https://example.com/1"
      },
      {
        title: "Central bank signals unexpected rate hikes to combat stubborn inflation",
        description: "Bond yields spiked as investors priced in aggressive tightening by the Fed.",
        url: "https://example.com/2"
      },
      {
        title: "Tech sector rallies on strong earnings reports from semiconductor giants",
        description: "A bright spot in the market as AI demand drives record revenues.",
        url: "https://example.com/3"
      },
      {
        title: "Oil prices surge following supply disruptions in the Middle East",
        description: "Energy markets are on edge with Brent crude crossing $90 per barrel.",
        url: "https://example.com/4"
      },
      {
        title: "Cryptocurrency exchanges face new regulatory crackdowns in Europe",
        description: "Bitcoin and Ethereum saw significant volatility following the announcement.",
        url: "https://example.com/5"
      }
    ];
  }

  // 3. Process Articles (Classification + Sentiment)
  let totalSeverity = 0;
  let totalSentiment = 0;
  let processedCount = 0;

  for (const item of articles) {
    const title = item.title || '';
    const summary = item.description || item.content || '';
    if (!title) continue;

    // Sentiment Analysis
    const sentimentResult = vader.SentimentIntensityAnalyzer.polarity_scores(title + " " + summary);
    const sentimentScore = sentimentResult.compound;

    let riskType = 'No Risk';
    let riskSeverity = 0;
    let affectedAssets: string[] = [];

    // Gemini Classification
    if (process.env.GEMINI_API_KEY) {
      try {
        const prompt = `
          Analyze the following financial news article:
          Title: ${title}
          Summary: ${summary}
          Respond strictly in JSON format with these exact keys:
          {
            "riskType": "Market Risk" | "Credit Risk" | "Geopolitical Risk" | "Liquidity Risk" | "Regulatory Risk" | "Operational Risk" | "No Risk",
            "affectedAssets": ["Equities", "Bonds", "Commodities", "Crypto", "FX", "Real Estate"],
            "riskSeverity": number // 1 to 10
          }
        `;
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: { responseMimeType: "application/json" }
        });
        if (response.text) {
          const parsed = JSON.parse(response.text);
          riskType = parsed.riskType || 'No Risk';
          riskSeverity = parsed.riskSeverity || 0;
          affectedAssets = parsed.affectedAssets || [];
        }
      } catch (e) {
        const errMsg = (e as Error).message;
        if (errMsg.includes('429')) {
          console.warn("[INGESTION] Gemini API quota exceeded. Using robust fallback classifications.");
        } else {
          console.warn(`[INGESTION] Classification failed (${errMsg.substring(0, 50)}...). Using robust fallback classifications.`);
        }
        // Fallback for demo purposes
        if (title.toLowerCase().includes('rates') || title.toLowerCase().includes('inflation')) {
          riskType = 'Macroeconomic Risk';
          riskSeverity = 8;
          affectedAssets = ['Bonds', 'Equities'];
        } else if (title.toLowerCase().includes('trade') || title.toLowerCase().includes('war') || title.toLowerCase().includes('supply')) {
          riskType = 'Geopolitical Risk';
          riskSeverity = 9;
          affectedAssets = ['Commodities', 'Equities'];
        } else if (title.toLowerCase().includes('tech') || title.toLowerCase().includes('earnings')) {
           riskType = 'Market Risk';
           riskSeverity = 4;
           affectedAssets = ['Equities'];
        } else {
           riskType = 'Market Risk';
           riskSeverity = Math.floor(Math.random() * 5) + 3;
           affectedAssets = ['Equities', 'Crypto'];
        }
      }
    }

    if (riskType !== 'No Risk') {
      totalSeverity += riskSeverity;
      processedCount++;
    }
    totalSentiment += sentimentScore;

    db.prepare(`INSERT INTO articles (title, url, summary, riskType, affectedAssets, riskSeverity, sentimentScore, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      title,
      item.url || '',
      summary.substring(0, 300),
      riskType,
      JSON.stringify(affectedAssets),
      riskSeverity,
      sentimentScore,
      timestamp
    );
  }

  // 4. Calculate Master Risk Score
  const avgSeverity = processedCount > 0 ? (totalSeverity / processedCount) : 0;
  const normSeverity = (avgSeverity / 10) * 100;
  
  const avgSentiment = articles.length > 0 ? (totalSentiment / articles.length) : 0;
  const normSentimentRisk = ((avgSentiment * -1) + 1) / 2 * 100;
  const normVolatility = Math.min((avgVolatility / 2) * 100, 100);

  const riskScore = (normSeverity * 0.4) + (normSentimentRisk * 0.3) + (normVolatility * 0.3);

  db.prepare(`INSERT INTO risk_scores (score, timestamp, details) VALUES (?, ?, ?)`).run(
    Math.round(riskScore * 10) / 10,
    timestamp,
    JSON.stringify({ avgSeverity, avgSentiment, avgVolatility })
  );

  console.log(`[INGESTION] Completed cycle. Master Risk Score: ${riskScore.toFixed(2)}`);
}
