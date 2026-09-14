import { env } from "cloudflare:workers";
import { readAssuraSetting } from "./environment";

export function contactUrl(): string | null {
  const value = readAssuraSetting("CONTACT_URL", env, process.env);
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
