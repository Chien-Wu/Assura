"use client";

import {
  Building2,
  Check,
  ChevronDown,
  LoaderCircle,
  LogOut,
  Moon,
  Sun,
  UserRound,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSignOut, type SignOutOptions } from "../auth/sign-out-button";
import "./account-menu.css";

type Props = SignOutOptions & {
  name: string;
  role: "worker" | "manager";
  providerName?: string;
  onDetails?: () => void;
  providers?: { id: string; name: string }[];
  providerId?: string;
};

export default function AccountMenu({
  name,
  role,
  providerName,
  onDetails,
  providers = [],
  providerId,
  ...signOutOptions
}: Props) {
  const { resolvedTheme, setTheme } = useTheme();
  // Keep action state outside the popup, which unmounts when dismissed.
  const { busy, error, signOut } = useSignOut(signOutOptions);
  const disabled = signOutOptions.disabled || busy;

  return (
    <div className="account-menu">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="account-menu-trigger"
            aria-label={`Account menu for ${name}`}
            title={name}
          >
            <span className="account-menu-avatar" aria-hidden="true">
              {name.trim().charAt(0).toUpperCase() || <UserRound size={16} />}
            </span>
            <span className="account-menu-name">{name}</span>
            <ChevronDown
              className="account-menu-chevron"
              size={15}
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="account-menu-content"
        >
          <DropdownMenuLabel className="account-menu-heading">
            <span className="account-menu-full-name">{name}</span>
            <span className="account-menu-context">
              {role === "worker" ? "Support worker" : "Manager"}
              {providerName ? ` · ${providerName}` : ""}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {onDetails && (
            <DropdownMenuItem
              className="account-menu-item"
              disabled={disabled}
              onSelect={onDetails}
            >
              <UserRound aria-hidden="true" />
              Your details
            </DropdownMenuItem>
          )}
          {providers.length > 1 && (
            <>
              <DropdownMenuLabel className="account-menu-section">
                Switch service provider
              </DropdownMenuLabel>
              {providers.map((provider) => (
                <DropdownMenuItem
                  key={provider.id}
                  asChild
                  className="account-menu-item"
                  disabled={disabled}
                >
                  <a
                    href={`/manager?providerId=${encodeURIComponent(provider.id)}`}
                    aria-current={
                      provider.id === providerId ? "page" : undefined
                    }
                  >
                    <Building2 aria-hidden="true" />
                    <span className="account-menu-provider-name">
                      {provider.name}
                    </span>
                    {provider.id === providerId && (
                      <Check
                        className="account-menu-current"
                        aria-hidden="true"
                      />
                    )}
                  </a>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            className="account-menu-item account-menu-theme"
            textValue={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
            onSelect={(event) => {
              event.preventDefault();
              setTheme(resolvedTheme === "dark" ? "light" : "dark");
            }}
          >
            <Moon className="account-menu-light" aria-hidden="true" />
            <Sun className="account-menu-dark" aria-hidden="true" />
            <span className="account-menu-light">Dark mode</span>
            <span className="account-menu-dark">Light mode</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="account-menu-item"
            disabled={disabled}
            onSelect={(event) => {
              event.preventDefault();
              void signOut();
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden="true" />
            ) : (
              <LogOut aria-hidden="true" />
            )}
            {busy ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
          {error && (
            <p className="account-menu-error" role="alert">
              {error}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
