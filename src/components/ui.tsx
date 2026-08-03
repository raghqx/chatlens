'use client';

import { useCallback, useState, type ReactNode } from 'react';

/** Compact large numbers the way a stat tile should read: 1,284 / 12.9K / 4.2M. */
export function compact(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) < 10_000) return value.toLocaleString();
  if (Math.abs(value) < 1_000_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
}

export function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-[var(--border)] bg-[var(--surface-1)] p-5 ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/**
 * A single headline number.
 *
 * Proportional figures, not tabular: `tabular-nums` gives every digit the width
 * of a zero, which reads loose at display sizes. Tabular is reserved for the
 * table columns that actually need to align.
 */
export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3.5">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
        {typeof value === 'number' ? compact(value) : value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{hint}</div>}
    </div>
  );
}

export interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

/**
 * Hover tooltip shared by the charts.
 *
 * Positioned against the chart container rather than the page so it travels
 * with scroll, and marked `pointer-events-none` so it can never steal the hover
 * that is keeping it open.
 */
export function useTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const show = useCallback((event: { clientX: number; clientY: number }, content: ReactNode) => {
    setTooltip({ x: event.clientX, y: event.clientY, content });
  }, []);

  const hide = useCallback(() => setTooltip(null), []);

  return { tooltip, show, hide };
}

export function Tooltip({ state }: { state: TooltipState | null }) {
  if (!state) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-2.5 py-1.5 text-xs whitespace-nowrap text-[var(--text-primary)] shadow-lg"
      style={{ left: state.x, top: state.y }}
    >
      {state.content}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--series-1)]"
      />
      <span>
        <span className="block text-sm text-[var(--text-primary)]">{label}</span>
        {description && (
          <span className="block text-xs text-[var(--text-secondary)]">{description}</span>
        )}
      </span>
    </label>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost';
  type?: 'button' | 'submit';
}) {
  const styles =
    variant === 'primary'
      ? 'bg-[var(--series-1)] text-white hover:opacity-90'
      : 'border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--surface-2)]';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning';
  children: ReactNode;
}) {
  const accent = tone === 'warning' ? 'var(--warning)' : 'var(--series-1)';
  return (
    <div
      className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-2.5 text-xs text-[var(--text-secondary)]"
      style={{ borderLeft: `3px solid ${accent}` }}
    >
      {children}
    </div>
  );
}
