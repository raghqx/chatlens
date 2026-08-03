"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { analyzeChat, loadStopWords } from "@/lib/analyze";
import { parseWhatsAppChat } from "@/lib/parseChat";
import type { AnalysisResult, ChatMessage } from "@/lib/types";
import {
  ActivityCharts,
  BusyUsersChart,
  CommonWordsChart,
  DailyTimelineChart,
  EmojiChart,
  MonthlyTimelineChart,
} from "./Charts";
import { StatStrip } from "./StatStrip";
import { WordCloud } from "./WordCloud";

type AnalyzerProps = {
  onAnalyzed?: (active: boolean) => void;
};

export function Analyzer({ onAnalyzed }: AnalyzerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedUser, setSelectedUser] = useState("Overall");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [stopWords, setStopWords] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    loadStopWords()
      .then((words) => {
        if (!cancelled) setStopWords(words);
      })
      .catch(() => {
        if (!cancelled) setStopWords(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    onAnalyzed?.(Boolean(analysis));
  }, [analysis, onAnalyzed]);

  const users = useMemo(() => {
    if (!messages.length) return ["Overall"];
    const names = [
      ...new Set(messages.filter((m) => !m.isNotification).map((m) => m.user)),
    ].sort((a, b) => a.localeCompare(b));
    return ["Overall", ...names];
  }, [messages]);

  function runAnalysis(nextMessages: ChatMessage[], user: string) {
    startTransition(() => {
      const result = analyzeChat(nextMessages, user, stopWords);
      setAnalysis(result);
    });
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setAnalysis(null);
    setFileName(file.name);

    try {
      const text = await file.text();
      const parsed = parseWhatsAppChat(text);
      setMessages(parsed);
      setSelectedUser("Overall");
      runAnalysis(parsed, "Overall");
    } catch (err) {
      setMessages([]);
      setAnalysis(null);
      setError(err instanceof Error ? err.message : "Failed to read chat file.");
    }
  }

  async function loadSample() {
    setError(null);
    setAnalysis(null);
    try {
      const response = await fetch("/sample-chat.txt");
      if (!response.ok) throw new Error("Sample chat could not be loaded.");
      const text = await response.text();
      const parsed = parseWhatsAppChat(text);
      setFileName("sample-chat.txt");
      setMessages(parsed);
      setSelectedUser("Overall");
      runAnalysis(parsed, "Overall");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sample.");
    }
  }

  function onUserChange(user: string) {
    setSelectedUser(user);
    if (messages.length) runAnalysis(messages, user);
  }

  return (
    <div className="analyzer">
      <section className="upload-panel" id="analyze">
        <div className="upload-panel__copy">
          <h2>Upload a WhatsApp export</h2>
          <p>
            Drop a `.txt` chat export. Analysis runs in your browser — nothing is
            uploaded to a server.
          </p>
        </div>

        <label className="file-drop">
          <input
            type="file"
            accept=".txt,text/plain"
            onChange={(event) => handleFile(event.target.files?.[0] ?? null)}
          />
          <span className="file-drop__title">
            {fileName ? fileName : "Choose chat file"}
          </span>
          <span className="file-drop__hint">WhatsApp → Chat info → Export chat</span>
        </label>

        <div className="upload-actions">
          <button type="button" className="button button--ghost" onClick={loadSample}>
            Try sample chat
          </button>
          {users.length > 1 && (
            <label className="user-select">
              <span>Filter by person</span>
              <select
                value={selectedUser}
                onChange={(event) => onUserChange(event.target.value)}
              >
                {users.map((user) => (
                  <option key={user} value={user}>
                    {user}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && <p className="error">{error}</p>}
        {isPending && <p className="muted">Crunching messages…</p>}
      </section>

      {analysis && (
        <div className="results">
          <header className="results__header">
            <div>
              <p className="eyebrow">Analysis</p>
              <h2>
                {selectedUser === "Overall" ? "Full chat" : selectedUser}
              </h2>
              {analysis.dateRange && (
                <p className="muted">
                  {analysis.dateRange.start} → {analysis.dateRange.end} ·{" "}
                  {analysis.users.length} participants
                </p>
              )}
            </div>
          </header>

          <StatStrip stats={analysis.stats} />
          <MonthlyTimelineChart data={analysis.monthlyTimeline} />
          <DailyTimelineChart data={analysis.dailyTimeline} />
          <ActivityCharts
            busyDays={analysis.busyDays}
            busyMonths={analysis.busyMonths}
          />
          {selectedUser === "Overall" && (
            <BusyUsersChart data={analysis.busyUsers} />
          )}
          <section className="panel">
            <h3>Word cloud</h3>
            <WordCloud words={analysis.wordCloud} />
          </section>
          <CommonWordsChart data={analysis.commonWords} />
          <EmojiChart data={analysis.emojis} />
        </div>
      )}
    </div>
  );
}
