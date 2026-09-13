"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Participant, PlanItem } from "@/lib/roster/participant-profiles";
import { Plus, X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { request } from "./roster-api";
type Profile = Omit<Participant, "id">;
const blankProfile = (): Profile => ({
  name: "",
  ndis: "",
  dateOfBirth: null,
  setting: "",
  conditions: [],
  risks: [],
  communication: "",
  mealtimePlan: "",
  seizureProtocol: "",
  behaviourPlan: false,
  medications: [],
  goals: [],
  plan: [],
});
export default function ParticipantEditor({
  participant,
  query,
  onCancel,
  onSaved,
}: {
  participant: Participant | null;
  query: string;
  onCancel: () => void;
  onSaved: (participant: Participant) => Promise<void>;
}) {
  const [profile, setProfile] = useState<Profile>(() => {
    if (!participant) return blankProfile();
    const copy = { ...participant };
    Reflect.deleteProperty(copy, "id");
    return copy;
  });
  const [conditions, setConditions] = useState(
    participant?.conditions.join("\n") ?? "",
  );
  const [risks, setRisks] = useState(participant?.risks.join("\n") ?? "");
  const [goals, setGoals] = useState(participant?.goals.join("\n") ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) =>
    setProfile((previous) => ({ ...previous, [key]: value }));
  const updateMedication = (
    index: number,
    patch: Partial<Profile["medications"][number]>,
  ) =>
    update(
      "medications",
      profile.medications.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  const updatePlan = (index: number, patch: Partial<PlanItem>) =>
    update(
      "plan",
      profile.plan.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    const lines = (value: string) =>
      value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    try {
      const saved = await request<{ participant: Participant }>(
        `/api/participants${participant ? `/${encodeURIComponent(participant.id)}` : ""}?${query}`,
        participant ? "PATCH" : "POST",
        {
          profile: {
            ...profile,
            name: profile.name.trim(),
            conditions: lines(conditions),
            risks: lines(risks),
            goals: lines(goals),
          },
        },
      );
      await onSaved(saved.participant);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to save participant details.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      className="roster-form"
      onSubmit={(event) => void submit(event)}
      aria-labelledby="participant-editor-heading"
    >
      <div className="roster-form-heading">
        <div>
          <h2 id="participant-editor-heading">
            {participant ? "Edit participant" : "New participant"}
          </h2>
          <p>Enter recorded care information. Only the name is required.</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close participant form"
          disabled={saving}
          onClick={onCancel}
        >
          <X size={18} />
        </Button>
      </div>
      <fieldset disabled={saving}>
        <div className="roster-fields">
          <label>
            Full name <span aria-hidden="true">*</span>
            <Input
              required
              maxLength={120}
              value={profile.name}
              onChange={(event) => update("name", event.target.value)}
              autoFocus
            />
          </label>
          <label>
            Date of birth
            <Input
              type="date"
              value={profile.dateOfBirth ?? ""}
              onChange={(event) =>
                update("dateOfBirth", event.target.value || null)
              }
            />
          </label>
          <label>
            NDIS / participant reference
            <Input
              maxLength={80}
              value={profile.ndis}
              onChange={(event) => update("ndis", event.target.value)}
            />
          </label>
          <label>
            Care setting
            <Input
              value={profile.setting}
              onChange={(event) => update("setting", event.target.value)}
            />
          </label>
          <label className="roster-field-wide">
            Communication preferences
            <Textarea
              value={profile.communication}
              onChange={(event) => update("communication", event.target.value)}
              rows={2}
            />
          </label>
          <label>
            Conditions<span className="roster-field-help">One per line</span>
            <Textarea
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              rows={3}
            />
          </label>
          <label>
            Known risks<span className="roster-field-help">One per line</span>
            <Textarea
              value={risks}
              onChange={(event) => setRisks(event.target.value)}
              rows={3}
            />
          </label>
          <label>
            Recorded mealtime plan
            <Textarea
              value={profile.mealtimePlan}
              onChange={(event) => update("mealtimePlan", event.target.value)}
              rows={3}
            />
          </label>
          <label>
            Recorded seizure protocol
            <Textarea
              value={profile.seizureProtocol ?? ""}
              onChange={(event) =>
                update("seizureProtocol", event.target.value)
              }
              rows={3}
            />
          </label>
          <label className="roster-field-wide">
            Goals<span className="roster-field-help">One per line</span>
            <Textarea
              value={goals}
              onChange={(event) => setGoals(event.target.value)}
              rows={3}
            />
          </label>
        </div>
        <details className="roster-details">
          <summary>Medications ({profile.medications.length})</summary>
          <p className="roster-field-help">
            Copy details from the participant’s recorded plan.
          </p>
          {profile.medications.map((medication, index) => (
            <div className="roster-detail-row" key={index}>
              <div className="roster-fields">
                <label>
                  Medication name
                  <Input
                    required
                    value={medication.name}
                    onChange={(event) =>
                      updateMedication(index, { name: event.target.value })
                    }
                  />
                </label>
                <label>
                  Recorded instructions
                  <Input
                    value={medication.description}
                    onChange={(event) =>
                      updateMedication(index, {
                        description: event.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <div className="roster-row-actions">
                <label className="roster-checkbox">
                  <input
                    type="checkbox"
                    checked={medication.routine}
                    onChange={(event) =>
                      updateMedication(index, { routine: event.target.checked })
                    }
                  />
                  Routine prescribed medication
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update(
                      "medications",
                      profile.medications.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove medication {index + 1}
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update("medications", [
                ...profile.medications,
                { name: "", description: "", routine: false },
              ])
            }
          >
            <Plus size={15} />
            Add medication
          </Button>
        </details>
        <details className="roster-details">
          <summary>
            Behaviour support and restrictive practices ({profile.plan.length})
          </summary>
          <label className="roster-checkbox">
            <input
              type="checkbox"
              checked={profile.behaviourPlan}
              onChange={(event) =>
                update("behaviourPlan", event.target.checked)
              }
            />
            Behaviour support plan recorded
          </label>
          {profile.plan.map((item, index) => (
            <div className="roster-detail-row" key={index}>
              <div className="roster-fields">
                <label>
                  Plan item reference
                  <Input
                    required
                    value={item.id}
                    onChange={(event) =>
                      updatePlan(index, { id: event.target.value })
                    }
                  />
                </label>
                <label>
                  Category
                  <select
                    className="roster-select"
                    value={item.category}
                    onChange={(event) =>
                      updatePlan(index, { category: event.target.value })
                    }
                  >
                    <option value="">Select category</option>
                    <option value="chemical">Chemical</option>
                    <option value="environmental">Environmental</option>
                    <option value="mechanical">Mechanical</option>
                    <option value="physical">Physical</option>
                    <option value="seclusion">Seclusion</option>
                    {item.category &&
                      ![
                        "chemical",
                        "environmental",
                        "mechanical",
                        "physical",
                        "seclusion",
                      ].includes(item.category) && (
                        <option value={item.category}>{item.category}</option>
                      )}
                  </select>
                </label>
                <label>
                  Description
                  <Input
                    required
                    value={item.description}
                    onChange={(event) =>
                      updatePlan(index, { description: event.target.value })
                    }
                  />
                </label>
                <label>
                  Recorded behaviour
                  <Input
                    value={item.behaviour}
                    onChange={(event) =>
                      updatePlan(index, { behaviour: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="roster-fields roster-limit-fields">
                <label>
                  Maximum minutes
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.maxMinutes ?? ""}
                    onChange={(event) =>
                      updatePlan(index, {
                        maxMinutes:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Maximum dose (mg)
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.maxDoseMg ?? ""}
                    onChange={(event) =>
                      updatePlan(index, {
                        maxDoseMg:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  Maximum uses / 24 h
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={item.maxUses24h ?? ""}
                    onChange={(event) =>
                      updatePlan(index, {
                        maxUses24h:
                          event.target.value === ""
                            ? undefined
                            : Number(event.target.value),
                      })
                    }
                  />
                </label>
              </div>
              <div className="roster-row-actions">
                <label className="roster-checkbox">
                  <input
                    type="checkbox"
                    checked={item.authorised}
                    onChange={(event) =>
                      updatePlan(index, { authorised: event.target.checked })
                    }
                  />
                  Authorisation recorded in the plan
                </label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    update(
                      "plan",
                      profile.plan.filter((_, i) => i !== index),
                    )
                  }
                >
                  Remove plan item {index + 1}
                </Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              update("plan", [
                ...profile.plan,
                {
                  id: `RP-${crypto.randomUUID().slice(0, 8)}`,
                  category: "",
                  description: "",
                  behaviour: "",
                  authorised: false,
                },
              ])
            }
          >
            <Plus size={15} />
            Add plan item
          </Button>
        </details>
      </fieldset>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div className="roster-form-footer">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save participant"}
        </Button>
      </div>
    </form>
  );
}
