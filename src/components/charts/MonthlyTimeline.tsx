'use client';

import { useMemo, useState } from 'react';
import { Tooltip, useTooltip } from '../ui';

const WIDTH = 720;
const HEIGHT = 200;
const PAD = { top: 12, right: 16, bottom: 28, left: 44 };

/** Round an axis maximum up to a clean 1/2/5 x 10^n value. */
function niceMax(value: number): number {
  if (value <= 5) return 5;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-');
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1]} ${y.slice(2)}`;
};

/**
 * Messages per month.
 *
 * One series, so no legend box — the card title already names what is plotted.
 * A 2px line with hairline gridlines and a single end-marker: the endpoint is
 * direct-labelled, everything else is left to the axis and the hover crosshair
 * rather than putting a number on every point.
 */
export function MonthlyTimeline({ data }: { data: Array<{ month: string; count: number }> }) {
  const { tooltip, show, hide } = useTooltip();
  const [active, setActive] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const max = niceMax(Math.max(1, ...data.map((d) => d.count)));
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const points = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.count) }));
    return { max, points, ticks: [0, max / 2, max].map((v) => ({ v, y: y(v) })) };
  }, [data]);

  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--text-muted)]">No activity to plot.</p>;
  }

  const { points, ticks } = geometry;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx},${p.cy}`).join(' ');
  const last = points[points.length - 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-[200px] w-full min-w-[520px]"
        role="img"
        aria-label={`Messages per month from ${data[0].month} to ${data[data.length - 1].month}`}
        onMouseLeave={() => {
          setActive(null);
          hide();
        }}
      >
        {ticks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--gridline)"
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={t.y + 3}
              textAnchor="end"
              className="tabular"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {Math.round(t.v).toLocaleString()}
            </text>
          </g>
        ))}

        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {active !== null && (
          <line
            x1={points[active].cx}
            x2={points[active].cx}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="var(--axis)"
            strokeWidth={1}
          />
        )}

        {/* End marker: 2px surface ring so it stays legible over the line. */}
        <circle cx={last.cx} cy={last.cy} r={6} fill="var(--surface-1)" />
        <circle cx={last.cx} cy={last.cy} r={4} fill="var(--series-1)" />

        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text
              key={p.month}
              x={p.cx}
              y={HEIGHT - 10}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-muted)"
            >
              {monthLabel(p.month)}
            </text>
          ) : null,
        )}

        {/* Invisible hit targets, wider than the marks, per interaction guidance. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.month}`}
            x={p.cx - 14}
            y={PAD.top}
            width={28}
            height={HEIGHT - PAD.top - PAD.bottom}
            fill="transparent"
            onMouseEnter={(e) => {
              setActive(i);
              show(e, (
                <span>
                  <strong>{p.count.toLocaleString()}</strong> messages &middot; {monthLabel(p.month)}
                </span>
              ));
            }}
          />
        ))}
      </svg>
      <Tooltip state={tooltip} />
    </div>
  );
}
