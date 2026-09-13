import {
  database,
  failure,
  identity,
  json,
  listProviderNotes,
  RequestError,
} from "@/lib/notes-server";
import { listProviderParticipants } from "@/lib/roster-server";
import {
  monthlyParticipantUses,
  providerParticipantUsesQuery,
  type ParticipantUse,
} from "@/lib/roster";
import { reportingGuidance } from "@/lib/safety";
import { requireManager } from "@/lib/organisations";
import {
  providerRisksQuery,
  providerActionsQuery,
} from "@/lib/organisation-access";
export async function GET(request: Request) {
  try {
    const user = await identity(request);
    const manager = await requireManager(
      user,
      new URL(request.url).searchParams.get("providerId"),
    );
    const month =
      new URL(request.url).searchParams.get("month") ??
      new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month))
      throw new RequestError("Choose a valid reporting month.");
    const [notes, risks, actions, uses, participants] = await Promise.all([
      listProviderNotes(manager.providerId),
      database().prepare(providerRisksQuery).bind(manager.providerId).all<{
        id: string;
        note_id: string;
        data_json: string;
        captured_at: string;
        inbox_at: string | null;
      }>(),
      database().prepare(providerActionsQuery).bind(manager.providerId).all<{
        id: string;
        risk_id: string;
        action: string;
        details_json: string;
        actor: string;
        created_at: string;
      }>(),
      database()
        .prepare(providerParticipantUsesQuery)
        .bind(manager.providerId, month)
        .all<ParticipantUse>(),
      listProviderParticipants(manager.providerId),
    ]);
    const incidents = risks.results.map((risk) => {
      const history = actions.results
        .filter((action) => action.risk_id === risk.id)
        .map((a) => ({ ...a, details: JSON.parse(a.details_json) }));
      const aware =
        history
          .map((a) => a.details.providerBecameAwareAt)
          .filter(Boolean)
          .sort()[0] ?? null;
      const eventAt =
        history.filter((a) => a.details.eventAt).at(-1)?.details.eventAt ??
        null;
      const notified =
        history
          .map((a) => a.details.commissionNotifiedAt)
          .filter(Boolean)
          .sort()[0] ?? null;
      return {
        id: risk.id,
        noteId: risk.note_id,
        ...JSON.parse(risk.data_json),
        inboxAt: risk.inbox_at,
        notificationStatus: "in_app_only",
        providerBecameAwareAt: aware,
        eventAt,
        commissionNotifiedAt: notified,
        eventToAwarenessMinutes:
          eventAt && aware
            ? (Date.parse(aware) - Date.parse(eventAt)) / 60000
            : null,
        awarenessToCommissionMinutes:
          aware && notified
            ? (Date.parse(notified) - Date.parse(aware)) / 60000
            : null,
        assessment:
          history.filter((a) => a.details.assessment).at(-1)?.details
            .assessment ?? "Needs review",
        history,
      };
    });
    const monthly = monthlyParticipantUses(participants, uses.results, month);
    return json({
      notes,
      incidents,
      monthly,
      month,
      provider: { id: manager.providerId, name: manager.providerName },
      reportingGuidance,
      audience: `${manager.providerName} — service provider records`,
      delivery:
        "In-app inbox only. No external message or Commission submission is sent.",
    });
  } catch (error) {
    return failure(error);
  }
}
