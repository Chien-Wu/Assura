declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ELEVENLABS_API_KEY?: string;
    ELEVENLABS_AGENT_ID?: string;
    LEGALMATE_PUBLIC_ORIGIN?: string;
  }
}
