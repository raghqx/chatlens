'use client';

export interface BarDatum {
  label: string;
  value: number;
  /** CSS colour for the bar. Defaults to series slot 1. */
  color?: string;
  /** Overrides the numeric value shown at the bar tip. */
  display?: string;
}

/**
 * Horizontal bars for a ranked list.
 *
 * Bars are capped at 24px and grow from a single baseline, with the value
 * direct-labelled at the tip rather than printed on every gridline. A single
 * ranking gets one colour for every bar — darkening bars by size would
 * double-encode length as hue and burn the only free channel on information the
 * chart already shows.
 */
export function BarList({
  data,
  formatValue = (v: number) => v.toLocaleString(),
}: {
  data: BarDatum[];
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));

  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nothing to show.</p>;
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {data.map((d) => (
        <li key={d.label} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3">
          <span className="truncate text-xs text-[var(--text-secondary)]" title={d.label}>
            {d.label}
          </span>
          <span className="h-3 w-full">
            <span
              className="block h-3 rounded-r-[4px]"
              style={{
                width: `${Math.max(2, (d.value / max) * 100)}%`,
                background: d.color ?? 'var(--series-1)',
              }}
            />
          </span>
          <span className="tabular text-xs text-[var(--text-secondary)]">
            {d.display ?? formatValue(d.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
