import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Brain, ScanSearch } from "lucide-react";

export const Route = createFileRoute("/analysis/")({
  head: () => ({
    meta: [
      { title: "Analyser — ProSignalsFx" },
      {
        name: "description",
        content:
          "Choose an analyser: V1 runs a Gemini vs ChatGPT trade debate on your charts and OHLC data, V2 checks every candle against 13 structure strategies.",
      },
      { property: "og:title", content: "Analyser — ProSignalsFx" },
      {
        property: "og:description",
        content:
          "Pick between the AI debate analyser (V1) and the structure strategy analyser (V2).",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyserPicker,
});

function AnalyserPicker() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Link
            to="/"
            className="flex w-fit items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/20"
          >
            <ArrowLeft size={12} /> Data fetcher
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Analyser
          </h1>
          <p className="text-sm text-muted-foreground">
            Both versions run on the CSV and charts generated on the fetcher page.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <Link
            to="/analysis/v1"
            className="glass-card flex flex-col gap-3 rounded-xl p-6 transition-colors hover:border-primary/40"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Brain size={18} />
            </span>
            <span className="text-lg font-semibold text-foreground">V1 — AI debate</span>
            <span className="text-xs text-muted-foreground">
              Gemini generates a trade, ChatGPT stress-tests it, citations are verified against the
              CSV and the agreed plan exports as a .txt summary.
            </span>
          </Link>

          <Link
            to="/analysis/v2"
            className="glass-card flex flex-col gap-3 rounded-xl p-6 transition-colors hover:border-primary/40"
          >
            <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <ScanSearch size={18} />
            </span>
            <span className="text-lg font-semibold text-foreground">V2 — Structure Scout</span>
            <span className="text-xs text-muted-foreground">
              Every candle checked against 13 structure strategies with PASS/FAIL reasons, RR math,
              a ranked setup list and the verifier stage.
            </span>
          </Link>
        </div>
      </div>
    </main>
  );
}
