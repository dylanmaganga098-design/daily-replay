import { fib618, withinPct } from "../indicators";
import { fail, pass, requireSwings, valid } from "./util";
import { pinBarOutcome } from "./pin-bar";
import { engulfingOutcome } from "./engulfing";
import type { StrategyCheck } from "../types";

export const fibPattern: StrategyCheck = {
  id: "fib_pattern",
  name: "Pin Bar/Engulfing at 61.8% Fib",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    if (c.trend === "ranging") return fail("trend is ranging — no alignment possible");
    const resolved = requireSwings(ctx, c, 2);
    if ("outcome" in resolved) return resolved.outcome;
    const swings = resolved.swings;
    const bullish = c.trend === "bullish";
    const origin = bullish ? Math.min(...swings.lows) : Math.max(...swings.highs);
    const end = bullish ? Math.max(...swings.highs) : Math.min(...swings.lows);
    const level = fib618(origin, end);
    const price = bullish ? c.low! : c.high!;
    if (!withinPct(price, level, 0.5)) {
      return fail(`price ${price} not within 0.5% of 61.8% level ${level.toFixed(5)}`);
    }
    const pin = pinBarOutcome(ctx, i);
    const eng = engulfingOutcome(ctx, i);
    const pattern = pin.result === "PASS" ? pin : eng.result === "PASS" ? eng : undefined;
    if (!pattern) return fail(`no pin bar or engulfing pattern at 61.8% level (${pin.reason})`);
    if (!c.isReliable) return fail("is_reliable = false");
    return pass(
      `${pattern === pin ? "pin bar" : "engulfing"} at 61.8% retracement ${level.toFixed(5)}`,
      bullish ? "long" : "short",
      c.close!,
      bullish ? c.low! : c.high!,
      end,
    );
  },
};