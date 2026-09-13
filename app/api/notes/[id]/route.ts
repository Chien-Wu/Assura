import { recorderFields } from "@/lib/shift-form";
import { applyFieldPatch, checkForm } from "@/lib/shift-form";
import {
  database,
  failure,
  getRow,
  getReadableRow,
  identity,
  json,
  RequestError,
  toNote,
  readBody,
} from "@/lib/notes-server";
import { readSafety, rpPatch, type FieldState } from "@/lib/safety";
import { participantFor, participantForNote } from "@/lib/participants";
import {
  auditStatements,
  safetyContext,
  workerTranscript,
} from "@/lib/audit-server";
import { getVoiceSession } from "@/lib/voice-server";
import { questionAnswerStatements } from "@/lib/interview-server";
import {
  noCurrentAssessmentSql,
  rejectRecorderDuringAssessment,
} from "@/lib/assessment-server";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const row = await getReadableRow(id, user);
    return json(await safetyContext(id, row.owner_id));
  } catch (error) {
    return failure(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    const row = await getRow(id, user.userId);
    if (row.status === "complete")
      throw new RequestError("This note has already been confirmed.", 409);
    if (body.revision !== row.revision)
      throw new RequestError(
        "The saved note has changed. Reload it before making further changes.",
        409,
      );
    let fields;
    try {
      fields = applyFieldPatch(JSON.parse(row.fields_json), body.fields);
    } catch (error) {
      throw new RequestError(
        error instanceof Error ? error.message : "Invalid fields.",
      );
    }
    const source = body.voiceSessionId ? "agent" : "manual";
    if (body.voiceSessionId) {
      await getVoiceSession(body.voiceSessionId, user.userId, id);
      await rejectRecorderDuringAssessment(id, user.userId);
      if (
        Object.keys(body.fields as object).some(
          (key) =>
            !recorderFields.includes(key as (typeof recorderFields)[number]),
        ) ||
        body.restrictivePractice !== undefined ||
        body.questionUpdates !== undefined
      )
        throw new RequestError(
          "The recorder collects basic shift facts. Additional concerns and questions belong to follow-up.",
          409,
        );
    }
    const savedNote = toNote(row);
    if (
      savedNote.shiftId &&
      fields.participant !== savedNote.fields.participant
    )
      throw new RequestError(
        "The participant belongs to this shift. Choose another shift to write a different participant's note.",
      );
    const profile = savedNote.shiftId
      ? participantForNote(savedNote)
      : participantFor(fields.participant);
    if (fields.participant && !profile)
      throw new RequestError("Choose one of the demo participant profiles.");
    if (
      source === "agent" &&
      fields.participant !== JSON.parse(row.fields_json).participant
    )
      throw new RequestError(
        "The participant is fixed for this conversation. Use the selected profile.",
      );
    const safety = readSafety(row.safety_json);
    const corpus = await workerTranscript(id, user.userId);
    const flags = toNote(row).riskFlags ?? [];
    const supplied = (
      body.fieldStates && typeof body.fieldStates === "object"
        ? body.fieldStates
        : {}
    ) as Record<string, { state?: FieldState; quote?: string }>;
    const warnings: string[] = [];
    for (const key of Object.keys(body.fields as object)) {
      let value = fields[key as keyof typeof fields];
      const evidence = supplied[key];
      const causal =
        /\b(?:because|therefore|due to|resulted in|helped|recovered after|improved after)\b/i;
      if (source === "agent" && causal.test(value) && !causal.test(corpus)) {
        warnings.push(
          `Unsupported causation in ${key} was not saved. Preserve observations without adding causes or outcomes.`,
        );
        value = JSON.parse(row.fields_json)[key];
        fields[key as keyof typeof fields] = value;
      }
      const negative =
        /^(?:no|none|no incidents(?: or concerns)?|no follow-up needed)$/i.test(
          value,
        );
      let state: FieldState =
        !value ||
        /^(?:unanswered|unknown|not reviewed|not sure|unsure|i don['’]?t know)$/i.test(
          value,
        )
          ? "not_reviewed"
          : negative
            ? "stated_negative"
            : "stated_positive";
      if (source === "agent" && negative) {
        const quote = evidence?.quote;
        const exact =
          typeof quote === "string" &&
          quote.trim().length > 2 &&
          corpus.includes(quote);
        const explicit =
          key === "incidents"
            ? /\bno (?:incidents?|concerns?|accidents?)\b/i
            : key === "followUp"
              ? /\b(?:no follow[ -]?up|no (?:further )?(?:actions?|handover)(?: needed|required)?|nothing (?:needs|needed) (?:following|follow)[ -]?up)\b/i
              : null;
        if (!exact || (explicit && !explicit.test(quote!))) {
          state = "not_reviewed";
          warnings.push(
            `${key} has no explicit worker evidence for absence; keep it open.`,
          );
        } else safety.evidence[key] = quote!;
      }
      if (
        (key === "incidents" || key === "followUp") &&
        negative &&
        flags.some((f) => f.severity === "urgent")
      ) {
        state = "not_reviewed";
        warnings.push(
          "Recorded risk facts remain flagged despite a negative answer or disagreement.",
        );
      }
      if (
        state === "not_reviewed" &&
        negative &&
        (key === "incidents" || key === "followUp")
      )
        fields[key] = "unknown";
      safety.fieldStates[key] = state;
    }
    if (body.restrictivePractice !== undefined) {
      try {
        safety.restrictivePractice = rpPatch(
          safety.restrictivePractice,
          body.restrictivePractice,
        );
      } catch (error) {
        throw new RequestError(
          error instanceof Error
            ? error.message
            : "Invalid restrictive practice.",
        );
      }
      if (
        source === "agent" &&
        safety.restrictivePractice.used === "no" &&
        !/\bno (?:restrictive practices|restraints|restrictions)\b/i.test(
          corpus,
        )
      )
        safety.restrictivePractice.used = "not_reviewed";
      if (
        flags.some((flag) => flag.code === "CANDIDATE_RESTRICTIVE_PRACTICE") &&
        safety.restrictivePractice.used === "no"
      )
        safety.restrictivePractice.used = "unsure";
    }
    const mutationId = crypto.randomUUID();
    // AI2 assesses the saved facts and their changes. Do not create a second,
    // competing set of keyword classifications during recorder capture.
    const questionStatements = await questionAnswerStatements(
      row,
      body.voiceSessionId,
      body.questionUpdates,
      mutationId,
    );
    const result = await database().batch([
      database()
        .prepare(
          "UPDATE shift_notes SET fields_json=?,safety_json=?,mutation_id=?, revision=revision+1, updated_at=?, confirmation_id=NULL, review_version=NULL WHERE id=? AND owner_id=? AND revision=? AND status='draft'" +
            (source === "agent"
              ? " AND " +
                noCurrentAssessmentSql +
                " AND EXISTS (SELECT 1 FROM voice_sessions v WHERE v.id=? AND v.note_id=shift_notes.id AND v.owner_id=shift_notes.owner_id AND v.expires_at>? AND COALESCE(json_extract(v.state_json,'$.closed'),0)=0)"
              : ""),
        )
        .bind(
          JSON.stringify(fields),
          JSON.stringify(safety),
          mutationId,
          new Date().toISOString(),
          id,
          user.userId,
          row.revision,
          ...(source === "agent"
            ? [body.voiceSessionId, new Date().toISOString()]
            : []),
        ),
      ...auditStatements(row, { ...fields, safety }, source, mutationId),
      ...questionStatements,
    ]);
    if (!result[0].meta.changes)
      throw new RequestError(
        "Another update arrived first. Reload the saved note.",
        409,
      );
    return json({
      ...(await safetyContext(id, user.userId)),
      validation: checkForm(fields),
      warnings,
    });
  } catch (error) {
    return failure(error);
  }
}
