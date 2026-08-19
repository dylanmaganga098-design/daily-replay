import { createFileRoute } from "@tanstack/react-router";
import Analysis from "@/pages/Analysis";

export const Route = createFileRoute("/analysis/v1")({
  head: () => ({
    meta: [
      { title: "Analyser V1 — AI Trade Debate — ProSignalsFx" },
      {
        name: "description",
        content:
          "Feed Gold and Forex charts plus 30-minute OHLC data to two AI models that debate and refine a trade plan, then export the summary as a text file.",
      },
      { property: "og:title", content: "Analyser V1 — AI Trade Debate — ProSignalsFx" },
      {
        property: "og:description",
        content:
          "Two AI models debate your charts and OHLC data until they agree, then export a structured trade summary.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Analysis,
});
