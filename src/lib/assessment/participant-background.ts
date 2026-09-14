import { z } from "zod";

const backgroundFieldsSchema = z.object({
  conditions: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  communication: z.string().default(""),
  setting: z.string().default(""),
});

// Strip every unlisted field again at the model boundary, including nested
// metadata. A snapshot timestamp is not a profile update or effective date.
export const riskParticipantBackgroundSchema = z.object({
  source: z.object({
    kind: z.literal("saved_note_participant_snapshot"),
    noteId: z.string().trim().min(1),
    participantId: z.string().trim().min(1),
    capturedAt: z.iso.datetime(),
    profileUpdatedAt: z.null(),
  }),
  fields: backgroundFieldsSchema,
});

export type RiskParticipantBackground = z.infer<
  typeof riskParticipantBackgroundSchema
>;

export function createRiskParticipantBackground(input: {
  snapshot: unknown;
  noteId: string;
  participantId: string | null;
  capturedAt: string;
}): RiskParticipantBackground | null {
  const snapshot = backgroundFieldsSchema
    .extend({ id: z.string().min(1) })
    .safeParse(input.snapshot);
  if (
    !snapshot.success ||
    !input.participantId ||
    snapshot.data.id !== input.participantId
  )
    return null;
  const background = riskParticipantBackgroundSchema.safeParse({
    source: {
      kind: "saved_note_participant_snapshot",
      noteId: input.noteId,
      participantId: input.participantId,
      capturedAt: input.capturedAt,
      profileUpdatedAt: null,
    },
    fields: snapshot.data,
  });
  return background.success ? background.data : null;
}
