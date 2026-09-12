export const FORM_VERSION = "shift-note-demo-v1";
export const definitions = [
  { key: "participant", label: "Participant", type: "text", placeholder: "Participant’s name", section: 1 },
  { key: "shiftStart", label: "Shift start", type: "datetime-local", section: 1 },
  { key: "shiftEnd", label: "Shift end", type: "datetime-local", section: 1 },
  { key: "activities", label: "Activities", type: "textarea", placeholder: "What did you do together?", section: 2 },
  { key: "supportProvided", label: "Support provided", type: "textarea", placeholder: "What assistance did you provide?", section: 2 },
  { key: "participantResponse", label: "Participant response", type: "textarea", placeholder: "What did you observe? Record anything you’re unsure about.", section: 2 },
  { key: "goalProgress", label: "Goal progress", type: "textarea", placeholder: "How did the activities relate to their goals? If unknown, say so.", section: 2 },
  { key: "incidents", label: "Incidents or concerns", type: "select", section: 3 },
  { key: "incidentDetails", label: "What happened and what you did", type: "textarea", placeholder: "Describe the concern and your response.", section: 3 },
  { key: "followUp", label: "Follow-up or handover", type: "select", section: 3 },
  { key: "followUpDetails", label: "What needs to happen next", type: "textarea", placeholder: "Add any follow-up or handover details.", section: 3 },
] as const;
export type FieldKey = typeof definitions[number]["key"];
export type ShiftFields = Record<FieldKey, string>;
export type ShiftNote = {
  id: string; fields: ShiftFields; revision: number; status: "draft" | "complete";
  createdAt: string; updatedAt: string; confirmedAt: string | null;
  workerName: string; formVersion: string; timezone: string;
};
export type FormIssue = { field: FieldKey; message: string };
export const incidentOptions = { unanswered: "Not answered", no: "No incidents or concerns", yes: "Yes — add details", unknown: "Not sure" };
export const followUpOptions = { unanswered: "Not answered", none: "No follow-up needed", needed: "Yes — add details", unknown: "Not sure" };
export const emptyFields = (): ShiftFields => ({ participant:"", shiftStart:"", shiftEnd:"", activities:"", supportProvided:"", participantResponse:"", goalProgress:"", incidents:"unanswered", incidentDetails:"", followUp:"unanswered", followUpDetails:"" });
export const labelFor = (key: FieldKey) => definitions.find(field => field.key === key)!.label;
export function applicable(key: FieldKey, fields: ShiftFields) {
  return !(key === "incidentDetails" && fields.incidents !== "yes") && !(key === "followUpDetails" && fields.followUp !== "needed");
}
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return false;
  const date = new Date(value + ":00Z");
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0,16) === value;
}
export function checkForm(fields: ShiftFields) {
  const issues: FormIssue[] = [];
  for (const {key,label} of definitions) {
    if (!applicable(key, fields)) continue;
    if (!fields[key].trim() || fields[key] === "unanswered") issues.push({ field: key, message: `Add or confirm ${label.toLowerCase()}.` });
  }
  for (const field of ["shiftStart","shiftEnd"] as const) if (fields[field] && !validDate(fields[field])) issues.push({field,message:`Enter a valid ${labelFor(field).toLowerCase()}.`});
  if (validDate(fields.shiftStart) && validDate(fields.shiftEnd) && fields.shiftEnd <= fields.shiftStart) issues.push({field:"shiftEnd",message:"The end must be after the start. For overnight shifts, use the next date."});
  const reviewReasons: string[] = [];
  if (fields.incidents === "yes") reviewReasons.push("Incident or concern recorded");
  if (fields.incidents === "unknown") reviewReasons.push("Incidents or concerns need confirmation");
  if (fields.followUp === "needed") reviewReasons.push("Follow-up needed");
  if (fields.followUp === "unknown") reviewReasons.push("Follow-up needs confirmation");
  if (/\b(unknown|not sure|not observed|uncertain|don['’]?t know)\b/i.test([fields.participantResponse,fields.goalProgress,fields.incidentDetails,fields.followUpDetails].join(" "))) reviewReasons.push("Some details are recorded as unknown");
  const total = definitions.filter(({key})=>applicable(key,fields)).length;
  const answered = total - new Set(issues.map(issue=>issue.field)).size;
  return { issues, reviewReasons, ready: issues.length === 0, answered, total };
}
export function applyFieldPatch(current: ShiftFields, patch: unknown): ShiftFields {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Invalid field update.");
  const next = { ...current };
  for (const [key,value] of Object.entries(patch)) {
    if (!definitions.some(field=>field.key===key) || typeof value !== "string") throw new Error("The update contains an unsupported field or value.");
    if (value.length > (key === "participant" ? 200 : 6000)) throw new Error("One of the answers is too long.");
    if (key === "incidents" && !Object.hasOwn(incidentOptions,value)) throw new Error("Choose a valid incident status.");
    if (key === "followUp" && !Object.hasOwn(followUpOptions,value)) throw new Error("Choose a valid follow-up status.");
    next[key as FieldKey]=value.trim();
  }
  if (next.incidents !== "yes") next.incidentDetails="";
  if (next.followUp !== "needed") next.followUpDetails="";
  return next;
}
export function answerText(key: FieldKey, value: string) {
  if (key === "incidents") return incidentOptions[value as keyof typeof incidentOptions] ?? value;
  if (key === "followUp") return followUpOptions[value as keyof typeof followUpOptions] ?? value;
  return value || "Not answered";
}
export function noteText(note: ShiftNote) {
  return ["SHIFT NOTE", "Demo form — temporary fields", `Worker: ${note.workerName}`, `Status: ${note.status}`, `Times: ${note.timezone}`, "", ...definitions.filter(({key})=>applicable(key,note.fields)).flatMap(({key,label})=>[label,answerText(key,note.fields[key]),""]), ...checkForm(note.fields).reviewReasons.map(reason=>`Review: ${reason}`), note.confirmedAt ? `Confirmed: ${note.confirmedAt}` : "Not yet confirmed"].join("\n");
}
