import type { Candle, Trend } from "./types";

export interface SwingSet {
  /** Resolved swing candles, ordered oldest -> newest by their position in the file. */
  candles: Candle[];
  highs: number[];
  lows: number[];
  unresolved: string[];
}

export function buildIndex(candles: Candle[]): Map<string, Candle> {
  const map = new Map<string, Candle>();
  for (const candle of candles) if (candle.datetime) map.set(candle.datetime.trim(), candle);
  return map;
}

/** Resolves similar_swing_refs datetimes back to real rows; unresolved refs are reported, never nulled. */
export function resolveSwings(candle: Candle, byDatetime: Map<string, Candle>): SwingSet {
  const resolved: Candle[] = [];
  const unresolved: string[] = [];
  for (const ref of candle.similarSwingRefs) {
    const match = byDatetime.get(ref.trim());
    if (match && match.high !== undefined && match.low !== undefined) resolved.push(match);
    else unresolved.push(ref);
  }
  resolved.sort((a, b) => a.index - b.index);
  const last5 = resolved.slice(-5);
  return {
    candles: last5,
    highs: last5.map((c) => c.high as number),
    lows: last5.map((c) => c.low as number),
    unresolved,
  };
}

function rising(values: number[]): boolean {
  return values.length >= 2 && values.every((v, i) => i === 0 || v > values[i - 1]!);
}

function falling(values: number[]): boolean {
  return values.length >= 2 && values.every((v, i) => i === 0 || v < values[i - 1]!);
}

export function trendFrom(swings: SwingSet): Trend {
  if (rising(swings.highs) && rising(swings.lows)) return "bullish";
  if (falling(swings.highs) && falling(swings.lows)) return "bearish";
  return "ranging";
}

/** Step 2: computes and stores trend + unresolved refs on every row, once. */
export function computeMarketStructure(candles: Candle[], byDatetime: Map<string, Candle>): void {
  for (const candle of candles) {
    const swings = resolveSwings(candle, byDatetime);
    candle.unresolvedRefs = swings.unresolved;
    candle.trend = trendFrom(swings);
  }
}