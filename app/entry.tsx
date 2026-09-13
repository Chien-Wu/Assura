"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AudioLines,
  Building2,
  ChevronDown,
  ArrowRight,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import SignOutButton from "./sign-out-button";

type Role = "worker" | "manager";
type Provider = { id: string; name: string };

export default function Entry({
  user,
  methods,
  initialRole,
  initialError,
  contact,
}: {
  user: { name: string; email: string } | null;
  methods: { google: boolean };
  initialRole: Role | null;
  initialError: string;
  contact: string | null;
}) {
  const [role, setRole] = useState<Role | null>(initialRole);
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [providerError, setProviderError] = useState("");
  const [providerId, setProviderId] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/providers", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("We couldn’t load service providers.");
        return response.json() as Promise<{ providers: Provider[] }>;
      })
      .then((result) => {
        setProviders(result.providers);
        setProviderError("");
      })
      .catch((error) => {
        if (!controller.signal.aborted) setProviderError(error.message);
      });
    return () => controller.abort();
  }, [retry]);
  return (
    <main className="entry-shell">
      <Link className="entry-brand" href="/" aria-label="LegalMate home">
        <span className="brand-icon">
          <AudioLines size={23} aria-hidden="true" />
        </span>
        LegalMate
      </Link>
      <div className="entry-intro">
        <h1>
          better note,
          <br />
          <span>less burden</span>
        </h1>
      </div>
      <div className="entry-choices">
        {(["manager", "worker"] as Role[]).map((item) => {
          const expanded = role === item;
          return (
            <section
              className="entry-choice"
              data-expanded={expanded}
              key={item}
            >
              <h2>
                <button
                  type="button"
                  className="entry-choice-toggle"
                  aria-expanded={expanded}
                  aria-controls={`${item}-entry`}
                  onClick={() => setRole(expanded ? null : item)}
                >
                  <span className="entry-choice-icon">
                    {item === "manager" ? (
                      <Building2 size={23} aria-hidden="true" />
                    ) : (
                      <UserRound size={23} aria-hidden="true" />
                    )}
                  </span>
                  <span>
                    <strong>
                      {item === "manager"
                        ? "Service provider"
                        : "Support worker"}
                    </strong>
                    <small>
                      {item === "manager"
                        ? "Manage your team’s shift notes"
                        : "Complete your shift notes"}
                    </small>
                  </span>
                  <ChevronDown
                    size={21}
                    className="entry-chevron"
                    aria-hidden="true"
                  />
                </button>
              </h2>
              {expanded && (
                <div id={`${item}-entry`} className="entry-expanded">
                  {item === "manager" ? (
                    <p className="entry-caption">
                      Sign in with your manager account.
                    </p>
                  ) : (
                    !user && (
                      <div className="entry-field">
                        <label htmlFor="entry-provider">
                          Your service provider
                        </label>
                        <select
                          id="entry-provider"
                          value={providerId}
                          onChange={(event) =>
                            setProviderId(event.target.value)
                          }
                          disabled={!providers?.length}
                        >
                          <option value="">
                            {providerError
                              ? "Providers unavailable"
                              : providers === null
                                ? "Loading providers…"
                                : "Select your provider"}
                          </option>
                          {providers?.map((provider) => (
                            <option key={provider.id} value={provider.id}>
                              {provider.name}
                            </option>
                          ))}
                        </select>
                        {providerError && (
                          <p role="alert" className="entry-error">
                            {providerError}{" "}
                            <button
                              className="entry-text-button"
                              type="button"
                              onClick={() => setRetry((value) => value + 1)}
                            >
                              Retry
                            </button>
                          </p>
                        )}
                        {providers?.length === 0 && (
                          <p className="entry-caption">
                            No service providers are available yet. The
                            LegalMate team needs to onboard your organisation
                            first.
                          </p>
                        )}
                        {providerId && (
                          <p className="entry-caption">
                            Your shift notes will be shared with this provider’s
                            managers.
                          </p>
                        )}
                      </div>
                    )
                  )}
                  {user ? (
                    <div className="entry-signed-in">
                      <p className="entry-caption">Signed in as {user.email}</p>
                      <a
                        className="entry-primary-link"
                        href={item === "manager" ? "/manager" : "/onboarding"}
                      >
                        Continue <ArrowRight size={17} aria-hidden="true" />
                      </a>
                    </div>
                  ) : (
                    <GoogleSignIn
                      role={item}
                      methods={methods}
                      providerId={providerId}
                      disabled={item === "worker" && !providerId}
                      initialError={initialError}
                    />
                  )}
                  {item === "manager" && (
                    <p className="entry-contact">
                      New to LegalMate?{" "}
                      {contact ? (
                        <a href={contact}>
                          Contact us to arrange provider access.
                        </a>
                      ) : (
                        <span>
                          Contact the LegalMate team to arrange provider access.
                        </span>
                      )}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {user && (
        <div className="entry-account">
          <SignOutButton />
        </div>
      )}
    </main>
  );
}

function GoogleSignIn({
  role,
  providerId,
  methods,
  disabled,
  initialError,
}: {
  role: Role;
  providerId: string;
  methods: { google: boolean };
  disabled: boolean;
  initialError: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const destination =
    role === "manager"
      ? "/manager"
      : `/onboarding?providerId=${encodeURIComponent(providerId)}`;
  async function google() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: destination,
        errorCallbackURL: `/?role=${role}&error=sign_in`,
      });
      if (result.error)
        throw new Error("Google sign-in is unavailable. Please try again.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
      setBusy(false);
    }
  }
  return (
    <div className="entry-signin">
      <Button
        type="button"
        variant="outline"
        className="entry-auth-button"
        disabled={disabled || busy || !methods.google}
        onClick={() => void google()}
      >
        <span className="google-letter" aria-hidden="true">
          G
        </span>
        Continue with Google
      </Button>
      {!methods.google && (
        <p className="entry-caption">
          Google sign-in is being set up. Please check back shortly.
        </p>
      )}
      {error && (
        <p className="entry-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
