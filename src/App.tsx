import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Activity, AlertTriangle, ListTree, Radio, Sigma } from 'lucide-react';

import { FLogo } from './components/Logo';
import { Chip, INK, STATUS, StatusDot, riskBand } from './components/Terminal';
import { useRiskData } from './lib/useRiskData';
import DashboardPage, { type View } from './pages/Dashboard';

const NAV: { id: View; label: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'feed', label: 'Feed', icon: ListTree },
  { id: 'methodology', label: 'Methodology', icon: Sigma },
];

export default function App() {
  const [view, setView] = useState<View>('overview');
  const { data, loaded, error, updatedAt } = useRiskData();
  const mainRef = useRef<HTMLElement>(null);

  // The app scrolls inside <main>, so switching views would otherwise land the
  // reader wherever the previous view was scrolled to -- mid-table, with the
  // new view's header off screen.
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [view]);

  const score = data.stats?.currentScore ?? 0;
  const band = riskBand(score);
  const degraded = data.stats?.degradedLast24h ?? 0;
  const reportDegraded = Boolean(data.latestReport?.mode && data.latestReport.mode !== 'gemini');

  // Delta against the oldest reading still inside the 7-day window.
  const oldest = data.scores.length ? data.scores[data.scores.length - 1].score : null;
  const delta = oldest !== null && data.stats?.currentScore != null ? score - oldest : null;

  return (
    <div className="h-full flex flex-col bg-black text-[#e7e9ec] font-sans">
      {/* Top rail */}
      <header className="h-12 shrink-0 border-b border-[#1c1f24] flex items-stretch relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-px sweep" aria-hidden="true" />

        <div className="w-[216px] shrink-0 border-r border-[#1c1f24] flex items-center gap-2.5 px-4">
          <FLogo className="w-4 h-4" />
          <span className="text-[13px] font-medium tracking-tight">Risk Intelligence</span>
        </div>

        <div className="flex-1 flex items-center justify-between px-4 gap-4 min-w-0">
          <div className="flex items-center gap-4 min-w-0">
            <span className="label hidden md:inline">Automated Market Intelligence</span>
            <span className="hidden lg:flex items-center gap-2">
              <StatusDot color={error ? STATUS.critical : STATUS.good} pulse={!error} />
              <span className="label">{error ? 'Feed Down' : 'Live'}</span>
            </span>
          </div>

          <div className="flex items-center gap-4 shrink-0">
            {degraded > 0 && (
              <Chip color={STATUS.warning}>
                <AlertTriangle className="w-3 h-3" /> {degraded} degraded
              </Chip>
            )}
            <div className="hidden sm:flex items-baseline gap-2">
              <span className="label">MRS</span>
              <span className="tnum text-[15px]" style={{ color: band.color }}>
                {loaded ? score.toFixed(1) : '--.-'}
              </span>
              {delta !== null && Math.abs(delta) >= 0.05 && (
                <span className="tnum text-[11px]" style={{ color: delta > 0 ? STATUS.critical : STATUS.good }}>
                  {delta > 0 ? '▲' : '▼'}
                  {Math.abs(delta).toFixed(1)}
                </span>
              )}
              <Chip color={band.color}>{band.code}</Chip>
            </div>
            <span className="label tnum hidden xl:inline">
              {updatedAt ? format(updatedAt, 'HH:mm:ss') : '--:--:--'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <nav className="w-[216px] shrink-0 border-r border-[#1c1f24] flex flex-col justify-between">
          <div className="py-3">
            {NAV.map(({ id, label, icon: Icon }) => {
              const active = view === id;
              return (
                <button
                  key={id}
                  onClick={() => setView(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center gap-2.5 px-4 h-9 text-left transition-colors border-l-2 ${
                    active
                      ? 'border-l-[#3987e5] bg-[#0d0e11] text-[#e7e9ec]'
                      : 'border-l-transparent text-[#8b9298] hover:text-[#e7e9ec] hover:bg-[#0b0c0e]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[11px] tracking-[0.1em] uppercase font-mono">{label}</span>
                </button>
              );
            })}
          </div>

          {/* Status rail: the pipeline's own account of itself. */}
          <div className="border-t border-[#131519] p-4 space-y-3">
            <div className="label">System</div>
            <RailRow label="Sources" value={`${data.sources.length}`} color={data.sources.length ? STATUS.good : INK.muted} />
            <RailRow label="Inference" value={degraded > 0 ? 'Degraded' : 'Gemini'} color={degraded > 0 ? STATUS.warning : STATUS.good} />
            <RailRow label="Briefing" value={reportDegraded ? 'Template' : 'Gemini'} color={reportDegraded ? STATUS.warning : STATUS.good} />
            <RailRow label="24h Vol" value={`${data.stats?.articlesLast24h ?? 0}`} color={INK.secondary} />
            <div className="pt-2 flex items-center gap-2">
              <Radio className="w-3 h-3 text-[#565c64] shrink-0" />
              <span className="label">30 min cycle</span>
            </div>
          </div>
        </nav>

        {/* Main */}
        <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
          <DashboardPage data={data} loaded={loaded} error={error} view={view} onNavigate={setView} />
        </main>
      </div>
    </div>
  );
}

function RailRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="label">{label}</span>
      <span className="tnum text-[11px]" style={{ color }}>
        {value}
      </span>
    </div>
  );
}
