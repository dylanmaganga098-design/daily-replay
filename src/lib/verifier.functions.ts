import { createServerFn } from "@tanstack/react-start";

export const VERIFIER_SYSTEM_PROMPT = `I'm sending this app's own analysis output: the SUMMARY block, the Live/Actionable PASS setups list
(with setup_status), the Overlaps section, and the raw 30M OHLC with precomputed columns (is_reliable,
atr_30m, similar_swing_retrace_pct, similar_swing_refs) and metadata (data_age, spread_convention,
atr_method, similar_swing_selection_rule). Find the one trade worth taking from the PASS list — any
strategy the data already validated. Prefer a limit order at an untouched level over forcing a
market entry.

Gate: confirm all 4 metadata fields are present and at least one Live/Actionable setup exists. If
either is missing, say so and stop — don't compute substitutes.

Rules:
- Every Entry/SL/TP/RR is already computed and verified by this app — use them exactly as given,
  never recompute or re-derive them from OHLC.
- Entry/SL/TP are already spread-adjusted. Do not apply spread_convention yourself — it's already
  been applied once, at the final step, by this app.
- Trust setup_status as given: only consider setups marked PENDING or FILLED. Never pick RESOLVED
  or EXPIRED.
- Safety filter — exclude before considering: any setup with RR > 15, or where SL sits on the wrong
  side of entry for its direction (SL >= entry for long, SL <= entry for short). These indicate
  broken math and must never be picked, regardless of which strategy produced them.
- If citing any candle beyond the setup's own trigger candle (e.g. supporting structure), cite only
  is_reliable=true rows — trust the flag.
- Use atr_30m and similar_swing_retrace_pct/similar_swing_refs directly, don't recompute. For limit
  entries, check distance vs similar_swing_retrace_pct using cited similar_swing_refs; flag
  atypically deep retracement with no move toward it, prefer the next setup.
- Prioritize fill probability over max RR; avoid the deepest zone edge unless a full retrace is
  likely.
- State data_age, diffed vs today, in the output.
- Every structural claim cites timestamp + OHLC.
- Silently weigh >=2 setups from the list; state why the weaker one was rejected, citing the specific
  failing value.
- If SL sits exactly at a visible swing point, flag the stop-cluster risk rather than assuming it's
  safe.
- If nothing on the list clears RR > 1:2 with strong TP-before-SL odds, or the best one barely
  qualifies, say so plainly instead of forcing a pick.

Do ONE of the following:
1. PICK the single best currently-live setup.
2. JOIN two setups if they reinforce each other — same direction, overlapping zone, or one confirms
   the other. State plainly why joining is stronger than either alone.
3. SPOT a setup the ranking undersold — state explicitly what the ranking missed and why it matters.

Output: Path Taken (Pick/Join/Spot), Entry Type, Direction, Entry, SL, TP, RR (as given, already
spread-adjusted)
Trade Summary: Source Strategy(ies) / Entry Reason / SL Justification / TP Justification /
Invalidation Window / Data Age / Confidence (H/M/L)`;

const OPENROUTER_MODELS = [
  "deepseek/deepseek-r1:free",
  "deepseek/deepseek-r1-0528:free",
  "deepseek/deepseek-chat-v3-0324:free",
];

const NVIDIA_MODELS = ["deepseek-ai/deepseek-r1-0528", "deepseek-ai/deepseek-r1"];

export interface VerifyResult {
  verdict: string;
  provider: "openrouter" | "nvidia";
  model: string;
  warnings: string[];
}

interface ChatResponse {
  choices?: { message?: { content?: string; reasoning?: string } }[];
  error?: { message?: string };
}

async function callChat(
  url: string,
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 2000 }),
  });

  const text = await res.text();
  let payload: ChatResponse = {};
  try {
    payload = JSON.parse(text) as ChatResponse;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    throw new Error(payload.error?.message ?? `${res.status} ${text.slice(0, 300)}`);
  }
  const choice = payload.choices?.[0]?.message;
  const content = (choice?.content ?? "").trim() || (choice?.reasoning ?? "").trim();
  if (!content) throw new Error("empty response from model");
  return content;
}

const OHLC_CHAR_LIMIT = 60_000;

function trimCsv(csv: string): string {
  if (csv.length <= OHLC_CHAR_LIMIT) return csv;
  const lines = csv.split("\n");
  const head = lines.slice(0, 2).join("\n");
  const tail: string[] = [];
  let size = head.length;
  for (let i = lines.length - 1; i > 1; i--) {
    const line = lines[i] as string;
    if (size + line.length > OHLC_CHAR_LIMIT) break;
    size += line.length;
    tail.unshift(line);
  }
  return `${head}\n${tail.join("\n")}\n(note: older rows truncated to fit the context window)`;
}

export const verifySetup = createServerFn({ method: "POST" })
  .inputValidator((input: { scoutData: string; ohlcCsv?: string }) => {
    if (!input || typeof input.scoutData !== "string" || input.scoutData.trim() === "") {
      throw new Error("Analyzer output is required");
    }
    return input;
  })
  .handler(async ({ data }): Promise<VerifyResult> => {
    const userContent = [
      "--- ANALYZER OUTPUT (SUMMARY + LIVE/ACTIONABLE PASS setups + Overlaps) ---",
      data.scoutData.trim(),
      "",
      "--- RAW 30M OHLC WITH PRECOMPUTED COLUMNS AND METADATA ---",
      trimCsv((data.ohlcCsv ?? "").trim()) || "(none supplied)",
    ].join("\n");

    const messages = [
      { role: "system", content: VERIFIER_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ];

    const warnings: string[] = [];
    const openRouterKey = process.env["OPENROUTER_API_KEY"];
    const nvidiaKey = process.env["NVIDIA_API_KEY"];

    if (openRouterKey) {
      // Free DeepSeek R1 slugs, newest first — OpenRouter retires them periodically.
      for (const model of OPENROUTER_MODELS) {
        try {
          const verdict = await callChat(
            "https://openrouter.ai/api/v1/chat/completions",
            openRouterKey,
            model,
            messages,
            {
              "HTTP-Referer": "https://structure-scout.lovable.app",
              "X-Title": "Structure Scout",
            },
          );
          return { verdict, provider: "openrouter", model, warnings };
        } catch (error) {
          warnings.push(
            `OpenRouter ${model} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } else {
      warnings.push("OPENROUTER_API_KEY is not configured");
    }

    if (!nvidiaKey) {
      throw new Error(
        `Verifier unavailable. ${warnings.join(" | ")} | NVIDIA_API_KEY is not configured`,
      );
    }

    for (const model of NVIDIA_MODELS) {
      try {
        const verdict = await callChat(
          "https://integrate.api.nvidia.com/v1/chat/completions",
          nvidiaKey,
          model,
          messages,
        );
        return { verdict, provider: "nvidia", model, warnings };
      } catch (error) {
        warnings.push(
          `NVIDIA NIM ${model} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    throw new Error(`Verifier failed. ${warnings.join(" | ")}`);
  });
