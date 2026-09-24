/**
 * Terminal primitives.
 *
 * The visual language is a trading desk rather than a web app: hairline rules
 * instead of rounded cards, mono tabular figures for anything measured, and
 * small tracked-out labels. Panels sit on a 1px grid where the page plane
 * shows through the gaps, which is why nothing here carries a border radius.
 */

import type { ReactNode } from 'react';

/* --------------------------------------------------------------------------
 * Tokens
 *
 * SERIES is the validated dark-mode categorical palette, checked against the
 * #09090b panel surface: worst adjacent CVD dE 8.4, worst adjacent
 * normal-vision dE 19.3, all six above 3:1 contrast. Slots are assigned to
 * entities in fixed order and never by rank, so a series keeps its colour as
 * the data around it changes.
 *
 * STATUS is reserved for risk bands and always ships beside a text label --
 * colour never carries the meaning on its own.
 * ----------------------------------------------------------------------- */

export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
export const STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b' };
export const INK = { primary: '#e7e9ec', secondary: '#8b9298', muted: '#565c64' };
export const PANEL = '#09090b';
export const RULE = '#1c1f24';
export const RULE_SOFT = '#131519';

export const ASSET_COLORS: Record<string, string> = {
  Equities: SERIES[0],
  Bonds: SERIES[1],
  Commodities: SERIES[2],
  Crypto: SERIES[3],
  FX: SERIES[4],
  'Real Estate': SERIES[5],
};

export const COMPONENT_COLORS: Record<string, string> = {
  NormalizedSeverity: SERIES[0],
  NormalizedSentimentRisk: SERIES[1],
  NormalizedNewsVolatility: SERIES[2],
};

export const COMPONENT_LABELS: Record<string, string> = {
  NormalizedSeverity: 'Severity',
  NormalizedSentimentRisk: 'Sentiment',
  NormalizedNewsVolatility: 'Volatility',
};

export const TOOLTIP_STYLE = {
  backgroundColor: '#000',
  border: `1px solid ${RULE}`,
  color: INK.primary,
  borderRadius: 0,
  fontSize: '11px',
  fontFamily: '"JetBrains Mono", ui-monospace, monospace',
  padding: '8px 10px',
};

export function riskBand(score: number) {
  if (score >= 70) return { label: 'Elevated', color: STATUS.critical, code: 'ELEV' };
  if (score >= 40) return { label: 'Moderate', color: STATUS.warning, code: 'MOD' };
  return { label: 'Contained', color: STATUS.good, code: 'CONT' };
}

export function severityColor(severity: number) {
  if (severity >= 8) return STATUS.critical;
  if (severity >= 4) return STATUS.warning;
  return SERIES[0];
}

/** Risk taxonomy as fixed-width codes. Slicing the words truncated them
 *  mid-syllable ("GEOPOLITI", "OPERATION"), so the codes are explicit. */
const RISK_CODES: Record<string, string> = {
  'Market Risk': 'MARKET',
  'Credit Risk': 'CREDIT',
  'Geopolitical Risk': 'GEOPOL',
  'Liquidity Risk': 'LIQUID',
  'Regulatory Risk': 'REGUL',
  'Operational Risk': 'OPER',
  'No Risk': 'NONE',
};

export function shortRisk(riskType?: string) {
  if (!riskType) return '—';
  return RISK_CODES[riskType] ?? riskType.replace(' Risk', '').toUpperCase().slice(0, 6);
}

/* --------------------------------------------------------------------------
 * Primitives
 * ----------------------------------------------------------------------- */

export function Panel({
  title,
  meta,
  children,
  className = '',
  bodyClass = 'p-4',
}: {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`bg-[#09090b] border border-[#1c1f24] flex flex-col min-w-0 ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-3 px-4 h-9 border-b border-[#131519] shrink-0">
          <h2 className="label">{title}</h2>
          {meta && <div className="label text-right truncate">{meta}</div>}
        </header>
      )}
      <div className={`flex-1 min-h-0 min-w-0 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** A labelled readout. `value` stays proportional-free: it is a measurement. */
export function Readout({
  label,
  value,
  sub,
  accent,
  size = 'md',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = { sm: 'text-lg', md: 'text-2xl', lg: 'text-[44px] leading-[1.05]' };
  return (
    <div className="flex flex-col justify-center min-w-0">
      <div className="label mb-2 truncate">{label}</div>
      <div className={`tnum ${sizes[size]} truncate`} style={{ color: accent || INK.primary }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-[#565c64] mt-1.5 truncate">{sub}</div>}
    </div>
  );
}

export function StatusDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      className={`w-1.5 h-1.5 shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ backgroundColor: color }}
    />
  );
}

/** A status chip. Always carries its label -- colour is never the only cue. */
export function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 text-[10px] tracking-[0.1em] uppercase border shrink-0"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}12`, fontFamily: '"JetBrains Mono", monospace' }}
    >
      {children}
    </span>
  );
}

/** Ten cells of severity, so the number is readable without colour. */
export function SeverityBar({ severity }: { severity: number }) {
  const color = severityColor(severity);
  return (
    <span className="inline-flex gap-[2px] items-center" aria-label={`severity ${severity} of 10`}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span
          key={i}
          className="w-[3px] h-2.5"
          style={{ backgroundColor: i < severity ? color : '#1c1f24' }}
        />
      ))}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="h-full w-full flex items-center justify-center text-[11px] text-[#565c64] p-6 text-center">
      {children}
    </div>
  );
}
