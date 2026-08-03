'use client';

import { SEQUENTIAL_STEPS, sequentialStep } from '@/lib/theme';
import { Tooltip, useTooltip } from '../ui';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Messages by hour of day against day of week.
 *
 * Magnitude, so a single-hue ramp light-to-dark — never a rainbow. A count of
 * zero renders as the surface colour rather than the palest blue, so "never
 * talked at 4am on a Tuesday" reads as absence rather than as a small value.
 * The 2px gap between cells is the surface showing through; no cell borders.
 */
export function ActivityHeatmap({ grid }: { grid: number[][] }) {
  const { tooltip, show, hide } = useTooltip();
  const peak = Math.max(1, ...grid.flat());

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="flex">
            <div className="w-9 shrink-0" />
            <div className="grid flex-1 grid-cols-24 gap-[2px]">
              {Array.from({ length: 24 }, (_, hour) => (
                <div
                  key={hour}
                  className="text-center text-[9px] leading-none text-[var(--text-muted)]"
                >
                  {hour % 6 === 0 ? hour : ''}
                </div>
              ))}
            </div>
          </div>

          {grid.map((row, weekday) => (
            <div key={WEEKDAYS[weekday]} className="mt-[2px] flex items-center">
              <div className="w-9 shrink-0 pr-2 text-right text-[10px] text-[var(--text-muted)]">
                {WEEKDAYS[weekday]}
              </div>
              <div className="grid flex-1 grid-cols-24 gap-[2px]">
                {row.map((count, hour) => {
                  const fill = sequentialStep(count / peak);
                  return (
                    <button
                      key={`${WEEKDAYS[weekday]}-${hour}`}
                      type="button"
                      aria-label={`${WEEKDAYS[weekday]} ${hour}:00, ${count} messages`}
                      className="h-5 rounded-[3px] border-0 p-0"
                      style={{ background: fill ?? 'var(--surface-2)' }}
                      onMouseEnter={(e) =>
                        show(e, (
                          <span>
                            <strong>{count.toLocaleString()}</strong> messages &middot;{' '}
                            {WEEKDAYS[weekday]} {String(hour).padStart(2, '0')}:00
                          </span>
                        ))
                      }
                      onMouseLeave={hide}
                      onFocus={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        show({ clientX: r.left + r.width / 2, clientY: r.top }, (
                          <span>
                            <strong>{count.toLocaleString()}</strong> messages &middot;{' '}
                            {WEEKDAYS[weekday]} {String(hour).padStart(2, '0')}:00
                          </span>
                        ));
                      }}
                      onBlur={hide}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
        <span>none</span>
        <div
          className="h-2.5 w-4 rounded-[2px] border border-[var(--border)]"
          style={{ background: 'var(--surface-2)' }}
        />
        {SEQUENTIAL_STEPS.map((step) => (
          <div key={step} className="h-2.5 w-4 rounded-[2px]" style={{ background: step }} />
        ))}
        <span>{peak.toLocaleString()} messages</span>
      </div>

      <Tooltip state={tooltip} />
    </div>
  );
}
