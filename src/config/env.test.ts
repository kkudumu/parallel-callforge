import { describe, it, expect } from "@jest/globals";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("parses valid environment variables", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      CLAUDE_CLI_PATH: "/usr/local/bin/claude",
      CODEX_CLI_PATH: "/usr/local/bin/codex",
      GEMINI_CLI_PATH: "/usr/local/bin/gemini",
      NODE_ENV: "development",
    });
    expect(env.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/db");
    expect(env.CLAUDE_CLI_PATH).toBe("/usr/local/bin/claude");
    expect(env.GEMINI_CLI_PATH).toBe("/usr/local/bin/gemini");
    expect(env.CITY_SOURCE_MODE).toBe("deployment_candidates");
    expect(env.AGENT7_PROVIDER).toBe("database");
    expect(env.SEARCH_CONSOLE_INTEGRATION_ENABLED).toBe(false);
    expect(env.INDEXATION_KILL_SWITCH_ENABLED).toBe(false);
    expect(env.AGENT1_RESEARCH_MODE).toBe("standard");
    expect(env.AGENT2_RESEARCH_MODE).toBe("standard");
    expect(env.RESEARCH_PROVIDER_MAX_CONCURRENCY).toBe(2);
    expect(env.RESEARCH_EST_TOKENS_PER_PASS).toBe(75000);
    expect(env.RESEARCH_MAX_EST_TOKENS_PER_JOB).toBe(300000);
    expect(env.AGENT3_TEMPLATE_TIMEOUT_MS).toBe(900000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("uses defaults for optional vars", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    });
    expect(env.CLAUDE_CLI_PATH).toBe("claude");
    expect(env.CODEX_CLI_PATH).toBe("codex");
    expect(env.GEMINI_CLI_PATH).toBe("gemini");
    expect(env.CITY_SOURCE_MODE).toBe("deployment_candidates");
    expect(env.AGENT7_PROVIDER).toBe("database");
    expect(env.SEARCH_CONSOLE_INTEGRATION_ENABLED).toBe(false);
    expect(env.AGENT1_RESEARCH_MODE).toBe("standard");
    expect(env.AGENT2_RESEARCH_MODE).toBe("standard");
    expect(env.RESEARCH_PROVIDER_MAX_CONCURRENCY).toBe(2);
    expect(env.RESEARCH_EST_TOKENS_PER_PASS).toBe(75000);
    expect(env.RESEARCH_MAX_EST_TOKENS_PER_JOB).toBe(300000);
    expect(env.AGENT3_TEMPLATE_TIMEOUT_MS).toBe(900000);
    expect(env.INDEXATION_RATIO_THRESHOLD).toBe(0.5);
    expect(env.NODE_ENV).toBe("development");
  });

  it("throws on missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
