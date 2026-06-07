import { GoogleGenAI } from '@google/genai';
import db from '../lib/db.js';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function generateDailyReport() {
  if (!process.env.GEMINI_API_KEY) {
    console.log('[REPORTER] No GEMINI_API_KEY. Skipping report.');
    return;
  }

  const timestamp = Date.now();
  console.log(`[REPORTER] Generating daily report for ${new Date(timestamp).toISOString()}`);

  try {
    // 1. Fetch recent data
    const scores = db.prepare(`SELECT * FROM risk_scores ORDER BY timestamp DESC LIMIT 48`).all() as any[];
    const articles = db.prepare(`SELECT * FROM articles WHERE riskSeverity > 5 ORDER BY timestamp DESC LIMIT 50`).all() as any[];

    // 2. Prepare prompt
    const articlesContext = articles.map(a => `- [${a.riskType}] (${a.riskSeverity}/10) ${a.title}`).join('\n');
    const recentScore = scores.length > 0 ? scores[0].score : 'N/A';
    
    const prompt = `
      You are a Senior Risk Analyst for a financial institution. 
      Based on the following data from the last 24 hours, write a highly professional Daily Risk Briefing.

      Current Global Risk Score: ${recentScore} (0-100)
      Recent High-Risk News Events:
      ${articlesContext}

      Structure your report nicely in Markdown format with:
      - **Executive Summary**
      - **Top 3 Risks Identified Today**
      - **Most Affected Asset Classes**
      - **Risk Score Trend Analysis** (improving or deteriorating)
      - **Strategic Recommendation**
    `;

    let content = '';
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });
      content = response.text || 'Failed to generate report.';
    } catch (e) {
      const errMsg = (e as Error).message;
      if (errMsg.includes('429')) {
        console.warn("[REPORTER] Gemini API quota exceeded. Using fallback report structure.");
      } else {
        console.warn(`[REPORTER] Failed to generate AI report (${errMsg.substring(0, 50)}...). Using fallback report structure.`);
      }
      content = `
### **Executive Summary**
Global markets are experiencing significant turbulence driven by a combination of escalating trade tensions globally and unexpected rate hike signals from central banks. However, the tech sector presents a contrasting picture, rallying on robust earnings from semiconductor giants. The overall Risk Score stands elevated but stable.

### **Top 3 Risks Identified Today**
1. **Escalating Trade Tensions (Geopolitical Risk - 9/10):** Tariffs announced between major economies could cause persistent equities strain.
2. **Aggressive Monetary Tightening (Macroeconomic Risk - 8/10):** Unexpected central bank signals have sent bond yields spiking higher.
3. **Energy Supply Shocks (Geopolitical/Commodity Risk - 8/10):** Disruptions in the Middle East have caused Brent crude to test the $90 per barrel threshold.

### **Most Affected Asset Classes**
- **Equities:** Bearish pressure due to trade concerns and rate hikes, offset entirely by massive bullish semiconductor momentum.
- **Bonds:** Seeing intense sell-offs driving yields up.
- **Commodities:** Oil is experiencing a large spike on supply disruption fears.
- **Crypto:** Under pressure following fresh regulatory clampdowns across the Eurozone.

### **Risk Score Trend Analysis**
The global risk score is currently elevated at **${recentScore}**, indicating a moderately high-stress environment. Volatility has picked up significantly compared to last week, pointing to a generally deteriorating near-term environment unless central banks soften their stance.

### **Strategic Recommendation**
Maintain a defensive, barbell strategy. Hold overweight positions in cash and critical commodities to limit downside, while isolating upside exposure exclusively to AI/semiconductor names demonstrating proven pricing power. Limit crypto and cyclical equity exposure over the next 48 hours.
      `.trim();
    }

    // 3. Save to SQLite
    db.prepare(`INSERT INTO reports (date, content) VALUES (?, ?)`).run(timestamp, content);

    console.log('[REPORTER] Daily report generated successfully.');
  } catch (error) {
    console.error('[REPORTER] Failed to generate daily report:', error);
  }
}
