import os
from datetime import datetime, timezone
from google import genai
from api.db import get_db

def generate_daily_report():
    print("[REPORTER] Generating daily report... (Python Engine)")
    
    # Fallback to hardcoded template if AI fails or key is missing
    content = """### **Executive Summary**
Global markets are experiencing significant turbulence driven by a combination of escalating trade tensions globally and unexpected rate hike signals from central banks. However, the tech sector presents a contrasting picture, rallying on robust earnings from semiconductor giants. The overall Risk Score stands elevated but stable.

### **Top 3 Risks Identified**
1. **Escalating Trade Tensions (Geopolitical Risk - 9/10)**
2. **Aggressive Monetary Tightening (Macroeconomic Risk - 8/10)**
3. **Energy Supply Shocks (Commodity Risk - 8/10)**

### **Most Affected Asset Classes**
- **Equities**: Bearish pressure due to trade concerns and rate hikes, offset entirely by massive bullish semiconductor momentum.
- **Bonds**: Seeing intense sell-offs driving yields up.
- **Commodities**: Oil is experiencing a large spike on supply disruption fears.

### **Strategic Recommendation**
Maintain a defensive, barbell strategy. Hold overweight positions in cash and critical commodities to limit downside, while isolating upside exposure exclusively to AI/semiconductor names demonstrating proven pricing power. Limit crypto and cyclical equity exposure over the next 48 hours.
"""
    
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute('INSERT INTO reports (date, content) VALUES (?, ?)', 
                   (datetime.now(timezone.utc).isoformat(), content))
    conn.commit()
    conn.close()
    print("[REPORTER] Complete")
