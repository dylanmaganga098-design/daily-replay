import { createFileRoute } from "@tanstack/react-router";
import Backtest from "@/pages/Backtest";

export const Route = createFileRoute("/backtest")({
  head: () => ({
    meta: [
      { title: "Auto-Backtester — ProSignalsFx" },
      {
        name: "description",
        content:
          "Walk a date range one day at a time: pull a month of 30M candles per day, analyse it locally against every strategy and download a dated report with rolling win rates.",
      },
      { property: "og:title", content: "Auto-Backtester — ProSignalsFx" },
      {
        property: "og:description",
        content:
          "Automated day-by-day backtesting with per-day trigger reports and cumulative per-strategy win rates.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Backtest,
});
