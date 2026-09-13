import type { ShiftAssessment } from "./assessment.ts";

export const assessmentAudioByteLimit = 5 * 1024 * 1024;
export const assessmentAudioBodyByteLimit = 7 * 1024 * 1024;
export const assessmentAudioDurationMs = 90_000;
export const assessmentAudioMimeTypes = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
  "audio/ogg",
] as const;
const transcriptByteLimit = 200_000;

export type AssessmentAudioRequest = {
  assessmentId: string;
  revision: number;
  questionId: string;
  mimeType: string;
  durationMs: number;
  audio: Uint8Array<ArrayBuffer>;
};
export type AssessmentAudioErrorCode =
  | "invalid_audio"
  | "too_large"
  | "too_long"
  | "stale_question"
  | "setup_required"
  | "provider_error"
  | "no_speech"
  | "cancelled"
  | "timeout";
const errorMessages: Record<AssessmentAudioErrorCode, string> = {
  invalid_audio:
    "This recording could not be read. Please record again or type your answer.",
  too_large:
    "This recording is too large. Record a shorter answer or type it instead.",
  too_long: "Record an answer of 90 seconds or less, or type your answer.",
  stale_question:
    "The question has changed. Please answer the current question.",
  setup_required:
    "Voice transcription is unavailable. You can still type your answer.",
  provider_error:
    "The recording could not be transcribed. Please try again or type your answer.",
  no_speech:
    "No speech was found in the recording. Please try again or type your answer.",
  cancelled:
    "Voice transcription was cancelled. You can still type your answer.",
  timeout:
    "Voice transcription took too long. Please try again or type your answer.",
};
export class AssessmentAudioError extends Error {
  readonly code: AssessmentAudioErrorCode;
  readonly status: number;
  constructor(code: AssessmentAudioErrorCode, status = 400) {
    super(errorMessages[code]);
    this.name = "AssessmentAudioError";
    this.code = code;
    this.status = status;
  }
}

async function boundedJson(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
  errorCode: AssessmentAudioErrorCode,
): Promise<unknown> {
  if (!body) throw new AssessmentAudioError(errorCode);
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let content = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new AssessmentAudioError(
          errorCode,
          errorCode === "too_large" ? 413 : 502,
        );
      }
      content += decoder.decode(chunk.value, { stream: true });
    }
    content += decoder.decode();
    return JSON.parse(content);
  } catch (error) {
    if (error instanceof AssessmentAudioError) throw error;
    throw new AssessmentAudioError(errorCode);
  } finally {
    reader.releaseLock();
  }
}

