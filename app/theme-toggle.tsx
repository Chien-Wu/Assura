"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

/**
 * Both icons are rendered and swapped by the theme class on <html>, so the
 * markup is identical on the server and the client (no hydration mismatch and
 * no mount effect).
 */
export default function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Switch between light and dark theme"
    >
      <Moon className="icon-light" size={17} aria-hidden="true" />
      <Sun className="icon-dark" size={17} aria-hidden="true" />
    </button>
  );
}
