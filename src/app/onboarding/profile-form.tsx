"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight } from "lucide-react";

export default function OnboardingForm({
  user,
  profile,
  providers,
  initialProviderId,
}: {
  user: { name: string; email: string };
  profile: { fullName: string; providerId: string } | null;
  providers: { id: string; name: string }[];
  initialProviderId: string;
}) {
  const [fullName, setFullName] = useState(profile?.fullName ?? user.name);
  const [providerId, setProviderId] = useState(
    providers.some((p) => p.id === initialProviderId)
      ? initialProviderId
      : (profile?.providerId ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const provider = providers.find((item) => item.id === providerId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), providerId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          result.error ?? "We couldn’t save your details. Please try again.",
        );
      window.location.assign("/worker");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <div className="onboarding-panel">
      <form className="entry-form" onSubmit={submit}>
        <div className="entry-field">
          <label htmlFor="worker-full-name">Full name</label>
          <Input
            id="worker-full-name"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={120}
            required
            disabled={busy}
          />
        </div>
        <div className="entry-field">
          <label htmlFor="worker-email">Email address</label>
          <Input id="worker-email" value={user.email} readOnly type="email" />
        </div>
        <div className="entry-field">
          <label htmlFor="worker-provider">Service provider</label>
          <select
            id="worker-provider"
            value={providerId}
            required
            onChange={(event) => setProviderId(event.target.value)}
            disabled={busy || !providers.length}
          >
            <option value="">Select your provider</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {!providers.length && (
            <p className="entry-caption">
              No providers are available yet. Contact the Assura team to arrange
              access for your organisation.
            </p>
          )}
        </div>
        {provider && (
          <p className="entry-caption">
            Your shift notes will be shared with {provider.name}’s managers.
          </p>
        )}
        {profile && providerId !== profile.providerId && (
          <p className="entry-caption">
            This change applies to new notes. Earlier notes stay with the
            provider they were created for.
          </p>
        )}
        {error && (
          <p className="entry-error" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="entry-auth-button"
          disabled={busy || !provider || !fullName.trim()}
        >
          {busy ? "Saving…" : profile ? "Save details" : "Start my shift note"}
          <ArrowRight size={17} aria-hidden="true" />
        </Button>
        {profile && (
          <a className="entry-text-button" href="/worker">
            Back to my notes
          </a>
        )}
      </form>
    </div>
  );
}