export function normaliseAssessmentAudioMimeType(value: string): string | null {
  const mime = value.toLowerCase().replace(/[\s"]/g, "");
  if (/^audio\/(?:webm|ogg)(?:;codecs=opus)?$/.test(mime)) return mime;
  if (/^audio\/mp4(?:;codecs=mp4a\.40\.2)?$/.test(mime)) return mime;
  return null;
}

function audioHeaderMatches(audio: Uint8Array, mime: string): boolean {
  if (audio.length < 12) return false;
  if (mime.startsWith("audio/webm"))
    return [0x1a, 0x45, 0xdf, 0xa3].every(
      (byte, index) => audio[index] === byte,
    );
  const signature = (offset: number, text: string) =>
    [...text].every(
      (character, index) => audio[offset + index] === character.charCodeAt(0),
    );
  if (mime.startsWith("audio/ogg")) return signature(0, "OggS");
  return signature(4, "ftyp");
}

export async function readAssessmentAudioRequest(
  request: Request,
): Promise<AssessmentAudioRequest> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > assessmentAudioBodyByteLimit) {
    await request.body?.cancel();
    throw new AssessmentAudioError("too_large", 413);
  }
  const value = await boundedJson(
    request.body,
    assessmentAudioBodyByteLimit,
    "too_large",
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AssessmentAudioError("invalid_audio");
  const data = value as Record<string, unknown>;
  const allowed = [
    "assessmentId",
    "revision",
    "questionId",
    "mimeType",
    "durationMs",
    "audioBase64",
  ];
  if (
    Object.keys(data).some((key) => !allowed.includes(key)) ||
    typeof data.assessmentId !== "string" ||
    !data.assessmentId ||
    data.assessmentId.length > 160 ||
    !Number.isSafeInteger(data.revision) ||
    Number(data.revision) < 0 ||
    typeof data.questionId !== "string" ||
    !data.questionId ||
    data.questionId.length > 160 ||
    typeof data.mimeType !== "string" ||
    data.mimeType.length > 100 ||
    typeof data.audioBase64 !== "string"
  )
    throw new AssessmentAudioError("invalid_audio");
  if (
    typeof data.durationMs !== "number" ||
    !Number.isFinite(data.durationMs) ||
    data.durationMs < 100 ||
    data.durationMs > assessmentAudioDurationMs
  )
    throw new AssessmentAudioError("too_long");
  const mimeType = normaliseAssessmentAudioMimeType(data.mimeType);
  if (!mimeType) throw new AssessmentAudioError("invalid_audio", 415);
  const base64 = data.audioBase64;
  if (base64.length > Math.ceil(assessmentAudioByteLimit / 3) * 4)
    throw new AssessmentAudioError("too_large", 413);
  if (
    !base64.length ||
    base64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    throw new AssessmentAudioError("invalid_audio");
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    throw new AssessmentAudioError("invalid_audio");
  }
  if (binary.length > assessmentAudioByteLimit)
    throw new AssessmentAudioError("too_large", 413);
  if (btoa(binary) !== base64) throw new AssessmentAudioError("invalid_audio");
  const audio = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    audio[index] = binary.charCodeAt(index);
  if (!audioHeaderMatches(audio, mimeType))
    throw new AssessmentAudioError("invalid_audio", 415);
  return {
    assessmentId: data.assessmentId,
    revision: Number(data.revision),
    questionId: data.questionId,
    mimeType,
    durationMs: data.durationMs,
    audio,
  };
}

export function requireCurrentAudioQuestion(
  assessment: ShiftAssessment | null,
  request: Pick<
    AssessmentAudioRequest,
    "assessmentId" | "revision" | "questionId"
  >,
): void {
  if (
    !assessment ||
    assessment.status !== "needs_answer" ||
    assessment.id !== request.assessmentId ||
    assessment.revision !== request.revision ||
    assessment.result?.action !== "ask_question" ||
    assessment.result.nextQuestion?.id !== request.questionId
  )
    throw new AssessmentAudioError("stale_question", 409);
}

/** Audio is forwarded in memory only. Provider retention follows the configured
 * ElevenLabs account policy; this endpoint does not promise provider zero retention.
 * API checked 2026-09-13: https://elevenlabs.io/docs/api-reference/speech-to-text/convert */
export async function transcribeAssessmentAudio(
  request: AssessmentAudioRequest,
  options: {
    apiKey: string;
    signal?: AbortSignal;
    readCurrent: () => Promise<ShiftAssessment | null>;
  },
): Promise<string> {
  requireCurrentAudioQuestion(await options.readCurrent(), request);
  if (!options.apiKey?.trim())
    throw new AssessmentAudioError("setup_required", 503);
  if (options.signal?.aborted) throw new AssessmentAudioError("cancelled", 409);
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);
  try {
    const form = new FormData();
    const extension = request.mimeType.startsWith("audio/mp4")
      ? "m4a"
      : request.mimeType.startsWith("audio/ogg")
        ? "ogg"
        : "webm";
    form.append(
      "file",
      new Blob([request.audio], { type: request.mimeType }),
      `answer.${extension}`,
    );
    form.append("model_id", "scribe_v2");
    form.append("tag_audio_events", "false");
    form.append("diarize", "false");
    form.append("timestamps_granularity", "none");
    const response = await fetch(
      "https://api.elevenlabs.io/v1/speech-to-text",
      {
        method: "POST",
        headers: { "xi-api-key": options.apiKey },
        body: form,
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new AssessmentAudioError(
        response.status === 401 || response.status === 403
          ? "setup_required"
          : "provider_error",
        503,
      );
    }
    const value = await boundedJson(
      response.body,
      transcriptByteLimit,
      "provider_error",
    );
    if (
      !value ||
      typeof value !== "object" ||
      typeof (value as { text?: unknown }).text !== "string"
    )
      throw new AssessmentAudioError("provider_error", 502);
    const text = (value as { text: string }).text.trim();
    if (!text) throw new AssessmentAudioError("no_speech");
    if (text.length > 6000) throw new AssessmentAudioError("too_long");
    // A result from an old/answered question is never returned to the composer.
    requireCurrentAudioQuestion(await options.readCurrent(), request);
    if (controller.signal.aborted)
      throw new AssessmentAudioError(timedOut ? "timeout" : "cancelled", 409);
    return text;
  } catch (error) {
    if (controller.signal.aborted)
      throw new AssessmentAudioError(timedOut ? "timeout" : "cancelled", 409);
    if (error instanceof AssessmentAudioError) throw error;
    throw new AssessmentAudioError("provider_error", 503);
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
