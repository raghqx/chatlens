"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BusyUser, NamedCount } from "@/lib/types";

const COLORS = ["#0F6A4F", "#1FA971", "#F2C14E", "#E4572E", "#2E86AB", "#6C63FF"];

type ChartCardProps = {
  title: string;
  children: React.ReactNode;
};

function ChartCard({ title, children }: ChartCardProps) {
  return (
    <section className="panel">
      <h3>{title}</h3>
      <div className="chart-frame">{children}</div>
    </section>
  );
}

export function MonthlyTimelineChart({ data }: { data: NamedCount[] }) {
  return (
    <ChartCard title="Monthly timeline">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 40, 30, 0.08)" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#0F6A4F"
            strokeWidth={2.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function DailyTimelineChart({ data }: { data: NamedCount[] }) {
  const compact =
    data.length > 60
      ? data.filter((_, index) => index % Math.ceil(data.length / 60) === 0)
      : data;

  return (
    <ChartCard title="Daily timeline">
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={compact}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 40, 30, 0.08)" />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="count"
            stroke="#1FA971"
            strokeWidth={2}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function ActivityCharts({
  busyDays,
  busyMonths,
}: {
  busyDays: NamedCount[];
  busyMonths: NamedCount[];
}) {
  return (
    <div className="split-grid">
      <ChartCard title="Most active days">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={busyDays}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 40, 30, 0.08)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#0F6A4F" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title="Most active months">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={busyMonths}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 40, 30, 0.08)" />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#F2C14E" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}

export function BusyUsersChart({ data }: { data: BusyUser[] }) {
  return (
    <ChartCard title="Most active users">
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 40, 30, 0.08)" />
          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
          <Tooltip
            formatter={(value, _name, item) => {
              const percent = (item?.payload as BusyUser | undefined)?.percent;
              return [`${value} messages (${percent ?? 0}%)`, "Count"];
            }}
          />
          <Bar dataKey="count" fill="#E4572E" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function CommonWordsChart({ data }: { data: NamedCount[] }) {
  return (
    <ChartCard title="Most common words">
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={[...data].reverse()} layout="vertical" margin={{ left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(15, 40, 30, 0.08)" />
          <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="count" fill="#2E86AB" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export function EmojiChart({ data }: { data: NamedCount[] }) {
  const top = data.slice(0, 8);

  return (
    <div className="split-grid">
      <ChartCard title="Top emojis">
        {top.length === 0 ? (
          <p className="muted">No emojis found in this selection.</p>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={top}
                dataKey="count"
                nameKey="name"
                outerRadius={95}
                label={(props) => String(props.name ?? "")}
              >
                {top.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
      <section className="panel">
        <h3>Emoji frequency</h3>
        {top.length === 0 ? (
          <p className="muted">No emojis to list.</p>
        ) : (
          <ul className="emoji-list">
            {top.map((emoji) => (
              <li key={emoji.name}>
                <span className="emoji-list__glyph">{emoji.name}</span>
                <span className="emoji-list__count">
                  {emoji.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
