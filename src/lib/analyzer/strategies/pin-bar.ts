import { fail, nearestLevel, pass, requireFields, requireSwings, valid } from "./util";
import type { AnalysisContext, Outcome, StrategyCheck } from "../types";

export function pinBarOutcome(ctx: AnalysisContext, i: number): Outcome {
  const c = ctx.candles[i];
  if (!valid(c)) return fail("INVALID: missing core fields");
  const missing = requireFields(c, [
    "isReliable",
    "upperWickPct",
    "lowerWickPct",
    "bodyPercentOfRange",
  ]);
  if (missing) return missing;
  if (!c.isReliable) return fail("is_reliable = false");
  if (c.bodyPercentOfRange! > 35) return fail(`body_percent_of_range ${c.bodyPercentOfRange}% above 35%`);
  if (c.trend === "ranging") return fail("trend is ranging — no alignment possible");
  const resolved = requireSwings(ctx, c, 1);
  if ("outcome" in resolved) return resolved.outcome;
  const swings = resolved.swings;
  const bullish = c.trend === "bullish";
  const wick = bullish ? c.lowerWickPct! : c.upperWickPct!;
  if (wick < 60) {
    return fail(`${bullish ? "lower" : "upper"}_wick_pct ${wick}% below 60%`);
  }
  const level = nearestLevel(swings, bullish ? c.low! : c.high!, 0.3);
  if (!level) return fail("pin bar wick not at a similar_swing_refs level");
  const tp = bullish ? Math.max(...swings.highs) : Math.min(...swings.lows);
  if (bullish ? !(tp > c.close!) : !(tp < c.close!)) return fail("no opposing swing to target");
  return pass(
    `pin bar at swing level ${level.level} aligned with ${c.trend} trend`,
    bullish ? "long" : "short",
    c.close!,
    bullish ? c.low! : c.high!,
    tp,
  );
}

export const pinBar: StrategyCheck = {
  id: "pin_bar",
  name: "Pin Bar at Key Level",
  run: pinBarOutcome,
};