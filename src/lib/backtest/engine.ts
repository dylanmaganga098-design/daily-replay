import { runAnalysis } from "@/lib/analyzer/run";
import type { ResultRow } from "@/lib/analyzer/types";

export type TriggerOutcome = "TP" | "SL" | "OPEN";

export interface DayTrigger {
  strategyId: string;
  strategy: string;
  datetime: string;
  side: string;
  entry: number | undefined;
  sl: number | undefined;
  tp: number | undefined;
  rr: number | undefined;
  reason: string;
  setupStatus: string;
  statusNote: string;
  outcome: TriggerOutcome;
}

export interface StrategyStats {
  strategyId: string;
  strategy: string;
  triggers: number;
  tpHits: number;
  slHits: number;
  open: number;
}

/** Cumulative state that survives across days (and across runs). */
export interface BacktestState {
  symbol: string;
  firstDay: string | null;
  lastCompletedDay: string | null;
  days: string[];
  skipped: { day: string; reason: string }[];
  stats: Record<string, StrategyStats>;
}

export const STORAGE_KEY = "forexlens.backtest.state";

export function emptyState(symbol: string): BacktestState {
  return {
    symbol,
    firstDay: null,
    lastCompletedDay: null,
    days: [],
    skipped: [],
    stats: {},
  };
}

export function loadState(symbol: string): BacktestState {
  if (typeof window === "undefined") return emptyState(symbol);
  try {
    const raw = window.localStorage.getItem(`${STORAGE_KEY}.${symbol}`);
    if (!raw) return emptyState(symbol);
    const parsed = JSON.parse(raw) as BacktestState;
    if (!parsed || parsed.symbol !== symbol) return emptyState(symbol);
    return { ...emptyState(symbol), ...parsed };
  } catch {
    return emptyState(symbol);
  }
}

export function saveState(state: BacktestState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_KEY}.${state.symbol}`, JSON.stringify(state));
  } catch {
    // quota exceeded — the in-memory state still drives the current run
  }
}

export function clearState(symbol: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${STORAGE_KEY}.${symbol}`);
  } catch {
    // ignore
  }
}

