import { at, fail, pass, requireFields, requireSwings, valid } from "./util";
import type { StrategyCheck } from "../types";

export const swingFailure: StrategyCheck = {
  id: "swing_failure",
  name: "Swing Failure Pattern",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, ["isReliable", "swingInvalidated", "upperWickPct", "lowerWickPct"]);
    if (missing) return missing;
    if (!c.isReliable) return fail("is_reliable = false");
    if (c.swingInvalidated) return fail("swing_invalidated = true");
    const resolved = requireSwings(ctx, c, 1);
    if ("outcome" in resolved) return resolved.outcome;
    const swings = resolved.swings;

    for (let k = 0; k <= 2; k++) {
      const breaker = at(ctx, i - k);
      if (!valid(breaker)) continue;
      const brokenHigh = swings.highs.filter((h) => breaker.high! > h && c.close! < h).sort((a, b) => b - a)[0];
      if (brokenHigh !== undefined) {
        const wick = k === 0 ? c.upperWickPct! : breaker.upperWickPct;
        if (wick === undefined) return fail("missing field: upper_wick_pct (breaking candle)");
        if (wick < 50) return fail(`upper_wick_pct ${wick}% below 50% on failed break`);
        const tp = Math.min(...swings.lows);
        if (!(tp < c.close!)) return fail("no opposing swing low below the failure close");
        return pass(`failed break of swing high ${brokenHigh}, closed back within ${k} candle(s)`, "short", c.close!, breaker.high!, tp);
      }
      const brokenLow = swings.lows.filter((l) => breaker.low! < l && c.close! > l).sort((a, b) => a - b)[0];
      if (brokenLow !== undefined) {
        const wick = k === 0 ? c.lowerWickPct! : breaker.lowerWickPct;
        if (wick === undefined) return fail("missing field: lower_wick_pct (breaking candle)");
        if (wick < 50) return fail(`lower_wick_pct ${wick}% below 50% on failed break`);
        const tp = Math.max(...swings.highs);
        if (!(tp > c.close!)) return fail("no opposing swing high above the failure close");
        return pass(`failed break of swing low ${brokenLow}, closed back within ${k} candle(s)`, "long", c.close!, breaker.low!, tp);
      }
    }
    return fail("no swing break-and-fail within 1-2 candles");
  },
};