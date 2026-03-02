import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getEnv, type CitySourceMode } from "./config/env.js";
import { createDbClient } from "./shared/db/client.js";
import { createRateLimiters } from "./shared/cli/rate-limiter.js";
import { createClaudeCli } from "./shared/cli/claude-cli.js";
import { createCodexCli } from "./shared/cli/codex-cli.js";
import { createGeminiCli } from "./shared/cli/gemini-cli.js";
import { createLlmClient } from "./shared/cli/llm-client.js";
import {
  parseZipInput,
  runAgent05,
} from "./agents/agent-0.5-geo-scanner/index.js";
import { runAgent1 } from "./agents/agent-1-keywords/index.js";
import { runAgent2 } from "./agents/agent-2-design/index.js";
import { runAgent3 } from "./agents/agent-3-builder/index.js";
import {
  DatabaseBackedDataProvider,
  MockDataProvider,
  runAgent7,
} from "./agents/agent-7-monitor/index.js";
import { SearchConsoleDataProvider } from "./agents/agent-7-monitor/search-console-provider.js";
import { createOrchestrator } from "./orchestrator/index.js";
import type { AgentHandler } from "./orchestrator/types.js";
import {
  loadOfferProfile,
  parseAndSaveOfferProfile,
} from "./shared/offer-profiles.js";
import {
  loadVerticalProfile,
  mergeOfferConstraints,
  saveVerticalProfile,
  VerticalDefinitionSchema,
} from "./shared/vertical-profiles.js";

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
      if (db.withTransaction) {
        await db.withTransaction(async (tx) => {
          await tx.query(sql);
          await tx.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        });
      } else {
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
    }
    console.log("Migrations complete.");
  } finally {
    await db.end();
  }
}

const DEFAULT_NICHE = "pest-control";
const HUGO_SITE_PATH = path.resolve("hugo-site");
const CANDIDATE_CITIES = [
  { city: "Santa Cruz", state: "CA", population: 65000 },
  { city: "Watsonville", state: "CA", population: 54000 },
  { city: "Capitola", state: "CA", population: 10000 },
];

function getAgent7Provider(env: ReturnType<typeof getEnv>, db: ReturnType<typeof createDbClient>) {
  if (env.AGENT7_PROVIDER === "mock") {
    return new MockDataProvider();
  }

  if (env.SEARCH_CONSOLE_INTEGRATION_ENABLED) {
    return new SearchConsoleDataProvider(db);
  }

  return new DatabaseBackedDataProvider(db);
}

function buildAgent1Config(
  env: ReturnType<typeof getEnv>,
  overrides: Partial<Parameters<typeof runAgent1>[0]> = {}
) {
  const citySource = overrides.citySource ?? env.CITY_SOURCE_MODE;
  const offerId = overrides.offerId ?? env.DEFAULT_OFFER_ID;
  const niche = overrides.offerProfile?.niche ?? overrides.niche ?? DEFAULT_NICHE;

  if (citySource === "deployment_candidates" && offerId) {
    return {
      niche,
      citySource,
      offerId,
      topCandidateLimit: 5,
      ...overrides,
    };
  }

  return {
    niche,
    citySource: "hardcoded" as CitySourceMode,
    candidateCities: CANDIDATE_CITIES,
    ...overrides,
  };
}

