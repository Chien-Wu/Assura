import { database, RequestError } from "./notes-server";
import {
  activeWorkerQuery,
  claimManagerGrantsQuery,
  cleanWorkerProfile,
  managedProvidersQuery,
} from "./organisation-access";
import { getTestAccountByIdentity, TEST_PROVIDER_ID } from "./test-accounts";

function testAccountFor(user: OrganisationUser) {
  return getTestAccountByIdentity({ id: user.userId, email: user.email });
}

// getAppUser only returns identities with a server-verified email address.
export type OrganisationUser = {
  userId: string;
  email: string;
  fullName?: string | null;
  displayName: string;
};
type Provider = { id: string; name: string };
type WorkerProfile = { fullName: string; providerId: string };

export async function listProviders(): Promise<Provider[]> {
  const result = await database()
    .prepare("SELECT id,name FROM providers WHERE active=1 ORDER BY name,id")
    .all<Provider>();
  return result.results;
}

export async function claimManagerGrants(user: OrganisationUser) {
  // Shared test credentials never claim email grants or gain extra roles.
  if (testAccountFor(user)) return;
  // This can only claim an administrator-provisioned grant; request bodies and
  // the selected landing-page role never determine management permissions.
  await database()
    .prepare(claimManagerGrantsQuery)
    .bind(
      user.userId,
      new Date().toISOString(),
      user.email.trim().toLowerCase(),
      user.userId,
    )
    .run();
}

export async function managedProviders(
  user: OrganisationUser,
): Promise<Provider[]> {
  await claimManagerGrants(user);
  const result = await database()
    .prepare(managedProvidersQuery)
    .bind(user.userId)
    .all<Provider>();
  const testAccount = testAccountFor(user);
  return testAccount
    ? result.results.filter(
        (provider) =>
          testAccount.role === "manager" && provider.id === TEST_PROVIDER_ID,
      )
    : result.results;
}

export async function getOnboarding(user: OrganisationUser) {
  const testAccount = testAccountFor(user);
  const [profile, providers, managed] = await Promise.all([
    database().prepare(activeWorkerQuery).bind(user.userId).first<{
      full_name: string;
      provider_id: string;
    }>(),
    listProviders(),
    managedProviders(user),
  ]);
  return {
    profile:
      profile &&
      (!testAccount ||
        (testAccount.role === "worker" &&
          profile.provider_id === TEST_PROVIDER_ID))
        ? { fullName: profile.full_name, providerId: profile.provider_id }
        : null,
    providers: testAccount
      ? providers.filter((provider) => provider.id === TEST_PROVIDER_ID)
      : providers,
    managedProviders: managed,
  };
}

export async function requireWorker(user: OrganisationUser | null) {
  if (!user) throw new RequestError("Sign in to continue.", 401);
  const testAccount = testAccountFor(user);
  if (testAccount && testAccount.role !== "worker")
    throw new RequestError(
      "Use the manager workspace for this test account.",
      403,
    );
  const profile = await database()
    .prepare(activeWorkerQuery)
    .bind(user.userId)
    .first<{
      full_name: string;
      provider_id: string;
    }>();
  if (!profile)
    throw new RequestError(
      "Complete your worker profile and choose a service provider.",
      403,
    );
  if (testAccount && profile.provider_id !== TEST_PROVIDER_ID)
    throw new RequestError(
      "This test account is limited to TestProvider.",
      403,
    );
  return {
    userId: user.userId,
    fullName: profile.full_name,
    providerId: profile.provider_id,
  };
}

export async function requireManager(
  user: OrganisationUser | null,
  providerId?: string | null,
) {
  if (!user) throw new RequestError("Sign in to continue.", 401);
  const providers = await managedProviders(user);
  const provider = providerId
    ? providers.find((item) => item.id === providerId)
    : providers[0];
  if (!provider)
    throw new RequestError(
      "You do not have management access to this service provider.",
      403,
    );
  return {
    userId: user.userId,
    providerId: provider.id,
    providerName: provider.name,
  };
}

export async function saveWorkerProfile(
  user: OrganisationUser,
  fullName: unknown,
  providerId: unknown,
) {
  const testAccount = testAccountFor(user);
  if (
    testAccount &&
    (testAccount.role !== "worker" || providerId !== TEST_PROVIDER_ID)
  )
    throw new RequestError(
      "This test account is limited to its TestProvider role.",
      403,
    );
  let profile: WorkerProfile;
  try {
    profile = cleanWorkerProfile(fullName, providerId);
  } catch (error) {
    throw new RequestError(
      error instanceof Error ? error.message : "Check your profile.",
    );
  }
  const provider = await database()
    .prepare("SELECT id FROM providers WHERE id=? AND active=1")
    .bind(profile.providerId)
    .first();
  if (!provider)
    throw new RequestError("Choose an available service provider.");
  const now = new Date().toISOString();
  // D1 batch is transactional. An existing note keeps its original provider;
  // these statements only change the worker's current affiliation.
  await database().batch([
    database()
      .prepare(
        `INSERT INTO app_profiles (user_id,full_name,provider_id,created_at,updated_at)
      SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM providers WHERE id=? AND active=1)
      ON CONFLICT(user_id) DO UPDATE SET full_name=excluded.full_name,
        provider_id=excluded.provider_id,updated_at=excluded.updated_at`,
      )
      .bind(
        user.userId,
        profile.fullName,
        profile.providerId,
        now,
        now,
        profile.providerId,
      ),
    database()
      .prepare(
        `UPDATE provider_memberships SET active=0,updated_at=?
      WHERE user_id=? AND EXISTS (SELECT 1 FROM providers WHERE id=? AND active=1)`,
      )
      .bind(now, user.userId, profile.providerId),
    database()
      .prepare(
        `INSERT INTO provider_memberships (provider_id,user_id,active,joined_at,updated_at)
      SELECT ?,?,1,?,? WHERE EXISTS (SELECT 1 FROM providers WHERE id=? AND active=1)
      ON CONFLICT(provider_id,user_id) DO UPDATE SET active=1,updated_at=excluded.updated_at`,
      )
      .bind(profile.providerId, user.userId, now, now, profile.providerId),
  ]);
  return requireWorker(user);
}
