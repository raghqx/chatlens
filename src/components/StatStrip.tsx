"use client";

import type { ChatStats } from "@/lib/types";

type StatStripProps = {
  stats: ChatStats;
};

const items: Array<{ key: keyof ChatStats; label: string }> = [
  { key: "totalMessages", label: "Messages" },
  { key: "totalWords", label: "Words" },
  { key: "mediaShared", label: "Media" },
  { key: "linksShared", label: "Links" },
];

export function StatStrip({ stats }: StatStripProps) {
  return (
    <div className="stat-strip">
      {items.map((item) => (
        <div key={item.key} className="stat-item">
          <span className="stat-item__value">
            {stats[item.key].toLocaleString()}
          </span>
          <span className="stat-item__label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
