export type ChatMessage = {
  date: Date;
  user: string;
  message: string;
  isNotification: boolean;
};

export type ChatStats = {
  totalMessages: number;
  totalWords: number;
  mediaShared: number;
  linksShared: number;
};

export type NamedCount = {
  name: string;
  count: number;
};

export type BusyUser = {
  name: string;
  count: number;
  percent: number;
};

export type AnalysisResult = {
  stats: ChatStats;
  monthlyTimeline: NamedCount[];
  dailyTimeline: NamedCount[];
  busyDays: NamedCount[];
  busyMonths: NamedCount[];
  busyUsers: BusyUser[];
  commonWords: NamedCount[];
  emojis: NamedCount[];
  wordCloud: NamedCount[];
  users: string[];
  dateRange: { start: string; end: string } | null;
};
