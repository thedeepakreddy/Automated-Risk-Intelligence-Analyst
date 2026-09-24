import { useEffect, useState } from 'react';

/** Shapes the backend actually returns from GET /api/data. */
export interface Article {
  id: number;
  title: string;
  url: string;
  summary?: string;
  source?: string;
  timestamp: string;
  publishedAt?: string;
  riskType: string;
  riskSeverity: number;
  sentimentScore: number;
  affectedAssets: string;
  classificationMode?: string;
  classificationModel?: string;
}

export interface ScoreComponent {
  name: string;
  normalized: number;
  weight: number;
  effectiveWeight: number;
  contribution: number;
  available: boolean;
  detail: string;
}

export interface Breakdown {
  score: number;
  components: ScoreComponent[];
  inputs: Record<string, number | null>;
  weights: Record<string, number>;
  formula: string;
  notes: string[];
}

export interface ScoreRow {
  id: number;
  timestamp: string;
  score: number;
  details: Breakdown | null;
}

export interface RiskData {
  articles: Article[];
  scores: ScoreRow[];
  latestReport: { date: string; content: string; mode?: string; masterRiskScore?: number; articleCount?: number } | null;
  scoreBreakdown: Breakdown | null;
  methodology: {
    scale: string;
    formula: string;
    weights: Record<string, number>;
    windowHours: number;
    components: { name: string; weight: number; derivation: string }[];
    renormalization: string;
    determinism: string;
  } | null;
  stats: {
    totalArticles: number;
    articlesLast24h: number;
    highSeverityLast24h: number;
    degradedLast24h: number;
    currentScore: number | null;
  } | null;
  sources: { name: string; url: string }[];
}

const EMPTY: RiskData = {
  articles: [],
  scores: [],
  latestReport: null,
  scoreBreakdown: null,
  methodology: null,
  stats: null,
  sources: [],
};

/**
 * Polls the dashboard payload. The previous render is held across refetches --
 * a skeleton flash every ten seconds would be worse than a stale second.
 */
export function useRiskData(intervalMs = 10000) {
  const [data, setData] = useState<RiskData>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error(`API ${res.status}`);
        const payload = await res.json();
        if (cancelled) return;
        setData({ ...EMPTY, ...payload });
        setUpdatedAt(new Date());
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Feed unreachable');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    fetchData();
    const timer = setInterval(fetchData, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);

  return { data, loaded, error, updatedAt };
}

/** Parse the JSON-encoded affectedAssets column, tolerating a malformed row. */
export function assetsOf(article: Article): string[] {
  if (!article.affectedAssets) return [];
  try {
    const parsed = JSON.parse(article.affectedAssets);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
