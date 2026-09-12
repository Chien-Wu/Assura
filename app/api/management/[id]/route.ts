import {
  database,
  failure,
  identity,
  json,
  readBody,
  RequestError,
} from "@/lib/notes-server";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity(request);
    const { id } = await context.params;
    const body = await readBody(request);
    const risk = await database()
      .prepare("SELECT id FROM risk_events WHERE id=? AND owner_id=?")
      .bind(id, user.userId)
      .first();
    if (!risk) throw new RequestError("Review item not found.", 404);
    const details: Record<string, string> = {};
    for (const key of [
      "eventAt",
      "providerBecameAwareAt",
      "commissionNotifiedAt",
      "awarenessSource",
      "comment",
      "assessment",
    ]) {
      if (body[key] === undefined || body[key] === "") continue;
      if (typeof body[key] !== "string" || (body[key] as string).length > 6000)
        throw new RequestError("Invalid review details.");
      details[key] = body[key] as string;
    }
    for (const key of [
      "eventAt",
      "providerBecameAwareAt",
      "commissionNotifiedAt",
    ])
      if (details[key]) {
        if (
          !/Z$|[+-]\d\d:\d\d$/.test(details[key]) ||
          !Number.isFinite(Date.parse(details[key])) ||
          Date.parse(details[key]) > Date.now()
        )
          throw new RequestError("Use a valid past timestamp with a timezone.");
        details[key] = new Date(details[key]).toISOString();
      }
    if (details.providerBecameAwareAt && !details.awarenessSource)
      throw new RequestError(
        "Record who became aware and how the time was established.",
      );
    if (
      details.assessment &&
      ![
        "Needs review",
        "Reportable — supervisor assessed",
        "Not reportable — supervisor assessed",
      ].includes(details.assessment)
    )
      throw new RequestError("Choose a review status.");
    if (
      details.assessment &&
      details.assessment !== "Needs review" &&
      !details.comment
    )
      throw new RequestError(
        "Record the supervisor's reason. Original flags remain retained.",
      );
    if (!Object.keys(details).length)
      throw new RequestError("Add an acknowledgement, facts, or assessment.");
    await database()
      .prepare(
        "INSERT INTO risk_actions (id,risk_id,owner_id,action,details_json,actor,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        crypto.randomUUID(),
        id,
        user.userId,
        "supervisor_review",
        JSON.stringify(details),
        user.userId,
        new Date().toISOString(),
      )
      .run();
    return json({
      ok: true,
      message:
        "Review entry added. Previous entries and original flags remain unchanged.",
    });
  } catch (error) {
    return failure(error);
  }
}
