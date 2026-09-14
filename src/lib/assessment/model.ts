import { riskAssessmentSystemPrompt } from "./prompt.ts";
import { riskParticipantBackgroundSchema } from "./participant-background.ts";
import {
  riskResultJsonSchema,
  RiskValidationError,
  validateRiskResult,
  type RiskModelInput,
  type RiskResult,
} from "./result.ts";

export const defaultRiskAssessmentModel = "gpt-5.6-terra";
export const riskAssessmentInputByteLimit = 180_000;
export const riskAssessmentResponseByteLimit = 60_000;
const requestTimeoutMs = 35_000;

type RiskAssessmentModelErrorCode =
  | "setup_required"
  | "input_too_large"
  | "invalid_input"
  | "provider_error"
  | "rate_limited"
  | "timeout"
  | "cancelled"
  | "refused"
  | "incomplete"
  | "invalid_output";

const messages: Record<RiskAssessmentModelErrorCode, string> = {
  setup_required:
    "Risk check needs to be configured. Your draft has been saved.",
  input_too_large:
    "This shift account exceeds the risk check limit. Your draft remains saved.",
  invalid_input:
    "The saved assessment context could not be prepared. Your draft has been saved.",
  provider_error:
    "Risk check is temporarily unavailable. Your draft remains saved. Please retry.",
  rate_limited:
    "Risk check is busy. Your draft remains saved. Please retry shortly.",
  timeout: "Risk check took too long. Your draft remains saved. Please retry.",
  cancelled:
    "Risk check was interrupted. Your draft remains saved. Please retry.",
  refused:
    "Risk check could not assess this account. Your draft remains saved for review.",
  incomplete:
    "Risk check did not finish. Your draft remains saved. Please retry.",
  invalid_output:
    "Risk check could not verify its result. Your draft remains saved. Please retry.",
};

export class RiskAssessmentModelError extends Error {
  readonly code: RiskAssessmentModelErrorCode;
  constructor(code: RiskAssessmentModelErrorCode) {
    super(messages[code]);
    this.name = "RiskAssessmentModelError";
    this.code = code;
  }
}

type RiskAssessmentModelOptions = {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
};

function serialiseInput(input: RiskModelInput): string {
  if (!input || !Array.isArray(input.sources) || input.sources.length === 0)
    throw new RiskAssessmentModelError("invalid_input");
  const ids = new Set<string>();
  for (const source of input.sources) {
    if (
      !source ||
      typeof source.id !== "string" ||
      !source.id.trim() ||
      source.id.length > 160 ||
      ids.has(source.id) ||
      typeof source.text !== "string"
    )
      throw new RiskAssessmentModelError("invalid_input");
    ids.add(source.id);
  }
  let encoded: string;
  try {
    // Only the four approved background fields may accompany the shift account.
    // Legacy full profiles, history and messages are not forwarded.
    encoded = JSON.stringify({
      note: input.note,
      sources: input.sources.map(({ id, text }) => ({ id, text })),
      participantBackground:
        input.participantBackground == null
          ? null
          : riskParticipantBackgroundSchema.parse(input.participantBackground),
    });
  } catch {
    throw new RiskAssessmentModelError("invalid_input");
  }
  // Reject rather than truncate: omitted events must never look like no events.
  if (new TextEncoder().encode(encoded).length > riskAssessmentInputByteLimit)
    throw new RiskAssessmentModelError("input_too_large");
  return encoded;
}

async function boundedResponse(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (length > riskAssessmentResponseByteLimit) {
    await response.body?.cancel();
    throw new RiskAssessmentModelError("invalid_output");
  }
  if (!response.body) throw new RiskAssessmentModelError("invalid_output");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let count = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > riskAssessmentResponseByteLimit) {
        await reader.cancel();
        throw new RiskAssessmentModelError("invalid_output");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new RiskAssessmentModelError("invalid_output");
  }
}

function readOutput(response: unknown): unknown {
  if (!response || typeof response !== "object")
    throw new RiskAssessmentModelError("invalid_output");
  const data = response as Record<string, unknown>;
  if (data.status === "incomplete")
    throw new RiskAssessmentModelError("incomplete");
  if (data.status !== "completed" || data.error)
    throw new RiskAssessmentModelError("provider_error");
  if (!Array.isArray(data.output))
    throw new RiskAssessmentModelError("invalid_output");
  const parts: string[] = [];
  for (const item of data.output) {
    if (!item || typeof item !== "object")
      throw new RiskAssessmentModelError("invalid_output");
    if (item.type === "reasoning") continue;
    if (
      item.type !== "message" ||
      item.role !== "assistant" ||
      item.status !== "completed" ||
      !Array.isArray(item.content)
    )
      throw new RiskAssessmentModelError("invalid_output");
    for (const content of item.content) {
      if (content?.type === "refusal")
        throw new RiskAssessmentModelError("refused");
      if (content?.type !== "output_text" || typeof content.text !== "string")
        throw new RiskAssessmentModelError("invalid_output");
      parts.push(content.text);
    }
  }
  if (parts.length !== 1) throw new RiskAssessmentModelError("invalid_output");
  try {
    return JSON.parse(parts[0]);
  } catch {
    throw new RiskAssessmentModelError("invalid_output");
  }
}

/** Official API shape checked 2026-09-13:
 * https://developers.openai.com/api/docs/guides/structured-outputs
 * https://developers.openai.com/api/docs/models/gpt-5.6-terra
 * No interview, full profile/history, stored provider conversation, tools or raw logs. */
export async function runRiskAssessmentModel(
  input: RiskModelInput,
  options: RiskAssessmentModelOptions,
): Promise<RiskResult> {
  if (!options.apiKey?.trim())
    throw new RiskAssessmentModelError("setup_required");
  const encoded = serialiseInput(input);
  const model = options.model?.trim() || defaultRiskAssessmentModel;
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model))
    throw new RiskAssessmentModelError("setup_required");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) throw new RiskAssessmentModelError("cancelled");
  options.signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        instructions: riskAssessmentSystemPrompt,
        input: [
          { role: "user", content: [{ type: "input_text", text: encoded }] },
        ],
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "shift_risk_check",
            strict: true,
            schema: riskResultJsonSchema,
          },
        },
        max_output_tokens: 2200,
        store: false,
        truncation: "disabled",
        tools: [],
      }),
    });
    if (!response.ok) {
      // Provider error bodies can echo input. Never expose or log them.
      await response.body?.cancel();
      throw new RiskAssessmentModelError(
        response.status === 429
          ? "rate_limited"
          : response.status === 401 || response.status === 403
            ? "setup_required"
            : "provider_error",
      );
    }
    return validateRiskResult(
      readOutput(await boundedResponse(response)),
      input,
    );
  } catch (error) {
    if (error instanceof RiskAssessmentModelError) throw error;
    if (error instanceof RiskValidationError)
      throw new RiskAssessmentModelError("invalid_output");
    if (controller.signal.aborted)
      throw new RiskAssessmentModelError(timedOut ? "timeout" : "cancelled");
    throw new RiskAssessmentModelError("provider_error");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
