import sqlite3
import os

# Use /tmp for Vercel Serverless environment where root filesystem is read-only
# Locallly, it will also just use the /tmp directory
DB_PATH = os.environ.get("DB_PATH", "/tmp/risk.db")

def get_db():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            url TEXT,
            timestamp DATETIME,
            riskType TEXT,
            riskSeverity INTEGER,
            sentimentScore REAL,
            affectedAssets TEXT
        );
        CREATE TABLE IF NOT EXISTS system_scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME,
            score REAL
        );
        CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date DATETIME,
            content TEXT
        );
    ''')
    conn.commit()
    conn.close()

def get_dashboard_data():
    conn = get_db()
    articles = [dict(r) for r in conn.execute("SELECT * FROM articles ORDER BY timestamp DESC LIMIT 50").fetchall()]
    scores = [dict(r) for r in conn.execute("SELECT * FROM system_scores ORDER BY timestamp ASC LIMIT 50").fetchall()]
    report_row = conn.execute("SELECT * FROM reports ORDER BY date DESC LIMIT 1").fetchone()
    conn.close()
    
    return {
        "articles": articles,
        "scores": scores,
        "latestReport": dict(report_row) if report_row else None
    }
