import { z } from "zod/v4";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).describe("PostgreSQL connection string"),
  CLAUDE_CLI_PATH: z.string().default("claude"),
  CODEX_CLI_PATH: z.string().default("codex"),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  NETLIFY_SITE_ID: z.string().optional(),
  BUSINESS_PHONE: z.string().default("(555) 123-4567"),
  WEATHER_API_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(raw: Record<string, string | undefined>): Env {
  return EnvSchema.parse(raw);
}

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    _env = parseEnv(process.env as Record<string, string>);
  }
  return _env;
}
