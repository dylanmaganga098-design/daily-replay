import JSZip from "jszip";

import { buildReport, exportFileName } from "./export";
import type { Analysis } from "./types";

export interface BundleOutcome {
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

function slug(analysis: Analysis): string {
  return exportFileName(analysis, "LIVE").replace(/^structure-scout_LIVE_/, "").replace(/\.txt$/, "");
}

/** Zips the LIVE + HISTORY reports, the source CSV and the verifier verdict, then auto-downloads. */
export async function downloadBundle(
  analysis: Analysis,
  options: { csv: string | null; csvName?: string | null; verdict?: string | null },
): Promise<BundleOutcome | undefined> {
  if (typeof document === "undefined") return undefined;

  const zip = new JSZip();
  zip.file(exportFileName(analysis, "LIVE"), buildReport(analysis, "LIVE"));
  zip.file(exportFileName(analysis, "HISTORY"), buildReport(analysis, "HISTORY"));
  if (options.csv) zip.file(options.csvName || "generator-ohlc.csv", options.csv);
  if (options.verdict) zip.file(`verifier-verdict_${slug(analysis)}.txt`, options.verdict);

  const blob = await zip.generateAsync({ type: "blob" });
  const fileName = `structure-scout_${slug(analysis)}.zip`;
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
    autoDownloaded = window.open(url, "_blank", "noopener") !== null;
  }

  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return { fileName, url, autoDownloaded };
}
