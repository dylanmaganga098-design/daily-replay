import { createFileRoute } from "@tanstack/react-router";
import AnalysisV2 from "@/pages/AnalysisV2";

export const Route = createFileRoute("/analysis/v2")({
  head: () => ({
    meta: [
      { title: "Analyser V2 — Structure Scout — ProSignalsFx" },
      {
        name: "description",
        content:
          "Run the generated OHLC CSV through 13 structure-based strategies and get exact PASS/FAIL reasons, RR math and a ranked live setup list.",
      },
      { property: "og:title", content: "Analyser V2 — Structure Scout — ProSignalsFx" },
      {
        property: "og:description",
        content:
          "Every candle checked against 13 structure strategies, with RR math, setup status and a verifier stage.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalysisV2,
});
