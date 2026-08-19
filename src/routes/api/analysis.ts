import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  extractVerdict,
  streamGemini,
  streamOpenAI,
  type ChartImage,
  type Turn,
} from "@/lib/ai-debate.server";
import {
  formatInvalidCitations,
  parseOhlcCsv,
  verifyCitations,
  type Citation,
} from "@/lib/citation-verify";

const RequestSchema = z.object({
  symbol: z.string().min(1),
  range: z.string().default(""),
  ohlcCsv: z.string().nullable().default(null),
  charts: z
    .array(
      z.object({
        name: z.string(),
        timeframe: z.string(),
        pngDataUrl: z.string(),
      }),
    )
    .default([]),
  summaryFields: z.string().min(1),
});

const MAX_ROUNDS = 6;

const CSV_CHAR_LIMIT = 60_000;

function trimCsv(csv: string | null): string {
  if (!csv) return "(no OHLC CSV was provided)";
  if (csv.length <= CSV_CHAR_LIMIT) return csv;
  const lines = csv.split("\n");
  const header = lines[0] ?? "";
  const tail: string[] = [];
  let size = header.length;
  for (let i = lines.length - 1; i > 0; i--) {
    const line = lines[i] as string;
    if (size + line.length > CSV_CHAR_LIMIT) break;
    size += line.length;
    tail.unshift(line);
  }
  return `${header}\n${tail.join("\n")}\n(note: older rows were truncated to fit the context window)`;
}

const VERDICT_RULE = `
End EVERY message with a final line exactly of the form "VERDICT: AGREE" (the current plan is Pass — no open issues) or "VERDICT: REVISE" (changes are still needed).`;

const GENERATOR_PROMPT = `3 charts (4H/1H/30M) + 1 month 30M OHLC with is_reliable, atr_30m, similar_swing_retrace_pct, similar_swing_refs + metadata (data_age, spread_convention, atr_method, similar_swing_selection_rule). Find one trade, any strategy. Prefer limit at untouched-but-real level over forced market entry.

Gate: confirm all 4 row fields + 4 metadata fields present, else stop. Skip null rows, don't estimate.

Rules: Prices from OHLC only, charts = context. Cite only is_reliable=true. Use atr_30m/similar_swing_retrace_pct/refs directly, don't recompute. Spread_convention applies only at final Entry/SL/TP. Don't trade setup quality for fill probability — check similar_swing_refs: of historical touches at this depth, did price mostly continue or reverse? State this as Historical Follow-Through (ratio + sample size); if thin/unclear, say so. Limit entries must reference a real touched price. If SL sits at visible swing point, push past stop-cluster or flag it. If nothing clears RR>1:2 + good odds post-spread, say so. State data_age vs today. Every structural claim cites timestamp+OHLC. Weigh >=2 setups silently, state why weaker was rejected.

Output: Entry Type/Direction/Entry/SL/TP/RR (spread-adjusted) + Structure/Entry Reason/SL Justification/TP Justification/Historical Follow-Through/Invalidation Window/Data Age/Confidence.${VERDICT_RULE}`;

const STRESS_PROMPT = `Trade thesis + 3 charts + 1 month 30M OHLC (same fields/metadata as the generator). Stress-test — weak assumptions, bad levels, bad RR math. Don't invent flaws.

Gate: confirm all 4 row fields + 4 metadata fields present, else stop. Skip null rows, don't estimate.

Rules: cite contradicting candle for every challenge, is_reliable=true only. Recompute RR from literal entry/SL/TP, spread-adjusted, show math. SL<atr_30m = tight, >=1.5x = structural, 1x-1.5x = salvageable only if Historical Follow-Through is stated and favorable, else flag "Follow-Through Unverified." Counter-trend ok if reversal signal at entry. Verify cited candle matches claim. Entry must be real touched price, not just reachable. Flag TP/SL near round numbers over data-derived levels. State data_age.

Kill Summary: Weakest Assumption / SL Problem / Counter-Trend Check / TP Problem / RR Reality / Fill Probability / Follow-Through Check / Data Age / Verdict (Kill/Salvageable/Pass).${VERDICT_RULE}`;

