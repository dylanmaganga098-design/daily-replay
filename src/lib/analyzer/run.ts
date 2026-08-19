import { ema, sessionBlocks } from "./indicators";
import { applySpreadAndRR, RR_FAIL_REASON, RR_THRESHOLD } from "./math";
import { parseCsv, parseSpread } from "./parse";
import { evaluateSetupStatus, isLive } from "./status";
import { STRATEGIES } from "./strategies";
import { buildIndex, computeMarketStructure } from "./structure";
import type {
  Analysis,
  AnalysisContext,
  OverlapEntry,
  ResultRow,
} from "./types";

export interface RunFailure {
  ok: false;
  error: string;
}

export interface RunSuccess {
  ok: true;
  analysis: Analysis;
}

export type RunOutcome = RunSuccess | RunFailure;

/** Steps 1-5: validation gate, structure, strategies, math, aggregation. */
export function runAnalysis(text: string): RunOutcome {
  const parsed = parseCsv(text);
  if (!parsed.meta) {
    return { ok: false, error: parsed.metadataError ?? "INVALID FILE: metadata header missing" };
  }

  const candles = parsed.candles;
  if (candles.length === 0) {
    return { ok: false, error: "INVALID FILE: no data rows found after the header" };
  }

  const byDatetime = buildIndex(candles);
  computeMarketStructure(candles, byDatetime);

  const ctx: AnalysisContext = {
    meta: parsed.meta,
    candles,
    byDatetime,
    ema50: ema(candles, 50),
    ema200: ema(candles, 200),
    blocks: sessionBlocks(candles),
    spread: parseSpread(parsed.meta.spread_convention),
  };

  const results: ResultRow[] = [];
  const invalidRowList: { datetime: string; reason: string }[] = [];

  for (const candle of candles) {
    if (candle.invalid) {
      invalidRowList.push({ datetime: candle.datetime, reason: candle.invalid });
      continue;
    }
    for (const strategy of STRATEGIES) {
      const outcome = strategy.run(ctx, candle.index);
      const row: ResultRow = {
        strategyId: strategy.id,
        strategy: strategy.name,
        index: candle.index,
        datetime: candle.datetime,
        result: outcome.result,
        reason: outcome.reason,
        trend: candle.trend,
        side: outcome.side,
      };

      if (outcome.result === "PASS") {
        // Step 4: spread + RR are applied only to PASS results.
        const math = applySpreadAndRR(outcome, ctx.spread);
        if (!math) {
          row.result = "FAIL";
          row.reason = "missing entry/SL/TP price from source rows";
        } else {
          row.entry = math.entry;
          row.sl = math.sl;
          row.tp = math.tp;
          if (math.invalidReason || math.rr === undefined) {
            // No RR at all when risk is non-positive; never report a faked positive.
            row.rr = undefined;
            row.result = "FAIL";
            row.reason = math.invalidReason ?? "INVALID: RR not computable";
          } else {
            row.rr = math.rr;
            if (math.rr <= RR_THRESHOLD) {
            row.result = "FAIL";
            row.reason = RR_FAIL_REASON;
            }
          }
        }
      }

      results.push(row);
    }
  }

  const perStrategy = STRATEGIES.map((strategy) => {
    const rows = results.filter((r) => r.strategyId === strategy.id);
    const reasons = new Map<string, number>();
    for (const row of rows) {
      if (row.result === "FAIL") reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
    }
    return {
      strategyId: strategy.id,
      strategy: strategy.name,
      passCount: rows.filter((r) => r.result === "PASS").length,
      failCount: rows.filter((r) => r.result === "FAIL").length,
      failReasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    };
  });

  const passing = results
    .filter((r) => r.result === "PASS")
    .sort((a, b) => (b.rr ?? 0) - (a.rr ?? 0));

  // Step 6: forward-check each PASS against later candles ("now" = last row).
  for (const row of passing) {
    const evaluation = evaluateSetupStatus(row, candles);
    row.setupStatus = evaluation.setupStatus;
    row.statusNote = evaluation.statusNote;
    row.candlesSinceTrigger = evaluation.candlesSinceTrigger;
  }

  const statusRank: Record<string, number> = { PENDING: 0, FILLED: 1 };
  const live = passing
    .filter((r) => isLive(r.setupStatus))
    .sort(
      (a, b) =>
        (statusRank[a.setupStatus ?? ""] ?? 9) - (statusRank[b.setupStatus ?? ""] ?? 9) ||
        (b.rr ?? 0) - (a.rr ?? 0),
    );
  const historical = passing.filter((r) => !isLive(r.setupStatus));

  const overlapMap = new Map<string, string[]>();
  for (const row of live) {
    const list = overlapMap.get(row.datetime) ?? [];
    list.push(row.strategy);
    overlapMap.set(row.datetime, list);
  }
  const overlaps: OverlapEntry[] = [...overlapMap.entries()]
    .filter(([, strategies]) => strategies.length > 1)
    .map(([datetime, strategies]) => ({ datetime, strategies: [...strategies].sort() }))
    .sort((a, b) => a.datetime.localeCompare(b.datetime));

  const analysis: Analysis = {
    meta: parsed.meta,
    spread: ctx.spread,
    totalRows: parsed.totalRows,
    analyzedRows: candles.length - invalidRowList.length,
    invalidRows: invalidRowList.length,
    invalidRowList,
    results,
    passing,
    live,
    historical,
    perStrategy,
    overlaps,
    lastRowDatetime: candles[candles.length - 1]?.datetime ?? "",
  };

  return { ok: true, analysis };
}
