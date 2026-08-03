import emojiRegex from "emoji-regex";
import { format } from "date-fns";
import type {
  AnalysisResult,
  BusyUser,
  ChatMessage,
  ChatStats,
  NamedCount,
} from "./types";

const URL_PATTERN = /https?:\/\/[^\s]+|www\.[^\s]+/gi;
const MEDIA_PATTERN =
  /<media omitted>|image omitted|video omitted|audio omitted|sticker omitted|document omitted|gif omitted|Contact card omitted|media omitted/i;

function filterMessages(
  messages: ChatMessage[],
  selectedUser: string,
): ChatMessage[] {
  if (selectedUser === "Overall") {
    return messages.filter((m) => !m.isNotification);
  }
  return messages.filter((m) => m.user === selectedUser && !m.isNotification);
}

function countWords(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => {
    const words = message.message.trim().split(/\s+/).filter(Boolean);
    return total + words.length;
  }, 0);
}

function countMedia(messages: ChatMessage[]): number {
  return messages.filter((m) => MEDIA_PATTERN.test(m.message)).length;
}

function countLinks(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => {
    const matches = message.message.match(URL_PATTERN);
    return total + (matches?.length ?? 0);
  }, 0);
}

function toNamedCounts(
  counter: Map<string, number>,
  limit?: number,
): NamedCount[] {
  const sorted = [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return typeof limit === "number" ? sorted.slice(0, limit) : sorted;
}

function buildStats(messages: ChatMessage[]): ChatStats {
  return {
    totalMessages: messages.length,
    totalWords: countWords(messages),
    mediaShared: countMedia(messages),
    linksShared: countLinks(messages),
  };
}

function buildMonthlyTimeline(messages: ChatMessage[]): NamedCount[] {
  const counter = new Map<string, number>();
  for (const message of messages) {
    const key = format(message.date, "MMM-yyyy");
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }

  return [...messages]
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .reduce<string[]>((months, message) => {
      const key = format(message.date, "MMM-yyyy");
      if (!months.includes(key)) months.push(key);
      return months;
    }, [])
    .map((name) => ({ name, count: counter.get(name) ?? 0 }));
}

function buildDailyTimeline(messages: ChatMessage[]): NamedCount[] {
  const counter = new Map<string, number>();
  for (const message of messages) {
    const key = format(message.date, "yyyy-MM-dd");
    counter.set(key, (counter.get(key) ?? 0) + 1);
  }

  return [...counter.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => ({ name, count }));
}

function buildBusyDays(messages: ChatMessage[]): NamedCount[] {
  const order = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];
  const counter = new Map<string, number>();
  for (const message of messages) {
    const day = format(message.date, "EEEE");
    counter.set(day, (counter.get(day) ?? 0) + 1);
  }
  return order
    .filter((day) => counter.has(day))
    .map((name) => ({ name, count: counter.get(name) ?? 0 }));
}

function buildBusyMonths(messages: ChatMessage[]): NamedCount[] {
  const counter = new Map<string, number>();
  for (const message of messages) {
    const month = format(message.date, "MMMM");
    counter.set(month, (counter.get(month) ?? 0) + 1);
  }
  return toNamedCounts(counter);
}

function buildBusyUsers(allMessages: ChatMessage[]): BusyUser[] {
  const userMessages = allMessages.filter((m) => !m.isNotification);
  const counter = new Map<string, number>();
  for (const message of userMessages) {
    counter.set(message.user, (counter.get(message.user) ?? 0) + 1);
  }

  const total = userMessages.length || 1;
  return toNamedCounts(counter, 8).map(({ name, count }) => ({
    name,
    count,
    percent: Number(((count / total) * 100).toFixed(2)),
  }));
}

function tokenize(
  messages: ChatMessage[],
  stopWords: Set<string>,
): string[] {
  const words: string[] = [];
  for (const message of messages) {
    if (MEDIA_PATTERN.test(message.message)) continue;
    for (const token of message.message.toLowerCase().split(/\s+/)) {
      const cleaned = token.replace(/[^\p{L}\p{N}'’_-]/gu, "");
      if (!cleaned || stopWords.has(cleaned) || cleaned.length < 2) continue;
      if (URL_PATTERN.test(cleaned)) continue;
      words.push(cleaned);
    }
  }
  return words;
}

function buildWordCounts(
  messages: ChatMessage[],
  stopWords: Set<string>,
  limit: number,
): NamedCount[] {
  const counter = new Map<string, number>();
  for (const word of tokenize(messages, stopWords)) {
    counter.set(word, (counter.get(word) ?? 0) + 1);
  }
  return toNamedCounts(counter, limit);
}

function buildEmojis(messages: ChatMessage[]): NamedCount[] {
  const regex = emojiRegex();
  const counter = new Map<string, number>();

  for (const message of messages) {
    const matches = message.message.match(regex);
    if (!matches) continue;
    for (const emoji of matches) {
      counter.set(emoji, (counter.get(emoji) ?? 0) + 1);
    }
  }

  return toNamedCounts(counter, 20);
}

export function analyzeChat(
  messages: ChatMessage[],
  selectedUser: string,
  stopWords: Set<string>,
): AnalysisResult {
  const scoped = filterMessages(messages, selectedUser);
  const users = [
    ...new Set(messages.filter((m) => !m.isNotification).map((m) => m.user)),
  ].sort((a, b) => a.localeCompare(b));

  const sortedByDate = [...messages].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );

  return {
    stats: buildStats(scoped),
    monthlyTimeline: buildMonthlyTimeline(scoped),
    dailyTimeline: buildDailyTimeline(scoped),
    busyDays: buildBusyDays(scoped),
    busyMonths: buildBusyMonths(scoped),
    busyUsers: buildBusyUsers(messages),
    commonWords: buildWordCounts(scoped, stopWords, 20),
    wordCloud: buildWordCounts(scoped, stopWords, 60),
    emojis: buildEmojis(scoped),
    users,
    dateRange:
      sortedByDate.length > 0
        ? {
            start: format(sortedByDate[0].date, "MMM d, yyyy"),
            end: format(sortedByDate[sortedByDate.length - 1].date, "MMM d, yyyy"),
          }
        : null,
  };
}

export async function loadStopWords(): Promise<Set<string>> {
  const response = await fetch("/stop_hinglish.txt");
  if (!response.ok) return new Set();
  const text = await response.text();
  return new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean),
  );
}
