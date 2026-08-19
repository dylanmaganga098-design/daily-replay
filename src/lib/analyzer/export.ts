import type { Analysis, ResultRow } from "./types";

export type ReportKind = "LIVE" | "HISTORY";

function fmt(value: number | undefined): string {
  return value === undefined ? "-" : String(Number(value.toFixed(5)));
}

function slugOf(analysis: Analysis): string {
  return (
    (analysis.lastRowDatetime || "analysis")
      .trim()
      .replace(/[:\s/]+/g, "-")
      .replace(/[^0-9A-Za-z_-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "analysis"
  );
}

/** Slug built from the last analysed row's datetime, e.g. structure-scout_LIVE_2026-08-14-2330.txt */
export function exportFileName(analysis: Analysis, kind: ReportKind = "LIVE"): string {
  return `structure-scout_${kind}_${slugOf(analysis)}.txt`;
}

function setupLine(row: ResultRow, i: number): string {
  return `${i + 1}. [${row.setupStatus ?? "-"}] ${row.strategy} @ ${row.datetime} | ${row.side ?? "-"} | entry ${fmt(row.entry)} | SL ${fmt(row.sl)} | TP ${fmt(row.tp)} | RR ${row.rr === undefined ? "-" : row.rr.toFixed(2)} | ${row.statusNote ?? ""}`;
}

function header(analysis: Analysis, title: string): string[] {
  return [
    `=== ${title} ===`,
    `data_age: ${analysis.meta.data_age}`,
    `current_time (last row): ${analysis.lastRowDatetime}`,
    `spread_convention: ${analysis.meta.spread_convention} (applied: ${analysis.spread})`,
    `atr_method: ${analysis.meta.atr_method}`,
    `similar_swing_selection_rule: ${analysis.meta.similar_swing_selection_rule}`,
    "",
  ];
}

/** File 1: only PENDING/FILLED setups — what can still be acted on. */
export function buildLiveReport(analysis: Analysis): string {
  const lines = header(analysis, "SUMMARY");
  lines.push(`Total candles: ${analysis.totalRows}`);
  lines.push(`Analyzed candles: ${analysis.analyzedRows}`);
  lines.push(`Total PASS setups: ${analysis.passing.length}`);
  lines.push(`Live/actionable setups: ${analysis.live.length}`);
  lines.push("");

  lines.push("=== LIVE / ACTIONABLE ===");
  if (analysis.live.length === 0) {
    lines.push("none — no PENDING or FILLED setups as of the last candle");
  }
  analysis.live.forEach((row, i) => lines.push(setupLine(row, i)));
  lines.push("");

  lines.push("-- Overlaps (same candle, multiple live setups) --");
  if (analysis.overlaps.length === 0) lines.push("none");
  for (const overlap of analysis.overlaps) {
    lines.push(`${overlap.datetime}: ${overlap.strategies.join(", ")}`);
  }

  return lines.join("\n");
}

/** File 2: resolved/expired setups plus the full diagnostic result table. */
export function buildHistoryReport(analysis: Analysis): string {
  const lines = header(analysis, "HISTORICAL RECORD");
  lines.push(`INVALID rows: ${analysis.invalidRows}`);
  lines.push(`Historical (RESOLVED/EXPIRED) setups: ${analysis.historical.length}`);
  lines.push("");

  lines.push("-- Historical setups (valid logic, no longer live) --");
  if (analysis.historical.length === 0) lines.push("none");
  analysis.historical.forEach((row, i) => lines.push(setupLine(row, i)));
  lines.push("");

  lines.push("-- Per strategy --");
  for (const strategy of analysis.perStrategy) {
    lines.push(`${strategy.strategy}: PASS ${strategy.passCount} | FAIL ${strategy.failCount}`);
    for (const reason of strategy.failReasons) {
      lines.push(`    ${reason.count} x ${reason.reason}`);
    }
  }
  lines.push("");

  lines.push("=== RESULTS ===");
  lines.push("datetime | strategy | result | status | trend | entry | SL | TP | RR | reason");
  for (const row of analysis.results) {
    lines.push(
      [
        row.datetime,
        row.strategy,
        row.result,
        row.setupStatus ?? "-",
        row.trend,
        fmt(row.entry),
        fmt(row.sl),
        fmt(row.tp),
        row.rr === undefined ? "-" : row.rr.toFixed(2),
        row.reason,
      ].join(" | "),
    );
  }

  for (const invalid of analysis.invalidRowList) {
    lines.push(
      `${invalid.datetime} | (all strategies) | SKIPPED | - | - | - | - | - | - | ${invalid.reason}`,
    );
  }

  return lines.join("\n");
}

export function buildReport(analysis: Analysis, kind: ReportKind = "LIVE"): string {
  return kind === "LIVE" ? buildLiveReport(analysis) : buildHistoryReport(analysis);
}

export interface DownloadOutcome {
  kind: ReportKind;
  fileName: string;
  /** Blob URL kept alive so the UI can offer a manual fallback link. */
  url: string;
  /** False when the page is sandboxed in an iframe, where downloads are blocked. */
  autoDownloaded: boolean;
}

function inIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function downloadReport(
  analysis: Analysis,
  kind: ReportKind = "LIVE",
): DownloadOutcome | undefined {
  if (typeof document === "undefined") return undefined;
  const fileName = exportFileName(analysis, kind);
  const blob = new Blob([buildReport(analysis, kind)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();

  let autoDownloaded = true;
  if (inIframe()) {
    // Preview iframes block downloads; hand the file to a top-level tab instead.
    autoDownloaded = window.open(url, "_blank", "noopener") !== null;
  }

  // Revoke late: revoking immediately can cancel an in-flight download.
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return { kind, fileName, url, autoDownloaded };
}

/** Both files auto-download on completion. */
export function downloadReports(analysis: Analysis): DownloadOutcome[] {
  return [downloadReport(analysis, "LIVE"), downloadReport(analysis, "HISTORY")].filter(
    (o): o is DownloadOutcome => o !== undefined,
  );
}
