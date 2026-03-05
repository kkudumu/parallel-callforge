import { z } from "zod/v4";

const CitySourceModeSchema = z.enum(["hardcoded", "deployment_candidates"]);
const Agent7ProviderModeSchema = z.enum(["mock", "database"]);

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1).describe("PostgreSQL connection string"),
  CLAUDE_CLI_PATH: z.string().default("claude"),
  CODEX_CLI_PATH: z.string().default("codex"),
  GEMINI_CLI_PATH: z.string().default("gemini"),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  NETLIFY_SITE_ID: z.string().optional(),
  BUSINESS_PHONE: z.string().default("(555) 123-4567"),
  WEATHER_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  CITY_SOURCE_MODE: CitySourceModeSchema.default("deployment_candidates"),
  AGENT7_PROVIDER: Agent7ProviderModeSchema.default("database"),
  SEARCH_CONSOLE_INTEGRATION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  INDEXATION_KILL_SWITCH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  INDEXATION_MIN_PAGE_AGE_DAYS: z.coerce.number().int().min(1).default(21),
  INDEXATION_LOOKBACK_DAYS: z.coerce.number().int().min(7).default(30),
  INDEXATION_RATIO_THRESHOLD: z.coerce.number().min(0).max(1).default(0.5),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DISCORD_WEBHOOK_URL: z.string().optional().transform((v) => v || undefined).pipe(z.string().url().optional()),
});

export type Env = z.infer<typeof EnvSchema>;
export type CitySourceMode = z.infer<typeof CitySourceModeSchema>;
export type Agent7ProviderMode = z.infer<typeof Agent7ProviderModeSchema>;

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
