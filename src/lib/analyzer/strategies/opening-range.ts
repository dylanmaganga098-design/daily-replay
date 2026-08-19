import { blockContaining } from "../indicators";
import { at, fail, isDisplacement, pass, requireFields, valid } from "./util";
import type { StrategyCheck } from "../types";

export const openingRange: StrategyCheck = {
  id: "opening_range",
  name: "Opening Range Breakout + Retest",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, ["session", "displacement"]);
    if (missing) return missing;
    if (c.session !== "london" && c.session !== "ny") {
      return fail(`session = ${c.session} (opening range only for london or ny)`);
    }
    const block = blockContaining(ctx.blocks, i);
    if (!block) return fail("candle is not inside a resolvable session block");
    const first = at(ctx, block.start);
    const second = at(ctx, block.start + 1);
    if (!valid(first) || !valid(second)) return fail("opening range candles unavailable or INVALID");
    if (i <= block.start + 1) return fail("candle is part of the opening range itself");
    const orHigh = Math.max(first.high!, second.high!);
    const orLow = Math.min(first.low!, second.low!);
    if (!isDisplacement(c)) return fail("displacement != Yes on breakout candle");
    const up = c.close! > orHigh;
    const down = c.close! < orLow;
    if (!up && !down) return fail(`close ${c.close} inside opening range ${orLow}-${orHigh}`);
    const boundary = up ? orHigh : orLow;
    for (let k = 1; k <= 4; k++) {
      const r = at(ctx, i + k);
      if (!valid(r)) continue;
      const touched = up ? r.low! <= boundary : r.high! >= boundary;
      if (!touched) continue;
      if (r.isReliable === undefined) return fail("missing field: is_reliable (retest candle)");
      if (!r.isReliable) return fail(`retest candle at +${k} has is_reliable = false`);
      // Root cause of the wrong-side SL: the retest candle must close back on the
      // breakout side of the boundary. Closing through it is a failed breakout,
      // not a retest entry, and previously produced entry below/above its own SL.
      const reclaimed = up ? r.close! > boundary : r.close! < boundary;
      if (!reclaimed) {
        return fail(
          `retest candle at +${k} closed ${r.close} through the boundary ${boundary} (failed breakout, not a retest)`,
        );
      }
      // Stop goes beyond the retest extreme, never inside the entry.
      const sl = up ? Math.min(boundary, r.low!) : Math.max(boundary, r.high!);
      if (up ? sl >= r.close! : sl <= r.close!) {
        return fail("INVALID: SL on wrong side of entry");
      }
      const measured = orHigh - orLow;
      return pass(
        `${c.session} opening range breakout ${up ? "above" : "below"} ${boundary} with retest`,
        up ? "long" : "short",
        r.close!,
        sl,
        up ? r.close! + measured : r.close! - measured,
      );
    }
    return fail("no retest of the opening range boundary within 1-4 candles");
  },
};