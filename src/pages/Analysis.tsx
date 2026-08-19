import { useMemo, useRef, useState, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  Brain,
  Download,
  Loader2,
  Play,
  Sparkles,
  FileText,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SUMMARY_FIELDS,
  useAnalysisSnapshot,
  type AnalysisSnapshot,
} from "@/lib/analysis-store";

type Message = {
  id: string;
  model: "gemini" | "gpt" | "summary";
  text: string;
  verdict?: "AGREE" | "REVISE";
};

type CitationEntry = {
  timestamp: string;
  quoted: string;
  problems: string[];
  values: { field: string; cited: number; actual: number | null }[];
};

type CitationReport = {
  model: "gemini" | "gpt";
  total: number;
  valid: CitationEntry[];
  invalid: CitationEntry[];
};

type LogLine = { level: "info" | "warn" | "error"; message: string; at: string };

const MODEL_LABEL: Record<Message["model"], string> = {
  gemini: "Gemini",
  gpt: "ChatGPT",
  summary: "Final Summary",
};

export default function Analysis() {
  const snapshot = useAnalysisSnapshot();
  const [summaryFields, setSummaryFields] = useState(DEFAULT_SUMMARY_FIELDS);
  const [messages, setMessages] = useState<Message[]>([]);
  const [statusLines, setStatusLines] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [reports, setReports] = useState<CitationReport[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [finalStatus, setFinalStatus] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const ready = Boolean(snapshot && (snapshot.charts.length > 0 || snapshot.ohlcCsv));

  const transcript = useMemo(
    () =>
      messages
        .map(
          (m) =>
            `===== ${MODEL_LABEL[m.model]} =====\n${m.text.trim()}\n`,
        )
        .join("\n"),
    [messages],
  );

  const run = async () => {
    if (!snapshot || isRunning) return;
    setMessages([]);
    setStatusLines([]);
    setSummary(null);
    setReports([]);
    setLogs([]);
    setFinalStatus(null);
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          symbol: snapshot.symbol,
          range: snapshot.range,
          ohlcCsv: snapshot.ohlcCsv,
          charts: snapshot.charts,
          summaryFields,
        }),
      });

      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `Request failed (${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }

          if (event.type === "turn-start" || event.type === "summary-start") {
            const model: Message["model"] =
              event.type === "summary-start" ? "summary" : event.model;
            setMessages((prev) => [
              ...prev,
              {
                id: `${model}-${prev.length}`,
                model,
                text: "",
              },
            ]);
          } else if (event.type === "delta") {
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const last = { ...(next[next.length - 1] as Message) };
              last.text += event.text;
              next[next.length - 1] = last;
              return next;
            });
          } else if (event.type === "turn-end") {
            setMessages((prev) => {
              if (prev.length === 0) return prev;
              const next = [...prev];
              const last = { ...(next[next.length - 1] as Message) };
              last.verdict = event.verdict;
              next[next.length - 1] = last;
              return next;
            });
          } else if (event.type === "citations") {
            setReports((prev) => [
              ...prev,
              {
                model: event.model,
                total: event.total,
                valid: event.valid ?? [],
                invalid: event.invalid ?? [],
              },
            ]);
          } else if (event.type === "log") {
            const line: LogLine = {
              level: event.level ?? "info",
              message: event.message,
              at: event.at ?? new Date().toISOString(),
            };
            setLogs((prev) => [...prev, line]);
            if (line.level === "warn") console.warn("[analysis]", line.message);
            else if (line.level === "error") console.error("[analysis]", line.message);
            else console.info("[analysis]", line.message);
          } else if (event.type === "final-status") {
            setFinalStatus(event.status);
          } else if (event.type === "status") {
            setStatusLines((prev) => [...prev, event.message]);
          } else if (event.type === "summary") {
            setSummary(event.text);
          } else if (event.type === "error") {
            toast.error(event.message);
            setStatusLines((prev) => [...prev, `Error: ${event.message}`]);
          } else if (event.type === "done") {
            setFinalStatus(event.status ?? null);
            if (event.status === "AGREE") toast.success("Models agreed — citations verified.");
            else toast.warning(`Finished as ${event.status ?? "NO_SIGNAL"}.`);
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        toast.error((error as Error).message);
      }
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setIsRunning(false);
  };

  const downloadTxt = (snap: AnalysisSnapshot) => {
    if (!summary) {
      toast.error("No summary yet");
      return;
    }
    const base = snap.symbol.replace("/", "");
    const blob = new Blob([summary], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${base}_analysis_summary.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success("Summary downloaded");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col font-sans">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/95 backdrop-blur-xl">
        <div className="container mx-auto px-6 h-14 flex items-center justify-between max-w-7xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <Brain size={16} strokeWidth={2.5} className="text-white" />
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className="text-base font-black tracking-tight text-white">
                Analysis
              </span>
              <span className="text-[10px] font-mono text-white/30 tracking-[0.2em] uppercase">
                Dual-Model
              </span>
            </div>
          </div>
          <Link
            to="/"
            className="flex items-center gap-1.5 text-[11px] font-mono text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={12} /> Data Fetcher
          </Link>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-5 max-w-7xl">
        <aside className="lg:col-span-4 space-y-3">
          <div className="rounded-xl border border-white/6 bg-[#0d0608] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 bg-primary/8">
              <h2 className="text-base font-black text-white tracking-tight leading-none">
                Input Data
              </h2>
              <p className="text-[11px] text-white/35 mt-1 font-mono">
                From the last generation
              </p>
            </div>
            <div className="p-5 space-y-2 text-[12px] font-mono text-white/60">
              {snapshot ? (
                <>
                  <p>
                    <span className="text-white/30">Symbol:</span>{" "}
                    <span className="text-primary">{snapshot.symbol}</span>
                  </p>
                  <p>
                    <span className="text-white/30">Range:</span> {snapshot.range || "—"}
                  </p>
                  <p>
                    <span className="text-white/30">Charts:</span>{" "}
                    {snapshot.charts.length > 0
                      ? snapshot.charts.map((c) => c.timeframe.toUpperCase()).join(", ")
                      : "none"}
                  </p>
                  <p>
                    <span className="text-white/30">OHLC CSV:</span>{" "}
                    {snapshot.ohlcCsv
                      ? `${snapshot.ohlcCsv.split("\n").length - 1} rows`
                      : "none"}
                  </p>
                  <p className="text-white/25">Captured {snapshot.createdAt}</p>
                </>
              ) : (
                <p className="text-white/40">
                  No data yet. Go to the Data Fetcher, run{" "}
                  <span className="text-primary">Generate</span>, then come back.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-white/6 bg-[#0d0608] p-5 space-y-4">
            <div className="space-y-2">
              <p className="text-[10px] font-bold text-white/35 uppercase tracking-[0.15em]">
                Summary Fields
              </p>
              <Textarea
                value={summaryFields}
                onChange={(e) => setSummaryFields(e.target.value)}
                spellCheck={false}
                className="bg-black/60 border-white/10 font-mono text-[11px] leading-relaxed rounded-lg text-white min-h-[280px]"
              />
            </div>

            <Button
              onClick={isRunning ? stop : run}
              disabled={!ready && !isRunning}
              className="w-full h-11 font-bold"
            >
              {isRunning ? (
                <>
                  <Loader2 size={15} className="animate-spin mr-2" /> Stop
                </>
              ) : (
                <>
                  <Play size={15} className="mr-2" /> Run Analysis
                </>
              )}
            </Button>

            <Button
              variant="outline"
              disabled={!summary || !snapshot}
              onClick={() => snapshot && downloadTxt(snapshot)}
              className="w-full h-11 font-bold border-white/10"
            >
              <Download size={15} className="mr-2" /> Download .txt
            </Button>
          </div>
        </aside>

        <section className="lg:col-span-8 space-y-3">
          <div className="rounded-xl border border-white/6 bg-[#0d0608] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 bg-primary/5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black text-white tracking-tight leading-none">
                  Model Debate
                </h2>
                <p className="text-[11px] text-white/35 mt-1 font-mono">
                  Gemini ↔ ChatGPT · refining until agreement
                </p>
              </div>
              <Sparkles size={16} className="text-primary/70" />
            </div>
            <div ref={scrollRef} className="h-[520px] overflow-y-auto">
              <div className="p-5 space-y-4">
                {messages.length === 0 && (
                  <p className="text-[12px] font-mono text-white/30">
                    The debate transcript will stream here.
                  </p>
                )}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "rounded-lg border p-4",
                      message.model === "gemini"
                        ? "border-sky-500/20 bg-sky-500/5"
                        : message.model === "gpt"
                          ? "border-emerald-500/20 bg-emerald-500/5"
                          : "border-primary/30 bg-primary/8",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/60">
                        {MODEL_LABEL[message.model]}
                      </span>
                      {message.verdict && (
                        <span
                          className={cn(
                            "text-[10px] font-mono px-2 py-0.5 rounded",
                            message.verdict === "AGREE"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : "bg-amber-500/15 text-amber-400",
                          )}
                        >
                          {message.verdict}
                        </span>
                      )}
                    </div>
                    <pre className="whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-white/75">
                      {message.text || "…"}
                    </pre>
                  </div>
                ))}
                {statusLines.map((line, i) => (
                  <p key={i} className="text-[11px] font-mono text-white/35">
                    · {line}
                  </p>
                ))}
              </div>
            </div>
          </div>

          {(reports.length > 0 || finalStatus) && (
            <div className="rounded-xl border border-white/6 bg-[#0d0608] overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5 bg-primary/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={15} className="text-primary" />
                  <h2 className="text-base font-black text-white tracking-tight">
                    Citation Verification
                  </h2>
                </div>
                {finalStatus && (
                  <span
                    className={cn(
                      "text-[10px] font-mono px-2 py-0.5 rounded",
                      finalStatus === "AGREE"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400",
                    )}
                  >
                    {finalStatus}
                  </span>
                )}
              </div>
              <div className="p-5 space-y-3 max-h-[300px] overflow-y-auto font-mono text-[11px]">
                {reports.map((report, index) => (
                  <div key={index} className="space-y-1">
                    <p className="text-white/60">
                      {report.model === "gemini" ? "Gemini" : "ChatGPT"} ·{" "}
                      <span className="text-emerald-400">{report.valid.length} valid</span> ·{" "}
                      <span className="text-rose-400">{report.invalid.length} invalid</span> of{" "}
                      {report.total}
                    </p>
                    {report.invalid.map((entry, i) => (
                      <p key={i} className="text-rose-300/80 pl-3">
                        ✕ {entry.timestamp} — {entry.problems.join("; ")}
                      </p>
                    ))}
                    {report.valid.slice(0, 6).map((entry, i) => (
                      <p key={`v-${i}`} className="text-emerald-300/60 pl-3">
                        ✓ {entry.timestamp}
                        {entry.values.length
                          ? ` (${entry.values.map((v) => `${v.field}=${v.cited}`).join(", ")})`
                          : ""}
                      </p>
                    ))}
                  </div>
                ))}
                {reports.length === 0 && (
                  <p className="text-white/30">No citations checked yet.</p>
                )}
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div className="rounded-xl border border-white/6 bg-black/60 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/5 flex items-center gap-2">
                <Terminal size={14} className="text-white/50" />
                <h2 className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/50">
                  Console
                </h2>
              </div>
              <div className="p-4 space-y-1 max-h-[220px] overflow-y-auto font-mono text-[10.5px]">
                {logs.map((line, i) => (
                  <p
                    key={i}
                    className={cn(
                      line.level === "error"
                        ? "text-rose-400"
                        : line.level === "warn"
                          ? "text-amber-400"
                          : "text-white/45",
                    )}
                  >
                    [{line.at.slice(11, 19)}] {line.level.toUpperCase()} · {line.message}
                  </p>
                ))}
              </div>
            </div>
          )}


          {summary && (
            <div className="rounded-xl border border-primary/25 bg-[#0d0608] overflow-hidden">
              <div className="px-5 py-4 border-b border-white/5 bg-primary/8 flex items-center gap-2">
                <FileText size={15} className="text-primary" />
                <h2 className="text-base font-black text-white tracking-tight">
                  Final Summary
                </h2>
              </div>
              <pre className="p-5 whitespace-pre-wrap font-mono text-[11.5px] leading-relaxed text-white/80">
                {summary}
              </pre>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
