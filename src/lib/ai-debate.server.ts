// Server-only helpers that stream two Lovable AI models against each other.
const GATEWAY = "https://ai.gateway.lovable.dev/v1";

export const GEMINI_MODEL = "google/gemini-3.1-pro-preview";
export const OPENAI_MODEL = "openai/gpt-5.6-sol";

export type Turn = {
  role: "user" | "assistant";
  speaker: "gemini" | "gpt" | "system";
  text: string;
};

export type ChartImage = { name: string; timeframe: string; pngDataUrl: string };

type DeltaHandler = (text: string) => void | Promise<void>;

async function readSse(
  response: Response,
  onEvent: (payload: unknown) => void | Promise<void>,
) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Model response had no body");
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        await onEvent(JSON.parse(data));
      } catch {
        // ignore keep-alive / non-JSON frames
      }
    }
  }
}

async function assertOk(response: Response, model: string) {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  if (response.status === 429) {
    throw new Error(`${model} is rate limited. Please retry in a moment.`);
  }
  if (response.status === 402) {
    throw new Error(
      "AI credits are exhausted. Add credits in your workspace billing settings to continue.",
    );
  }
  throw new Error(`${model} request failed (${response.status}): ${body.slice(0, 400)}`);
}

function geminiContent(text: string, images: ChartImage[]) {
  const parts: unknown[] = [{ type: "text", text }];
  for (const image of images) {
    parts.push({ type: "image_url", image_url: { url: image.pngDataUrl } });
  }
  return parts;
}

/** Gemini via the gateway chat-completions path (multimodal, streaming). */
export async function streamGemini(
  apiKey: string,
  system: string,
  turns: Turn[],
  images: ChartImage[],
  onDelta: DeltaHandler,
): Promise<string> {
  const messages: unknown[] = [{ role: "system", content: system }];
  turns.forEach((turn, index) => {
    const attachImages = index === 0 && turn.role === "user";
    messages.push({
      role: turn.role,
      content: attachImages ? geminiContent(turn.text, images) : turn.text,
    });
  });

  const response = await fetch(`${GATEWAY}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({ model: GEMINI_MODEL, messages, stream: true }),
  });
  await assertOk(response, "Gemini");

  let full = "";
  await readSse(response, async (payload) => {
    const chunk = payload as {
      choices?: { delta?: { content?: string } }[];
    };
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      full += delta;
      await onDelta(delta);
    }
  });
  return full;
}

/** GPT via the gateway Responses API (multimodal, streaming). */
export async function streamOpenAI(
  apiKey: string,
  system: string,
  turns: Turn[],
  images: ChartImage[],
  onDelta: DeltaHandler,
): Promise<string> {
  const input: unknown[] = [];
  turns.forEach((turn, index) => {
    if (turn.role === "assistant") {
      input.push({
        role: "assistant",
        content: [{ type: "output_text", text: turn.text }],
      });
      return;
    }
    const content: unknown[] = [{ type: "input_text", text: turn.text }];
    if (index === 0) {
      for (const image of images) {
        content.push({ type: "input_image", image_url: image.pngDataUrl });
      }
    }
    input.push({ role: "user", content });
  });

  const response = await fetch(`${GATEWAY}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      instructions: system,
      input,
      stream: true,
      store: false,
      reasoning: { effort: "medium" },
    }),
  });
  await assertOk(response, "GPT");

  let full = "";
  await readSse(response, async (payload) => {
    const event = payload as { type?: string; delta?: string };
    if (event.type === "response.output_text.delta" && event.delta) {
      full += event.delta;
      await onDelta(event.delta);
    }
  });
  return full;
}

export function extractVerdict(text: string): "AGREE" | "REVISE" {
  const matches = text.toUpperCase().match(/VERDICT:\s*(AGREE|REVISE)/g);
  if (!matches || matches.length === 0) return "REVISE";
  const last = matches[matches.length - 1] as string;
  return last.includes("AGREE") ? "AGREE" : "REVISE";
}
