"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth/client";
import { TEST_ACCOUNTS } from "@/lib/auth/test-accounts";
import {
  ArrowRight,
  AudioLines,
  Building2,
  ChevronDown,
  Mail,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import SignOutButton from "./sign-out-button";

type Role = "worker" | "manager";
type Provider = { id: string; name: string };

export default function Entry({
  user,
  methods,
  testPassword,
  initialRole,
  initialError,
  contact,
}: {
  user: { name: string; email: string } | null;
  methods: { google: boolean; testAccounts: boolean };
  testPassword: string;
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
                    <SignInForm
                      role={item}
                      methods={methods}
                      initialPassword={testPassword}
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

function SignInForm({
  role,
  providerId,
  methods,
  initialPassword,
  disabled,
  initialError,
}: {
  role: Role;
  providerId: string;
  methods: { google: boolean; testAccounts: boolean };
  initialPassword: string;
  disabled: boolean;
  initialError: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [emailOpen, setEmailOpen] = useState(methods.testAccounts);
  const [email, setEmail] = useState(
    () => TEST_ACCOUNTS.find((account) => account.role === role)?.alias ?? "",
  );
  const [password, setPassword] = useState(initialPassword);
  const destination =
    role === "manager"
      ? "/manager"
      : `/onboarding?providerId=${encodeURIComponent(providerId)}`;
  async function google() {
    if (busy || disabled || !methods.google) return;
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
  async function testAccount(event: FormEvent) {
    event.preventDefault();
    if (busy || !methods.testAccounts) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/sign-in/test-account", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const payload: unknown = await response.json().catch(() => null);
      const result: { redirectTo?: unknown; message?: unknown } =
        payload && typeof payload === "object" ? payload : {};
      if (!response.ok)
        throw new Error(
          typeof result.message === "string"
            ? result.message
            : "Check your test account email and password, then try again.",
        );
      // The authenticated account controls its role and provider. The selected
      // entry card and provider selector never grant a test account permissions.
      if (result.redirectTo !== "/manager" && result.redirectTo !== "/worker")
        throw new Error(
          "We couldn’t open your test account. Please try again.",
        );
      setPassword("");
      window.location.assign(result.redirectTo);
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
      {methods.testAccounts &&
        (emailOpen ? (
          <form className="entry-form entry-test-form" onSubmit={testAccount}>
            <div className="entry-test-heading">
              <p className="entry-test-label">Test account</p>
              <p className="entry-caption" id={`${role}-test-help`}>
                Use managertest@gmail.com or workertest@gmail.com. Test accounts
                use the test provider.
              </p>
            </div>
            <div className="entry-field">
              <label htmlFor={`${role}-test-email`}>Email address</label>
              <Input
                id={`${role}-test-email`}
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                aria-describedby={`${role}-test-help`}
                required
                disabled={busy}
                autoFocus
              />
            </div>
            <div className="entry-field">
              <label htmlFor={`${role}-test-password`}>Password</label>
              <Input
                id={`${role}-test-password`}
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                disabled={busy}
              />
            </div>
            <Button
              type="submit"
              className="entry-auth-button"
              disabled={busy || !email.trim() || !password}
            >
              {busy ? "Signing in…" : "Sign in"}
              {!busy && <ArrowRight size={17} aria-hidden="true" />}
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="entry-auth-button"
            disabled={busy}
            onClick={() => {
              setEmailOpen(true);
              setError("");
            }}
          >
            <Mail size={19} aria-hidden="true" />
            Continue with email
          </Button>
        ))}
      {!methods.google && (
        <p className="entry-caption">
          {methods.testAccounts
            ? "Google sign-in is being set up. You can use a test account."
            : "Google sign-in is being set up. Please check back shortly."}
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
