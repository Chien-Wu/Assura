import {
  assessmentOutputJsonSchema,
  AssessmentValidationError,
  validateAssessmentOutput,
  type AssessmentModelInput,
  type AssessmentOutput,
} from "./assessment.ts";
import { assessmentSystemPrompt } from "./assessment-prompt.ts";

export const defaultAssessmentModel = "gpt-5.6-terra";
export const assessmentInputByteLimit = 180_000;
export const assessmentResponseByteLimit = 160_000;
const requestTimeoutMs = 55_000;

export type AssessmentModelErrorCode =
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

const messages: Record<AssessmentModelErrorCode, string> = {
  setup_required:
    "AI review needs to be configured. Your draft has been saved.",
  input_too_large:
    "This shift account exceeds the AI review limit. Your draft and answers remain saved.",
  invalid_input:
    "The saved assessment context could not be prepared. Your draft has been saved.",
  provider_error:
    "AI review is temporarily unavailable. Your draft and answers remain saved. Please retry.",
  rate_limited:
    "AI review is busy. Your draft and answers remain saved. Please retry shortly.",
  timeout:
    "AI review took too long. Your draft and answers remain saved. Please retry.",
  cancelled:
    "AI review was interrupted. Your draft and answers remain saved. Please retry.",
  refused:
    "AI review could not assess this account. Your draft and answers remain saved for review.",
  incomplete:
    "AI review did not finish. Your draft and answers remain saved. Please retry.",
  invalid_output:
    "AI review could not verify its result. Your draft and answers remain saved. Please retry.",
};

export class AssessmentModelError extends Error {
  readonly code: AssessmentModelErrorCode;
  constructor(code: AssessmentModelErrorCode) {
    super(messages[code]);
    this.name = "AssessmentModelError";
    this.code = code;
  }
}

export type AssessmentModelOptions = {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
};

function serialiseInput(input: AssessmentModelInput): string {
  if (
    !input ||
    !Array.isArray(input.sources) ||
    input.sources.length === 0 ||
    !Array.isArray(input.messages)
  )
    throw new AssessmentModelError("invalid_input");
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
      throw new AssessmentModelError("invalid_input");
    ids.add(source.id);
  }
  for (const message of input.messages) {
    if (
      !message ||
      !["assistant", "user"].includes(message.role) ||
      typeof message.text !== "string" ||
      (message.questionId !== null && typeof message.questionId !== "string")
    )
      throw new AssessmentModelError("invalid_input");
  }
  let encoded: string;
  try {
    encoded = JSON.stringify({
      note: input.note,
      profile: input.profile,
      history: input.history,
      sources: input.sources,
      messages: input.messages,
      previous: input.previous,
    });
  } catch {
    throw new AssessmentModelError("invalid_input");
  }
  // Reject rather than truncate: omitted events must never look like no events.
  if (new TextEncoder().encode(encoded).length > assessmentInputByteLimit)
    throw new AssessmentModelError("input_too_large");
  return encoded;
}

async function boundedResponse(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length"));
  if (length > assessmentResponseByteLimit) {
    await response.body?.cancel();
    throw new AssessmentModelError("invalid_output");
  }
  if (!response.body) throw new AssessmentModelError("invalid_output");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let count = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      count += chunk.value.byteLength;
      if (count > assessmentResponseByteLimit) {
        await reader.cancel();
        throw new AssessmentModelError("invalid_output");
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
    throw new AssessmentModelError("invalid_output");
  }
}

function readOutput(response: unknown): unknown {
  if (!response || typeof response !== "object")
    throw new AssessmentModelError("invalid_output");
  const data = response as Record<string, unknown>;
  if (data.status === "incomplete")
    throw new AssessmentModelError("incomplete");
  if (data.status !== "completed" || data.error)
    throw new AssessmentModelError("provider_error");
  if (!Array.isArray(data.output))
    throw new AssessmentModelError("invalid_output");
  const parts: string[] = [];
  for (const item of data.output) {
    if (!item || typeof item !== "object")
      throw new AssessmentModelError("invalid_output");
    if (item.type === "reasoning") continue;
    if (
      item.type !== "message" ||
      item.role !== "assistant" ||
      item.status !== "completed" ||
      !Array.isArray(item.content)
    )
      throw new AssessmentModelError("invalid_output");
    for (const content of item.content) {
      if (content?.type === "refusal")
        throw new AssessmentModelError("refused");
      if (content?.type !== "output_text" || typeof content.text !== "string")
        throw new AssessmentModelError("invalid_output");
      parts.push(content.text);
    }
  }
  if (parts.length !== 1) throw new AssessmentModelError("invalid_output");
  try {
    return JSON.parse(parts[0]);
  } catch {
    throw new AssessmentModelError("invalid_output");
  }
}

/** Official API shape checked 2026-09-13:
 * https://developers.openai.com/api/docs/guides/structured-outputs
 * https://developers.openai.com/api/docs/models/gpt-5.6-terra
 * No stored provider conversation, external tools, silent truncation or raw logs. */
export async function runAssessmentModel(
  input: AssessmentModelInput,
  options: AssessmentModelOptions,
): Promise<AssessmentOutput> {
  if (!options.apiKey?.trim()) throw new AssessmentModelError("setup_required");
  const encoded = serialiseInput(input);
  const model = options.model?.trim() || defaultAssessmentModel;
  if (!/^[a-zA-Z0-9._:-]{1,100}$/.test(model))
    throw new AssessmentModelError("setup_required");
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (options.signal?.aborted) throw new AssessmentModelError("cancelled");
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
        instructions: assessmentSystemPrompt,
        input: [
          { role: "user", content: [{ type: "input_text", text: encoded }] },
        ],
        reasoning: { effort: "low" },
        text: {
          format: {
            type: "json_schema",
            name: "shift_assessment",
            strict: true,
            schema: assessmentOutputJsonSchema,
          },
        },
        max_output_tokens: 8000,
        store: false,
        truncation: "disabled",
        tools: [],
      }),
    });
    if (!response.ok) {
      // Provider error bodies can echo input. Never expose or log them.
      await response.body?.cancel();
      throw new AssessmentModelError(
        response.status === 429
          ? "rate_limited"
          : response.status === 401 || response.status === 403
            ? "setup_required"
            : "provider_error",
      );
    }
    return validateAssessmentOutput(
      readOutput(await boundedResponse(response)),
      input,
    );
  } catch (error) {
    if (error instanceof AssessmentModelError) throw error;
    if (error instanceof AssessmentValidationError)
      throw new AssessmentModelError("invalid_output");
    if (controller.signal.aborted)
      throw new AssessmentModelError(timedOut ? "timeout" : "cancelled");
    throw new AssessmentModelError("provider_error");
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
