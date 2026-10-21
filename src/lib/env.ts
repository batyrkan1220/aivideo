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
  PAYMENT_PROVIDER: z.string().default("sandbox"),
  AI_PROVIDER: z.string().default("dev"),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  UPLOAD_MIN_DIMENSION: z.coerce.number().int().positive().default(256),
  UPLOAD_MAX_DIMENSION: z.coerce.number().int().positive().default(8192),
  UPLOAD_RETENTION_DAYS: z.coerce.number().int().positive().default(7),
  VIDEO_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  GENERATION_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  WORKER_SECRET: z.string().min(8).optional(),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      // Developer-facing message (logs only)
      throw new Error("Invalid environment: " + parsed.error.issues.map((i) => i.path.join(".")).join(", "));
    }
    cached = parsed.data;
    if (cached.APP_ENV === "production" && (cached.PAYMENT_PROVIDER === "sandbox" || cached.AI_PROVIDER === "dev")) {
      throw new Error("Sandbox payment / dev AI provider are not allowed in production");
    }
  }
  return cached;
}
