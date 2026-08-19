import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

import { VerifierPanel } from "@/components/verifier-panel";

import { buildReport } from "@/lib/analyzer/export";
import { downloadBundle, type BundleOutcome } from "@/lib/analyzer/bundle";

import { runAnalysis } from "@/lib/analyzer/run";
import type { Analysis, ResultRow } from "@/lib/analyzer/types";
import { useAnalysisSnapshot } from "@/lib/analysis-store";
import type { VerifyResult } from "@/lib/verifier.functions";

type Status = "idle" | "working" | "ready" | "error";

const STATUS_LABEL: Record<Status, string> = {
  idle: "Waiting for generated CSV",
  working: "Analyzing",
  ready: "Analysis complete",
  error: "CSV rejected",
};

function StatusDot({ status }: { status: Status }) {
  const tone =
    status === "ready"
      ? "bg-success"
      : status === "error"
        ? "bg-destructive"
        : status === "working"
          ? "bg-warning animate-pulse"
          : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <span className={`size-2.5 rounded-full ${tone}`} aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

function price(value: number | undefined) {
  return value === undefined ? "—" : Number(value.toFixed(5)).toString();
}

export default function AnalysisV2() {
  const snapshot = useAnalysisSnapshot();
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [strategyFilter, setStrategyFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<"all" | "PASS" | "FAIL">("all");
  const [bundle, setBundle] = useState<BundleOutcome | null>(null);
  const csv = snapshot?.ohlcCsv ?? null;
  const csvName = snapshot?.csvName ?? (snapshot ? `${snapshot.symbol}.csv` : null);
  const bundledFor = useRef<string | null>(null);

  // The generated CSV is the only input — analyse it as soon as it's available.
  useEffect(() => {
    if (!csv) {
      setStatus("idle");
      setAnalysis(null);
      return;
    }
    setStatus("working");
    setError(null);
    setBundle(null);
    bundledFor.current = null;
    const outcome = runAnalysis(csv);
    if (!outcome.ok) {
      setAnalysis(null);
      setError(outcome.error);
      setStatus("error");
      return;
    }
    setAnalysis(outcome.analysis);
    setStrategyFilter("all");
    setResultFilter("all");
    setStatus("ready");
  }, [csv]);

  const handleVerdict = useCallback(
    (result: VerifyResult) => {
      if (!analysis) return;
      const key = analysis.lastRowDatetime || "analysis";
      if (bundledFor.current === key) return;
      bundledFor.current = key;
      void downloadBundle(analysis, { csv, csvName, verdict: result.verdict }).then((outcome) => {
        if (outcome) setBundle(outcome);
      });
    },
    [analysis, csv, csvName],
  );

  const rows: ResultRow[] = useMemo(() => {
    if (!analysis) return [];
    return analysis.results.filter(
      (row) =>
        (strategyFilter === "all" || row.strategyId === strategyFilter) &&
        (resultFilter === "all" || row.result === resultFilter),
    );
  }, [analysis, strategyFilter, resultFilter]);

  const visible = rows.slice(0, 500);

  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-3">
          <Link
            to="/analysis"
            className="flex w-fit items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/20"
          >
            <ArrowLeft size={12} /> Analyser versions
          </Link>
          <p className="num text-xs uppercase tracking-[0.35em] text-primary">
            Analyser V2 · Structure Scout
          </p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            Trading strategy analyzer
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Every candle is checked against 13 structure strategies. Nothing is estimated — each
            result traces back to a real row in the generated CSV.
          </p>
        </header>

        <section className="panel flex flex-col gap-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-medium text-foreground">
                Generated CSV{csvName ? ` · ${csvName}` : ""}
              </h2>
              <p className="text-xs text-muted-foreground">
                {snapshot
                  ? `${snapshot.symbol} · ${snapshot.range || "range unspecified"} — analysed automatically, verifier runs next, then the bundle downloads.`
                  : "No CSV yet — generate one on the fetcher page and it will be analysed here automatically."}
              </p>
            </div>
            <StatusDot status={status} />
          </div>

          {!csv ? (
            <Link
              to="/"
              className="w-fit rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to the generator
            </Link>
          ) : null}

          {bundle && !bundle.autoDownloaded ? (
            <div className="flex flex-col gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-3 text-sm text-foreground">
              <p>The preview window blocks automatic downloads — save the bundle manually.</p>
              <a
                href={bundle.url}
                download={bundle.fileName}
                target="_blank"
                rel="noopener noreferrer"
                className="num w-fit rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Save {bundle.fileName}
              </a>
            </div>
          ) : null}

          {bundle?.autoDownloaded ? (
            <p className="num text-xs text-success">Downloaded {bundle.fileName}</p>
          ) : null}

          {error ? (
            <p className="num rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </section>


        {analysis ? (
          <>
            <section className="panel flex flex-col gap-6 p-6">
              <div className="flex flex-col gap-2 border-b border-border pb-5">
                <span className="text-xs uppercase tracking-widest text-muted-foreground">
                  data_age
                </span>
                <span className="num text-2xl font-semibold text-warning">
                  {analysis.meta.data_age}
                </span>
                <span className="text-xs text-muted-foreground">
                  spread_convention: {analysis.meta.spread_convention} · applied spread{" "}
                  {analysis.spread} · atr_method: {analysis.meta.atr_method} · swing rule:{" "}
                  {analysis.meta.similar_swing_selection_rule}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ["Total candles", analysis.totalRows],
                  ["PASS setups", analysis.passing.length],
                  ["Live/actionable", analysis.live.length],
                  ["Historical", analysis.historical.length],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md bg-secondary/60 p-4">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="num mt-1 text-xl font-semibold text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">Per strategy</h3>
                <div className="flex flex-col gap-2">
                  {analysis.perStrategy.map((strategy) => (
                    <details
                      key={strategy.strategyId}
                      className="rounded-md border border-border bg-secondary/40 px-4 py-3"
                    >
                      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm text-foreground">
                        <span>{strategy.strategy}</span>
                        <span className="num text-xs">
                          <span className="text-success">PASS {strategy.passCount}</span>
                          {"  ·  "}
                          <span className="text-muted-foreground">FAIL {strategy.failCount}</span>
                        </span>
                      </summary>
                      <ul className="mt-3 flex flex-col gap-1">
                        {strategy.failReasons.length === 0 ? (
                          <li className="text-xs text-muted-foreground">No failures recorded.</li>
                        ) : (
                          strategy.failReasons.map((reason) => (
                            <li
                              key={reason.reason}
                              className="num flex justify-between gap-4 text-xs text-muted-foreground"
                            >
                              <span>{reason.reason}</span>
                              <span>{reason.count}</span>
                            </li>
                          ))
                        )}
                      </ul>
                    </details>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                  Live / actionable ({analysis.live.length}) — PENDING first, then RR
                </h3>
                {analysis.live.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border p-6 text-center">
                    <p className="text-sm font-medium text-foreground">
                      No live setups as of {analysis.lastRowDatetime || "the last candle"}.
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Every candle was still checked — see the historical record below and the
                      results table for exact reasons.
                    </p>
                  </div>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {analysis.live.map((row, i) => (
                      <li
                        key={`${row.strategyId}-${row.index}`}
                        className="num flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/60 px-4 py-2 text-xs text-foreground"
                      >
                        <span>
                          {i + 1}.{" "}
                          <span
                            className={
                              row.setupStatus === "FILLED"
                                ? "rounded bg-warning/15 px-2 py-0.5 text-warning"
                                : "rounded bg-success/15 px-2 py-0.5 text-success"
                            }
                          >
                            {row.setupStatus}
                          </span>{" "}
                          {row.strategy} @ {row.datetime}
                        </span>
                        <span className="text-muted-foreground">
                          entry {price(row.entry)} · SL {price(row.sl)} · TP {price(row.tp)} ·{" "}
                          <span className="text-success">RR {row.rr?.toFixed(2)}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-medium text-foreground">
                  Historical record ({analysis.historical.length}) — resolved or expired
                </h3>
                <p className="text-xs text-muted-foreground">
                  Valid setups that are no longer tradeable. Kept for win-rate backtesting, not
                  counted as failures.
                </p>
                {analysis.historical.length === 0 ? (
                  <p className="text-xs text-muted-foreground">none</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {analysis.historical.slice(0, 50).map((row, i) => (
                      <li
                        key={`${row.strategyId}-${row.index}`}
                        className="num flex flex-wrap items-center justify-between gap-2 rounded-md bg-secondary/40 px-4 py-2 text-xs text-muted-foreground"
                      >
                        <span>
                          {i + 1}. [{row.setupStatus}] {row.strategy} @ {row.datetime}
                        </span>
                        <span>
                          RR {row.rr?.toFixed(2)} · {row.statusNote}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {analysis.overlaps.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium text-foreground">
                    Overlaps ({analysis.overlaps.length})
                  </h3>
                  <ul className="flex flex-col gap-1">
                    {analysis.overlaps.map((overlap) => (
                      <li key={overlap.datetime} className="num text-xs text-muted-foreground">
                        {overlap.datetime}: {overlap.strategies.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <VerifierPanel
              key={analysis.lastRowDatetime}
              scoutData={buildReport(analysis, "LIVE")}
              ohlcCsv={csv ?? ""}
              onVerdict={handleVerdict}
            />


            <section className="panel flex flex-col gap-4 p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-medium text-foreground">Results</h2>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Filter by strategy"
                    value={strategyFilter}
                    onChange={(event) => setStrategyFilter(event.target.value)}
                    className="rounded-md border border-input bg-secondary px-3 py-2 text-xs text-foreground"
                  >
                    <option value="all">All strategies</option>
                    {analysis.perStrategy.map((strategy) => (
                      <option key={strategy.strategyId} value={strategy.strategyId}>
                        {strategy.strategy}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filter by result"
                    value={resultFilter}
                    onChange={(event) =>
                      setResultFilter(event.target.value as "all" | "PASS" | "FAIL")
                    }
                    className="rounded-md border border-input bg-secondary px-3 py-2 text-xs text-foreground"
                  >
                    <option value="all">All results</option>
                    <option value="PASS">PASS only</option>
                    <option value="FAIL">FAIL only</option>
                  </select>
                </div>
              </div>

              <p className="num text-xs text-muted-foreground">
                Showing {visible.length} of {rows.length} rows
              </p>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      {["Datetime", "Strategy", "Result", "Trend", "Entry", "SL", "TP", "RR", "Reason"].map(
                        (head) => (
                          <th key={head} className="border-b border-border px-3 py-2 font-medium">
                            {head}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={`${row.strategyId}-${row.index}`} className="align-top">
                        <td className="num border-b border-border/60 px-3 py-2">{row.datetime}</td>
                        <td className="border-b border-border/60 px-3 py-2">{row.strategy}</td>
                        <td className="border-b border-border/60 px-3 py-2">
                          <span
                            className={
                              row.result === "PASS"
                                ? "rounded bg-success/15 px-2 py-0.5 font-medium text-success"
                                : "rounded bg-muted px-2 py-0.5 text-muted-foreground"
                            }
                          >
                            {row.result}
                          </span>
                        </td>
                        <td className="border-b border-border/60 px-3 py-2">{row.trend}</td>
                        <td className="num border-b border-border/60 px-3 py-2">{price(row.entry)}</td>
                        <td className="num border-b border-border/60 px-3 py-2">{price(row.sl)}</td>
                        <td className="num border-b border-border/60 px-3 py-2">{price(row.tp)}</td>
                        <td className="num border-b border-border/60 px-3 py-2">
                          {row.rr === undefined ? "—" : row.rr.toFixed(2)}
                        </td>
                        <td className="border-b border-border/60 px-3 py-2 text-muted-foreground">
                          {row.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {analysis.invalidRowList.length > 0 ? (
                <details className="rounded-md border border-border bg-secondary/40 px-4 py-3">
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    {analysis.invalidRowList.length} INVALID rows excluded from strategy checks
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {analysis.invalidRowList.map((row) => (
                      <li key={row.datetime} className="num text-xs text-muted-foreground">
                        {row.datetime || "(no datetime)"} — {row.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
