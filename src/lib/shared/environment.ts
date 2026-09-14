export type AssuraSetting =
  | "WORKFLOW_ENABLED"
  | "AI2_MODEL"
  | "PUBLIC_ORIGIN"
  | "CONTACT_URL"
  | "EMAIL_FROM"
  | "TEST_PASSWORD";

export type AssuraEnvironment = Partial<
  Record<`ASSURA_${AssuraSetting}` | `LEGALMATE_${AssuraSetting}`, string>
>;

// Keep existing deployments working while their server settings are renamed.
// An explicitly empty Assura value disables the setting instead of reviving an
// old value. Canonical names take priority across bindings and process.env.
export function readAssuraSetting(
  name: AssuraSetting,
  bindings: AssuraEnvironment,
  fallback: Readonly<Record<string, string | undefined>> = {},
): string | undefined {
  return (
    bindings[`ASSURA_${name}`] ??
    fallback[`ASSURA_${name}`] ??
    bindings[`LEGALMATE_${name}`] ??
    fallback[`LEGALMATE_${name}`]
  );
}
