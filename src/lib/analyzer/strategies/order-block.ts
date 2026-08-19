import { at, fail, isDisplacement, pass, requireFields, valid } from "./util";
import type { Candle, StrategyCheck } from "../types";

function bullishCandle(c: Candle): boolean {
  return c.close! > c.open!;
}

export const orderBlock: StrategyCheck = {
  id: "order_block",
  name: "Order Block Return",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, ["swingInvalidated"]);
    if (missing) return missing;
    if (c.swingInvalidated) return fail("swing_invalidated = true at order block level");

    for (let j = i - 1; j >= 1 && j >= i - 60; j--) {
      const impulse = at(ctx, j);
      if (!valid(impulse)) continue;
      if (impulse.displacement === undefined) continue;
      if (!isDisplacement(impulse)) continue;
      const up = bullishCandle(impulse);
      let ob: Candle | undefined;
      for (let k = j - 1; k >= 0 && k >= j - 10; k--) {
        const candidate = at(ctx, k);
        if (!valid(candidate)) continue;
        if (bullishCandle(candidate) !== up) {
          ob = candidate;
          break;
        }
      }
      if (!ob) continue;
      if (ob.isReliable === undefined) return fail("missing field: is_reliable (order block candle)");
      if (!ob.isReliable) return fail("order block candle has is_reliable = false");
      const returned = c.low! <= ob.high! && c.high! >= ob.low!;
      if (!returned) return fail(`price has not returned to order block ${ob.low}-${ob.high}`);
      const measured = impulse.high! - impulse.low!;
      const entry = up ? ob.high! : ob.low!;
      const sl = up ? ob.low! : ob.high!;
      const tp = up ? entry + measured : entry - measured;
      return pass(
        `returned to ${up ? "bullish" : "bearish"} order block at ${ob.datetime}`,
        up ? "long" : "short",
        entry,
        sl,
        tp,
      );
    }
    return fail("no displacement impulse with a prior opposing candle found");
  },
};