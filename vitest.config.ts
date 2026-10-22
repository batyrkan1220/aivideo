import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "test/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      APP_ENV: "development",
      AKOOL_API_KEY: "test-akool-key-123",
      TOLE_API_KEY: "tole_sk_test_unit_only",
      TOLE_CONNECTION_ID: "11111111-2222-4333-8444-555555555555",
      TOLE_WEBHOOK_SECRET: "whsec_unit_test_secret_0123456789",
      TELEGRAM_BOT_TOKEN: "123456789:AAEunit-test-token_abcdefghijklmnopqrs",
    },
  },
});
