import { useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format } from 'date-fns';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

import {
  ASSET_COLORS,
  COMPONENT_COLORS,
  COMPONENT_LABELS,
  Chip,
  Empty,
  INK,
  Panel,
  Readout,
  RULE,
  SERIES,
  STATUS,
  SeverityBar,
  riskBand,
  severityColor,
  shortRisk,
} from '../components/Terminal';
import { assetsOf, type Article, type RiskData } from '../lib/useRiskData';

export type View = 'overview' | 'feed' | 'methodology';

interface Props {
  data: RiskData;
  loaded: boolean;
  error: string | null;
  view: View;
  onNavigate: (view: View) => void;
}

export default function DashboardPage({ data, loaded, error, view, onNavigate }: Props) {
  if (!loaded) {
    return (
      <div className="h-full flex items-center justify-center gap-3 label">
        <span className="w-1.5 h-1.5 bg-[#3987e5] animate-pulse" /> Connecting to risk engine
      </div>
    );
  }

  return (
    <div className="p-px bg-[#1c1f24] min-h-full">
      {error && (
        <Banner
          color={STATUS.critical}
          icon={AlertTriangle}
          title="Data feed unreachable"
          body={`${error} — displaying the last successful read.`}
        />
      )}
      {view === 'overview' && <Overview data={data} onNavigate={onNavigate} />}
      {view === 'feed' && <Feed data={data} />}
      {view === 'methodology' && <Methodology data={data} />}
    </div>
  );
}

function Banner({
  color,
  icon: Icon,
  title,
  body,
}: {
  color: string;
  icon: typeof AlertTriangle;
  title: string;
  body: string;
}) {
  return (
    <div
      className="flex items-start gap-3 px-4 py-3 mb-px border"
      style={{ borderColor: `${color}40`, backgroundColor: `${color}0d` }}
    >
      <Icon className="w-4 h-4 shrink-0 mt-px" style={{ color }} />
      <div className="min-w-0">
        <div className="text-[11px] font-mono uppercase tracking-[0.1em]" style={{ color }}>
          {title}
        </div>
        <p className="text-[12px] mt-1" style={{ color: `${color}cc` }}>
          {body}
        </p>
      </div>
    </div>
  );
}

/* ==========================================================================
 * Overview
 * ======================================================================= */

