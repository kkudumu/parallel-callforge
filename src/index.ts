import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getEnv } from "./config/env.js";
import { createDbClient } from "./shared/db/client.js";
import { createRateLimiters } from "./shared/cli/rate-limiter.js";
import { createClaudeCli } from "./shared/cli/claude-cli.js";
import { createCodexCli } from "./shared/cli/codex-cli.js";
import { createGeminiCli } from "./shared/cli/gemini-cli.js";
import { createLlmClient } from "./shared/cli/llm-client.js";
import { runAgent1 } from "./agents/agent-1-keywords/index.js";
import { runAgent2 } from "./agents/agent-2-design/index.js";
import { runAgent3 } from "./agents/agent-3-builder/index.js";
import { runAgent7 } from "./agents/agent-7-monitor/index.js";
import { createOrchestrator } from "./orchestrator/index.js";
import type { AgentHandler } from "./orchestrator/types.js";

async function runMigrations(databaseUrl: string, migrationsDir: string) {
  const db = createDbClient(databaseUrl);
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const applied = await db.query<{ name: string }>("SELECT name FROM _migrations ORDER BY id");
    const appliedSet = new Set(applied.rows.map((r) => r.name));
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (appliedSet.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      console.log(`  applying: ${file}`);
      await db.query("BEGIN");
      try {
        await db.query(sql);
        await db.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await db.query("COMMIT");
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
    }
    console.log("Migrations complete.");
  } finally {
    await db.end();
  }
}

const NICHE = "pest-control";
const HUGO_SITE_PATH = path.resolve("hugo-site");
const CANDIDATE_CITIES = [
  { city: "Santa Cruz", state: "CA", population: 65000 },
  { city: "Watsonville", state: "CA", population: 54000 },
  { city: "Capitola", state: "CA", population: 10000 },
];

async function runSingleAgent(agentName: string) {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);
  const limiters = createRateLimiters();
  const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
  const codexCli = createCodexCli(env.CODEX_CLI_PATH);
  const geminiCli = createGeminiCli(env.GEMINI_CLI_PATH);
  const llm = createLlmClient(claudeCli, codexCli, limiters, geminiCli);

  try {
    // Run migrations first
    await runMigrations(env.DATABASE_URL, path.resolve("src/shared/db/migrations"));

    switch (agentName) {
      case "agent-1":
        await runAgent1({ niche: NICHE, candidateCities: CANDIDATE_CITIES }, llm, db);
        break;
      case "agent-2":
        await runAgent2({ niche: NICHE }, llm, db);
        break;
      case "agent-3":
        await runAgent3({
          niche: NICHE,
          hugoSitePath: HUGO_SITE_PATH,
          phone: env.BUSINESS_PHONE,
          minWordCountHub: 800,
          minWordCountSubpage: 1200,
        }, llm, db);
        break;
      case "agent-7":
        await runAgent7({ niche: NICHE }, db);
        break;
      default:
        console.error(`Unknown agent: ${agentName}`);
        process.exit(1);
    }
  } finally {
    await db.end();
  }
}

async function runPipeline() {
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);
  const limiters = createRateLimiters();
  const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
  const codexCli = createCodexCli(env.CODEX_CLI_PATH);
  const geminiCli = createGeminiCli(env.GEMINI_CLI_PATH);
  const llm = createLlmClient(claudeCli, codexCli, limiters, geminiCli);

  try {
    await runMigrations(env.DATABASE_URL, path.resolve("src/shared/db/migrations"));

    console.log("=== CallForge Pipeline ===");
    console.log("Step 1/4: Keyword Research");
    await runAgent1({ niche: NICHE, candidateCities: CANDIDATE_CITIES }, llm, db);

    console.log("Step 2/4: Design Research");
    await runAgent2({ niche: NICHE }, llm, db);

    console.log("Step 3/4: Site Build");
    await runAgent3({
      niche: NICHE,
      hugoSitePath: HUGO_SITE_PATH,
      phone: env.BUSINESS_PHONE,
      minWordCountHub: 800,
      minWordCountSubpage: 1200,
    }, llm, db);

    console.log("Step 4/4: Performance Monitor");
    await runAgent7({ niche: NICHE }, db);

    console.log("=== Pipeline Complete ===");
  } finally {
    await db.end();
  }
}

async function runOrchestrated() {
  const agentHandlers = new Map<string, AgentHandler>();
  const env = getEnv();
  const db = createDbClient(env.DATABASE_URL);
  const limiters = createRateLimiters();
  const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
  const codexCli = createCodexCli(env.CODEX_CLI_PATH);
  const geminiCli = createGeminiCli(env.GEMINI_CLI_PATH);
  const llm = createLlmClient(claudeCli, codexCli, limiters, geminiCli);

  agentHandlers.set("agent-1", {
    name: "agent-1",
    async execute(payload) {
      await runAgent1({ niche: NICHE, candidateCities: CANDIDATE_CITIES }, llm, db);
      return {};
    },
  });

  agentHandlers.set("agent-2", {
    name: "agent-2",
    async execute(payload) {
      await runAgent2({ niche: NICHE }, llm, db);
      return {};
    },
  });

  agentHandlers.set("agent-3", {
    name: "agent-3",
    async execute(payload) {
      await runAgent3({
        niche: NICHE,
        hugoSitePath: HUGO_SITE_PATH,
        phone: env.BUSINESS_PHONE,
        minWordCountHub: 800,
        minWordCountSubpage: 1200,
      }, llm, db);
      return {};
    },
  });

  agentHandlers.set("agent-7", {
    name: "agent-7",
    async execute(payload) {
      await runAgent7({ niche: NICHE }, db);
      return {};
    },
  });

  const orchestrator = await createOrchestrator({ agentHandlers });

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\nShutting down gracefully...");
    await orchestrator.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await orchestrator.start();
}

// CLI argument parsing
const command = process.argv[2];

if (command === "pipeline") {
  runPipeline().catch((err) => {
    console.error("Pipeline failed:", err);
    process.exit(1);
  });
} else if (command === "orchestrate") {
  runOrchestrated().catch((err) => {
    console.error("Orchestrator failed:", err);
    process.exit(1);
  });
} else if (command?.startsWith("agent-")) {
  runSingleAgent(command).catch((err) => {
    console.error(`Agent ${command} failed:`, err);
    process.exit(1);
  });
} else {
  console.log("CallForge - Parallel Content Pipeline");
  console.log("");
  console.log("Usage:");
  console.log("  npx tsx src/index.ts pipeline     Run full pipeline sequentially");
  console.log("  npx tsx src/index.ts orchestrate   Run via task queue orchestrator");
  console.log("  npx tsx src/index.ts agent-1       Run single agent (1, 2, 3, or 7)");
  console.log("");
  console.log("Environment: Set DATABASE_URL in .env");
}
