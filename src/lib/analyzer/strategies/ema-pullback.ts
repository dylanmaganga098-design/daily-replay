import { fail, pass, requireFields, requireSwings, structureAbove, structureBelow, valid } from "./util";
import type { StrategyCheck } from "../types";

export const emaPullback: StrategyCheck = {
  id: "ema_pullback",
  name: "EMA 50/200 Pullback",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, ["isReliable", "upperWickPct", "lowerWickPct"]);
    if (missing) return missing;
    if (!c.isReliable) return fail("is_reliable = false");
    const ema50 = ctx.ema50[i];
    const ema200 = ctx.ema200[i];
    if (ema50 === undefined) return fail("EMA-50 unavailable (fewer than 50 closes before this row)");
    if (ema200 === undefined) return fail("EMA-200 unavailable (fewer than 200 closes before this row)");
    if (c.trend === "ranging") return fail("trend is ranging — EMA order cannot align");
    const bullish = c.trend === "bullish";
    if (bullish ? ema50 <= ema200 : ema50 >= ema200) {
      return fail(`EMA order not aligned with ${c.trend} trend`);
    }
    if (!(c.low! <= ema50 && c.high! >= ema50)) return fail("candle did not pull back to EMA-50");
    const wick = bullish ? c.lowerWickPct! : c.upperWickPct!;
    if (wick < 45) return fail(`${bullish ? "lower" : "upper"}_wick_pct ${wick}% below 45%`);
    const resolved = requireSwings(ctx, c, 1);
    if ("outcome" in resolved) return resolved.outcome;
    const entry = c.close!;
    const sl = bullish ? c.low! : c.high!;
    const tp = bullish ? structureAbove(resolved.swings, entry) : structureBelow(resolved.swings, entry);
    if (tp === undefined) return fail("no next structure level available in swing references");
    return pass(`pullback to EMA-50 (${ema50.toFixed(5)}) in ${c.trend} trend`, bullish ? "long" : "short", entry, sl, tp);
  },
};