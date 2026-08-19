import type { Candle, ResultRow, SetupStatus } from "./types";

/** Candles a limit order may wait for a fill before it is considered stale. */
export const PENDING_EXPIRY_CANDLES = 20;

export interface StatusEvaluation {
  setupStatus: SetupStatus;
  candlesSinceTrigger: number;
  statusNote: string;
}

function touched(candle: Candle, level: number): boolean {
  return (
    candle.low !== undefined && candle.high !== undefined && candle.low <= level && candle.high >= level
  );
}

/**
 * Forward-check a PASS setup against every candle after its trigger, up to the
 * last row in the file (treated as "now"). Only PENDING and FILLED are live.
 */
export function evaluateSetupStatus(
  row: ResultRow,
  candles: Candle[],
  expiryCandles = PENDING_EXPIRY_CANDLES,
): StatusEvaluation {
  const forward = candles.filter((c) => c.index > row.index && !c.invalid);
  const candlesSinceTrigger = forward.length;

  if (row.entry === undefined || row.sl === undefined || row.tp === undefined) {
    return { setupStatus: "PENDING", candlesSinceTrigger, statusNote: "no price levels to track" };
  }

  let filled = false;
  let barsWaiting = 0;

  for (const candle of forward) {
    if (!filled) {
      if (touched(candle, row.entry)) {
        filled = true;
        // Same-candle TP/SL after the fill still resolves the setup.
        if (touched(candle, row.tp)) {
          return { setupStatus: "RESOLVED", candlesSinceTrigger, statusNote: `TP hit at ${candle.datetime}` };
        }
        if (touched(candle, row.sl)) {
          return { setupStatus: "RESOLVED", candlesSinceTrigger, statusNote: `SL hit at ${candle.datetime}` };
        }
        continue;
      }
      barsWaiting++;
      // Price broke past the stop without ever filling: the setup is dead.
      const brokeStop =
        row.side === "short" ? (candle.high ?? -Infinity) >= row.sl : (candle.low ?? Infinity) <= row.sl;
      if (brokeStop) {
        return {
          setupStatus: "RESOLVED",
          candlesSinceTrigger,
          statusNote: `invalidated at ${candle.datetime} (SL broken before fill)`,
        };
      }
      if (barsWaiting > expiryCandles) {
        return {
          setupStatus: "EXPIRED",
          candlesSinceTrigger,
          statusNote: `no fill within ${expiryCandles} candles`,
        };
      }
      continue;
    }

    if (touched(candle, row.tp)) {
      return { setupStatus: "RESOLVED", candlesSinceTrigger, statusNote: `TP hit at ${candle.datetime}` };
    }
    if (touched(candle, row.sl)) {
      return { setupStatus: "RESOLVED", candlesSinceTrigger, statusNote: `SL hit at ${candle.datetime}` };
    }
  }

  if (filled) {
    return { setupStatus: "FILLED", candlesSinceTrigger, statusNote: "entry filled, trade still open" };
  }
  return {
    setupStatus: "PENDING",
    candlesSinceTrigger,
    statusNote: `waiting for fill (${barsWaiting} candles)`,
  };
}

export const LIVE_STATUSES: SetupStatus[] = ["PENDING", "FILLED"];

export function isLive(status: SetupStatus | undefined): boolean {
  return status === "PENDING" || status === "FILLED";
}
