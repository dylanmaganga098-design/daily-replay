import { resolveSwings, type SwingSet } from "../structure";
import type { AnalysisContext, Candle, Outcome } from "../types";

export const FIELD_LABELS: Record<string, string> = {
  displacement: "displacement",
  isReliable: "is_reliable",
  swingInvalidated: "swing_invalidated",
  upperWickPct: "upper_wick_pct",
  lowerWickPct: "lower_wick_pct",
  bodyPercentOfRange: "body_percent_of_range",
  similarSwingRetracePct: "similar_swing_retrace_pct",
  session: "session",
  open: "open",
  high: "high",
  low: "low",
  close: "close",
};

export function fail(reason: string): Outcome {
  return { result: "FAIL", reason };
}

export function pass(
  reason: string,
  side: "long" | "short",
  entry: number,
  sl: number,
  tp: number,
): Outcome {
  return { result: "PASS", reason, side, entry, sl, tp };
}

/** Returns a `missing field: x` outcome when any required field is absent on the candle. */
export function requireFields(candle: Candle, keys: (keyof Candle)[]): Outcome | undefined {
  for (const key of keys) {
    const value = candle[key];
    if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
      return fail(`missing field: ${FIELD_LABELS[key as string] ?? String(key)}`);
    }
  }
  return undefined;
}

/** Unresolved swing refs are distinct from empty fields. */
export function requireSwings(
  ctx: AnalysisContext,
  candle: Candle,
  minimum = 2,
): { swings: SwingSet } | { outcome: Outcome } {
  if (candle.similarSwingRefs.length === 0) {
    return { outcome: fail("missing field: similar_swing_refs") };
  }
  const swings = resolveSwings(candle, ctx.byDatetime);
  if (swings.unresolved.length > 0) {
    return { outcome: fail(`INVALID: unresolved swing reference [${swings.unresolved[0]}]`) };
  }
  if (swings.candles.length < minimum) {
    return { outcome: fail(`insufficient resolved swings (${swings.candles.length} of ${minimum})`) };
  }
  return { swings };
}

export function isDisplacement(candle: Candle): boolean {
  return /^(yes|true|1)$/i.test(String(candle.displacement ?? ""));
}

export function valid(candle: Candle | undefined): candle is Candle {
  return (
    !!candle &&
    !candle.invalid &&
    candle.open !== undefined &&
    candle.high !== undefined &&
    candle.low !== undefined &&
    candle.close !== undefined
  );
}

export function at(ctx: AnalysisContext, index: number): Candle | undefined {
  return ctx.candles[index];
}

/** Nearest swing level (high or low) to a price, within tolerance percent. */
export function nearestLevel(
  swings: SwingSet,
  price: number,
  tolerancePct: number,
): { level: number; kind: "high" | "low" } | undefined {
  const levels: { level: number; kind: "high" | "low" }[] = [
    ...swings.highs.map((level) => ({ level, kind: "high" as const })),
    ...swings.lows.map((level) => ({ level, kind: "low" as const })),
  ];
  let best: { level: number; kind: "high" | "low" } | undefined;
  let bestDistance = Infinity;
  for (const entry of levels) {
    const distance = Math.abs(price - entry.level);
    const tolerance = (Math.abs(entry.level) * tolerancePct) / 100;
    if (distance <= tolerance && distance < bestDistance) {
      best = entry;
      bestDistance = distance;
    }
  }
  return best;
}

/** Highest swing high strictly above `price`, taken from a real row. */
export function structureAbove(swings: SwingSet, price: number): number | undefined {
  const above = swings.highs.filter((h) => h > price).sort((a, b) => a - b);
  return above[0];
}

export function structureBelow(swings: SwingSet, price: number): number | undefined {
  const below = swings.lows.filter((l) => l < price).sort((a, b) => b - a);
  return below[0];
}

export function wickPct(candle: Candle, kind: "upper" | "lower"): number | undefined {
  return kind === "upper" ? candle.upperWickPct : candle.lowerWickPct;
}