export type PlanItem = {
  id: string;
  category: string;
  description: string;
  behaviour: string;
  authorised: boolean;
  maxMinutes?: number;
  maxDoseMg?: number;
  maxUses24h?: number;
};
export type Participant = {
  id: string;
  name: string;
  ndis: string;
  setting: string;
  conditions: string[];
  risks: string[];
  communication: string;
  mealtimePlan: string;
  behaviourPlan: boolean;
  medications: { name: string; description: string; routine: boolean }[];
  goals: string[];
  plan: PlanItem[];
  dateOfBirth: string | null;
  seizureProtocol?: string;
};
export const participants: Participant[] = [
  {
    id: "P-001",
    name: "Minh Pham",
    ndis: "43118",
    setting: "Supported Independent Living, shared house",
    conditions: [
      "Intellectual disability",
      "Suspected dysphagia — not formally diagnosed; speech pathology review pending",
    ],
    risks: [
      "Eats very rapidly",
      "Choking risk at meals",
      "Excessive food seeking",
    ],
    communication: "Verbal, short sentences",
    mealtimePlan: "None yet — assessment pending",
    behaviourPlan: true,
    medications: [],
    goals: [
      "1. Increase independence in meal preparation",
      "2. Maintain routine and reduce mealtime distress",
    ],
    plan: [
      {
        id: "RP-02",
        category: "environmental",
        description: "Kitchen door lock",
        behaviour: "Excessive food seeking",
        authorised: true,
      },
    ],
    dateOfBirth: null,
  },
  {
    id: "P-002",
    name: "Sarah Doyle",
    ndis: "41902",
    setting: "Lives with family; community access supports",
    conditions: ["Down syndrome", "Type 2 diabetes"],
    risks: ["Hypoglycaemia if meals are missed"],
    communication: "Verbal, fluent",
    mealtimePlan: "None",
    behaviourPlan: false,
    medications: [
      {
        name: "metformin",
        description: "500 mg each morning — routine prescribed medication",
        routine: true,
      },
    ],
    goals: ["3. Build community connections", "4. Increase physical activity"],
    plan: [],
    dateOfBirth: null,
  },
  {
    id: "P-003",
    name: "James Whitlock",
    ndis: "44607",
    setting: "Supported Independent Living",
    conditions: ["Cerebral palsy", "Epilepsy (tonic-clonic)", "Dysphagia"],
    risks: ["Seizures", "Aspiration", "Respiratory infection"],
    communication: "Verbal, slow speech; allow processing time",
    mealtimePlan:
      "Active: level 2 thickened fluids; level 5 minced and moist food; upright for 30 minutes after meals; no straws",
    behaviourPlan: false,
    medications: [
      {
        name: "levetiracetam",
        description: "Twice daily — routine prescribed medication",
        routine: true,
      },
    ],
    goals: [
      "5. Maintain health and wellbeing",
      "6. Increase choice in daily routine",
    ],
    plan: [],
    dateOfBirth: null,
    seizureProtocol:
      "Recorded plan: time the seizure; call an ambulance if over 5 minutes or if a second seizure follows without recovery.",
  },
  {
    id: "P-004",
    name: "Aroha Ngata",
    ndis: "42355",
    setting: "Supported Independent Living",
    conditions: ["Autism", "Complex communication needs"],
    risks: [
      "Sensory overload",
      "Self-injurious behaviour",
      "Escalation in unfamiliar environments",
    ],
    communication: "Non-speaking; uses AAC device and gestures",
    mealtimePlan: "None",
    behaviourPlan: true,
    medications: [
      {
        name: "risperidone",
        description: "PRN 0.5 mg for behaviour; see RP-05",
        routine: false,
      },
    ],
    goals: [
      "7. Expand communication using AAC",
      "8. Participate in one community activity weekly",
    ],
    plan: [
      {
        id: "RP-05",
        category: "chemical",
        description: "Risperidone PRN 0.5 mg",
        behaviour: "Self-injurious behaviour",
        authorised: true,
        maxDoseMg: 0.5,
        maxUses24h: 1,
      },
      {
        id: "RP-06",
        category: "physical",
        description: "Two-person guided hold",
        behaviour: "As specified in the behaviour support plan",
        authorised: true,
        maxMinutes: 1,
      },
    ],
    dateOfBirth: null,
  },
];
export const participantFor = (value: string) =>
  participants.find(
    (p) => p.id === value || p.name.toLowerCase() === value.toLowerCase(),
  );
