import { fail, pass, requireFields, requireSwings, valid } from "./util";
import type { StrategyCheck } from "../types";

export const liquiditySweep: StrategyCheck = {
  id: "liquidity_sweep",
  name: "Liquidity Sweep + Reclaim",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, [
      "isReliable",
      "swingInvalidated",
      "upperWickPct",
      "lowerWickPct",
    ]);
    if (missing) return missing;
    if (!c.isReliable) return fail("is_reliable = false");
    if (c.swingInvalidated) return fail("swing_invalidated = true");
    const resolved = requireSwings(ctx, c, 1);
    if ("outcome" in resolved) return resolved.outcome;
    const swings = resolved.swings;

    const sweptHigh = swings.highs.filter((h) => c.high! > h && c.close! < h).sort((a, b) => b - a)[0];
    if (sweptHigh !== undefined) {
      if (c.upperWickPct! < 55) return fail(`upper_wick_pct ${c.upperWickPct}% below 55%`);
      const tp = Math.min(...swings.lows);
      if (!(tp < c.close!)) return fail("no opposing swing low below reclaim close");
      return pass(`swept swing high ${sweptHigh} and reclaimed below it`, "short", c.close!, c.high!, tp);
    }

    const sweptLow = swings.lows.filter((l) => c.low! < l && c.close! > l).sort((a, b) => a - b)[0];
    if (sweptLow !== undefined) {
      if (c.lowerWickPct! < 55) return fail(`lower_wick_pct ${c.lowerWickPct}% below 55%`);
      const tp = Math.max(...swings.highs);
      if (!(tp > c.close!)) return fail("no opposing swing high above reclaim close");
      return pass(`swept swing low ${sweptLow} and reclaimed above it`, "long", c.close!, c.low!, tp);
    }

    return fail("no swing level swept and reclaimed");
  },
};