function summarizeCitation(citation: Citation) {
  return {
    timestamp: citation.timestamp,
    quoted: citation.quoted,
    problems: citation.problems,
    values: citation.values,
  };
}

function encodeEvent(event: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(event)}\n`);
}

async function handlePost({ request }: { request: Request }) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "AI is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let parsed: z.infer<typeof RequestSchema>;
  try {
    parsed = RequestSchema.parse(await request.json());
  } catch (error) {
    return new Response(JSON.stringify({ error: `Invalid request: ${String(error)}` }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { symbol, range, summaryFields } = parsed;
  const images: ChartImage[] = parsed.charts.slice(0, 3);
  const csv = trimCsv(parsed.ohlcCsv);
  const csvRows = parseOhlcCsv(parsed.ohlcCsv);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(encodeEvent(event));
      };

      const log = (level: "info" | "warn" | "error", message: string) => {
        console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
          `[analysis] ${message}`,
        );
        send({ type: "log", level, message, at: new Date().toISOString() });
      };

      try {
        if (csvRows.size === 0) {
          log("warn", "No parsable OHLC rows found — citations cannot be verified.");
        } else {
          log("info", `Loaded ${csvRows.size} OHLC candles for citation verification.`);
        }

        const dataBlock = [
          `SYMBOL: ${symbol}`,
          `DATA RANGE: ${range || "unspecified"}`,
          `CHART SCREENSHOTS ATTACHED: ${images.map((c) => c.timeframe.toUpperCase()).join(", ") || "none"}`,
          "",
          "ENRICHED 30-MINUTE OHLC DATA (CSV):",
          csv,
        ].join("\n");

        const turns: Turn[] = [
          {
            role: "user",
            speaker: "system",
            text: `${dataBlock}\n\nGenerator, run your brief now on this data and produce the single trade.`,
          },
        ];

        const verifyTurn = (model: "gemini" | "gpt", text: string) => {
          const report = verifyCitations(text, csvRows);
          send({
            type: "citations",
            model,
            total: report.total,
            valid: report.valid.map(summarizeCitation),
            invalid: report.invalid.map(summarizeCitation),
          });
          if (report.invalid.length > 0) {
            log(
              "warn",
              `${model === "gemini" ? "Gemini" : "ChatGPT"} produced ${report.invalid.length} invalid citation(s) out of ${report.total}.`,
            );
          } else {
            log(
              "info",
              `${model === "gemini" ? "Gemini" : "ChatGPT"} citations verified (${report.valid.length} checked).`,
            );
          }
          return report;
        };

        let agreed = false;
        let attempt = 0;
        let citationsClean = false;

        while (attempt < MAX_ROUNDS && !agreed) {
          attempt += 1;

          send({ type: "turn-start", model: "gemini" });
          const geminiText = await streamGemini(
            apiKey,
            GENERATOR_PROMPT,
            turns,
            images,
            (delta) => send({ type: "delta", model: "gemini", text: delta }),
          );
          const geminiReport = verifyTurn("gemini", geminiText);
          let geminiVerdict = extractVerdict(geminiText);
          if (geminiReport.invalid.length > 0) geminiVerdict = "REVISE";
          send({ type: "turn-end", model: "gemini", verdict: geminiVerdict });
          turns.push({ role: "assistant", speaker: "gemini", text: geminiText });

          const geminiCitationNote =
            geminiReport.invalid.length > 0
              ? `\n\nAUTOMATED CITATION CHECK — the following citations in the thesis above do NOT match the CSV and must be treated as invalid:\n${formatInvalidCitations(geminiReport)}\nChallenge these explicitly; the plan cannot pass while any citation is invalid.`
              : "";

          turns.push({
            role: "user",
            speaker: "system",
            text: `The above is the current trade thesis. Stress-tester, run your brief on it now and output the Kill Summary.${geminiCitationNote}`,
          });

          send({ type: "turn-start", model: "gpt" });
          const gptText = await streamOpenAI(
            apiKey,
            STRESS_PROMPT,
            turns,
            images,
            (delta) => send({ type: "delta", model: "gpt", text: delta }),
          );
          const gptReport = verifyTurn("gpt", gptText);
          let gptVerdict = extractVerdict(gptText);
          if (gptReport.invalid.length > 0) gptVerdict = "REVISE";
          send({ type: "turn-end", model: "gpt", verdict: gptVerdict });
          turns.push({ role: "assistant", speaker: "gpt", text: gptText });

          citationsClean = geminiReport.invalid.length === 0 && gptReport.invalid.length === 0;
          agreed = geminiVerdict === "AGREE" && gptVerdict === "AGREE" && citationsClean;
          if (agreed) {
            send({ type: "status", message: "Both models agreed and all citations verified." });
            break;
          }

          const invalidNote = [...geminiReport.invalid, ...gptReport.invalid].length
            ? `\n\nAUTOMATED CITATION CHECK — invalid citations detected in this exchange:\n${formatInvalidCitations({
                total: 0,
                valid: [],
                invalid: [...geminiReport.invalid, ...gptReport.invalid],
              })}\nRe-quote each one from the CSV verbatim or drop the claim. VERDICT: AGREE is not allowed while any citation is invalid.`
            : "";

          turns.push({
            role: "user",
            speaker: "system",
            text: `Generator, address the Kill Summary: fix or defend each point with timestamp+OHLC citations and restate the full trade per your output format.${invalidNote}`,
          });
        }

        if (!agreed) {
          log(
            "warn",
            citationsClean
              ? "Debate ended without full agreement — writing the best converged summary."
              : "Debate ended with unresolved invalid citations — signal withheld.",
          );
          send({
            type: "status",
            message: citationsClean
              ? "Ended without full agreement — writing the best converged summary."
              : "Unresolved invalid citations — the final signal is withheld.",
          });
        }

        const finalStatus = agreed
          ? "AGREE"
          : citationsClean
            ? "NO_SIGNAL"
            : "REVIEW_REQUIRED";
        send({ type: "final-status", status: finalStatus });

        send({ type: "summary-start" });
        turns.push({
          role: "user",
          speaker: "system",
          text: `The debate is finished. Write the FINAL SUMMARY as plain text only — no markdown, no commentary before or after.