function Overview({ data, onNavigate }: { data: RiskData; onNavigate: (v: View) => void }) {
  const { articles, scores, stats, scoreBreakdown, latestReport } = data;
  const score = stats?.currentScore ?? 0;
  const band = riskBand(score);
  const degraded = stats?.degradedLast24h ?? 0;
  const reportDegraded = Boolean(latestReport?.mode && latestReport.mode !== 'gemini');

  const timeline = useMemo(
    () =>
      [...scores].reverse().map((s) => ({
        time: format(new Date(s.timestamp), 'MMM dd HH:mm'),
        Risk: s.score,
      })),
    [scores],
  );

  const volume = useMemo(() => {
    const counts: Record<string, number> = {};
    articles.forEach((a) => {
      if (!a.riskType || a.riskType === 'No Risk') return;
      counts[a.riskType] = (counts[a.riskType] || 0) + 1;
    });
    return Object.keys(counts)
      .map((k) => ({ name: k.replace(' Risk', ''), count: counts[k] }))
      .sort((a, b) => b.count - a.count);
  }, [articles]);

  const { sentimentData, sentimentAssets } = useSentiment(articles);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-px">
      {/* Score block */}
      <Panel title="Master Risk Score" meta={band.label} className="xl:col-span-3" bodyClass="p-5">
        <div className="flex flex-col h-full justify-between gap-5">
          <Readout
            label="Composite / 100"
            value={score.toFixed(1)}
            accent={band.color}
            size="lg"
            sub={scoreBreakdown ? `${scoreBreakdown.inputs.articleCount ?? 0} articles in window` : 'awaiting first run'}
          />
          <GaugeBar score={score} color={band.color} />
          <div className="grid grid-cols-2 gap-px bg-[#131519] -mx-5 -mb-5 mt-auto">
            <MiniStat label="Sev 8+" value={`${stats?.highSeverityLast24h ?? 0}`} />
            <MiniStat label="24h Vol" value={`${stats?.articlesLast24h ?? 0}`} />
          </div>
        </div>
      </Panel>

      {/* Composition */}
      <Panel
        title="Score Composition"
        meta={scoreBreakdown?.formula ? 'weighted composite' : undefined}
        className="xl:col-span-6"
        bodyClass="p-0"
      >
        <Composition breakdown={data.scoreBreakdown} />
      </Panel>

      {/* Integrity */}
      <Panel title="Pipeline Integrity" className="xl:col-span-3" bodyClass="p-5">
        <div className="flex flex-col h-full gap-4">
          <Readout
            label="Classification"
            value={degraded > 0 ? `${degraded} degraded` : 'Verified'}
            accent={degraded > 0 ? STATUS.warning : STATUS.good}
            size="md"
            sub={degraded > 0 ? 'keyword fallback in use' : 'all 24h articles model-classified'}
          />
          <div className="border-t border-[#131519] pt-4 space-y-2.5">
            <IntegrityRow label="Briefing" ok={!reportDegraded} okText="Gemini" badText="Templated" />
            <IntegrityRow label="Sources" ok={data.sources.length > 0} okText={`${data.sources.length} feeds`} badText="none" />
            <IntegrityRow
              label="Volatility"
              ok={Boolean(scoreBreakdown?.components?.find((c) => c.name === 'NormalizedNewsVolatility')?.available)}
              okText="Active"
              badText="Warming up"
            />
          </div>
          {(degraded > 0 || reportDegraded) && (
            <p className="text-[11px] text-[#8b9298] leading-relaxed mt-auto border-t border-[#131519] pt-3">
              Readings remain valid; the methodology is downgraded and labelled per row.
            </p>
          )}
        </div>
      </Panel>

      {/* Timeline */}
      <Panel title="Score Timeline" meta="7 days" className="xl:col-span-12" bodyClass="p-4 pt-5">
        <div className="h-[220px] w-full">
          {timeline.length === 0 ? (
            <Empty>No score history yet.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={timeline} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={RULE} vertical={false} />
                <XAxis
                  dataKey="time"
                  stroke={RULE}
                  tick={{ fill: INK.muted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={48}
                  dy={6}
                />
                <YAxis
                  domain={[0, 100]}
                  stroke={RULE}
                  tick={{ fill: INK.muted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine y={70} stroke={STATUS.critical} strokeOpacity={0.45} />
                <Tooltip contentStyle={TOOLTIP} itemStyle={{ color: INK.primary }} labelStyle={{ color: INK.muted }} />
                <Area type="monotone" dataKey="Risk" stroke={SERIES[0]} strokeWidth={1.75} fill="url(#riskFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      {/* Volume + sentiment */}
      <Panel title="Volume by Category" meta="risk concentration" className="xl:col-span-5" bodyClass="p-4">
        <div className="h-[250px] w-full">
          {volume.length === 0 ? (
            <Empty>No risk-bearing headlines in the window.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={volume} layout="vertical" margin={{ top: 0, right: 36, left: 12, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis
                  dataKey="name"
                  type="category"
                  stroke={RULE}
                  tick={{ fill: INK.muted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  width={92}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip cursor={{ fill: '#0f1114' }} contentStyle={TOOLTIP} itemStyle={{ color: INK.primary }} />
                <Bar dataKey="count" barSize={9}>
                  {volume.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? SERIES[0] : '#2c3036'} />
                  ))}
                  {/* Direct labels: counts are readable without hovering. */}
                  <LabelList
                    dataKey="count"
                    position="right"
                    offset={10}
                    fill={INK.secondary}
                    fontSize={10}
                    fontFamily="JetBrains Mono"
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      <Panel title="Sentiment by Asset" meta="negative below zero" className="xl:col-span-7" bodyClass="p-4">
        <div className="h-[250px] w-full">
          {sentimentAssets.length === 0 ? (
            <Empty>No asset attributions in the window.</Empty>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sentimentData} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke={RULE} vertical={false} />
                <XAxis
                  dataKey="time"
                  stroke={RULE}
                  tick={{ fill: INK.muted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                  dy={6}
                />
                <YAxis
                  domain={[-1, 1]}
                  ticks={[-1, -0.5, 0, 0.5, 1]}
                  stroke={RULE}
                  tick={{ fill: INK.muted, fontSize: 10, fontFamily: 'JetBrains Mono' }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine y={0} stroke={INK.muted} />
                <Tooltip contentStyle={TOOLTIP} labelStyle={{ color: INK.muted }} />
                <Legend
                  wrapperStyle={{ fontSize: 10, paddingTop: 8, fontFamily: 'JetBrains Mono', letterSpacing: '0.08em' }}
                  iconType="square"
                  iconSize={7}
                />
                {sentimentAssets.map((asset) => (
                  <Line
                    key={asset}
                    type="monotone"
                    dataKey={asset}
                    stroke={ASSET_COLORS[asset]}
                    strokeWidth={1.75}
                    dot={{ r: 2, strokeWidth: 0, fill: ASSET_COLORS[asset] }}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: '#000' }}
                    // An asset is only mentioned in some hours; joining the gaps
                    // keeps a series readable instead of scattering stubs.
                    connectNulls
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </Panel>

      {/* Heatmap */}
      <Panel title="Severity Heatmap" meta="peak severity per hour · 7d" className="xl:col-span-12" bodyClass="p-4">
        <Heatmap articles={articles} />
      </Panel>

      {/* Briefing + feed preview */}
      <Panel
        title="Daily Briefing"
        meta={
          latestReport?.mode ? (
            <Chip color={reportDegraded ? STATUS.warning : STATUS.good}>{reportDegraded ? 'Templated' : 'Gemini'}</Chip>
          ) : undefined
        }
        className="xl:col-span-5"
        bodyClass="p-0"
      >
        <div className="h-[420px] overflow-y-auto custom-scrollbar p-4">
          {latestReport ? (
            <div className="markdown-body">
              <ReactMarkdown>{latestReport.content}</ReactMarkdown>
            </div>
          ) : (
            <Empty>Awaiting the first reporting cycle.</Empty>
          )}
        </div>
      </Panel>

      <Panel
        title="Intelligence Feed"
        meta={
          <button onClick={() => onNavigate('feed')} className="label hover:text-[#e7e9ec] transition-colors">
            View all →
          </button>
        }
        className="xl:col-span-7"
        bodyClass="p-0"
      >
        <div className="h-[420px] overflow-y-auto custom-scrollbar">
          <ArticleTable articles={articles.slice(0, 40)} compact />
        </div>
      </Panel>
    </div>
  );
}

const TOOLTIP = {
  backgroundColor: '#000',
  border: `1px solid ${RULE}`,
  color: INK.primary,
  borderRadius: 0,
  fontSize: '11px',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
};

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#09090b] px-5 py-3">
      <div className="label mb-1">{label}</div>
      <div className="tnum text-[15px]">{value}</div>
    </div>
  );
}

function IntegrityRow({ label, ok, okText, badText }: { label: string; ok: boolean; okText: string; badText: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="label">{label}</span>
      <span className="tnum text-[11px]" style={{ color: ok ? STATUS.good : STATUS.warning }}>
        {ok ? okText : badText}
      </span>
    </div>
  );
}

/** A linear gauge: the terminal analogue of the old semicircle dial. */
function GaugeBar({ score, color }: { score: number; color: string }) {
  return (
    <div>
      <div className="relative h-2 bg-[#131519]">
        <div
          className="absolute inset-y-0 left-0 transition-[width] duration-700"
          style={{ width: `${Math.min(Math.max(score, 0), 100)}%`, backgroundColor: color }}
        />
        {/* Critical threshold the alert fires on. */}
        <div className="absolute inset-y-[-3px] w-px bg-[#d03b3b]" style={{ left: '70%' }} />
      </div>
      <div className="flex justify-between label mt-1.5">
        <span>0</span>
        <span style={{ color: STATUS.critical }}>70 crit</span>
        <span>100</span>
      </div>
    </div>
  );
}

/* ---- Score composition --------------------------------------------------- */

function Composition({ breakdown }: { breakdown: RiskData['scoreBreakdown'] }) {
  if (!breakdown?.components?.length) {
    return <Empty>Awaiting the first scoring run.</Empty>;
  }
  const available = breakdown.components.filter((c) => c.available);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4">
        <div className="flex h-2.5 w-full gap-[2px] bg-[#131519]">
          {available.map((c) => (
            <div
              key={c.name}
              style={{ width: `${c.contribution}%`, backgroundColor: COMPONENT_COLORS[c.name] }}
              title={`${COMPONENT_LABELS[c.name]}: ${c.contribution} pts`}
            />
          ))}
        </div>
        <div className="flex justify-between label mt-1.5">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
      </div>

      <table className="w-full mt-4 text-[11px]">
        <thead>
          <tr className="border-y border-[#131519]">
            <th className="label text-left font-normal px-4 py-2">Component</th>
            <th className="label text-right font-normal px-2 py-2">Norm</th>
            <th className="label text-right font-normal px-2 py-2">Weight</th>
            <th className="label text-right font-normal px-4 py-2">Contrib</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.components.map((c) => (
            <tr key={c.name} className={`border-b border-[#131519] ${c.available ? '' : 'opacity-45'}`}>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-2 h-2 shrink-0" style={{ backgroundColor: COMPONENT_COLORS[c.name] }} />
                  <div className="min-w-0">
                    <div className="text-[#e7e9ec] font-mono uppercase tracking-[0.08em] text-[10px]">
                      {COMPONENT_LABELS[c.name] || c.name}
                    </div>
                    <div className="text-[#565c64] truncate text-[10px] mt-0.5" title={c.detail}>
                      {c.detail}
                    </div>
                  </div>
                </div>
              </td>
              <td className="tnum text-right px-2 text-[#e7e9ec]">{c.available ? c.normalized.toFixed(1) : '—'}</td>
              <td className="tnum text-right px-2 text-[#8b9298]">
                {(c.weight * 100).toFixed(0)}%
                {c.available && Math.abs(c.effectiveWeight - c.weight) > 0.001 && (
                  <span style={{ color: STATUS.warning }}> →{(c.effectiveWeight * 100).toFixed(0)}%</span>
                )}
              </td>
              <td className="tnum text-right px-4 text-[#e7e9ec]">
                {c.available ? `+${c.contribution.toFixed(1)}` : 'excl'}
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="px-4 py-2.5 label">
              Master Risk Score
            </td>
            <td className="tnum text-right px-4 py-2.5 text-[#e7e9ec] text-[13px]">{breakdown.score?.toFixed(1)}</td>
          </tr>
        </tbody>
      </table>

      {breakdown.notes?.length > 0 && (
        <div
          className="mt-auto flex items-start gap-2 px-4 py-2.5 border-t text-[10px] leading-relaxed"
          style={{ borderColor: '#131519', color: STATUS.warning }}
        >
          <ShieldAlert className="w-3 h-3 shrink-0 mt-px" />
          <span>{breakdown.notes.join(' · ')}</span>
        </div>
      )}
    </div>
  );
}

/* ---- Heatmap ------------------------------------------------------------- */

function Heatmap({ articles }: { articles: Article[] }) {
  const days = useMemo(
    () =>
      Array.from({ length: 7 })
        .map((_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          return format(d, 'EEE');
        })
        .reverse(),
    [],
  );
  const hours = Array.from({ length: 24 }).map((_, i) => i);

  const cells = useMemo(() => {
    const map: Record<string, number> = {};
    days.forEach((d) => hours.forEach((h) => (map[`${d}-${h}`] = 0)));
    articles.forEach((a) => {
      const d = new Date(a.timestamp);
      const key = `${format(d, 'EEE')}-${d.getHours()}`;
      if (map[key] !== undefined) map[key] = Math.max(map[key], a.riskSeverity || 0);
    });
    return map;
  }, [articles, days]);

  // One ordered ramp for a continuous magnitude -- never a rainbow.
  const shade = (s: number) => {
    if (s === 0) return '#101215';
    if (s < 4) return '#1e4272';
    if (s < 7) return '#2a6bb8';
    return SERIES[0];
  };

  return (
    <div>
      <div className="flex items-start gap-3 overflow-x-auto custom-scrollbar pb-1">
        <div className="flex flex-col gap-[3px] mt-5 pr-3 border-r border-[#131519] shrink-0">
          {days.map((d) => (
            <div key={d} className="h-5 label flex items-center justify-end">
              {d}
            </div>
          ))}
        </div>
        <div className="flex-1 min-w-[680px] flex gap-[3px]">
          {hours.map((h) => (
            <div key={h} className="flex-1 flex flex-col gap-[3px]">
              <div className="label text-center mb-1">{h.toString().padStart(2, '0')}</div>
              {days.map((d) => {
                const s = cells[`${d}-${h}`];
                return (
                  <div
                    key={`${d}-${h}`}
                    className="h-5 w-full transition-colors"
                    style={{ backgroundColor: shade(s) }}
                    title={`${d} ${h.toString().padStart(2, '0')}:00 — peak severity ${s}/10`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 mt-4 pt-3 border-t border-[#131519]">
        <span className="label">Severity</span>
        {[
          ['0', '#101215'],
          ['1–3', '#1e4272'],
          ['4–6', '#2a6bb8'],
          ['7–10', SERIES[0]],
        ].map(([l, c]) => (
          <span key={l} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5" style={{ backgroundColor: c }} />
            <span className="label">{l}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---- Shared article table ------------------------------------------------ */

function ArticleTable({ articles, compact = false }: { articles: Article[]; compact?: boolean }) {
  if (articles.length === 0) {
    return <Empty>Awaiting the first ingestion cycle.</Empty>;
  }
  return (
    <table className="w-full text-[11px]">
      <thead className="sticky top-0 z-10 bg-[#09090b]">
        <tr className="border-b border-[#1c1f24]">
          <th className="label text-left font-normal px-4 py-2.5 w-[86px]">Time</th>
          {!compact && <th className="label text-left font-normal px-2 py-2.5 w-[130px]">Source</th>}
          <th className="label text-left font-normal px-2 py-2.5 w-[86px]">Class</th>
          <th className="label text-left font-normal px-2 py-2.5">Headline</th>
          <th className="label text-right font-normal px-4 py-2.5 w-[120px]">Severity</th>
        </tr>
      </thead>
      <tbody>
        {articles.map((a) => {
          const degraded = a.classificationMode && a.classificationMode !== 'gemini';
          return (
            <tr key={a.id} className="border-b border-[#131519] hover:bg-[#0d0e11] transition-colors">
              <td className="tnum px-4 py-2 text-[#565c64] align-top whitespace-nowrap">
                {format(new Date(a.timestamp), 'dd HH:mm')}
              </td>
              {!compact && (
                <td className="px-2 py-2 align-top">
                  <span className="label truncate block">{a.source || '—'}</span>
                </td>
              )}
              <td className="px-2 py-2 align-top">
                <span
                  className="font-mono text-[10px] tracking-[0.08em]"
                  style={{ color: a.riskType === 'No Risk' ? INK.muted : severityColor(a.riskSeverity) }}
                >
                  {shortRisk(a.riskType)}
                </span>
              </td>
              <td className="px-2 py-2 align-top">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#c9ced4] hover:text-white transition-colors line-clamp-1"
                  title={a.summary || a.title}
                >
                  {a.title}
                </a>
                {degraded && (
                  <span className="label" style={{ color: STATUS.warning }}>
                    keyword fallback
                  </span>
                )}
              </td>
              <td className="px-4 py-2 align-top">
                <div className="flex items-center justify-end gap-2.5">
                  <span className="tnum text-[#8b9298] w-4 text-right">{a.riskSeverity || '—'}</span>
                  <SeverityBar severity={a.riskSeverity || 0} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ==========================================================================
 * Feed
 * ======================================================================= */

function Feed({ data }: { data: RiskData }) {
  const [filter, setFilter] = useState<string>('ALL');

  const categories = useMemo(() => {
    const set = new Set(data.articles.map((a) => a.riskType).filter(Boolean));
    return ['ALL', ...Array.from(set)];
  }, [data.articles]);

  const rows = useMemo(
    () => (filter === 'ALL' ? data.articles : data.articles.filter((a) => a.riskType === filter)),
    [data.articles, filter],
  );

  return (
    <Panel
      title="Classified Intelligence Feed"
      meta={`${rows.length} of ${data.articles.length}`}
      bodyClass="p-0"
      className="min-h-[calc(100vh-48px)]"
    >
      {/* One filter row above everything it scopes. */}
      <div className="flex flex-wrap items-center gap-px bg-[#131519] border-b border-[#1c1f24]">
        {categories.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`px-3 h-8 text-[10px] font-mono uppercase tracking-[0.1em] transition-colors ${
              filter === c ? 'bg-[#13151a] text-[#e7e9ec]' : 'bg-[#09090b] text-[#565c64] hover:text-[#8b9298]'
            }`}
          >
            {c === 'ALL' ? 'All' : shortRisk(c)}
          </button>
        ))}
      </div>
      <ArticleTable articles={rows} />
    </Panel>
  );
}

/* ==========================================================================
 * Methodology
 * ======================================================================= */

function Methodology({ data }: { data: RiskData }) {
  const m = data.methodology;
  const b = data.scoreBreakdown;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-px items-start">
      <Panel title="Master Risk Score" meta={m?.scale} bodyClass="p-5">
        {m ? (
          <div className="space-y-5">
            <div>
              <div className="label mb-2">Formula</div>
              <code className="block text-[11px] text-[#c9ced4] bg-[#0d0e11] border border-[#131519] p-3 leading-relaxed">
                {m.formula}
              </code>
            </div>
            <div className="space-y-3">
              {m.components.map((c) => (
                <div key={c.name} className="border-t border-[#131519] pt-3">
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 shrink-0" style={{ backgroundColor: COMPONENT_COLORS[c.name] }} />
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[#e7e9ec] truncate">
                        {COMPONENT_LABELS[c.name] || c.name}
                      </span>
                    </span>
                    <span className="tnum text-[11px] text-[#8b9298] shrink-0">{(c.weight * 100).toFixed(0)}%</span>
                  </div>
                  <p className="text-[11px] text-[#8b9298] leading-relaxed">{c.derivation}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-[#131519] pt-3 space-y-2">
              <p className="text-[11px] text-[#8b9298] leading-relaxed">{m.renormalization}</p>
              <p className="text-[11px] text-[#565c64] leading-relaxed">{m.determinism}</p>
            </div>
          </div>
        ) : (
          <Empty>Methodology unavailable.</Empty>
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-px content-start">
        <Panel title="Current Decomposition" meta={b ? `score ${b.score.toFixed(1)}` : undefined} bodyClass="p-0">
          <Composition breakdown={b} />
        </Panel>

        <Panel title="Scoring Inputs" bodyClass="p-0">
          {b ? (
            <table className="w-full text-[11px]">
              <tbody>
                {Object.entries(b.inputs).map(([k, v]) => (
                  <tr key={k} className="border-b border-[#131519]">
                    <td className="label px-4 py-2">{k.replace(/([A-Z])/g, ' $1').trim()}</td>
                    <td className="tnum text-right px-4 py-2 text-[#e7e9ec]">{v === null ? '—' : String(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No scoring run yet.</Empty>
          )}
        </Panel>

        <Panel title="News Sources" meta={`${data.sources.length} configured`} bodyClass="p-0">
          {data.sources.length ? (
            <table className="w-full text-[11px]">
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.name} className="border-b border-[#131519]">
                    <td className="px-4 py-2 text-[#c9ced4] whitespace-nowrap">{s.name}</td>
                    <td className="px-4 py-2 text-right">
                      <span className="label truncate block max-w-[320px]" title={s.url}>
                        {s.url.replace(/^https?:\/\//, '').split('/')[0]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No sources configured.</Empty>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ---- Sentiment aggregation ----------------------------------------------- */

function useSentiment(articles: Article[]) {
  return useMemo(() => {
    const buckets: Record<string, { time: string; sums: Record<string, number>; counts: Record<string, number> }> = {};
    const seen = new Set<string>();

    [...articles].reverse().forEach((article) => {
      const timeKey = format(new Date(article.timestamp), 'HH:00');
      if (!buckets[timeKey]) buckets[timeKey] = { time: timeKey, sums: {}, counts: {} };
      assetsOf(article).forEach((asset) => {
        seen.add(asset);
        buckets[timeKey].sums[asset] = (buckets[timeKey].sums[asset] || 0) + (article.sentimentScore || 0);
        buckets[timeKey].counts[asset] = (buckets[timeKey].counts[asset] || 0) + 1;
      });
    });

    const sentimentData = Object.values(buckets).map((bucket) => {
      const row: Record<string, string | number> = { time: bucket.time };
      Object.keys(bucket.sums).forEach((asset) => {
        row[asset] = Number((bucket.sums[asset] / bucket.counts[asset]).toFixed(2));
      });
      return row;
    });

    // Fixed order so an asset keeps its colour as the set changes.
    const sentimentAssets = Object.keys(ASSET_COLORS).filter((a) => seen.has(a));
    return { sentimentData, sentimentAssets };
  }, [articles]);
}
