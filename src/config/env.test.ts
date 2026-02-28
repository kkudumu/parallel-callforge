import { describe, it, expect } from "@jest/globals";
import { parseEnv } from "./env.js";

describe("parseEnv", () => {
  it("parses valid environment variables", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
      CLAUDE_CLI_PATH: "/usr/local/bin/claude",
      CODEX_CLI_PATH: "/usr/local/bin/codex",
      NODE_ENV: "development",
    });
    expect(env.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/db");
    expect(env.CLAUDE_CLI_PATH).toBe("/usr/local/bin/claude");
    expect(env.NODE_ENV).toBe("development");
  });

  it("uses defaults for optional vars", () => {
    const env = parseEnv({
      DATABASE_URL: "postgres://user:pass@localhost:5432/db",
    });
    expect(env.CLAUDE_CLI_PATH).toBe("claude");
    expect(env.CODEX_CLI_PATH).toBe("codex");
    expect(env.NODE_ENV).toBe("development");
  });

  it("throws on missing DATABASE_URL", () => {
    expect(() => parseEnv({})).toThrow();
  });
});
