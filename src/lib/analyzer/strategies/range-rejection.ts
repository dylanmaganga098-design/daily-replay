import { fail, pass, requireFields, requireSwings, valid } from "./util";
import type { StrategyCheck } from "../types";

function clustered(values: number[]): boolean {
  if (values.length < 3) return false;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return max === 0 ? true : (max - min) / Math.abs(max) <= 0.003;
}

export const rangeRejection: StrategyCheck = {
  id: "range_rejection",
  name: "Horizontal Range + Boundary Rejection",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, ["isReliable", "upperWickPct", "lowerWickPct"]);
    if (missing) return missing;
    if (!c.isReliable) return fail("is_reliable = false");
    const resolved = requireSwings(ctx, c, 3);
    if ("outcome" in resolved) return resolved.outcome;
    const swings = resolved.swings;
    if (!clustered(swings.highs)) return fail("fewer than 3 swing highs within 0.3% of each other");
    if (!clustered(swings.lows)) return fail("fewer than 3 swing lows within 0.3% of each other");
    const top = Math.max(...swings.highs);
    const bottom = Math.min(...swings.lows);

    if (c.high! >= bottom + (top - bottom) * 0.9) {
      if (c.upperWickPct! < 50) return fail(`upper_wick_pct ${c.upperWickPct}% below 50% at range top`);
      return pass(`rejection at range top ${top}`, "short", c.close!, c.high!, bottom);
    }
    if (c.low! <= bottom + (top - bottom) * 0.1) {
      if (c.lowerWickPct! < 50)
        return fail(`lower_wick_pct ${c.lowerWickPct}% below 50% at range bottom`);
      return pass(`rejection at range bottom ${bottom}`, "long", c.close!, c.low!, top);
    }
    return fail("candle not at a range boundary");
  },
};