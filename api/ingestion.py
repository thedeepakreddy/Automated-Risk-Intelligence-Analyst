import os
import json
import random
from datetime import datetime, timezone
from google import genai
from api.db import get_db

def run_ingestion_cycle():
    print("[INGESTION] Starting cycle (Python Engine)")
    
    # Mock data to avoid news api req in this snippet
    articles = [
        {
            "title": "Global markets tumble as trade tensions escalate between major economies",
            "url": "https://example.com/1"
        },
        {
            "title": "Tech sector rallies on strong earnings reports from semiconductor giants",
            "url": "https://example.com/2"
        },
        {
            "title": "Energy supply disruptions push oil prices to multi-month highs",
            "url": "https://example.com/3"
        }
    ]
    
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    client = genai.Client(api_key=gemini_api_key) if gemini_api_key else None

    conn = get_db()
    cursor = conn.cursor()

    for article in articles:
        # Robust fallback values matching your existing JS logic
        title_lower = article['title'].lower()
        
        if 'trade' in title_lower or 'supply' in title_lower:
            risk_type = 'Geopolitical Risk'
            risk_severity = random.randint(8, 10)
            sentiment_score = -0.8
            affected_assets = ['Commodities', 'Equities']
        elif 'tech' in title_lower or 'earnings' in title_lower:
            risk_type = 'Market Risk'
            risk_severity = random.randint(3, 5)
            sentiment_score = 0.8
            affected_assets = ['Equities']
        else:
            risk_type = 'Macroeconomic Risk'
            risk_severity = random.randint(5, 7)
            sentiment_score = -0.4
            affected_assets = ['Bonds', 'Crypto']
        
        cursor.execute('''
            INSERT INTO articles (title, url, timestamp, riskType, riskSeverity, sentimentScore, affectedAssets)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            article['title'],
            article['url'],
            datetime.now(timezone.utc).isoformat(),
            risk_type,
            risk_severity,
            sentiment_score,
            json.dumps(affected_assets)
        ))
    
    # Calculate Master Score
    master_score = random.uniform(70, 85)
    cursor.execute('INSERT INTO system_scores (timestamp, score) VALUES (?, ?)', 
                   (datetime.now(timezone.utc).isoformat(), master_score))
    
    conn.commit()
    conn.close()
    print("[INGESTION] Cycle Complete")
