import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, AreaChart, Area, Legend, Cell, LabelList, ReferenceLine } from 'recharts';
import { format } from 'date-fns';
import { AlertTriangle, TrendingDown, BookOpen, Activity, Database, Sparkles, ShieldCheck, ShieldAlert, Rss, Scale } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

/* ---------------------------------------------------------------------------
 * Design tokens
 *
 * Categorical slots are the validated dark-mode palette, assigned to entities
 * (asset class, score component) in fixed order and never by rank, so a series
 * keeps its colour when the data around it changes. Status colours are reserved
 * for risk bands and always ship beside a text label, never alone.
 * ------------------------------------------------------------------------ */
const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };
const INK = { secondary: '#c3c2b7', muted: '#898781' };
const GRID = '#2c2c2a';

const ASSET_COLORS: Record<string, string> = {
  'Equities': SERIES[0],
  'Bonds': SERIES[1],
  'Commodities': SERIES[2],
  'Crypto': SERIES[3],
  'FX': SERIES[4],
  'Real Estate': SERIES[5],
};

const COMPONENT_COLORS: Record<string, string> = {
  'NormalizedSeverity': SERIES[0],
  'NormalizedSentimentRisk': SERIES[1],
  'NormalizedNewsVolatility': SERIES[2],
};

const COMPONENT_LABELS: Record<string, string> = {
  'NormalizedSeverity': 'News Severity',
  'NormalizedSentimentRisk': 'Sentiment Risk',
  'NormalizedNewsVolatility': 'News-Flow Volatility',
};

const TOOLTIP_STYLE = {
  backgroundColor: '#09090b',
  border: `1px solid ${GRID}`,
  color: '#f4f4f5',
  borderRadius: '8px',
  fontSize: '12px',
  boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.5)',
};

function riskBand(score: number) {
  if (score >= 70) return { label: 'Elevated', color: STATUS.critical };
  if (score >= 40) return { label: 'Moderate', color: STATUS.warning };
  return { label: 'Contained', color: STATUS.good };
}

/* --------------------------------------------------------------------------- */

