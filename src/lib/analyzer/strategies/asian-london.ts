import { blockContaining } from "../indicators";
import { at, fail, pass, requireFields, valid } from "./util";
import type { StrategyCheck } from "../types";

export const asianLondon: StrategyCheck = {
  id: "asian_london",
  name: "Asian Sweep + London Reclaim",
  run: (ctx, i) => {
    const c = ctx.candles[i];
    if (!valid(c)) return fail("INVALID: missing core fields");
    const missing = requireFields(c, ["session", "isReliable"]);
    if (missing) return missing;
    if (c.session !== "asian") return fail(`session = ${c.session} (sweep must occur in asian)`);
    if (!c.isReliable) return fail("sweep candle has is_reliable = false");
    const block = blockContaining(ctx.blocks, i);
    if (!block) return fail("candle is not inside a resolvable session block");
    if (i === block.start) return fail("first asian candle — no prior asian high/low to sweep");

    let priorHigh = -Infinity;
    let priorLow = Infinity;
    for (let j = block.start; j < i; j++) {
      const prior = at(ctx, j);
      if (!valid(prior)) continue;
      priorHigh = Math.max(priorHigh, prior.high!);
      priorLow = Math.min(priorLow, prior.low!);
    }
    if (!Number.isFinite(priorHigh)) return fail("no valid earlier asian candles to define the range");

    const sweptHigh = c.high! > priorHigh;
    const sweptLow = c.low! < priorLow;
    if (!sweptHigh && !sweptLow) return fail("no sweep beyond the asian session high/low");

    const london = ctx.blocks.find((b) => b.session === "london" && b.start > block.end);
    if (!london) return fail("no london session follows this asian session");
    for (let k = london.start; k <= Math.min(london.end, london.start + 2); k++) {
      const r = at(ctx, k);
      if (!valid(r)) continue;
      if (sweptHigh && r.close! < priorHigh) {
        return pass(
          `asian sweep above ${priorHigh} reclaimed in london at ${r.datetime}`,
          "short",
          r.close!,
          c.high!,
          priorLow,
        );
      }
      if (sweptLow && r.close! > priorLow) {
        return pass(
          `asian sweep below ${priorLow} reclaimed in london at ${r.datetime}`,
          "long",
          r.close!,
          c.low!,
          priorHigh,
        );
      }
    }
    return fail("no london reclaim within the first 3 london candles");
  },
};