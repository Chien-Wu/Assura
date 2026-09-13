"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function SignOutButton({
  disabled = false,
  beforeSignOut,
  onBusyChange,
}: {
  disabled?: boolean;
  beforeSignOut?: () => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    if (disabled || busy) return;
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
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  return (
    <span className="sign-out-control">
      <button
        type="button"
        className="entry-text-button"
        disabled={disabled || busy}
        onClick={() => void signOut()}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && <span role="alert">{error}</span>}
    </span>
  );
}
