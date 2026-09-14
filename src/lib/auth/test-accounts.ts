// Public login labels never become Google identities or real email grant claims.
// Internal legacy email identities are persisted in existing databases; retaining
// them keeps provisioned accounts and provider grants valid after the rebrand.
export const TEST_PROVIDER_ID = "testprovider";
export const TEST_PROVIDER_NAME = "TestProvider";

export const TEST_ACCOUNTS = [
  {
    alias: "managertest@gmail.com",
    id: "auth_test_manager",
    email: "manager@test.legalmate.invalid",
    name: "Test Manager",
    role: "manager",
    redirectTo: "/manager",
  },
  {
    alias: "workertest@gmail.com",
    id: "auth_test_worker",
    email: "worker@test.legalmate.invalid",
    name: "Test Support Worker",
    role: "worker",
    redirectTo: "/worker",
  },
] as const;

export type TestAccount = (typeof TEST_ACCOUNTS)[number];

export function getTestAccountByAlias(alias: string): TestAccount | null {
  return (
    TEST_ACCOUNTS.find(
      (account) => account.alias === alias.trim().toLowerCase(),
    ) ?? null
  );
}

export function getTestAccountByIdentity(user: {
  id: string;
  email: string;
}): TestAccount | null {
  return (
    TEST_ACCOUNTS.find(
      (account) => account.id === user.id && account.email === user.email,
    ) ?? null
  );
}

export function isReservedTestEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@test.legalmate.invalid");
}

export const testAccountScopeQuery = `SELECT p.id FROM providers p WHERE p.id=? AND p.active=1 AND (
  (?='worker' AND EXISTS (SELECT 1 FROM app_profiles a JOIN provider_memberships m ON m.user_id=a.user_id AND m.provider_id=a.provider_id WHERE a.user_id=? AND a.provider_id=p.id AND m.active=1))
  OR (?='manager' AND EXISTS (SELECT 1 FROM provider_manager_grants g WHERE g.provider_id=p.id AND g.claimed_user_id=? AND g.email=? AND g.active=1))
)`;

export function testAccountScopeParams(account: TestAccount) {
  return [
    TEST_PROVIDER_ID,
    account.role,
    account.id,
    account.role,
    account.id,
    account.email,
  ];
}
