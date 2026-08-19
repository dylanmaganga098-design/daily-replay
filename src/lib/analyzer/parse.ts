import { METADATA_FIELDS, type Candle, type Metadata } from "./types";

export interface ParseResult {
  meta?: Metadata;
  missingMetadataField?: string;
  metadataError?: string;
  candles: Candle[];
  totalRows: number;
}

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(field);
      field = "";
    } else field += ch;
  }
  out.push(field);
  return out.map((f) => f.trim());
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const cleaned = value.replace(/[%\s]/g, "");
  if (cleaned === "") return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const v = value.trim().toLowerCase();
  if (v === "") return undefined;
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return undefined;
}

function refs(value: string | undefined): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "[]") return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((r) => String(r).trim()).filter(Boolean);
  } catch {
    /* fall through to delimiter split */
  }
  return trimmed
    .replace(/^\[|\]$/g, "")
    .split(/[;|]/)
    .map((r) => r.replace(/^["']|["']$/g, "").trim())
    .filter(Boolean);
}

const DEFAULT_MARKERS = ["===", "---", "###", "***", "~~~"];

/**
 * Reads the generator's `section_marker_convention` text and pulls out the literal
 * marker tokens it documents (any run of 2+ symbol characters). Falls back to the
 * common markers when the field is absent or purely descriptive.
 */
export function sectionMarkers(convention: string | undefined): string[] {
  const found = convention ? (convention.match(/[=\-#*~_+>|]{2,}/g) ?? []) : [];
  const tokens = [...new Set(found)].filter((t) => t.length >= 2);
  return tokens.length > 0 ? tokens : DEFAULT_MARKERS;
}

/** True when a raw CSV line is a section/day divider rather than a candle row. */
export function isDividerLine(line: string, cells: string[], markers: string[]): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  const first = (cells[0] ?? "").trim();
  for (const marker of markers) {
    if (trimmed.startsWith(marker) || trimmed.endsWith(marker) || first.startsWith(marker)) {
      return true;
    }
  }
  // Safety net: a divider never carries numeric OHLC cells, so a row without any
  // numeric cell is a divider, not an INVALID candle row.
  const hasNumericCell = cells.some((cell) => {
    const value = cell.trim();
    return value !== "" && Number.isFinite(Number(value));
  });
  return !hasNumericCell;
}

/**
 * First non-empty line carries the JSON metadata header. It may be prefixed with
 * arbitrary text (e.g. `# metadata: `), so we parse from the first `{` onwards.
 */
export function parseCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) {
    return { candles: [], totalRows: 0, metadataError: "INVALID FILE: file is empty" };
  }

  let metaRaw: Record<string, unknown> = {};
  try {
    const firstLine = lines[0]!;
    const braceIndex = firstLine.indexOf("{");
    if (braceIndex === -1) throw new Error("no json object on metadata line");
    const first = firstLine.slice(braceIndex).trim();
    const parsed: unknown = JSON.parse(first);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not object");
    metaRaw = parsed as Record<string, unknown>;

  } catch {
    return {
      candles: [],
      totalRows: 0,
      metadataError: "INVALID FILE: metadata header line is not valid JSON",
    };
  }

  for (const field of METADATA_FIELDS) {
    const value = metaRaw[field];
    if (value === undefined || value === null || String(value).trim() === "") {
      return {
        candles: [],
        totalRows: 0,
        missingMetadataField: field,
        metadataError: `INVALID FILE: missing metadata field ${field}`,
      };
    }
  }

  const sectionConvention =
    metaRaw["section_marker_convention"] === undefined || metaRaw["section_marker_convention"] === null
      ? undefined
      : String(metaRaw["section_marker_convention"]).trim();

  const meta: Metadata = {
    data_age: String(metaRaw["data_age"]).trim(),
    spread_convention: String(metaRaw["spread_convention"]).trim(),
    atr_method: String(metaRaw["atr_method"]).trim(),
    similar_swing_selection_rule: String(metaRaw["similar_swing_selection_rule"]).trim(),
    section_marker_convention: sectionConvention,
  };

  const markers = sectionMarkers(sectionConvention);

  const header = splitCsvLine(lines[1] ?? "").map((h) => h.toLowerCase());
  const candles: Candle[] = [];

  for (let l = 2; l < lines.length; l++) {
    const cells = splitCsvLine(lines[l]!);
    // Section/day dividers are not data — detected via section_marker_convention
    // when present, with a marker/no-numeric-cells fallback otherwise.
    if (isDividerLine(lines[l]!, cells, markers)) continue;
    const raw: Record<string, string> = {};
    header.forEach((key, idx) => {
      raw[key] = cells[idx] ?? "";
    });
    const index = candles.length;
    const candle: Candle = {
      index,
      datetime: raw["datetime"] ?? "",
      open: num(raw["open"]),
      high: num(raw["high"]),
      low: num(raw["low"]),
      close: num(raw["close"]),
      direction: raw["direction"] || undefined,
      body: num(raw["body"]),
      upperWick: num(raw["upper_wick"]),
      lowerWick: num(raw["lower_wick"]),
      range: num(raw["range"]),
      bodyPercentOfRange: num(raw["body_percent_of_range"]),
      upperWickPct: num(raw["upper_wick_pct"]),
      lowerWickPct: num(raw["lower_wick_pct"]),
      displacement: raw["displacement"] || undefined,
      isReliable: bool(raw["is_reliable"]),
      localAvgRange: num(raw["local_avg_range"]),
      session: (raw["session"] || "").toLowerCase() || undefined,
      atr30m: num(raw["atr_30m"]),
      similarSwingRetracePct: num(raw["similar_swing_retrace_pct"]),
      similarSwingContinuedPct: num(raw["similar_swing_continued_pct"]),
      similarSwingRefs: refs(raw["similar_swing_refs"]),
      unresolvedRefs: [],
      swingInvalidated: bool(raw["swing_invalidated"]),
      reliableStreakLength: num(raw["reliable_streak_length"]),
      trend: "ranging",
      raw,
    };

    const coreMissing: string[] = [];
    if (candle.open === undefined) coreMissing.push("open");
    if (candle.high === undefined) coreMissing.push("high");
    if (candle.low === undefined) coreMissing.push("low");
    if (candle.close === undefined) coreMissing.push("close");
    if (candle.isReliable === undefined) coreMissing.push("is_reliable");
    if (coreMissing.length > 0) candle.invalid = "INVALID: missing core fields";

    candles.push(candle);
  }

  return { meta, candles, totalRows: candles.length };
}

/** Extracts a numeric spread from the free-text spread_convention value. */
export function parseSpread(convention: string): number {
  const match = convention.match(/-?\d+(\.\d+)?/);
  if (!match) return 0;
  const value = Number(match[0]);
  if (!Number.isFinite(value)) return 0;
  return /pip/i.test(convention) ? value * 0.0001 : value;
}