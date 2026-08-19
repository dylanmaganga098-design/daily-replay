import {
  at,
  fail,
  isDisplacement,
  pass,
  requireFields,
  requireSwings,
  structureAbove,
  structureBelow,
  valid,
} from "./util";
import type { StrategyCheck } from "../types";

export const bosRetest: StrategyCheck = {
  id: "bos_retest",
  name: "Break of Structure + Retest",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, [
      "displacement",
      "isReliable",
      "swingInvalidated",
      "similarSwingRetracePct",
    ]);
    if (missing) return missing;
    if (!isDisplacement(c)) return fail("displacement != Yes");
    if (c.trend === "ranging") return fail("trend is ranging — no directional structure to break");
    const resolved = requireSwings(ctx, c, 2);
    if ("outcome" in resolved) return resolved.outcome;
    const swings = resolved.swings;
    const bullish = c.trend === "bullish";
    const level = bullish ? Math.max(...swings.highs) : Math.min(...swings.lows);
    if (bullish ? c.close! <= level : c.close! >= level) {
      return fail("displacement candle did not break prior swing in trend direction");
    }
    const impulse = bullish ? c.high! - level : level - c.low!;
    for (let k = 1; k <= 4; k++) {
      const r = at(ctx, i + k);
      if (!valid(r)) continue;
      const touched = bullish ? r.low! <= level : r.high! >= level;
      if (!touched) continue;
      if (r.isReliable === undefined) return fail("missing field: is_reliable (retest candle)");
      if (!r.isReliable) return fail(`retest candle at +${k} has is_reliable = false`);
      if (r.swingInvalidated === undefined)
        return fail("missing field: swing_invalidated (retest candle)");
      if (r.swingInvalidated) return fail("swing_invalidated = true at retest");
      const retrace =
        impulse > 0
          ? ((bullish ? c.high! - r.low! : r.high! - c.low!) / impulse) * 100
          : 0;
      const target = c.similarSwingRetracePct!;
      const band = Math.abs(target) * 0.5 + 10;
      if (Math.abs(retrace - target) > band) {
        return fail(
          `retrace ${retrace.toFixed(1)}% outside similar_swing_retrace_pct range (${target}% ±${band.toFixed(1)})`,
        );
      }
      const entry = bullish ? r.high! : r.low!;
      const sl = bullish ? r.low! : r.high!;
      const tp =
        (bullish ? structureAbove(swings, entry) : structureBelow(swings, entry)) ??
        (bullish ? entry + impulse : entry - impulse);
      return pass(
        `broke swing ${level} with reliable retest at +${k}`,
        bullish ? "long" : "short",
        entry,
        sl,
        tp,
      );
    }
    return fail("no retest within 1-4 candles");
  },
};