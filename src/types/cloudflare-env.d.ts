declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    ELEVENLABS_API_KEY?: string;
    ELEVENLABS_AGENT_ID?: string;
    ELEVENLABS_WORKFLOW_AGENT_ID?: string;
    ELEVENLABS_WORKFLOW_VERSION_ID?: string;
    LEGALMATE_WORKFLOW_ENABLED?: string;
    OPENAI_API_KEY?: string;
    LEGALMATE_AI2_MODEL?: string;
    LEGALMATE_PUBLIC_ORIGIN?: string;
    LEGALMATE_CONTACT_URL?: string;
    BETTER_AUTH_SECRET?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    RESEND_API_KEY?: string;
    LEGALMATE_EMAIL_FROM?: string;
    LEGALMATE_TEST_PASSWORD?: string;
  }
}
