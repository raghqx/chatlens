import type { ChatMessage } from "./types";

const IOS_PATTERN =
  /\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]\s*/g;

const ANDROID_PATTERN =
  /(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\s*-\s*/g;

function parseDateTime(datePart: string, timePart: string): Date | null {
  const dateBits = datePart.split("/").map((part) => Number(part));
  if (dateBits.length !== 3 || dateBits.some((n) => Number.isNaN(n))) {
    return null;
  }

  const first = dateBits[0];
  const second = dateBits[1];
  let year = dateBits[2];
  if (year < 100) year += 2000;

  // Prefer day/month (common WhatsApp export), fall back to month/day when needed.
  let day = first;
  let month = second;
  if (first <= 12 && second > 12) {
    month = first;
    day = second;
  } else if (first > 12 && second <= 12) {
    day = first;
    month = second;
  }

  const normalizedTime = timePart.trim().toUpperCase();
  const ampmMatch = normalizedTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (ampmMatch) {
    hours = Number(ampmMatch[1]);
    minutes = Number(ampmMatch[2]);
    seconds = Number(ampmMatch[3] ?? 0);
    const meridiem = ampmMatch[4];
    if (meridiem === "PM" && hours < 12) hours += 12;
    if (meridiem === "AM" && hours === 12) hours = 0;
  } else {
    const twentyFour = normalizedTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!twentyFour) return null;
    hours = Number(twentyFour[1]);
    minutes = Number(twentyFour[2]);
    seconds = Number(twentyFour[3] ?? 0);
  }

  const parsed = new Date(year, month - 1, day, hours, minutes, seconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function extractMessages(
  data: string,
  pattern: RegExp,
): Array<{ date: Date; body: string }> {
  const matches = [...data.matchAll(pattern)];
  if (matches.length === 0) return [];

  const rows: Array<{ date: Date; body: string }> = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const date = parseDateTime(match[1], match[2]);
    if (!date) continue;

    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? data.length) : data.length;
    const body = data.slice(start, end).replace(/\r?\n$/, "").trim();
    if (!body) continue;
    rows.push({ date, body });
  }

  return rows;
}

function splitUserAndMessage(body: string): {
  user: string;
  message: string;
  isNotification: boolean;
} {
  const separator = body.indexOf(": ");
  if (separator > 0 && separator < 50) {
    const user = body.slice(0, separator).trim();
    const message = body.slice(separator + 2).trim();
    // Avoid treating URLs / times as users.
    if (user && !user.includes("http") && !/^\d+$/.test(user)) {
      return { user, message, isNotification: false };
    }
  }

  return {
    user: "notification",
    message: body,
    isNotification: true,
  };
}

export function parseWhatsAppChat(raw: string): ChatMessage[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

  const iosRows = extractMessages(text, IOS_PATTERN);
  const androidRows = extractMessages(text, ANDROID_PATTERN);
  const rows = iosRows.length >= androidRows.length ? iosRows : androidRows;

  if (rows.length === 0) {
    throw new Error(
      "Could not parse this file. Export the chat from WhatsApp as a .txt file (without media is fine) and try again.",
    );
  }

  return rows.map(({ date, body }) => {
    const { user, message, isNotification } = splitUserAndMessage(body);
    return { date, user, message, isNotification };
  });
}
