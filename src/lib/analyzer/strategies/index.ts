import { bosRetest } from "./bos-retest";
import { liquiditySweep } from "./liquidity-sweep";
import { rangeRejection } from "./range-rejection";
import { orderBlock } from "./order-block";
import { fvgFill } from "./fvg-fill";
import { pinBar } from "./pin-bar";
import { engulfing } from "./engulfing";
import { fibPattern } from "./fib-pattern";
import { pivotRejection } from "./pivot-rejection";
import { asianLondon } from "./asian-london";
import { openingRange } from "./opening-range";
import { emaPullback } from "./ema-pullback";
import { swingFailure } from "./swing-failure";
import type { StrategyCheck } from "../types";

export const STRATEGIES: StrategyCheck[] = [
  bosRetest,
  liquiditySweep,
  rangeRejection,
  orderBlock,
  fvgFill,
  pinBar,
  engulfing,
  fibPattern,
  pivotRejection,
  asianLondon,
  openingRange,
  emaPullback,
  swingFailure,
];