// Verifies every timestamp + OHLC value a model cites against the uploaded CSV.

export type CandleRow = {
  timestamp: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
};

export type Citation = {
  timestamp: string;
  quoted: string;
  valid: boolean;
  problems: string[];
  values: { field: "open" | "high" | "low" | "close"; cited: number; actual: number | null }[];
};

export type VerificationReport = {
  total: number;
  valid: Citation[];
  invalid: Citation[];
};

const TIMESTAMP_RE =
  /\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2})(?::\d{2})?)?\b/g;

const FIELD_ALIASES: Record<string, "open" | "high" | "low" | "close"> = {
  o: "open",
  open: "open",
  h: "high",
  high: "high",
  l: "low",
  low: "low",
  c: "close",
  close: "close",
};

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function num(value: string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalizes a timestamp to "YYYY-MM-DD HH:MM" (minute precision) or a date-only key. */
export function normalizeTimestamp(raw: string): string {
  const match = raw.trim().match(/(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
  if (!match) return raw.trim();
  return match[2] ? `${match[1]} ${match[2]}` : (match[1] as string);
}

/** Parses the exported CSV (which may contain day-header / weekend marker lines). */
export function parseOhlcCsv(csv: string | null): Map<string, CandleRow> {
  const rows = new Map<string, CandleRow>();
  if (!csv) return rows;

  const lines = csv.split(/\r?\n/);
  let header: string[] | null = null;

  for (const line of lines) {
    if (!line.trim()) continue;
    const cells = splitCsvLine(line);
    const first = (cells[0] ?? "").trim().toLowerCase();
    if (!header) {
      if (first === "datetime" || first.includes("datetime")) {
        header = cells.map((c) => c.trim().toLowerCase());
      }
      continue;
    }
    if (cells.length < 5) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test((cells[0] ?? "").trim())) continue;

    const get = (name: string) => {
      const index = header?.indexOf(name) ?? -1;
      return index >= 0 ? cells[index] : undefined;
    };
    const timestamp = normalizeTimestamp((cells[0] as string).trim());
    rows.set(timestamp, {
      timestamp,
      open: num(get("open")),
      high: num(get("high")),
      low: num(get("low")),
      close: num(get("close")),
    });
  }
  return rows;
}

function tolerance(actual: number): number {
  const magnitude = Math.abs(actual);
  // Allow rounding at the CSV's precision (2dp for most, looser for large prices).
  return Math.max(0.011, magnitude * 0.0005);
}

/**
 * Extracts every cited timestamp and any OHLC values stated near it, then
 * checks them against the CSV rows.
 */
export function verifyCitations(
  text: string,
  rows: Map<string, CandleRow>,
): VerificationReport {
  const valid: Citation[] = [];
  const invalid: Citation[] = [];
  const seen = new Set<string>();

  TIMESTAMP_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TIMESTAMP_RE.exec(text)) !== null) {
    const raw = match[0];
    const start = match.index;
    const rest = text.slice(start + raw.length, start + 260);
    const nextTs = rest.search(/\d{4}-\d{2}-\d{2}/);
    const window = raw + (nextTs >= 0 ? rest.slice(0, nextTs) : rest);
    const key = normalizeTimestamp(raw);

    const values: Citation["values"] = [];
    const valueRe =
      /\b(open|high|low|close|[OHLC])\s*(?:=|:|\sat\s|\sof\s|\s)\s*\$?(\d+(?:\.\d+)?)/gi;
    let valueMatch: RegExpExecArray | null;
    while ((valueMatch = valueRe.exec(window)) !== null) {
      const field = FIELD_ALIASES[(valueMatch[1] as string).toLowerCase()];
      const cited = Number(valueMatch[2]);
      if (!field || !Number.isFinite(cited)) continue;
      if (values.some((v) => v.field === field)) continue;
      values.push({ field, cited, actual: null });
    }

    const dedupeKey = `${key}|${values.map((v) => `${v.field}:${v.cited}`).join(",")}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const problems: string[] = [];
    const row = rows.get(key);

    if (!row) {
      // A date-only citation is acceptable if any candle exists on that day.
      const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(key);
      const dayExists =
        dayOnly && [...rows.keys()].some((k) => k.startsWith(key));
      if (!dayExists) problems.push(`timestamp ${key} does not exist in the CSV`);
    } else {
      for (const value of values) {
        const actual = row[value.field];
        value.actual = actual;
        if (actual == null) {
          problems.push(`${value.field} missing in CSV for ${key}`);
        } else if (Math.abs(actual - value.cited) > tolerance(actual)) {
          problems.push(
            `${value.field} cited ${value.cited} but CSV has ${actual} at ${key}`,
          );
        }
      }
    }

    const citation: Citation = {
      timestamp: key,
      quoted: window.split("\n")[0]?.slice(0, 140) ?? raw,
      valid: problems.length === 0,
      problems,
      values,
    };
    (citation.valid ? valid : invalid).push(citation);
  }

  return { total: valid.length + invalid.length, valid, invalid };
}

export function formatInvalidCitations(report: VerificationReport): string {
  return report.invalid
    .map((c, i) => `${i + 1}. ${c.timestamp} — ${c.problems.join("; ")}`)
    .join("\n");
}
