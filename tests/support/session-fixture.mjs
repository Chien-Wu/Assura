import { readFile } from "node:fs/promises";

export async function loadTestSession(
  origin,
  { manager = false, withProfile = false } = {},
) {
  const path = process.env.LEGALMATE_TEST_COOKIE_FILE;
  if (!path)
    throw new Error(
      "Set LEGALMATE_TEST_COOKIE_FILE to a private file containing a real signed-in test account's Cookie header. Complete worker onboarding first; see docs/vm-deployment.md.",
    );
  let cookie;
  try {
    cookie = (await readFile(path, "utf8")).trim().replace(/^Cookie:\s*/i, "");
  } catch {
    throw new Error(
      "Cannot read LEGALMATE_TEST_COOKIE_FILE. Use a private local cookie-header file.",
    );
  }
  if (!cookie || /[\r\n]/.test(cookie))
    throw new Error(
      "The test cookie file must contain one nonempty Cookie header line.",
    );
  const response = await fetch(`${origin}/api/onboarding`, {
    headers: { Cookie: cookie },
  });
  if (!response.ok)
    throw new Error(
      "The test session is unavailable or expired. Sign in again and update the private cookie file.",
    );
  const onboarding = await response.json();
  if (!onboarding.profile)
    throw new Error(
      "Complete the test account's worker profile and choose a service provider before running HTTP tests.",
    );
  if (
    manager &&
    !onboarding.managedProviders?.some(
      (provider) => provider.id === onboarding.profile.providerId,
    )
  )
    throw new Error(
      "Safety HTTP tests require manager access to the test worker's selected provider. Have an operator provision that grant first.",
    );
  return withProfile ? { cookie, profile: onboarding.profile } : cookie;
}

// Optional HTTP tests consume an explicitly prepared, unused assignment. This
// helper only reads; it never creates participants, shifts or manager grants.
export async function loadAssignedTestShift(
  origin,
  cookie,
  { environment, participantName },
) {
  const shiftId =
    process.env[environment] || process.env.LEGALMATE_TEST_SHIFT_ID;
  if (!shiftId)
    throw new Error(
      `Set ${environment} to an unused fictional shift assigned to this worker (LEGALMATE_TEST_SHIFT_ID also works for a single test). Have a test provider manager prepare the ${participantName} profile and assignment first.`,
    );
  const response = await fetch(`${origin}/api/shifts`, {
    headers: { Cookie: cookie },
  });
  if (!response.ok)
    throw new Error(
      "Cannot read assigned test shifts. Check the signed-in worker session and completed onboarding.",
    );
  const { shifts } = await response.json();
  const shift = shifts?.find((item) => item.id === shiftId);
  if (!shift)
    throw new Error(
      `${environment} does not identify a shift assigned to this signed-in worker. Prepare a fresh assignment through the test provider manager.`,
    );
  if (shift.participantName !== participantName)
    throw new Error(
      `${environment} must use the fictional ${participantName} profile matching the test sample, including its clinical and behaviour-plan details.`,
    );
  if (shift.noteId)
    throw new Error(
      `${environment} already has a note. Prepare a new unused test shift; these tests must not edit an existing record.`,
    );
  return shift;
}
