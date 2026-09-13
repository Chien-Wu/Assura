export function isAllowedRequestOrigin(
  requestUrl: string,
  requestOrigin: string | null,
  publicOrigin?: string,
): boolean {
  let expectedOrigin = new URL(requestUrl).origin;
  if (publicOrigin !== undefined) {
    let configured: URL;
    try {
      configured = new URL(publicOrigin);
    } catch {
      throw new Error("LEGALMATE_PUBLIC_ORIGIN must be an HTTP(S) origin.");
    }
    if (
      publicOrigin !== publicOrigin.trim() ||
      !/^https?:\/\/[^/?#\\\s]+\/?$/i.test(publicOrigin) ||
      !["http:", "https:"].includes(configured.protocol) ||
      configured.username ||
      configured.password ||
      configured.pathname !== "/" ||
      configured.search ||
      configured.hash
    ) {
      throw new Error("LEGALMATE_PUBLIC_ORIGIN must be an HTTP(S) origin.");
    }
    expectedOrigin = configured.origin;
  }

  // Preserve non-browser clients without Origin, after validating configuration.
  return requestOrigin === null || requestOrigin === expectedOrigin;
}
