import Link from "next/link";
import { redirect } from "next/navigation";
import { AudioLines } from "lucide-react";
import { getAppUser } from "@/lib/auth";
import { managedProviders } from "@/lib/organisations";
import { contactUrl } from "@/lib/contact";
import ManagementBoard from "../management-board";
import ThemeToggle from "../theme-toggle";
import SignOutButton from "../sign-out-button";

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
          <p className="entry-caption">Signed in as {user.email}</p>
          <SignOutButton />
        </div>
      </main>
    );
  }
  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <AudioLines size={24} aria-hidden="true" />
          </span>
          LegalMate<span className="edition">MANAGER</span>
        </Link>
        <span className="manager-role">{provider.name}</span>
        <div className="profile">
          <ThemeToggle />
          <span className="profile-name" title={user.displayName}>
            {user.displayName}
          </span>
          <SignOutButton />
        </div>
      </header>
      <main className="main-shell manager-shell">
        {providers.length > 1 && (
          <nav aria-label="Your service providers" className="entry-form-links">
            {providers.map((item) => (
              <a
                key={item.id}
                className="entry-text-button"
                href={`/manager?providerId=${encodeURIComponent(item.id)}`}
                aria-current={item.id === provider.id ? "page" : undefined}
              >
                {item.name}
              </a>
            ))}
          </nav>
        )}
        <ManagementBoard key={provider.id} signedIn providerId={provider.id} />
      </main>
    </>
  );
}
