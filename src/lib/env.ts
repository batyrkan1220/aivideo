import "server-only";
import { z } from "zod";

// Server-side environment. Secrets never leave this module's importers (server-only).
const schema = z.object({
  APP_ENV: z.enum(["development", "sandbox", "production"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  // Optional so login/signup work without it; supabaseAdmin() fails loudly if missing.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  // tole = Tole Payments (Kaspi QR) live; tole_sandbox = Tole /v1/sandbox/* with a test key.
  PAYMENT_PROVIDER: z.enum(["sandbox", "kaspi", "tole", "tole_sandbox"]).default("sandbox"),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16).optional(),
  KASPI_MERCHANT_ID: z.string().optional(),
  KASPI_API_KEY: z.string().optional(),
  KASPI_WEBHOOK_SECRET: z.string().optional(),
  KASPI_API_BASE_URL: z.string().url().optional(),
  // Tole Payments — server-only secrets (never exposed to the browser or logs).
  TOLE_API_KEY: z.string().transform((v) => v.trim().replace(/^["']|["']$/g, "").trim()).pipe(z.string().min(10)).optional(),
  TOLE_CONNECTION_ID: z.string().transform((v) => v.trim().replace(/^["']|["']$/g, "").trim()).pipe(z.string().uuid()).optional(),
  TOLE_WEBHOOK_SECRET: z.string().transform((v) => v.trim().replace(/^["']|["']$/g, "").trim()).pipe(z.string().min(16)).optional(),
  TOLE_API_BASE_URL: z.string().url().default("https://api.tolepay.kz/v1"),
  // Telegram bot / Mini App — server-only.
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/).optional(),
  // Teliks partner cabinet (separate server + Supabase): shared secret for its API calls only.
  TELIKS_API_SECRET: z.string().trim().min(32).optional(),
  AI_PROVIDER: z.string().default("dev"),
  AKOOL_API_KEY: z.string().min(10).optional(),
  AKOOL_API_BASE_URL: z.string().url().default("https://openapi.akool.com"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  UPLOAD_MIN_DIMENSION: z.coerce.number().int().positive().default(256),
  UPLOAD_MAX_DIMENSION: z.coerce.number().int().positive().default(8192),
  UPLOAD_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  VIDEO_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  GENERATION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  WORKER_SECRET: z.string().min(16).optional(),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  DAILY_PROVIDER_SPEND_LIMIT_USD: z.coerce.number().nonnegative().default(100),
});

const OPTIONAL_INTEGRATION_KEYS = new Set([
  "TOLE_API_KEY", "TOLE_CONNECTION_ID", "TOLE_WEBHOOK_SECRET", "TOLE_API_BASE_URL",
  "AKOOL_API_KEY", "AKOOL_API_BASE_URL", "TELEGRAM_BOT_TOKEN",
  "TELIKS_API_SECRET",
  "KASPI_MERCHANT_ID", "KASPI_API_KEY", "KASPI_WEBHOOK_SECRET", "KASPI_API_BASE_URL",
]);

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) {
    let parsed = schema.safeParse(process.env);
    // A malformed OPTIONAL integration secret must not take the whole site down:
    // drop just that key (the integration then reports "not configured") and log its NAME only.
    if (!parsed.success) {
      const bad = new Set(parsed.error.issues.map((i) => String(i.path[0])));
      if ([...bad].every((k) => OPTIONAL_INTEGRATION_KEYS.has(k))) {
        console.error(`[env] ignoring invalid optional variable(s): ${[...bad].join(", ")}`);
        const src: Record<string, string | undefined> = { ...process.env };
        bad.forEach((k) => delete src[k]);
        parsed = schema.safeParse(src);
      }
    }
    if (!parsed.success) {
      // Developer-facing message (logs only)
      throw new Error("Invalid environment: " + parsed.error.issues.map((i) => i.path.join(".")).join(", "));
    }
    cached = parsed.data;
    console.log(`[env] payment=${cached.PAYMENT_PROVIDER} tole_key=${cached.TOLE_API_KEY ? (cached.TOLE_API_KEY.startsWith("tole_sk_test_") ? "test" : cached.TOLE_API_KEY.startsWith("tole_sk_live_") ? "live" : "unknown_format") : "none"} tole_connection=${cached.TOLE_CONNECTION_ID ? "set" : "none"} tole_webhook_secret=${cached.TOLE_WEBHOOK_SECRET ? "set" : "none"} ai=${cached.AI_PROVIDER} telegram=${cached.TELEGRAM_BOT_TOKEN ? "on" : "off"} teliks_api=${cached.TELIKS_API_SECRET ? "on" : "off"}`);
    if (cached.APP_ENV === "production" && (cached.PAYMENT_PROVIDER === "sandbox" || cached.PAYMENT_PROVIDER === "tole_sandbox" || cached.AI_PROVIDER === "dev")) {
      throw new Error("Sandbox payment / dev AI provider are not allowed in production");
    }
  }
  return cached;
}
