"use client";
import { useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

export type SignOutOptions = {
  disabled?: boolean;
  beforeSignOut?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
};

export function useSignOut({
  disabled = false,
  beforeSignOut,
  onBusyChange,
}: SignOutOptions) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function signOut() {
    if (disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    try {
      // Persist any worker edits while the current session is still valid.
      // A rejected save must stop here, before the session is revoked.
      await beforeSignOut?.();
      const result = await authClient.signOut();
      if (result.error) throw new Error("Couldn’t sign out.");
      window.location.assign("/");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Couldn’t sign out. Please try again.",
      );
      pending.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return { busy, error, signOut };
}

export default function SignOutButton(options: SignOutOptions) {
  const { busy, error, signOut } = useSignOut(options);
  return (
    <span className="sign-out-control">
      <button
        type="button"
        className="entry-text-button"
        disabled={options.disabled || busy}
        onClick={() => void signOut()}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
