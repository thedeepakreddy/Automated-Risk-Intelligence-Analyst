import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(process.cwd(), 'risk.db'));

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS market_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    price REAL,
    changePercent REAL,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS articles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    url TEXT,
    summary TEXT,
    riskType TEXT,
    affectedAssets TEXT,
    riskSeverity INTEGER,
    sentimentScore REAL,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS risk_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    score REAL,
    timestamp INTEGER,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date INTEGER,
    content TEXT
  );
`);

export default db;
