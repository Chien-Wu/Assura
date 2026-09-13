import Link from "next/link";
import { redirect } from "next/navigation";
import { AudioLines } from "lucide-react";
import { getAppUser } from "@/lib/auth/server";
import { managedProviders } from "@/lib/roster/organisations-server";
import { contactUrl } from "@/lib/shared/contact-server";
import ProviderRoster from "../../components/manager/roster/provider-roster";
import SignOutButton from "../../components/auth/sign-out-button";

export const dynamic = "force-dynamic";

export default function ManagerPage({
  searchParams,
}: {
  searchParams: Promise<{ providerId?: string }>;
}) {
  return <ManagerContent searchParams={searchParams} />;
}
async function ManagerContent({
  searchParams,
}: {
  searchParams: Promise<{ providerId?: string }>;
}) {
  const user = await getAppUser();
  if (!user) redirect("/?role=manager");
  const [providers, query] = await Promise.all([
    managedProviders(user),
    searchParams,
  ]);
  const provider = query.providerId
    ? providers.find((item) => item.id === query.providerId)
    : providers[0];
  if (!provider) {
    const contact = contactUrl();
    return (
      <main className="entry-shell">
        <Link className="entry-brand" href="/">
          <span className="brand-icon">
            <AudioLines size={23} />
          </span>
          LegalMate
        </Link>
        <div className="onboarding-heading">
          <h1>Manager access</h1>
          <p className="entry-caption">
            This account doesn’t have management access
            {query.providerId ? " to the selected provider" : " yet"}.
          </p>
        </div>
        <div className="onboarding-panel entry-form">
          <p className="entry-caption">
            Provider access is arranged with the LegalMate team. We’ll set up
            your organisation and its first manager account.
          </p>
          {contact && (
            <a className="entry-primary-link" href={contact}>
              Contact us
            </a>
          )}
          {!!providers.length && (
            <Link href="/manager" className="entry-primary-link">
              Open my provider
            </Link>
          )}
          <Link href="/?role=worker" className="entry-text-button">
            Continue as a support worker
          </Link>
          <p className="entry-caption">
            Signed in as {user.displayEmail ?? user.email}
          </p>
          <SignOutButton />
        </div>
      </main>
    );
  }
  return (
    <ProviderRoster
      key={provider.id}
      providerId={provider.id}
      account={{
        name: user.displayName,
        providerName: provider.name,
        providers,
      }}
    />
  );
}
