import { env } from "cloudflare:workers";

export function contactUrl(): string | null {
  const value = env.LEGALMATE_CONTACT_URL ?? process.env.LEGALMATE_CONTACT_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
