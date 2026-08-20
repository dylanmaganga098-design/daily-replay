import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { format, subMonths } from "date-fns";
import JSZip from "jszip";
import {
  Activity,
  ArrowLeft,
  Download,
  History,
  Loader2,
  Play,
  RotateCcw,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
import { STRATEGIES } from "@/lib/analyzer/strategies";
} from "@/components/ui/select";
import { AVAILABLE_SYMBOLS, TWELVE_DATA_API_KEYS } from "@/lib/market-data";
import { buildOhlcCsv } from "@/lib/ohlc-generator";
import {
  analyseDay,
  applyTriggers,
  buildDayReport,
  clearState,
  dayFileName,
  loadState,
  saveState,
  tradingDays,
  winRate,
  type BacktestState,
  type DayTrigger,
} from "@/lib/backtest/engine";

/** Month-long CSV window ending on the analysed day. */
function windowStartFor(day: string): string {
  return format(subMonths(new Date(`${day}T00:00:00Z`), 1), "yyyy-MM-dd");
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
  if (inIframe()) window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export default function Backtest() {
  const [symbol, setSymbol] = useState("XAU/USD");
  const [fromDate, setFromDate] = useState(
    format(subMonths(new Date(), 1), "yyyy-MM-dd"),
  );
  const [toDate, setToDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [checkpoint, setCheckpoint] = useState("11:45");
  

  const [isRunning, setIsRunning] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);
  const [currentDay, setCurrentDay] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [state, setState] = useState<BacktestState>(() => loadState("XAU/USD"));
  const [dayFiles, setDayFiles] = useState<{ name: string; content: string }[]>([]);

  const stopRef = useRef(false);
  const keyIndexRef = useRef(0);

  useEffect(() => {
    setState(loadState(symbol));
  }, [symbol]);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev.slice(-400), `${new Date().toLocaleTimeString()}  ${msg}`]);
  };

  const plannedDays = useMemo(() => {
    const days = tradingDays(fromDate, toDate);
    if (!state.lastCompletedDay) return days;
    return days.filter((day) => day > state.lastCompletedDay!);
  }, [fromDate, toDate, state.lastCompletedDay]);

  const statsRows = useMemo(
    () => Object.values(state.stats).sort((a, b) => a.strategy.localeCompare(b.strategy)),
    [state.stats],
  );

  const handleStop = () => {
    stopRef.current = true;
    addLog("⏹ Stop requested — finishing the current day, then halting.");
  };

  const handleReset = () => {
    clearState(symbol);
    setState(loadState(symbol));
    setDayFiles([]);
    addLog(`♻️ Cleared saved progress for ${symbol}. Next run starts from the From date.`);
  };

  const handleRun = async () => {
    if (isRunning) return;
    const days = tradingDays(fromDate, toDate);
    if (days.length === 0) {
      toast.error("No trading days in that range (weekends are skipped).");
      return;
    }

    stopRef.current = false;
    setIsRunning(true);
    setLogs([]);

    // Resume point: whatever day was last completed, continue from the next one.
    const working: BacktestState = { ...loadState(symbol), symbol };
    working.skipped = [...working.skipped];
    working.days = [...working.days];
    working.stats = { ...working.stats };

    const queue = working.lastCompletedDay
      ? days.filter((day) => day > working.lastCompletedDay!)
      : days;

    if (queue.length === 0) {
      addLog(`✅ Nothing to do — ${working.lastCompletedDay} already covers this range.`);
      setIsRunning(false);
      return;
    }

    addLog(`🚀 Auto-Backtest ${symbol} | ${queue[0]} → ${queue[queue.length - 1]}`);
    addLog(`⏰ Time checkpoint: ${checkpoint} EAT | window: 1 month of 30M candles per day`);
    if (working.lastCompletedDay) {
      addLog(`↩️ Resuming after last completed day ${working.lastCompletedDay}`);
    }

    const collected: { name: string; content: string }[] = [];

    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) {
        addLog("⏹ Run halted by user.");
        break;
      }

      const day = queue[i];
      setCurrentDay(day);
      const windowStart = windowStartFor(day);
      addLog(`\n📅 ${day} (${i + 1}/${queue.length}) — pulling ${windowStart} → ${day} ${checkpoint}`);

      let skipReason: string | undefined;
      let triggers: DayTrigger[] = [];
      let analyzedRows = 0;
      let invalidRows = 0;
      let lastRowDatetime = "-";

      try {
        const csv = await buildOhlcCsv({
          symbol,
          startDate: windowStart,
          endDate: day,
          specifyTime: true,
          startTime: "00:00",
          endTime: checkpoint,
          apiKeys: TWELVE_DATA_API_KEYS,
          keyIndexRef,
          log: addLog,
          setCooldown: setCooldownSeconds,
        });

        if (!csv) {
          skipReason = "no usable OHLC data returned for this window (missing or bad data)";
        } else {
          // Local structure engine only — nothing is sent to Gemini here.
          const outcome = analyseDay(csv, day);
          if (!outcome.ok) {
            skipReason = `analysis rejected the data: ${outcome.error}`;
          } else {
            triggers = outcome.triggers;
            analyzedRows = outcome.analyzedRows;
            invalidRows = outcome.invalidRows;
            lastRowDatetime = outcome.lastRowDatetime;
          }
        }
      } catch (error) {
        skipReason = `data pull/analysis failed: ${String(error)}`;
      }

      if (skipReason) {
        working.skipped.push({ day, reason: skipReason });
        addLog(`⚠️ ${day} skipped — ${skipReason}`);
      } else {
        applyTriggers(working, triggers);
        addLog(`✅ ${day}: ${triggers.length} new trigger(s) from ${analyzedRows} candles`);
      }

      working.firstDay = working.firstDay ?? day;
      working.days.push(day);
      working.lastCompletedDay = day;
      saveState(working);
      setState({ ...working, stats: { ...working.stats } });

      const report = buildDayReport({
        symbol,
        day,
        checkpoint,
        windowStart,
        state: working,
        triggers,
        skipReason,
        analyzedRows,
        invalidRows,
        lastRowDatetime,
      });
      const fileName = dayFileName(day);
      // Files are collected only — the whole run downloads once, as a single ZIP.
      collected.push({ name: fileName, content: report });
      setDayFiles((prev) => [{ name: fileName, content: report }, ...prev]);
    }

    setCurrentDay(null);
    setCooldownSeconds(null);
    setIsRunning(false);

    if (collected.length > 0) {
      try {
        const zip = new JSZip();
        for (const file of collected) zip.file(file.name, file.content);
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(
          blob,
          `backtest_${symbol.replace("/", "")}_${collected[0].name.slice(9, 19)}_to_${collected[collected.length - 1].name.slice(9, 19)}.zip`,
        );
        addLog(`📦 Bundled ${collected.length} day file(s) into a ZIP.`);
      } catch (error) {
        addLog(`⚠️ ZIP packaging failed: ${String(error)}`);
      }
      toast.success(`Backtest finished — ${collected.length} day file(s) downloaded`);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-white/5 bg-black/95 backdrop-blur-xl">
        <div className="container mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded bg-primary">
              <History size={16} strokeWidth={2.5} className="text-primary-foreground" />
            </div>
            <span className="text-base font-black tracking-tight">Auto-Backtester</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/"
              className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/20"
            >
              <ArrowLeft size={12} /> Data fetcher
            </Link>
            {cooldownSeconds !== null && (
              <Badge variant="outline" className="font-mono text-[11px]">
                cooldown {cooldownSeconds}s
              </Badge>
            )}
          </div>
        </div>
      </header>

      <main className="container mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[380px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run settings</CardTitle>
            <CardDescription className="text-xs">
              One month of 30M candles per day, analysed locally by the structure engine — no AI
              call. The window advances one day at a time; weekends are skipped automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[11px] uppercase tracking-wide">Symbol</Label>
              <Select value={symbol} onValueChange={setSymbol} disabled={isRunning}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {AVAILABLE_SYMBOLS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from" className="text-[11px] uppercase tracking-wide">
                  From
                </Label>
                <Input
                  id="from"
                  type="date"
                  value={fromDate}
                  disabled={isRunning}
                  onChange={(event) => setFromDate(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to" className="text-[11px] uppercase tracking-wide">
                  To
                </Label>
                <Input
                  id="to"
                  type="date"
                  value={toDate}
                  disabled={isRunning}
                  onChange={(event) => setToDate(event.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="checkpoint" className="text-[11px] uppercase tracking-wide">
                  Last OHLC time (EAT)
                </Label>
                <Input
                  id="checkpoint"
                  type="time"
                  value={checkpoint}
                  disabled={isRunning}
                  onChange={(event) => setCheckpoint(event.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-[11px] uppercase tracking-wide">Strategies</Label>
                <div className="flex h-9 items-center rounded-md border border-border/60 bg-muted/30 px-3 font-mono text-xs text-muted-foreground">
                  {STRATEGIES.length} saved strategies
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-[11px] text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Trading days queued</span>
                <span className="font-mono text-foreground">{plannedDays.length}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Last completed day</span>
                <span className="font-mono text-foreground">
                  {state.lastCompletedDay ?? "none"}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span>Days skipped</span>
                <span className="font-mono text-foreground">{state.skipped.length}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleRun} disabled={isRunning} className="flex-1">
                {isRunning ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Running{" "}
                    {currentDay ? currentDay : ""}
                  </>
                ) : (
                  <>
                    <Play size={14} /> Run backtest
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleStop} disabled={!isRunning}>
                <Square size={14} /> Stop
              </Button>
              <Button variant="ghost" onClick={handleReset} disabled={isRunning}>
                <RotateCcw size={14} /> Reset progress
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Rolling cumulative stats {state.firstDay ? `since ${state.firstDay}` : ""}
              </CardTitle>
              <CardDescription className="text-xs">
                Win rate = TP hit / (TP hit + SL hit), resolved trades only.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {statsRows.length === 0 ? (
                <p className="text-xs text-muted-foreground">No triggers recorded yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="py-1.5 pr-3">Strategy</th>
                        <th className="py-1.5 pr-3">Triggers</th>
                        <th className="py-1.5 pr-3">TP</th>
                        <th className="py-1.5 pr-3">SL</th>
                        <th className="py-1.5 pr-3">Open</th>
                        <th className="py-1.5">Win rate</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {statsRows.map((row) => {
                        const rate = winRate(row);
                        return (
                          <tr key={row.strategyId} className="border-t border-border/40">
                            <td className="py-1.5 pr-3 font-sans">{row.strategy}</td>
                            <td className="py-1.5 pr-3">{row.triggers}</td>
                            <td className="py-1.5 pr-3 text-emerald-500">{row.tpHits}</td>
                            <td className="py-1.5 pr-3 text-destructive">{row.slHits}</td>
                            <td className="py-1.5 pr-3">{row.open}</td>
                            <td className="py-1.5">
                              {rate === null ? "n/a" : `${rate.toFixed(1)}%`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Run log</CardTitle>
                <CardDescription className="text-xs">
                  Every day writes backtest_YYYY-MM-DD.txt and downloads automatically.
                </CardDescription>
              </div>
              <Activity size={16} className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-64 rounded-lg border border-border/60 bg-muted/20 p-3">
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {logs.length === 0 ? "Idle — configure the range and press Run backtest." : logs.join("\n")}
                </pre>
              </ScrollArea>
            </CardContent>
          </Card>

          {dayFiles.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Day files ({dayFiles.length})</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                {dayFiles.map((file) => (
                  <button
                    key={file.name}
                    onClick={() =>
                      downloadBlob(
                        new Blob([file.content], { type: "text/plain;charset=utf-8" }),
                        file.name,
                      )
                    }
                    className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-left text-xs transition-colors hover:border-primary/40"
                  >
                    <span className="font-mono">{file.name}</span>
                    <Download size={12} className="text-muted-foreground" />
                  </button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}
