import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectRisks,
  assessRP,
  emptyRP,
  rpPatch,
  retentionUntil,
} from "../lib/safety.ts";
import { participantFor } from "../lib/participants.ts";
const minh = participantFor("P-001"),
  sarah = participantFor("P-002"),
  james = participantFor("P-003"),
  aroha = participantFor("P-004");
const codes = (flags) => flags.map((x) => x.code);

test("vague Test A preserves two candidate events and exact schedule hint", () => {
  const text =
    "morning shift with Minh, all pretty normal, he was in a good mood, had a bit of a coughing fit while eating but he was fine after, later he kept going to the fridge so I locked the kitchen door for a bit, he got a bit aggro but calmed down, rest was same as usual, all good";
  const flags = detectRisks(text, minh);
  assert.ok(flags.some((x) => x.category === "choking"));
  assert.ok(
    flags.some((x) => x.category === "environmental" && x.planItem === "RP-02"),
  );
  assert.ok(codes(flags).includes("DUPLICATE_NOTE_RISK"));
});
test("complete formal Test B keeps evidence literal", () => {
  const text =
    'Environmental restraint RP-02: locked the kitchen door from 11:00 to 11:10. Minh said "I want my food". Coughing while eating lasted 10 seconds; he was able to speak throughout. Reference INC-43118-02.';
  const snapshot = text;
  const flags = detectRisks(text, minh);
  assert.ok(flags.some((x) => x.category === "environmental"));
  assert.equal(text, snapshot);
});
test("ordinary Test C does not flag routine medication, seatbelt, no mark or declined choice", () => {
  const text =
    "Sarah took prescribed morning metformin 500 mg. She wore an ordinary car seatbelt. She bumped her elbow with no mark and declined an activity.";
  assert.deepEqual(detectRisks(text, sarah), []);
});
test("negated observations are not positive incidents or restrictions", () => {
  const text =
    "No coughing while eating. No seizures. No physical restraint. I did not lock the door. There was no environmental restraint. No bleeding, no swelling and no visible mark.";
  assert.deepEqual(detectRisks(text, minh), []);
});
test("positive event after negated event remains a candidate", () => {
  const flags = detectRisks(
    "No choking at breakfast, but coughing while eating lunch lasted 20 seconds.",
    minh,
  );
  assert.ok(flags.some((x) => x.category === "choking"));
});
test("routine medication does not hide separate behavioural PRN in same account", () => {
  const flags = detectRisks(
    "Sarah took metformin for diabetes and PRN risperidone to settle her behaviour.",
    sarah,
  );
  assert.ok(
    flags.some((x) => x.category === "chemical" && x.severity === "urgent"),
  );
});
test("negative PRN report and routine treatment do not create chemical flag", () => {
  assert.deepEqual(
    detectRisks(
      "No PRN risperidone was given. Medicated with metformin for diabetes.",
      sarah,
    ),
    [],
  );
});
test("PRN with unknown purpose stays unverified", () => {
  const flags = detectRisks("PRN medication was given at noon.", james);
  assert.deepEqual(codes(flags), ["MEDICATION_PURPOSE_UNVERIFIED"]);
});
test("known plan membership survives worker uncertainty or disagreement", () => {
  for (const state of ["worker_does_not_know", "no"]) {
    const flags = assessRP(
      {
        ...emptyRP(),
        used: "yes",
        category: "environmental",
        schedule_item: "RP-02",
        in_behaviour_plan: state,
        what_happened: "Locked kitchen door",
      },
      minh,
    );
    assert.ok(codes(flags).includes("MONTHLY_RP_REPORT_REQUIRED"));
    assert.ok(codes(flags).includes("AUTHORISATION_UNVERIFIED"));
    assert.ok(!codes(flags).includes("UNAUTHORISED_RESTRICTIVE_PRACTICE"));
  }
});
test("missing plan cannot become authorised from worker claim", () => {
  const flags = assessRP(
    {
      ...emptyRP(),
      used: "yes",
      category: "physical",
      in_behaviour_plan: "yes",
    },
    sarah,
  );
  assert.ok(codes(flags).includes("UNAUTHORISED_RESTRICTIVE_PRACTICE"));
});
test("known physical limit escalates above 60 seconds and leaves unknown duration unresolved", () => {
  const base = {
    ...emptyRP(),
    used: "yes",
    category: "physical",
    schedule_item: "RP-06",
    in_behaviour_plan: "yes",
  };
  assert.ok(
    codes(assessRP({ ...base, duration_minutes: 1.1 }, aroha)).includes(
      "PLAN_LIMIT_BREACH",
    ),
  );
  assert.ok(
    !codes(assessRP({ ...base, duration_minutes: 1 }, aroha)).includes(
      "PLAN_LIMIT_BREACH",
    ),
  );
  assert.ok(codes(assessRP(base, aroha)).includes("PLAN_LIMITS_UNVERIFIED"));
});
test("chemical dose and frequency are evaluated without routine masking", () => {
  const base = {
    ...emptyRP(),
    used: "yes",
    category: "chemical",
    schedule_item: "RP-05",
    in_behaviour_plan: "yes",
    given_for_behaviour: "yes",
    dose_mg: "0.5",
    uses_in_24h: "1",
    what_happened: "Routine medicine plus PRN for behaviour",
  };
  assert.ok(!codes(assessRP(base, aroha)).includes("PLAN_LIMIT_BREACH"));
  assert.ok(
    codes(assessRP({ ...base, dose_mg: "1" }, aroha)).includes(
      "PLAN_LIMIT_BREACH",
    ),
  );
  assert.ok(
    codes(assessRP({ ...base, uses_in_24h: "2" }, aroha)).includes(
      "PLAN_LIMIT_BREACH",
    ),
  );
  assert.deepEqual(assessRP({ ...base, given_for_behaviour: "no" }, aroha), []);
  assert.deepEqual(
    codes(assessRP({ ...base, given_for_behaviour: "unsure" }, aroha)),
    ["MEDICATION_PURPOSE_UNVERIFIED"],
  );
});
test("RP times derive overnight duration and reject calendar errors and fractional frequency", () => {
  assert.equal(
    rpPatch(emptyRP(), {
      start_time: "2026-09-12T23:59",
      end_time: "2026-09-13T00:01",
    }).duration_minutes,
    2,
  );
  assert.throws(() => rpPatch(emptyRP(), { start_time: "2026-02-30T12:00" }));
  assert.throws(() => rpPatch(emptyRP(), { uses_in_24h: "1.5" }));
});
test("retention keeps minimum seven years and longer supplied minor rule", () => {
  assert.equal(
    retentionUntil("2026-09-12T00:00:00Z"),
    "2033-09-12T00:00:00.000Z",
  );
  assert.equal(
    retentionUntil("2026-09-12T00:00:00Z", "2016-01-01"),
    "2041-01-01T00:00:00.000Z",
  );
});
