import { at, fail, pass, requireSwings, structureAbove, structureBelow, valid } from "./util";
import type { StrategyCheck } from "../types";

export const fvgFill: StrategyCheck = {
  id: "fvg_fill",
  name: "Fair Value Gap Fill",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    if (c.trend === "ranging") return fail("trend is ranging — gap direction cannot align");
    const bullish = c.trend === "bullish";

    for (let j = i - 1; j >= 2 && j >= i - 60; j--) {
      const a = at(ctx, j - 2);
      const b = at(ctx, j - 1);
      const d = at(ctx, j);
      if (!valid(a) || !valid(b) || !valid(d)) continue;
      const gapUp = d.low! > a.high!;
      const gapDown = d.high! < a.low!;
      if (!gapUp && !gapDown) continue;
      if (gapUp !== bullish) return fail("fair value gap direction opposes trend");
      for (const gapCandle of [a, b, d]) {
        if (gapCandle.isReliable === undefined)
          return fail(`missing field: is_reliable (gap candle ${gapCandle.datetime})`);
        if (!gapCandle.isReliable)
          return fail(`gap candle ${gapCandle.datetime} has is_reliable = false`);
      }
      const gapTop = gapUp ? d.low! : a.low!;
      const gapBottom = gapUp ? a.high! : d.high!;
      const filled = c.low! <= gapTop && c.high! >= gapBottom;
      if (!filled) return fail(`price has not returned to fill gap ${gapBottom}-${gapTop}`);
      const resolved = requireSwings(ctx, c, 1);
      if ("outcome" in resolved) return resolved.outcome;
      const entry = gapUp ? gapTop : gapBottom;
      const sl = gapUp ? gapBottom : gapTop;
      const tp =
        (gapUp ? structureAbove(resolved.swings, entry) : structureBelow(resolved.swings, entry)) ??
        (gapUp ? entry + (gapTop - gapBottom) * 3 : entry - (gapTop - gapBottom) * 3);
      return pass(
        `filled ${gapUp ? "bullish" : "bearish"} fair value gap from ${d.datetime}`,
        gapUp ? "long" : "short",
        entry,
        sl,
        tp,
      );
    }
    return fail("no 3-candle non-overlapping gap found before this candle");
  },
};