function Card({ title, subtitle, children, className = '' }: any) {
  return (
    <div className={`bg-[#09090b] border border-zinc-800 rounded-xl p-6 ${className}`}>
      {title && (
        <div className="mb-6">
          <h3 className="text-zinc-500 text-xs font-semibold uppercase tracking-widest">{title}</h3>
          {subtitle && <p className="text-zinc-600 text-xs mt-1.5">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, caption, accent }: any) {
  return (
    <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col justify-center">
      <div className="text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="text-4xl text-zinc-100" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="text-xs text-zinc-500 mt-2">{caption}</div>
    </div>
  );
}

/**
 * The score, decomposed. The backend publishes each component's normalized
 * value, its weight and its contribution; this panel is that payload rendered,
 * so the number on the gauge is explainable rather than asserted.
 */
function ScoreComposition({ breakdown, methodology }: any) {
  if (!breakdown?.components?.length) {
    return (
      <Card title="Score Composition">
        <p className="text-sm text-zinc-600">Awaiting the first scoring run.</p>
      </Card>
    );
  }

  const available = breakdown.components.filter((c: any) => c.available);

  return (
    <Card
      title="Score Composition"
      subtitle={methodology?.formula || breakdown.formula}
    >
      {/* Contributions sum to the score; the empty track is the headroom to 100. */}
      <div className="flex h-3 w-full gap-[2px] rounded-full bg-zinc-900 overflow-hidden mb-2">
        {available.map((c: any) => (
          <div
            key={c.name}
            style={{ width: `${c.contribution}%`, backgroundColor: COMPONENT_COLORS[c.name] }}
            title={`${COMPONENT_LABELS[c.name]}: ${c.contribution} points`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600 font-mono tabular-nums mb-6">
        <span>0</span><span>50</span><span>100</span>
      </div>

      <div className="space-y-px bg-zinc-900 rounded-lg overflow-hidden">
        <div className="grid grid-cols-12 gap-4 px-4 py-2.5 bg-[#09090b] text-[10px] uppercase tracking-widest text-zinc-600 font-semibold">
          <div className="col-span-5">Component</div>
          <div className="col-span-2 text-right">Normalized</div>
          <div className="col-span-2 text-right">Weight</div>
          <div className="col-span-3 text-right">Contribution</div>
        </div>
        {breakdown.components.map((c: any) => (
          <div key={c.name} className={`grid grid-cols-12 gap-4 px-4 py-3 bg-[#09090b] items-center ${c.available ? '' : 'opacity-50'}`}>
            <div className="col-span-5 flex items-center gap-2.5 min-w-0">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: COMPONENT_COLORS[c.name] }} />
              <div className="min-w-0">
                <div className="text-sm text-zinc-300">{COMPONENT_LABELS[c.name] || c.name}</div>
                <div className="text-[11px] text-zinc-600 truncate" title={c.detail}>{c.detail}</div>
              </div>
            </div>
            <div className="col-span-2 text-right font-mono tabular-nums text-sm text-zinc-300">
              {c.available ? c.normalized.toFixed(1) : '—'}
            </div>
            <div className="col-span-2 text-right font-mono tabular-nums text-sm text-zinc-500">
              {(c.weight * 100).toFixed(0)}%
              {c.available && Math.abs(c.effectiveWeight - c.weight) > 0.001 && (
                <span className="text-amber-500/80"> → {(c.effectiveWeight * 100).toFixed(0)}%</span>
              )}
            </div>
            <div className="col-span-3 text-right font-mono tabular-nums text-sm text-zinc-100">
              {c.available ? `+${c.contribution.toFixed(1)}` : 'excluded'}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-[#09090b] border-t border-zinc-800">
          <div className="col-span-9 text-sm text-zinc-400 font-medium">Master Risk Score</div>
          <div className="col-span-3 text-right font-mono tabular-nums text-sm text-zinc-100 font-semibold">
            {breakdown.score?.toFixed(1)}
          </div>
        </div>
      </div>

      {breakdown.notes?.length > 0 && (
        <div className="mt-4 flex items-start gap-2.5 text-xs text-amber-500/90 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
          <Scale className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div>{breakdown.notes.join(' · ')}</div>
        </div>
      )}
    </Card>
  );
}

export default function DashboardPage() {
  const [scores, setScores] = useState<any[]>([]);
  const [articles, setArticles] = useState<any[]>([]);
  const [latestReport, setLatestReport] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [breakdown, setBreakdown] = useState<any>(null);
  const [methodology, setMethodology] = useState<any>(null);
  const [sources, setSources] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('/api/data');
        if (!res.ok) throw new Error(`API returned ${res.status}`);
        const data = await res.json();
        if (data.scores) setScores([...data.scores].reverse());
        if (data.articles) setArticles(data.articles);
        setLatestReport(data.latestReport ?? null);
        setStats(data.stats ?? null);
        setBreakdown(data.scoreBreakdown ?? null);
        setMethodology(data.methodology ?? null);
        setSources(data.sources ?? []);
        setUpdatedAt(new Date());
        setError(null);
      } catch (e: any) {
        setError(e.message || 'Failed to reach the API');
      } finally {
        setLoaded(true);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000); // 10s auto-refresh
    return () => clearInterval(interval);
  }, []);

  const currentScore = stats?.currentScore ?? (scores.length > 0 ? scores[scores.length - 1].score : 0);
  const band = riskBand(currentScore);
  const isHighRisk = currentScore >= 70;

  const scoreChartData = scores.map(s => ({
    time: format(new Date(s.timestamp), 'MMM dd HH:mm'),
    Risk: s.score,
  }));

  // News volume by risk type. One measure over nominal categories, so the
  // leading category is emphasised and the rest recede -- no value-ramp.
  const riskVolume = articles.reduce((acc: any, curr) => {
    if (!curr.riskType || curr.riskType === 'No Risk') return acc;
    acc[curr.riskType] = (acc[curr.riskType] || 0) + 1;
    return acc;
  }, {});
  const volumeChartData = Object.keys(riskVolume)
    .map(k => ({ name: k.replace(' Risk', ''), count: riskVolume[k] }))
    .sort((a, b) => b.count - a.count);

  // Heatmap: severity is continuous magnitude, so it gets one ordered ramp.
  const heatmapDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    return format(d, 'EEE');
  }).reverse();
  const heatmapHours = Array.from({ length: 24 }).map((_, i) => i);
  const heatmapData: Record<string, number> = {};
  heatmapDays.forEach(d => heatmapHours.forEach(h => { heatmapData[`${d}-${h}`] = 0; }));
  articles.forEach(article => {
    const date = new Date(article.timestamp);
    const key = `${format(date, 'EEE')}-${date.getHours()}`;
    if (heatmapData[key] !== undefined) {
      heatmapData[key] = Math.max(heatmapData[key], article.riskSeverity || 0);
    }
  });

  const sentimentByTime: Record<string, any> = {};
  const allAssetsInSentiment = new Set<string>();
  [...articles].reverse().forEach(article => {
    const timeKey = format(new Date(article.timestamp), 'HH:00');
    let assets: string[] = [];
    try { assets = JSON.parse(article.affectedAssets || '[]'); } catch (e) { /* malformed row */ }
    if (!sentimentByTime[timeKey]) sentimentByTime[timeKey] = { time: timeKey, count: {} };
    assets.forEach(asset => {
      allAssetsInSentiment.add(asset);
      if (typeof sentimentByTime[timeKey][asset] === 'undefined') {
        sentimentByTime[timeKey][asset] = 0;
        sentimentByTime[timeKey].count[asset] = 0;
      }
      sentimentByTime[timeKey][asset] += article.sentimentScore;
      sentimentByTime[timeKey].count[asset] += 1;
    });
  });
  const sentimentChartData = Object.keys(sentimentByTime).map(time => {
    const p: any = { time };
    const bucket = sentimentByTime[time];
    Object.keys(bucket).forEach(k => {
      if (k !== 'time' && k !== 'count') p[k] = Number((bucket[k] / bucket.count[k]).toFixed(2));
    });
    return p;
  });
  // Fixed order so an asset keeps its colour as the set changes between cycles.
  const sentimentAssets = Object.keys(ASSET_COLORS).filter(a => allAssetsInSentiment.has(a));

  const degradedCount = stats?.degradedLast24h ?? 0;
  const reportDegraded = latestReport && latestReport.mode && latestReport.mode !== 'gemini';

  const gaugePercent = Math.min(Math.max(currentScore, 0), 100) / 100;
  const gaugeDashArray = 251.3;
  const gaugeDashOffset = gaugeDashArray - (gaugePercent * gaugeDashArray);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-96 text-sm text-zinc-600">
        <span className="w-2 h-2 rounded-full bg-zinc-600 animate-pulse mr-3" /> Connecting to the risk engine...
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* Title Board */}
      <div className="bg-[#09090b] border border-zinc-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-zinc-500 to-transparent opacity-20"></div>
        <h2 className="text-3xl font-medium text-zinc-100 tracking-tight mb-3">Global Macro Risk Intelligence</h2>
        <p className="text-zinc-400 max-w-2xl text-sm leading-relaxed">
          Live financial news across <strong className="text-zinc-300 font-medium">Equities, Bonds, Commodities, Crypto, FX and Real Estate</strong>.
          Python engines handle ingestion, deduplication and scoring; Gemini classifies each headline by risk type and severity.
        </p>
        {updatedAt && (
          <div className="mt-5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-zinc-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Updated {format(updatedAt, 'HH:mm:ss')}
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-4">
          <AlertTriangle className="text-red-400 w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-400 font-medium text-sm">Data feed unreachable</h3>
            <p className="text-red-400/80 text-sm mt-1">{error} — showing the last successful read.</p>
          </div>
        </div>
      )}

      {isHighRisk && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-start gap-4">
          <AlertTriangle className="text-red-400 w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-red-400 font-medium text-sm">Critical Risk Alert</h3>
            <p className="text-red-400/80 text-sm mt-1">The master risk score has crossed 70. Review the AI briefing immediately.</p>
          </div>
        </div>
      )}

      {(degradedCount > 0 || reportDegraded) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex items-start gap-4">
          <ShieldAlert className="text-amber-400 w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <h3 className="text-amber-400 font-medium text-sm">Degraded inference mode</h3>
            <p className="text-amber-400/80 text-sm mt-1">
              {degradedCount > 0 && `${degradedCount} article${degradedCount === 1 ? '' : 's'} in the last 24h were classified by the deterministic keyword fallback rather than the model. `}
              {reportDegraded && 'The current briefing was assembled from a template. '}
              Readings remain valid but the methodology is downgraded.
            </p>
          </div>
        </div>
      )}

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col items-center justify-center">
          <div className="w-full text-left text-zinc-500 text-xs font-semibold uppercase tracking-widest mb-2 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" /> Master Risk
          </div>
          <div className="relative w-48 h-28 -mb-4 flex items-end justify-center">
            <svg viewBox="0 0 200 110" className="w-full h-full">
              <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="#27272a" strokeWidth="14" strokeLinecap="round" />
              <path
                d="M 20 100 A 80 80 0 0 1 180 100"
                fill="none"
                stroke={band.color}
                strokeWidth="14"
                strokeLinecap="round"
                strokeDasharray={gaugeDashArray}
                strokeDashoffset={gaugeDashOffset}
                style={{ transition: 'stroke-dashoffset 1s ease-out, stroke 0.5s ease-out' }}
              />
            </svg>
            <div className="absolute bottom-2 flex flex-col items-center">
              <span className="text-4xl tracking-tight" style={{ color: band.color }}>
                {currentScore.toFixed(1)}
              </span>
              <span className="text-[10px] font-semibold tracking-widest uppercase mt-1" style={{ color: band.color }}>
                {band.label}
              </span>
            </div>
          </div>
        </div>

        <StatTile
          icon={TrendingDown}
          label="High Anomalies"
          value={stats?.highSeverityLast24h ?? 0}
          caption="Severity 8+ in the trailing 24h"
        />
        <StatTile
          icon={BookOpen}
          label="Articles / 24h"
          value={stats?.articlesLast24h ?? articles.length}
          caption={`${stats?.totalArticles ?? articles.length} classified all-time`}
        />
        <StatTile
          icon={degradedCount > 0 ? ShieldAlert : ShieldCheck}
          label="Classification"
          value={degradedCount > 0 ? `${degradedCount} degraded` : 'Verified'}
          caption={degradedCount > 0 ? 'Keyword fallback in use' : 'All 24h articles model-classified'}
          accent={degradedCount > 0 ? STATUS.warning : STATUS.good}
        />
      </div>

      {/* Score composition — the methodology, rendered */}
      <ScoreComposition breakdown={breakdown} methodology={methodology} />

      {/* Score Timeline */}
      <Card title="Score Timeline (Last 7 Days)">
        <div className="h-[250px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={scoreChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SERIES[0]} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={SERIES[0]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="time" stroke={GRID} tick={{ fill: INK.muted, fontSize: 11 }} dy={10} axisLine={false} tickLine={false} minTickGap={40} />
              <YAxis domain={[0, 100]} stroke={GRID} tick={{ fill: INK.muted, fontSize: 11 }} dx={-10} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ color: INK.secondary }} />
              <Area type="monotone" dataKey="Risk" stroke={SERIES[0]} strokeWidth={2} fillOpacity={1} fill="url(#colorRisk)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Visual Summary Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500"></div>
          <h2 className="text-sm font-medium text-zinc-100 uppercase tracking-widest">Visual Summary</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="News Volume by Category" subtitle="Where risk is concentrated right now">
            <div className="h-[280px] w-full">
              {volumeChartData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-zinc-600">No risk-bearing headlines yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeChartData} layout="vertical" margin={{ top: 0, right: 40, left: 20, bottom: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" stroke={GRID} tick={{ fill: INK.muted, fontSize: 11 }} width={100} axisLine={false} tickLine={false} />
                    <Tooltip cursor={{ fill: '#18181b', radius: 4 }} contentStyle={TOOLTIP_STYLE} itemStyle={{ color: INK.secondary }} />
                    <Bar dataKey="count" radius={[4, 4, 4, 4]} barSize={10}>
                      {volumeChartData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? SERIES[0] : '#3f3f46'} />
                      ))}
                      {/* Direct labels: the count is readable without hovering. */}
                      <LabelList dataKey="count" position="right" offset={10} fill={INK.secondary} fontSize={11} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card title="Sentiment Trend by Asset" subtitle="Negative tone below the zero line">
            <div className="h-[280px] w-full">
              {sentimentAssets.length === 0 ? (
                <div className="h-full flex items-center justify-center text-sm text-zinc-600">No asset attributions yet.</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sentimentChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="time" stroke={GRID} tick={{ fill: INK.muted, fontSize: 11 }} dy={10} axisLine={false} tickLine={false} />
                    <YAxis domain={[-1, 1]} ticks={[-1, -0.5, 0, 0.5, 1]} stroke={GRID} tick={{ fill: INK.muted, fontSize: 11 }} dx={-10} axisLine={false} tickLine={false} />
                    <ReferenceLine y={0} stroke={INK.muted} strokeWidth={1} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} itemStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px', color: INK.muted }} iconType="circle" iconSize={6} />
                    {sentimentAssets.map(asset => (
                      <Line
                        key={asset}
                        type="monotone"
                        dataKey={asset}
                        stroke={ASSET_COLORS[asset]}
                        strokeWidth={2}
                        dot={{ r: 2.5, strokeWidth: 0, fill: ASSET_COLORS[asset] }}
                        activeDot={{ r: 5, strokeWidth: 2, stroke: '#09090b' }}
                        // An asset is only mentioned in some hours; joining across the
                        // gaps keeps a series readable instead of scattering stubs.
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </Card>

          <Card title="7-Day Risk Heatmap" subtitle="Peak severity per hour" className="lg:col-span-2">
            <div className="w-full flex items-start gap-4 overflow-x-auto custom-scrollbar pb-2">
              <div className="flex flex-col gap-1.5 mt-6 pr-4 border-r border-zinc-800/50 shrink-0">
                {heatmapDays.map(day => (
                  <div key={`label-${day}`} className="h-6 text-[10px] text-zinc-500 font-medium flex items-center justify-end uppercase tracking-widest">
                    {day}
                  </div>
                ))}
              </div>
              <div className="flex-1 min-w-[700px] flex gap-1.5">
                {heatmapHours.map(hour => (
                  <div key={`col-${hour}`} className="flex-1 flex flex-col gap-1.5">
                    <div className="text-[10px] text-zinc-600 text-center mb-1.5 font-mono tabular-nums">{hour.toString().padStart(2, '0')}</div>
                    {heatmapDays.map(day => {
                      const severity = heatmapData[`${day}-${hour}`];
                      return (
                        <div
                          key={`cell-${day}-${hour}`}
                          className={`h-6 rounded-sm w-full transition-colors duration-300 ${
                            severity === 0 ? 'bg-zinc-800/30' :
                            severity < 4 ? 'bg-zinc-700 hover:bg-zinc-600' :
                            severity < 7 ? 'bg-zinc-400 hover:bg-zinc-300' :
                            'bg-zinc-100 hover:bg-white'
                          }`}
                          title={`${day} ${hour.toString().padStart(2, '0')}:00 — peak severity ${severity}/10`}
                        ></div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-zinc-800/50">
              <span className="text-[10px] text-zinc-500 font-medium tracking-widest uppercase">Severity</span>
              {[['0', 'bg-zinc-800/30'], ['1–3', 'bg-zinc-700'], ['4–6', 'bg-zinc-400'], ['7–10', 'bg-zinc-100']].map(([label, cls]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div className={`w-4 h-4 rounded-sm ${cls}`}></div>
                  <span className="text-[10px] text-zinc-500 font-mono tabular-nums">{label}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Latest AI Report */}
        <div className="lg:col-span-1 bg-[#09090b] border border-zinc-800 rounded-xl p-6 flex flex-col max-h-[720px]">
          <div className="flex items-center justify-between mb-6 gap-3">
            <h3 className="text-zinc-100 font-medium tracking-tight flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: reportDegraded ? STATUS.warning : STATUS.good }} />
              Daily AI Briefing
            </h3>
            {latestReport?.mode && (
              <span
                className="px-2 py-1 text-[10px] uppercase tracking-wider rounded-md font-medium border shrink-0"
                style={reportDegraded
                  ? { color: STATUS.warning, borderColor: `${STATUS.warning}33`, backgroundColor: `${STATUS.warning}0d` }
                  : { color: STATUS.good, borderColor: `${STATUS.good}33`, backgroundColor: `${STATUS.good}0d` }}
              >
                {reportDegraded ? 'Templated' : 'Gemini'}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar text-sm text-zinc-400 font-sans leading-relaxed">
            {latestReport ? (
              <div className="markdown-body">
                <ReactMarkdown>{latestReport.content}</ReactMarkdown>
              </div>
            ) : 'Awaiting the first reporting cycle...'}
          </div>
          {latestReport && (
            <div className="mt-6 pt-4 border-t border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-600">
              Generated {new Date(latestReport.date).toLocaleString()}
              {latestReport.articleCount != null && ` · ${latestReport.articleCount} articles`}
            </div>
          )}
        </div>

        {/* News Feed */}
        <div className="lg:col-span-2 bg-[#09090b] border border-zinc-800 rounded-xl overflow-hidden flex flex-col max-h-[720px]">
          <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="text-zinc-100 font-medium tracking-tight">Classified Intelligence Feed</h3>
            <span className="text-[10px] uppercase tracking-widest text-zinc-600">{articles.length} most recent</span>
          </div>
          <div className="overflow-y-auto custom-scrollbar">
            <table className="w-full text-left text-sm text-zinc-400">
              <thead className="bg-[#09090b] border-b border-zinc-800 text-zinc-500 text-xs uppercase tracking-wider sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-4 font-semibold">Time</th>
                  <th className="px-6 py-4 font-semibold w-1/2">Headline</th>
                  <th className="px-6 py-4 font-semibold">Category</th>
                  <th className="px-6 py-4 font-semibold text-right">Sev.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/50">
                {articles.slice(0, 20).map(article => (
                  <tr key={article.id} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap font-mono tabular-nums text-xs text-zinc-500 align-top">
                      {format(new Date(article.timestamp), 'MMM dd HH:mm')}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <a href={article.url} target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-white transition-colors line-clamp-2" title={article.summary || article.title}>
                        {article.title}
                      </a>
                      <div className="flex items-center gap-2 mt-1.5">
                        {article.source && (
                          <span className="text-[10px] text-zinc-600 uppercase tracking-wider">{article.source}</span>
                        )}
                        {article.classificationMode && article.classificationMode !== 'gemini' && (
                          <span className="text-[10px] uppercase tracking-wider" style={{ color: STATUS.warning }}>· keyword fallback</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 align-top">
                      <span className={`px-2.5 py-1 text-[10px] uppercase tracking-wider rounded-md font-medium border whitespace-nowrap ${
                        article.riskType === 'No Risk'
                          ? 'bg-zinc-800/30 text-zinc-500 border-zinc-700/50'
                          : 'bg-red-500/5 text-red-400 border-red-500/20'}`}>
                        {(article.riskType || '').replace(' Risk', '')}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right align-top">
                      {article.riskSeverity > 0 ? (
                        <div className="flex items-center justify-end gap-3">
                          <span className="font-mono tabular-nums text-xs">{article.riskSeverity}</span>
                          <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${article.riskSeverity * 10}%`,
                                backgroundColor: article.riskSeverity >= 8 ? STATUS.critical : article.riskSeverity >= 4 ? STATUS.warning : SERIES[0],
                              }}
                            />
                          </div>
                        </div>
                      ) : <span className="text-zinc-700">—</span>}
                    </td>
                  </tr>
                ))}
                {articles.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-zinc-600 border-none">Awaiting the first ingestion cycle...</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Pipeline provenance */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-zinc-900 rounded-xl overflow-hidden border border-zinc-800">
        <div className="bg-[#09090b] p-6">
          <div className="text-zinc-500 uppercase tracking-widest text-[10px] font-semibold mb-4 flex items-center gap-2">
            <Rss className="w-3.5 h-3.5" /> News Sources
          </div>
          <ul className="space-y-1.5 text-xs text-zinc-500">
            {sources.length > 0 ? sources.map(s => (
              <li key={s.name} className="flex items-center gap-2">
                <span className="w-1 h-1 bg-zinc-600 rounded-full shrink-0"></span> {s.name}
              </li>
            )) : <li>Loading source list...</li>}
          </ul>
        </div>
        <div className="bg-[#09090b] p-6">
          <div className="text-zinc-500 uppercase tracking-widest text-[10px] font-semibold mb-4 flex items-center gap-2">
            <Database className="w-3.5 h-3.5" /> Processing
          </div>
          <ul className="space-y-2.5 text-sm text-zinc-400">
            <li className="flex items-center gap-2"><span className="w-1 h-1 bg-indigo-400 rounded-full"></span> Title + URL deduplication</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 bg-indigo-400 rounded-full"></span> Strict JSON schema validation</li>
            <li className="flex items-center gap-2"><span className="w-1 h-1 bg-indigo-400 rounded-full"></span> News-flow realized volatility</li>
          </ul>
        </div>
        <div className="bg-[#09090b] p-6">
          <div className="text-zinc-500 uppercase tracking-widest text-[10px] font-semibold mb-4 flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5" /> AI Inference
          </div>
          <ul className="space-y-2.5 text-sm text-zinc-400">
            <li className="flex items-start gap-2">
              <span className="w-1 h-1 bg-amber-400 rounded-full mt-1.5 shrink-0"></span>
              <div>
                <span className="text-zinc-300 font-medium">Gemini 2.5 Flash</span>
                <div className="text-xs text-zinc-500 mt-0.5">Risk classification, strict JSON schema</div>
              </div>
            </li>
            <li className="flex items-start gap-2 mt-2">
              <span className="w-1 h-1 bg-amber-400 rounded-full mt-1.5 shrink-0"></span>
              <div>
                <span className="text-zinc-300 font-medium">Daily briefings</span>
                <div className="text-xs text-zinc-500 mt-0.5">Written from the day's classified corpus</div>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
