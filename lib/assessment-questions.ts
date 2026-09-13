// A compact intake bank adapted from the supplied NDIS Core Reporting Forms.
// These are prompts for worker observations, not an official reporting checklist.
export const assessmentQuestions: Record<string, string> = {
  "safety.now":
    "Is anyone currently in immediate danger, in need of urgent medical assistance, or potentially affected by a crime?",
  "screen.incident_safeguarding":
    "Did anything happen that caused, or could have caused, harm?",
  "screen.health_wellbeing":
    "Did you observe any change in the participant's health or wellbeing?",
  "screen.medication": "Was there any medication issue?",
  "screen.behaviour_restriction":
    "Was there a behaviour of concern or any restrictive practice?",
  "screen.complaint":
    "Did anyone express dissatisfaction, make an allegation, or raise a complaint?",
  "screen.service_exception":
    "Was any part of the service not delivered as planned?",
  "event.when": "When and where did this happen?",
  "event.before": "What happened immediately before the event?",
  "event.during":
    "What happened during the event, in chronological and objective terms?",
  "event.after": "What happened immediately after the event?",
  "event.affected": "Who was affected?",
  "event.impact":
    "What injury, symptoms, impact, or potential impact occurred?",
  "event.actions": "What immediate actions were taken?",
  "event.safe": "Is the participant safe now?",
  "event.words":
    "What did the participant say about the event, using their own words where possible?",
  "event.communication":
    "Does the participant need communication support, an advocate, nominee, family member, or interpreter?",
  "event.notified":
    "Were emergency services, police, a clinician, family, or management contacted?",
  "event.evidence": "What evidence or documents were preserved?",
  "event.outcome": "What was the final outcome?",
  "event.followup": "Who is responsible for follow-up, and by when?",
  "redflag.death": "Did the event involve a death?",
  "redflag.serious_injury": "Could the event have involved a serious injury?",
  "redflag.abuse_neglect": "Could the event have involved abuse or neglect?",
  "redflag.assault":
    "Could the event have involved unlawful physical or sexual contact, or assault?",
  "redflag.sexual_misconduct":
    "Could the event have involved sexual misconduct or grooming?",
  "redflag.restriction":
    "Could a restrictive practice have been used without authorisation or outside the active behaviour support plan?",
  "health.baseline": "What is the participant's normal baseline?",
  "health.change": "What is different now?",
  "health.onset": "When was the change first observed?",
  "health.pattern":
    "Was the change sudden, gradual, intermittent, or recurring?",
  "health.observations": "What objective signs were observed?",
  "health.measurements":
    "Were any measurements taken under an authorised support plan?",
  "health.plan":
    "Does the issue exceed a threshold in the participant's health or escalation plan?",
  "health.advice": "What clinical advice was obtained, from whom and when?",
  "health.outcome":
    "Is the condition resolved, improving, unchanged, worsening, or unknown?",
  "medication.scheduled": "What medication was scheduled?",
  "medication.authorised":
    "What dose, route, and administration time were authorised?",
  "medication.variance": "What type of variance occurred?",
  "medication.actual":
    "What medication, amount and route were administered, and at what time?",
  "medication.harm": "Does the participant have any symptoms or signs of harm?",
  "medication.advice":
    "Who provided clinical advice, at what time, and what instructions were given?",
  "medication.record": "Was the MAR or medication record updated correctly?",
  "medication.refusal": "What reason did the participant give?",
  "medication.indication": "What authorised indication was present?",
  "medication.strategies":
    "What non-medication strategies were attempted first?",
  "medication.effect": "What effect or side effect was observed?",
  "behaviour.before":
    "What happened before the behaviour? Include people, demands, activities, environmental factors, pain, delays, or transitions.",
  "behaviour.observation":
    "What observable behaviour occurred? Avoid labels, assumptions, or judgemental language.",
  "behaviour.timing":
    "What were the start time, end time, duration, and frequency?",
  "behaviour.impact":
    "Was anyone injured, threatened, or affected by property damage?",
  "behaviour.strategies": "Which authorised strategies were used?",
  "behaviour.response": "How did the participant respond to each strategy?",
  "restriction.type":
    "What type was used: chemical, environmental, mechanical, physical, seclusion, or unsure?",
  "restriction.timing": "What were the start and finish times?",
  "restriction.reason": "Why was it used?",
  "restriction.alternatives":
    "What less-restrictive strategies were attempted first?",
  "restriction.plan": "Is it included in the active Behaviour Support Plan?",
  "restriction.authorisation":
    "Is the required state or territory authorisation current?",
  "restriction.implementation": "Was it implemented exactly as authorised?",
  "restriction.people": "Who implemented it and who witnessed it?",
  "restriction.monitoring": "How was the participant monitored?",
  "restriction.harm": "Did the participant experience injury or distress?",
  "complaint.person":
    "Who is raising it: participant, family member, nominee, advocate, worker, other person, or anonymous person?",
  "complaint.privacy": "Do they request anonymity or confidentiality?",
  "complaint.account": "What happened?",
  "complaint.impact": "What impact did this have on the participant?",
  "complaint.remedy": "What outcome or remedy is requested?",
  "complaint.safety":
    "Is there any concern about retaliation, threat, service withdrawal, or immediate safety?",
  "complaint.sharing": "What information may be shared to resolve the matter?",
  "complaint.response":
    "What response was received if the concern has already been raised?",
  "service.scheduled": "What service was scheduled?",
  "service.actual": "What service was actually delivered?",
  "service.times": "What were the actual start and finish times?",
  "service.reason": "What objective reason caused the exception?",
  "service.critical": "Was any critical support missed?",
  "service.risk": "Did the exception create a health or safety risk?",
  "service.informed": "When and how were the participant or nominee informed?",
  "service.agreement":
    "Did the participant agree to the alternative arrangement?",
  "service.alternative":
    "What alternative was offered: replacement worker, rescheduling, family support, remote support, clinical escalation, or no alternative?",
  "missing.last_seen": "When and where was the participant last seen?",
  "missing.actions": "What actions have been taken to locate the participant?",
  "missing.now": "Is the participant's current location and welfare known?",
};

export function assessmentQuestionText(
  id: string,
  concernIds: readonly string[],
): string | undefined {
  if (id === "safety.now" || id.startsWith("screen."))
    return Object.hasOwn(assessmentQuestions, id)
      ? assessmentQuestions[id]
      : undefined;
  const parts = id.split(":");
  if (parts.length !== 2 || !concernIds.includes(parts[0])) return undefined;
  const key = parts[1];
  if (key.startsWith("screen.") || key === "safety.now") return undefined;
  return Object.hasOwn(assessmentQuestions, key)
    ? assessmentQuestions[key]
    : undefined;
}
