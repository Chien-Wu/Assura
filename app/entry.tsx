"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import {
  AudioLines,
  Building2,
  ChevronDown,
  ArrowRight,
  Mail,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  methods: { google: boolean; email: boolean };
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
  disabled,
  initialError,
}: {
  role: Role;
  providerId: string;
  methods: { google: boolean; email: boolean };
  disabled: boolean;
  initialError: string;
}) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sent]);
  const remaining = Math.max(0, Math.ceil((resendAt - now) / 1000));
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
  async function sendCode() {
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "sign-in",
    });
    if (result.error)
      throw new Error(
        "We couldn’t send your code. Check your email address and try again shortly.",
      );
    setSent(true);
    setOtp("");
    setNow(Date.now());
    setResendAt(Date.now() + 60000);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (!sent) await sendCode();
      else {
        const result = await authClient.signIn.emailOtp({
          email: email.trim(),
          otp: otp.trim(),
        });
        if (result.error)
          throw new Error(
            "That code is invalid or has expired. Please try again or request a new code.",
          );
        window.location.assign(destination);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  async function resend() {
    setBusy(true);
    setError("");
    try {
      await sendCode();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Please try again.");
    } finally {
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
      {!emailOpen ? (
        <Button
          type="button"
          variant="outline"
          className="entry-auth-button"
          disabled={disabled || busy || !methods.email}
          onClick={() => setEmailOpen(true)}
        >
          <Mail size={19} aria-hidden="true" />
          Continue with email
        </Button>
      ) : (
        <form className="entry-form" onSubmit={submit}>
          <div className="entry-field">
            <label htmlFor={`${role}-email`}>Email address</label>
            <Input
              id={`${role}-email`}
              type="email"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              readOnly={sent}
              disabled={busy}
              autoFocus
            />
          </div>
          {sent && (
            <>
              <p className="entry-caption" role="status">
                Enter the six-digit code sent to {email}.
              </p>
              <div className="entry-field">
                <label htmlFor={`${role}-otp`}>Verification code</label>
                <Input
                  id={`${role}-otp`}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(event) =>
                    setOtp(event.target.value.replace(/\D/g, ""))
                  }
                  required
                  disabled={busy}
                  autoFocus
                />
              </div>
            </>
          )}
          <Button
            type="submit"
            className="entry-auth-button"
            disabled={disabled || busy || !methods.email}
          >
            {busy
              ? "Please wait…"
              : sent
                ? "Verify and continue"
                : "Send verification code"}
          </Button>
          {sent && (
            <div className="entry-form-links">
              <button
                className="entry-text-button"
                type="button"
                disabled={busy || remaining > 0}
                onClick={() => void resend()}
              >
                {remaining > 0 ? `Resend in ${remaining}s` : "Resend code"}
              </button>
              <button
                className="entry-text-button"
                type="button"
                disabled={busy}
                onClick={() => {
                  setSent(false);
                  setOtp("");
                  setError("");
                }}
              >
                Change email
              </button>
            </div>
          )}
        </form>
      )}
      {(!methods.google || !methods.email) && (
        <p className="entry-caption">
          {!methods.google && !methods.email
            ? "Sign-in is being set up. Please check back shortly."
            : !methods.google
              ? "Google sign-in is being set up. You can use email."
              : "Email sign-in is being set up. You can use Google."}
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
