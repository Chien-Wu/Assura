import Link from "next/link";
import { redirect } from "next/navigation";
import { AudioLines } from "lucide-react";
import { getAppUser } from "@/lib/auth";
import { getOnboarding } from "@/lib/organisations";
import OnboardingForm from "./profile-form";
import SignOutButton from "../sign-out-button";

export const dynamic = "force-dynamic";

export default function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ providerId?: string; edit?: string }>;
}) {
  return <OnboardingContent searchParams={searchParams} />;
}

async function OnboardingContent({
  searchParams,
}: {
  searchParams: Promise<{ providerId?: string; edit?: string }>;
}) {
  const user = await getAppUser();
  if (!user) redirect("/?role=worker");
  const [data, query] = await Promise.all([getOnboarding(user), searchParams]);
  const selectedDifferentProvider =
    query.providerId &&
    query.providerId !== data.profile?.providerId &&
    data.providers.some((provider) => provider.id === query.providerId);
  if (data.profile && query.edit !== "1" && !selectedDifferentProvider)
    redirect("/worker");
  return (
    <main className="entry-shell">
      <Link className="entry-brand" href="/">
        <span className="brand-icon">
          <AudioLines size={23} aria-hidden="true" />
        </span>
        LegalMate
      </Link>
      <div className="onboarding-heading">
        <h1>
          {data.profile ? "Your details" : "A few details to get started"}
        </h1>
        <p className="entry-caption">
          Choose the provider you work with. You can start your shift note
          straight away.
        </p>
      </div>
      <OnboardingForm
        user={{ name: user.fullName ?? "", email: user.email }}
        profile={data.profile}
        providers={data.providers}
        initialProviderId={query.providerId ?? ""}
      />
      <div className="entry-account">
        <SignOutButton />
      </div>
    </main>
  );
}
