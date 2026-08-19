import type { Candle } from "./types";

/** EMA over close; undefined until `period` closes are available. */
export function ema(candles: Candle[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(candles.length).fill(undefined);
  const k = 2 / (period + 1);
  let prev: number | undefined;
  let seed: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const close = candles[i]!.close;
    if (close === undefined) {
      out[i] = prev;
      continue;
    }
    if (prev === undefined) {
      seed.push(close);
      if (seed.length === period) {
        prev = seed.reduce((a, b) => a + b, 0) / period;
        out[i] = prev;
      }
      continue;
    }
    prev = close * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface SessionBlock {
  session: string;
  day: string;
  start: number;
  end: number;
  high: number;
  low: number;
  close: number;
}

export function dayOf(datetime: string): string {
  return datetime.trim().split(/[ T]/)[0] ?? datetime;
}

/** Contiguous runs of the same session on the same calendar day. */
export function sessionBlocks(candles: Candle[]): SessionBlock[] {
  const blocks: SessionBlock[] = [];
  let current: SessionBlock | undefined;
  for (const candle of candles) {
    if (!candle.session || candle.high === undefined || candle.low === undefined || candle.close === undefined) {
      current = undefined;
      continue;
    }
    const day = dayOf(candle.datetime);
    if (!current || current.session !== candle.session || current.day !== day) {
      current = {
        session: candle.session,
        day,
        start: candle.index,
        end: candle.index,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      };
      blocks.push(current);
    } else {
      current.end = candle.index;
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
    }
  }
  return blocks;
}

export function blockContaining(blocks: SessionBlock[], index: number): SessionBlock | undefined {
  return blocks.find((b) => index >= b.start && index <= b.end);
}

export function previousBlock(blocks: SessionBlock[], index: number): SessionBlock | undefined {
  let previous: SessionBlock | undefined;
  for (const block of blocks) {
    if (block.end < index) previous = block;
    else break;
  }
  return previous;
}

export interface PivotLevels {
  pivot: number;
  r1: number;
  s1: number;
}

export function pivotLevels(block: SessionBlock): PivotLevels {
  const pivot = (block.high + block.low + block.close) / 3;
  const range = block.high - block.low;
  return { pivot, r1: pivot + range, s1: pivot - range };
}

export function fib618(swingStart: number, swingEnd: number): number {
  return swingEnd - (swingEnd - swingStart) * 0.618;
}

export function withinPct(value: number, target: number, pct: number): boolean {
  if (target === 0) return value === 0;
  return Math.abs(value - target) / Math.abs(target) <= pct / 100;
}