async function getOfferContext(
  db: ReturnType<typeof createDbClient>,
  offerId?: string
): Promise<{
  offerProfile: Awaited<ReturnType<typeof loadOfferProfile>>;
  verticalProfile: Awaited<ReturnType<typeof loadVerticalProfile>> | null;
  niche: string;
}> {
  if (!offerId) {
    return { offerProfile: null, verticalProfile: null, niche: DEFAULT_NICHE };
  }

  const storedOfferProfile = await loadOfferProfile(db, offerId);
  if (!storedOfferProfile) {
    return { offerProfile: null, verticalProfile: null, niche: DEFAULT_NICHE };
  }

  const verticalProfile = await loadVerticalProfile(db, storedOfferProfile.vertical);
  const offerProfile = {
    ...storedOfferProfile,
    constraints: mergeOfferConstraints(
      verticalProfile.definition,
      storedOfferProfile.constraints
    ),
  };
  return {
    offerProfile,
    verticalProfile,
    niche: offerProfile.niche,
  };
}

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

    const offerIdArg = process.argv[3];
    const zipInputArg = process.argv.slice(4).join(" ").trim();
    const offerContext = await getOfferContext(db, offerIdArg ?? env.DEFAULT_OFFER_ID);

    switch (agentName) {
      case "vertical-profile": {
        const verticalKey = offerIdArg;
        if (!verticalKey) {
          throw new Error("vertical-profile requires a vertical key argument");
        }
        const rawArg = process.argv.slice(4).join(" ").trim();
        if (!rawArg) {
          throw new Error("vertical-profile requires JSON or a file path");
        }
        const rawJson = fs.existsSync(rawArg)
          ? fs.readFileSync(path.resolve(rawArg), "utf-8")
          : rawArg;
        const parsedInput = JSON.parse(rawJson) as {
          niche?: string;
          definition?: unknown;
        };
        const definition =
          parsedInput && typeof parsedInput === "object" && "definition" in parsedInput
            ? VerticalDefinitionSchema.parse(parsedInput.definition)
            : VerticalDefinitionSchema.parse(parsedInput);
        const niche =
          parsedInput && typeof parsedInput === "object" && typeof parsedInput.niche === "string"
            ? parsedInput.niche
            : verticalKey;
        await saveVerticalProfile(db, {
          vertical_key: verticalKey,
          niche,
          definition,
        });
        console.log(
          `Saved vertical profile ${verticalKey} (${niche}) with ${definition.core_services.length} core services`
        );
        break;
      }
      case "offer-profile": {
        if (!offerIdArg) {
          throw new Error("offer-profile requires an offerId argument");
        }
        const rawArg = process.argv.slice(4).join(" ").trim();
        if (!rawArg) {
          throw new Error("offer-profile requires raw offer text or a file path");
        }
        const rawOfferText = fs.existsSync(rawArg)
          ? fs.readFileSync(path.resolve(rawArg), "utf-8")
          : rawArg;
        const profile = await parseAndSaveOfferProfile(db, offerIdArg, rawOfferText);
        console.log(
          `Saved offer profile ${profile.offer_id} (${profile.niche}) with ${profile.constraints.allowed_services.length} allowed and ${profile.constraints.disallowed_services.length} disallowed services`
        );
        break;
      }
      case "agent-0.5":
        if (!offerIdArg) {
          throw new Error("agent-0.5 requires an offerId argument");
        }
        await runAgent05(
          {
            offerId: offerIdArg,
            zipCodes: zipInputArg ? parseZipInput(zipInputArg) : undefined,
            source: zipInputArg ? "cli" : "stored-offer",
          },
          db
        );
        break;
      case "agent-1":
        await runAgent1(
          buildAgent1Config(env, {
            offerProfile: offerContext.offerProfile,
            verticalProfile: offerContext.verticalProfile,
            niche: offerContext.niche,
          }),
          llm,
          db
        );
        break;
      case "agent-2":
        await runAgent2({
          niche: offerContext.niche,
          offerProfile: offerContext.offerProfile,
          verticalProfile: offerContext.verticalProfile,
        }, llm, db);
        break;
      case "agent-3":
        await runAgent3({
          niche: offerContext.niche,
          offerProfile: offerContext.offerProfile,
          verticalProfile: offerContext.verticalProfile,
          hugoSitePath: HUGO_SITE_PATH,
          phone: env.BUSINESS_PHONE,
          minWordCountHub: 800,
          minWordCountSubpage: 1200,
          deployLimiter: limiters.contentDeploy,
          indexationKillSwitchEnabled:
            env.INDEXATION_KILL_SWITCH_ENABLED && env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
          searchConsoleIntegrationEnabled: env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
          indexationMinPageAgeDays: env.INDEXATION_MIN_PAGE_AGE_DAYS,
          indexationLookbackDays: env.INDEXATION_LOOKBACK_DAYS,
          minIndexationRatio: env.INDEXATION_RATIO_THRESHOLD,
        }, llm, db);
        break;
      case "agent-7":
        await runAgent7({ niche: offerContext.niche }, db, getAgent7Provider(env, db));
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
    const offerContext = await getOfferContext(db, env.DEFAULT_OFFER_ID);

    console.log("=== CallForge Pipeline ===");
    console.log("Step 1/4: Keyword Research");
    await runAgent1(
      buildAgent1Config(env, {
        offerProfile: offerContext.offerProfile,
        verticalProfile: offerContext.verticalProfile,
        niche: offerContext.niche,
      }),
      llm,
      db
    );

    console.log("Step 2/4: Design Research");
    await runAgent2({
      niche: offerContext.niche,
      offerProfile: offerContext.offerProfile,
      verticalProfile: offerContext.verticalProfile,
    }, llm, db);

    console.log("Step 3/4: Site Build");
    await runAgent3({
      niche: offerContext.niche,
      offerProfile: offerContext.offerProfile,
      verticalProfile: offerContext.verticalProfile,
      hugoSitePath: HUGO_SITE_PATH,
      phone: env.BUSINESS_PHONE,
      minWordCountHub: 800,
      minWordCountSubpage: 1200,
      deployLimiter: limiters.contentDeploy,
      indexationKillSwitchEnabled:
        env.INDEXATION_KILL_SWITCH_ENABLED && env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
      searchConsoleIntegrationEnabled: env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
      indexationMinPageAgeDays: env.INDEXATION_MIN_PAGE_AGE_DAYS,
      indexationLookbackDays: env.INDEXATION_LOOKBACK_DAYS,
      minIndexationRatio: env.INDEXATION_RATIO_THRESHOLD,
    }, llm, db);

    console.log("Step 4/4: Performance Monitor");
    await runAgent7({ niche: offerContext.niche }, db, getAgent7Provider(env, db));

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
      const effectiveOfferId =
        typeof payload?.offerId === "string" ? payload.offerId : env.DEFAULT_OFFER_ID;
      const offerContext = await getOfferContext(db, effectiveOfferId);
      const payloadCity = typeof payload?.city === "string" ? payload.city : null;
      const payloadState = typeof payload?.state === "string" ? payload.state : null;
      const candidateCities = payloadCity
        ? CANDIDATE_CITIES.filter((entry) =>
            entry.city === payloadCity && (!payloadState || entry.state === payloadState)
          )
        : CANDIDATE_CITIES;
      const citySource: CitySourceMode =
        payload?.citySource === "deployment_candidates" ? "deployment_candidates" : env.CITY_SOURCE_MODE;
      await runAgent1(
        citySource === "deployment_candidates"
          ? buildAgent1Config(env, {
              citySource,
              offerId: effectiveOfferId,
              offerProfile: offerContext.offerProfile,
              verticalProfile: offerContext.verticalProfile,
              niche: offerContext.niche,
              forceRefresh: payload?.forceRefresh === true,
            })
          : buildAgent1Config(env, {
              citySource: "hardcoded",
              offerProfile: offerContext.offerProfile,
              verticalProfile: offerContext.verticalProfile,
              niche: offerContext.niche,
              candidateCities: candidateCities.length > 0 ? candidateCities : CANDIDATE_CITIES,
              forceRefresh: payload?.forceRefresh === true,
            }),
        llm,
        db
      );
      return {};
    },
  });

  agentHandlers.set("agent-2", {
    name: "agent-2",
    async execute(payload) {
      const effectiveOfferId =
        typeof payload?.offerId === "string" ? payload.offerId : env.DEFAULT_OFFER_ID;
      const offerContext = await getOfferContext(db, effectiveOfferId);
      await runAgent2({
        niche: offerContext.niche,
        offerProfile: offerContext.offerProfile,
        verticalProfile: offerContext.verticalProfile,
        forceRefresh: payload?.forceRefresh === true,
      }, llm, db);
      return {};
    },
  });

  agentHandlers.set("agent-3", {
    name: "agent-3",
    async execute(payload) {
      const effectiveOfferId =
        typeof payload?.offerId === "string" ? payload.offerId : env.DEFAULT_OFFER_ID;
      const offerContext = await getOfferContext(db, effectiveOfferId);
      await runAgent3({
        niche: offerContext.niche,
        offerProfile: offerContext.offerProfile,
        verticalProfile: offerContext.verticalProfile,
        hugoSitePath: HUGO_SITE_PATH,
        phone: env.BUSINESS_PHONE,
        minWordCountHub: 800,
        minWordCountSubpage: 1200,
        deployLimiter: limiters.contentDeploy,
        targetCities: typeof payload?.city === "string" ? [payload.city] : undefined,
        indexationKillSwitchEnabled:
          env.INDEXATION_KILL_SWITCH_ENABLED && env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
        searchConsoleIntegrationEnabled: env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
        indexationMinPageAgeDays: env.INDEXATION_MIN_PAGE_AGE_DAYS,
        indexationLookbackDays: env.INDEXATION_LOOKBACK_DAYS,
        minIndexationRatio: env.INDEXATION_RATIO_THRESHOLD,
        ignoreIndexationKillSwitch: payload?.ignoreIndexationKillSwitch === true,
      }, llm, db);
      return {};
    },
  });

  agentHandlers.set("agent-7", {
    name: "agent-7",
    async execute(payload) {
      const effectiveOfferId =
        typeof payload?.offerId === "string" ? payload.offerId : env.DEFAULT_OFFER_ID;
      const offerContext = await getOfferContext(db, effectiveOfferId);
      await runAgent7(
        { niche: offerContext.niche },
        db,
        payload?.provider === "mock" ? new MockDataProvider() : getAgent7Provider(env, db)
      );
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
} else if (
  command === "offer-profile" ||
  command === "vertical-profile" ||
  command?.startsWith("agent-")
) {
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
  console.log("  npx tsx src/index.ts vertical-profile <verticalKey> <json-or-file>  Save a vertical definition");
  console.log("  npx tsx src/index.ts offer-profile <offerId> <raw-text-or-file>  Save parsed offer profile");
  console.log("  npx tsx src/index.ts agent-0.5 <offerId> [zip-list]  Run Agent 0.5");
  console.log("  npx tsx src/index.ts agent-1       Run single agent (0.5, 1, 2, 3, or 7)");
  console.log("");
  console.log("Environment: Set DATABASE_URL in .env");
}
