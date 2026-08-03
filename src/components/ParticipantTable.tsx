'use client';

import type { ParticipantStats } from '@/lib/analytics';
import { seriesVar } from '@/lib/theme';

const minutes = (value: number | null) => {
  if (value === null) return '-';
  if (value < 60) return `${value.toFixed(1)}m`;
  if (value < 1440) return `${(value / 60).toFixed(1)}h`;
  return `${(value / 1440).toFixed(1)}d`;
};

/**
 * The participant table doubles as the chart legend.
 *
 * Each row carries the participant's series swatch, so identity is never
 * carried by colour alone — which is also the relief that makes the three
 * lighter hues in the palette legal on a light surface. Numbers are
 * `tabular-nums` here because these columns must align vertically.
 */
export function ParticipantTable({ participants }: { participants: ParticipantStats[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]">
            <th scope="col" className="pb-2 font-medium">
              Participant
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Messages
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Share
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Avg words
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Median reply
            </th>
            <th scope="col" className="pb-2 text-right font-medium">
              Started
            </th>
          </tr>
        </thead>
        <tbody>
          {participants.map((p, i) => (
            <tr key={p.name} className="border-b border-[var(--border)] last:border-0">
              <td className="py-2.5">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: seriesVar(i) }}
                  />
                  <span className="truncate text-[var(--text-primary)]" title={p.name}>
                    {p.name}
                  </span>
                </span>
              </td>
              <td className="tabular py-2.5 text-right text-[var(--text-secondary)]">
                {p.messages.toLocaleString()}
              </td>
              <td className="tabular py-2.5 text-right text-[var(--text-secondary)]">
                {(p.share * 100).toFixed(1)}%
              </td>
              <td className="tabular py-2.5 text-right text-[var(--text-secondary)]">
                {p.averageWords.toFixed(1)}
              </td>
              <td className="tabular py-2.5 text-right text-[var(--text-secondary)]">
                {minutes(p.medianReplyMinutes)}
              </td>
              <td className="tabular py-2.5 text-right text-[var(--text-secondary)]">
                {p.conversationsStarted.toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
