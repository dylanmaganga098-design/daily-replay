import { at, fail, nearestLevel, pass, requireFields, requireSwings, valid } from "./util";
import type { AnalysisContext, Outcome, StrategyCheck } from "../types";

export function engulfingOutcome(ctx: AnalysisContext, i: number): Outcome {
  const c = ctx.candles[i];
  if (!valid(c)) return fail("INVALID: missing core fields");
  const prev = at(ctx, i - 1);
  if (!valid(prev)) return fail("prior candle unavailable or INVALID: missing core fields");
  const missing = requireFields(c, ["isReliable"]);
  if (missing) return missing;
  if (prev.isReliable === undefined) return fail("missing field: is_reliable (prior candle)");
  if (!c.isReliable || !prev.isReliable) return fail("is_reliable = false on engulfing or prior candle");
  const bodyTop = Math.max(c.open!, c.close!);
  const bodyBottom = Math.min(c.open!, c.close!);
  const prevTop = Math.max(prev.open!, prev.close!);
  const prevBottom = Math.min(prev.open!, prev.close!);
  if (!(bodyTop >= prevTop && bodyBottom <= prevBottom)) {
    return fail("body does not fully engulf prior candle body");
  }
  if (c.trend === "ranging") return fail("trend is ranging — no alignment possible");
  const bullish = c.trend === "bullish";
  if (bullish ? c.close! <= c.open! : c.close! >= c.open!) {
    return fail(`engulfing candle direction opposes ${c.trend} trend`);
  }
  const resolved = requireSwings(ctx, c, 1);
  if ("outcome" in resolved) return resolved.outcome;
  const swings = resolved.swings;
  const level = nearestLevel(swings, bullish ? c.low! : c.high!, 0.3);
  if (!level) return fail("engulfing candle not at a similar_swing_refs level");
  const tp = bullish ? Math.max(...swings.highs) : Math.min(...swings.lows);
  if (bullish ? !(tp > c.close!) : !(tp < c.close!)) return fail("no opposing swing to target");
  return pass(
    `engulfing candle at swing level ${level.level} aligned with ${c.trend} trend`,
    bullish ? "long" : "short",
    c.close!,
    bullish ? c.low! : c.high!,
    tp,
  );
}

export const engulfing: StrategyCheck = {
  id: "engulfing",
  name: "Engulfing at Support/Resistance",
  run: engulfingOutcome,
};