Fill in every field of this exact template, keeping the field names, order and dash bullets exactly as given. Replace each dash bullet with a real point (add or remove bullets only where the content requires it):

${summaryFields}

Rules: values must be consistent with the debate's agreed plan and the OHLC data. Use "unknown / not derivable from data" where the data cannot support a value. Data Age should state how recent the last candle is relative to the data range given.
FINAL STATUS: ${finalStatus}. ${
            finalStatus === "AGREE"
              ? "Output the agreed signal."
              : finalStatus === "NO_SIGNAL"
                ? 'No tradable signal was agreed. Start the summary with the single line "NO_SIGNAL" and fill only the fields the data supports.'
                : 'Citations could not be verified against the CSV. Start the summary with the single line "REVIEW_REQUIRED" and list the unverified citations under Structural Risk Check.'
          }`,
        });

        const summary = await streamOpenAI(apiKey, STRESS_PROMPT, turns, images, (delta) => {
          send({ type: "delta", model: "summary", text: delta });
        });

        send({ type: "summary", text: summary.trim(), status: finalStatus });
        log("info", `Analysis complete — final status ${finalStatus}.`);
        send({ type: "done", agreed, status: finalStatus });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const level: "warn" | "error" = /rate limit|429|credits/i.test(message)
          ? "warn"
          : "error";
        log(level, message);
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export const Route = createFileRoute("/api/analysis")({
  server: {
    handlers: {
      POST: handlePost,
    },
  },
});