/** yyyy-MM-dd helpers that never touch local timezone drift. */
export function toDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dayDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00Z`);
}

export function addUtcDays(dayKey: string, days: number): string {
  const date = dayDate(dayKey);
  date.setUTCDate(date.getUTCDate() + days);
  return toDayKey(date);
}

export function isWeekend(dayKey: string): boolean {
  const weekday = dayDate(dayKey).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Every calendar day in the inclusive range, weekends already removed. */
export function tradingDays(fromDay: string, toDay: string): string[] {
  const days: string[] = [];
  if (dayDate(fromDay) > dayDate(toDay)) return days;
  let current = fromDay;
  while (dayDate(current) <= dayDate(toDay)) {
    if (!isWeekend(current)) days.push(current);
    current = addUtcDays(current, 1);
  }
  return days;
}

function outcomeOf(row: ResultRow): TriggerOutcome {
  const note = row.statusNote ?? "";
  if (note.includes("TP hit")) return "TP";
  if (note.includes("SL hit") || note.includes("SL broken before fill")) return "SL";
  return "OPEN";
}

export interface DayAnalysisResult {
  ok: true;
  triggers: DayTrigger[];
  analyzedRows: number;
  invalidRows: number;
  lastRowDatetime: string;
}

export interface DayAnalysisFailure {
  ok: false;
  error: string;
}

/**
 * Analyse a month-long CSV window locally (no AI call at all) and keep only the
 * triggers that are new on `day`.
 */
export function analyseDay(csv: string, day: string): DayAnalysisResult | DayAnalysisFailure {
  const outcome = runAnalysis(csv);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  const { analysis } = outcome;
  const triggers: DayTrigger[] = analysis.passing
    .filter((row) => row.datetime.startsWith(day))
    .sort((a, b) => a.datetime.localeCompare(b.datetime) || a.strategy.localeCompare(b.strategy))
    .map((row) => ({
      strategyId: row.strategyId,
      strategy: row.strategy,
      datetime: row.datetime,
      side: row.side ?? "-",
      entry: row.entry,
      sl: row.sl,
      tp: row.tp,
      rr: row.rr,
      reason: row.reason,
      setupStatus: row.setupStatus ?? "-",
      statusNote: row.statusNote ?? "",
      outcome: outcomeOf(row),
    }));

  return {
    ok: true,
    triggers,
    analyzedRows: analysis.analyzedRows,
    invalidRows: analysis.invalidRows,
    lastRowDatetime: analysis.lastRowDatetime,
  };
}

/** Fold a day's triggers into the rolling per-strategy totals. */
export function applyTriggers(state: BacktestState, triggers: DayTrigger[]) {
  for (const trigger of triggers) {
    const existing =
      state.stats[trigger.strategyId] ??
      ({
        strategyId: trigger.strategyId,
        strategy: trigger.strategy,
        triggers: 0,
        tpHits: 0,
        slHits: 0,
        open: 0,
      } satisfies StrategyStats);
    existing.triggers += 1;
    if (trigger.outcome === "TP") existing.tpHits += 1;
    else if (trigger.outcome === "SL") existing.slHits += 1;
    else existing.open += 1;
    state.stats[trigger.strategyId] = existing;
  }
}

export function winRate(stats: StrategyStats): number | null {
  const resolved = stats.tpHits + stats.slHits;
  return resolved === 0 ? null : (stats.tpHits / resolved) * 100;
}

function num(value: number | undefined): string {
  return value === undefined ? "-" : String(Number(value.toFixed(5)));
}

export interface DayReportInput {
  symbol: string;
  day: string;
  checkpoint: string;
  windowStart: string;
  state: BacktestState;
  triggers: DayTrigger[];
  skipReason?: string | undefined;
  analyzedRows?: number | undefined;
  invalidRows?: number | undefined;
  lastRowDatetime?: string | undefined;
}

/** One self-contained file per day: new triggers plus cumulative trend stats. */
export function buildDayReport(input: DayReportInput): string {
  const { symbol, day, checkpoint, windowStart, state, triggers, skipReason } = input;
  const lines: string[] = [];

  lines.push("=== AUTO-BACKTEST DAY REPORT ===");
  lines.push(`symbol: ${symbol}`);
  lines.push(`day: ${day}`);
  lines.push(`time_checkpoint (EAT): ${checkpoint}`);
  lines.push(`csv_window: ${windowStart} 00:00 -> ${day} ${checkpoint}`);
  lines.push(`analysis_mode: local structure engine only (no AI/Gemini call)`);
  lines.push(`generated_at: ${new Date().toISOString()}`);
  lines.push("");

  if (skipReason) {
    lines.push("=== DAY SKIPPED ===");
    lines.push(`status: SKIPPED`);
    lines.push(`reason: ${skipReason}`);
    lines.push("The run continued to the next day; no triggers were recorded for this date.");
  } else {
    lines.push("=== DAY DATA ===");
    lines.push(`analyzed candles: ${input.analyzedRows ?? 0}`);
    lines.push(`invalid/skipped rows: ${input.invalidRows ?? 0}`);
    lines.push(`last candle in window: ${input.lastRowDatetime ?? "-"}`);
    lines.push("");
    lines.push(`=== NEW TRIGGERS ON ${day} (${triggers.length}) ===`);
    if (triggers.length === 0) {
      lines.push("none — no strategy triggered on this day up to the checkpoint");
    }
    triggers.forEach((trigger, index) => {
      lines.push(
        `${index + 1}. ${trigger.strategy} @ ${trigger.datetime} | ${trigger.side} | entry ${num(trigger.entry)} | SL ${num(trigger.sl)} | TP ${num(trigger.tp)} | RR ${trigger.rr === undefined ? "-" : trigger.rr.toFixed(2)} | outcome ${trigger.outcome} | status ${trigger.setupStatus}`,
      );
      lines.push(`    reason: ${trigger.reason}`);
      if (trigger.statusNote) lines.push(`    note: ${trigger.statusNote}`);
    });
  }

  lines.push("");
  lines.push("=== ROLLING CUMULATIVE STATS PER STRATEGY ===");
  lines.push(`since first backtest day: ${state.firstDay ?? day}`);
  lines.push(`days completed (incl. this one): ${state.days.length}`);
  lines.push("strategy | total triggers | TP hits | SL hits | still open | win rate");
  const rows = Object.values(state.stats).sort((a, b) => a.strategy.localeCompare(b.strategy));
  if (rows.length === 0) lines.push("no triggers recorded yet");
  for (const stats of rows) {
    const rate = winRate(stats);
    lines.push(
      `${stats.strategy} | ${stats.triggers} | ${stats.tpHits} | ${stats.slHits} | ${stats.open} | ${rate === null ? "n/a (no resolved trades)" : `${rate.toFixed(1)}%`}`,
    );
  }

  const totals = rows.reduce(
    (acc, stats) => ({
      triggers: acc.triggers + stats.triggers,
      tpHits: acc.tpHits + stats.tpHits,
      slHits: acc.slHits + stats.slHits,
      open: acc.open + stats.open,
    }),
    { triggers: 0, tpHits: 0, slHits: 0, open: 0 },
  );
  const totalResolved = totals.tpHits + totals.slHits;
  lines.push("");
  lines.push(
    `ALL STRATEGIES | ${totals.triggers} | ${totals.tpHits} | ${totals.slHits} | ${totals.open} | ${totalResolved === 0 ? "n/a" : `${((totals.tpHits / totalResolved) * 100).toFixed(1)}%`}`,
  );

  if (state.skipped.length > 0) {
    lines.push("");
    lines.push("=== SKIPPED DAYS SO FAR ===");
    for (const skip of state.skipped) lines.push(`${skip.day}: ${skip.reason}`);
  }

  lines.push("");
  lines.push(`win_rate_definition: TP hit / (TP hit + SL hit), resolved trades only.`);
  lines.push(`weekend_policy: Saturdays and Sundays are skipped automatically — no data expected.`);

  return lines.join("\n");
}

export function dayFileName(day: string): string {
  return `backtest_${day}.txt`;
}
