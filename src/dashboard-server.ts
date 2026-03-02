import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { eventBus } from "./shared/events/event-bus.js";
import { createDbClient, type DbClient } from "./shared/db/client.js";
import { createRateLimiters } from "./shared/cli/rate-limiter.js";
import { createClaudeCli } from "./shared/cli/claude-cli.js";
import { createCodexCli } from "./shared/cli/codex-cli.js";
import { createGeminiCli } from "./shared/cli/gemini-cli.js";
import { createLlmClient } from "./shared/cli/llm-client.js";
import {
  loadCandidateCitiesFromDeploymentCandidates,
  runAgent1,
} from "./agents/agent-1-keywords/index.js";
import {
  parseZipInput,
  runAgent05,
} from "./agents/agent-0.5-geo-scanner/index.js";
import { runAgent2 } from "./agents/agent-2-design/index.js";
import { runAgent3 } from "./agents/agent-3-builder/index.js";
import { runAgent7 } from "./agents/agent-7-monitor/index.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { getEnv } from "./config/env.js";
import type { CitySourceMode } from "./config/env.js";
import type { AgentHandler } from "./orchestrator/types.js";
import type {
  AgentName,
  AgentStatusEvent,
  DashboardEvent,
  PipelineRunEvent,
  PipelineStatsEvent,
  HealthScoreEvent,
  PipelineRunStatus,
} from "./shared/events/event-types.js";
import {
  getCityResearchFingerprint,
  getCityScoringFingerprint,
  isFreshTimestamp,
  KEYWORD_RESEARCH_TTL_MS,
  DESIGN_RESEARCH_TTL_MS,
  normalizeNiche,
  selectTopCities,
  type ScoredCity,
} from "./shared/cache-policy.js";
import {
  DatabaseBackedDataProvider,
  MockDataProvider,
} from "./agents/agent-7-monitor/index.js";
import { SearchConsoleDataProvider } from "./agents/agent-7-monitor/search-console-provider.js";
import {
  loadOfferProfile,
  parseAndSaveOfferProfile,
} from "./shared/offer-profiles.js";
import {
  loadVerticalProfile,
  mergeOfferConstraints,
} from "./shared/vertical-profiles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT ?? 3847);
const STATS_POLL_MS = 3000;
const MAX_LOG_BUFFER = 300;

const DEFAULT_NICHE = "pest-control";
const HUGO_SITE_PATH = path.resolve("hugo-site");

function getAgentFromSource(source?: string): AgentName | null {
  const normalized = source?.toLowerCase() ?? "";
  if (normalized.includes("agent 0.5")) return "agent-0.5";
  if (normalized.includes("agent 1") || normalized === "googlekp") return "agent-1";
  if (normalized.includes("agent 2")) return "agent-2";
  if (normalized.includes("agent 3")) return "agent-3";
  if (normalized.includes("agent 7")) return "agent-7";
  return null;
}

function stripSourcePrefix(message: string, source?: string): string {
  return source ? message.replace(`[${source}] `, "") : message;
}
const CANDIDATE_CITIES = [
  { city: "Santa Cruz", state: "CA", population: 65000 },
  { city: "Watsonville", state: "CA", population: 54000 },
  { city: "Capitola", state: "CA", population: 10000 },
];

function buildAgent1Config(
  citySource: CitySourceMode,
  offerId: string | undefined,
  forceRefresh: boolean,
  candidateCities = CANDIDATE_CITIES,
  payoutPerQualifiedCall?: number,
  offerProfile?: Awaited<ReturnType<typeof loadOfferProfile>> | null,
  verticalProfile?: Awaited<ReturnType<typeof loadVerticalProfile>> | null
) {
  const niche = offerProfile?.niche ?? DEFAULT_NICHE;
  if (citySource === "deployment_candidates" && offerId) {
    return {
      niche,
      citySource,
      offerId,
      topCandidateLimit: 5,
      offerProfile,
      verticalProfile,
      payoutPerQualifiedCall,
      forceRefresh,
    };
  }

  return {
    niche,
    citySource: "hardcoded" as CitySourceMode,
    candidateCities,
    offerProfile,
    verticalProfile,
    payoutPerQualifiedCall,
    forceRefresh,
  };
}

async function getOfferContext(
  db: DbClient,
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

interface KillSwitchStatus {
  configured: boolean;
  supported: boolean;
  armed: boolean;
  ratio: number | null;
  eligiblePages: number;
  indexedPages: number;
  reason: string;
}

async function getKillSwitchStatus(
  db: DbClient | undefined,
  env = getEnv(),
  agent7Enabled = true
): Promise<KillSwitchStatus> {
  const configured = env.INDEXATION_KILL_SWITCH_ENABLED;
  const supported = env.SEARCH_CONSOLE_INTEGRATION_ENABLED;

  if (!configured) {
    return {
      configured,
      supported,
      armed: false,
      ratio: null,
      eligiblePages: 0,
      indexedPages: 0,
      reason: "Disabled in config",
    };
  }

  if (!agent7Enabled) {
    return {
      configured,
      supported,
      armed: false,
      ratio: null,
      eligiblePages: 0,
      indexedPages: 0,
      reason: "Inactive while Agent 7 is off",
    };
  }

  if (!supported) {
    return {
      configured,
      supported,
      armed: false,
      ratio: null,
      eligiblePages: 0,
      indexedPages: 0,
      reason: "Search Console integration is not enabled",
    };
  }

  if (!db) {
    return {
      configured,
      supported,
      armed: false,
      ratio: null,
      eligiblePages: 0,
      indexedPages: 0,
      reason: "No database connection",
    };
  }

  const result = await db.query<{ eligible_pages: string; indexed_pages: string }>(
    `SELECT
       COUNT(*)::text AS eligible_pages,
       COUNT(*) FILTER (
         WHERE p.indexation_status = 'indexed'
            OR EXISTS (
              SELECT 1
              FROM ranking_snapshots rs
              WHERE rs.page_id = p.id
            )
       )::text AS indexed_pages
     FROM pages p
     WHERE p.created_at <= now() - (($1::text || ' days')::interval)
       AND p.created_at >= now() - (($2::text || ' days')::interval)`,
    [
      String(env.INDEXATION_MIN_PAGE_AGE_DAYS),
      String(env.INDEXATION_LOOKBACK_DAYS),
    ]
  );

  const eligiblePages = Number(result.rows[0]?.eligible_pages ?? "0");
  const indexedPages = Number(result.rows[0]?.indexed_pages ?? "0");
  const ratio = eligiblePages > 0 ? indexedPages / eligiblePages : null;
  const armed = eligiblePages > 0 && ratio !== null && ratio < env.INDEXATION_RATIO_THRESHOLD;

  return {
    configured,
    supported,
    armed,
    ratio,
    eligiblePages,
    indexedPages,
    reason: armed
      ? `Ratio ${ratio?.toFixed(2)} below threshold ${env.INDEXATION_RATIO_THRESHOLD.toFixed(2)}`
      : eligiblePages === 0
        ? "No eligible aged pages yet"
        : "Threshold not breached",
  };
}

async function hasFreshAgent1Cache(
  db: DbClient,
  niche: string,
  candidateCities: Array<{ city: string; state: string; population: number }>
): Promise<boolean> {
  const normalizedNiche = normalizeNiche(niche);
  const templateResult = await db.query<{ templates: string[]; updated_at: Date }>(
    `SELECT templates, updated_at
     FROM keyword_templates
     WHERE niche = $1
     LIMIT 1`,
    [normalizedNiche]
  );
  const templateRow = templateResult.rows[0];
  if (
    !templateRow ||
    !Array.isArray(templateRow.templates) ||
    templateRow.templates.length === 0 ||
    !isFreshTimestamp(templateRow.updated_at, KEYWORD_RESEARCH_TTL_MS)
  ) {
    return false;
  }

  const scoringFingerprint = getCityScoringFingerprint(candidateCities, templateRow.templates);
  const scoringResult = await db.query<{ scored_cities: ScoredCity[]; updated_at: Date }>(
    `SELECT scored_cities, updated_at
     FROM city_scoring_cache
     WHERE niche = $1
       AND input_fingerprint = $2
     LIMIT 1`,
    [normalizedNiche, scoringFingerprint]
  );
  const scoringRow = scoringResult.rows[0];
  if (
    !scoringRow ||
    !Array.isArray(scoringRow.scored_cities) ||
    !isFreshTimestamp(scoringRow.updated_at, KEYWORD_RESEARCH_TTL_MS)
  ) {
    return false;
  }

  const selectedCities = selectTopCities(scoringRow.scored_cities);
  if (selectedCities.length === 0) {
    return false;
  }

  for (const city of selectedCities) {
    const cityResult = await db.query<{
      keyword_cluster_ids: string[];
      research_fingerprint: string | null;
      updated_at: Date;
    }>(
      `SELECT keyword_cluster_ids, research_fingerprint, updated_at
       FROM city_keyword_map
       WHERE city = $1
         AND state = $2
         AND niche = $3
       LIMIT 1`,
      [city.city, city.state, normalizedNiche]
    );
    const row = cityResult.rows[0];
    if (
      !row ||
      row.research_fingerprint !==
        getCityResearchFingerprint(niche, city.city, city.state, templateRow.templates) ||
      !isFreshTimestamp(row.updated_at, KEYWORD_RESEARCH_TTL_MS) ||
      !Array.isArray(row.keyword_cluster_ids) ||
      row.keyword_cluster_ids.length === 0
    ) {
      return false;
    }

    const clusterResult = await db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM keyword_clusters WHERE id = ANY($1::uuid[])",
      [row.keyword_cluster_ids]
    );
    if (Number(clusterResult.rows[0]?.count ?? "0") !== row.keyword_cluster_ids.length) {
      return false;
    }
  }

  return true;
}

async function hasFreshAgent2Cache(db: DbClient, niche: string): Promise<boolean> {
  const normalizedNiche = normalizeNiche(niche);
  const [designResult, copyResult, schemaResult, seasonalResult] = await Promise.all([
    db.query<{ updated_at: Date; created_at: Date }>(
      "SELECT updated_at, created_at FROM design_specs WHERE niche = $1 LIMIT 1",
      [normalizedNiche]
    ),
    db.query<{ updated_at: Date; created_at: Date }>(
      "SELECT updated_at, created_at FROM copy_frameworks WHERE niche = $1 LIMIT 1",
      [normalizedNiche]
    ),
    db.query<{ updated_at: Date | null; created_at: Date }>(
      "SELECT updated_at, created_at FROM schema_templates WHERE niche = $1 LIMIT 1",
      [normalizedNiche]
    ),
    db.query<{ updated_at: Date | null; created_at: Date }>(
      "SELECT updated_at, created_at FROM seasonal_calendars WHERE niche = $1 LIMIT 1",
      [normalizedNiche]
    ),
  ]);

  return [
    designResult.rows[0],
    copyResult.rows[0],
    schemaResult.rows[0],
    seasonalResult.rows[0],
  ].every((row) =>
    row &&
    isFreshTimestamp(row.updated_at ?? row.created_at, DESIGN_RESEARCH_TTL_MS)
  );
}

async function getAvailableOfferIds(db: DbClient | undefined): Promise<string[]> {
  if (!db) {
    return [];
  }

  const result = await db.query<{ offer_id: string }>(
    `SELECT DISTINCT offer_id
     FROM offer_geo_coverage
     ORDER BY offer_id ASC`
  );

  return result.rows.map((row) => row.offer_id);
}

export function createDashboardServer(db?: DbClient) {
  const app = express();
  const server = createServer(app);

  // WebSocket on /ws path so it works through tunnels on same origin
  const wss = new WebSocketServer({ server, path: "/ws" });

  function createAgentStatus(agent: AgentName): AgentStatusEvent {
    return {
      type: "agent_status",
      agent,
      status: "idle",
      currentStep: "",
      currentDetail: "",
      lastError: "",
      completedAt: null,
      startedAt: null,
      duration: null,
      timestamp: Date.now(),
    };
  }

  const agentStates: Record<AgentName, AgentStatusEvent> = {
    "agent-0.5": createAgentStatus("agent-0.5"),
    "agent-1": createAgentStatus("agent-1"),
    "agent-2": createAgentStatus("agent-2"),
    "agent-3": createAgentStatus("agent-3"),
    "agent-7": createAgentStatus("agent-7"),
  };
  let lastPipelineStats: PipelineStatsEvent | null = null;
  let lastHealthScore: HealthScoreEvent | null = null;
  let lastPipelineRun: PipelineRunEvent | null = null;
  const logBuffer: DashboardEvent[] = [];
  const pipelineSequence: AgentName[] = ["agent-0.5", "agent-1", "agent-2", "agent-3", "agent-7"];

  function resetAgentStates() {
    for (const agent of Object.keys(agentStates) as AgentName[]) {
      agentStates[agent] = createAgentStatus(agent);
      try { broadcast(agentStates[agent]); } catch { /* server not ready yet */ }
    }
  }

  function getResumeAgent(snapshot: Record<AgentName, AgentStatusEvent>): AgentName | null {
    for (const agent of pipelineSequence) {
      if (snapshot[agent].status === "error") {
        return agent;
      }
    }

    return null;
  }

  function restoreCompletedAgentStates(
    snapshot: Record<AgentName, AgentStatusEvent>,
    agentsToKeep: AgentName[]
  ) {
    for (const agent of agentsToKeep) {
      if (snapshot[agent].status !== "completed") {
        continue;
      }

      agentStates[agent] = {
        ...snapshot[agent],
        timestamp: Date.now(),
      };
      try { broadcast(agentStates[agent]); } catch { /* server not ready yet */ }
    }
  }

  // Intercept console output and broadcast as pipeline_log events
  function emitLog(level: "info" | "warn" | "error", args: unknown[]) {
    const message = args.map((a) =>
      typeof a === "string" ? a : JSON.stringify(a)
    ).join(" ");
    // Extract source from bracket prefix like [Agent 1] or [orchestrator]
    const srcMatch = message.match(/^\[([^\]]+)\]/);
    const event: DashboardEvent = {
      type: "pipeline_log",
      level,
      message,
      source: srcMatch?.[1],
      timestamp: Date.now(),
    };
    logBuffer.push(event);
    if (logBuffer.length > MAX_LOG_BUFFER) {
      logBuffer.splice(0, logBuffer.length - MAX_LOG_BUFFER);
    }
    const agent = getAgentFromSource(event.source);
    if (agent && agentStates[agent].status === "running") {
      const detail = stripSourcePrefix(event.message, event.source);
      if (detail && detail !== agentStates[agent].currentDetail) {
        agentStates[agent] = {
          ...agentStates[agent],
          currentDetail: detail,
          timestamp: event.timestamp,
        };
        try { broadcast(agentStates[agent]); } catch { /* server not ready yet */ }
      }
    }
    // broadcast is defined later — use lazy reference via closure
    try { broadcast(event); } catch { /* server not ready yet */ }
  }

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);

  console.log = (...args: unknown[]) => { origLog(...args); emitLog("info", args); };
  console.warn = (...args: unknown[]) => { origWarn(...args); emitLog("warn", args); };
  console.error = (...args: unknown[]) => { origError(...args); emitLog("error", args); };

  // CORS for local Vite dev
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    next();
  });

  app.use(express.json());

  // Serve built frontend from dashboard/dist
  const distPath = path.resolve(__dirname, "../dashboard/dist");
  app.use(express.static(distPath));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", clients: wss.clients.size, timestamp: Date.now() });
  });

  // --- Pipeline control ---
  let pipelineStatus: PipelineRunStatus = "idle";
  let pipelineRunMessage = "";

  function emitPipelineRun(status: PipelineRunStatus, message: string) {
    pipelineStatus = status;
    pipelineRunMessage = message;
    const event: DashboardEvent = {
      type: "pipeline_run",
      status,
      message,
      timestamp: Date.now(),
    };
    lastPipelineRun = event;
    broadcast(event);
  }

  app.get("/api/pipeline/status", async (_req, res) => {
    try {
      const killSwitch = await getKillSwitchStatus(db);
      const availableOffers = await getAvailableOfferIds(db);
      const env = getEnv();
      res.json({
        status: pipelineStatus,
        killSwitch,
        defaults: {
          citySource: env.CITY_SOURCE_MODE,
          defaultOfferId: env.DEFAULT_OFFER_ID ?? availableOffers[0] ?? null,
          searchConsoleEnabled: env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
          agent7Provider: env.AGENT7_PROVIDER,
        },
        availableOffers,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Deployed sites
  app.get("/api/sites", async (_req, res) => {
    if (!db) {
      res.json({ sites: [] });
      return;
    }
    try {
      const result = await db.query(
        "SELECT url, slug, city, state, niche, published_at FROM pages ORDER BY published_at DESC"
      );
      res.json({ sites: result.rows });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/offers/profile", async (req, res) => {
    if (!db) {
      res.status(503).json({ error: "No database connection" });
      return;
    }

    const offerId =
      typeof req.body?.offerId === "string" ? req.body.offerId.trim() : "";
    const rawOfferText =
      typeof req.body?.rawOfferText === "string" ? req.body.rawOfferText.trim() : "";

    if (!offerId || !rawOfferText) {
      res.status(400).json({ error: "offerId and rawOfferText are required" });
      return;
    }

    try {
      await runMigrations(db);
      const profile = await parseAndSaveOfferProfile(db, offerId, rawOfferText);
      res.json({ profile });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/agent-0.5/scan", async (req, res) => {
    if (!db) {
      res.status(503).json({ error: "No database connection" });
      return;
    }

    const rawOfferId =
      typeof req.body?.offerId === "string" ? req.body.offerId.trim() : "";
    const offerId = rawOfferId || `offer-${randomUUID()}`;
    const zipCodes = typeof req.body?.zipCodes === "string" || Array.isArray(req.body?.zipCodes)
      ? parseZipInput(req.body.zipCodes as string | string[])
      : [];
    const topN = typeof req.body?.topN === "number" ? req.body.topN : undefined;
    const runAgent1AfterScan = req.body?.runAgent1 === true;
    const forceRefresh = req.body?.forceRefresh === true;

    try {
      await runMigrations(db);

      const candidates = await runAgent05(
        {
          offerId,
          zipCodes: zipCodes.length > 0 ? zipCodes : undefined,
          source: zipCodes.length > 0 ? "api" : "stored-offer",
          topN,
        },
        db
      );

      if (runAgent1AfterScan) {
        const env = getEnv();
        const limiters = createRateLimiters();
        const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
        const codexCli = createCodexCli(env.CODEX_CLI_PATH);
        const geminiCli = createGeminiCli(env.GEMINI_CLI_PATH);
        const llm = createLlmClient(claudeCli, codexCli, limiters, geminiCli);
        const offerContext = await getOfferContext(db, offerId);

        await runAgent1({
          niche: offerContext.niche,
          offerProfile: offerContext.offerProfile,
          verticalProfile: offerContext.verticalProfile,
          offerId,
          topCandidateLimit: topN,
          forceRefresh,
        }, llm, db);
      }

      res.json({
        offerId,
        candidates: candidates.map((candidate) => ({
          city: candidate.city,
          state: candidate.state,
          population: candidate.population,
          eligible_zip_count: candidate.eligibleZipCount,
          zip_codes: candidate.zipCodes,
          pre_keyword_score: candidate.preKeywordScore,
          reason_summary: candidate.reasonSummary,
        })),
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post("/api/pipeline/start", async (req, res) => {
    if (pipelineStatus === "running") {
      res.status(409).json({ error: "Pipeline is already running" });
      return;
    }
    if (!db) {
      res.status(503).json({ error: "No database connection" });
      return;
    }

    const forceKeywordRefresh = req.body?.forceKeywordRefresh === true;
    const forceDesignRefresh = req.body?.forceDesignRefresh === true;
    const enableAgent7 = req.body?.enableAgent7 === true;
    const envDefaults = getEnv();
    const citySource: CitySourceMode =
      req.body?.citySource === "deployment_candidates"
        ? "deployment_candidates"
        : req.body?.citySource === "hardcoded"
          ? "hardcoded"
          : envDefaults.CITY_SOURCE_MODE;
    let offerId =
      typeof req.body?.offerId === "string" && req.body.offerId.trim().length > 0
        ? req.body.offerId.trim()
        : undefined;
    const rawOfferText =
      typeof req.body?.rawOfferText === "string" ? req.body.rawOfferText.trim() : "";
    if (!offerId && rawOfferText) {
      offerId = `offer-${randomUUID()}`;
    }
    const offerZipCodes = typeof req.body?.offerZipCodes === "string"
      ? parseZipInput(req.body.offerZipCodes)
      : [];
    const ignoreIndexationKillSwitch = req.body?.ignoreIndexationKillSwitch === true;
    const payoutPerQualifiedCall = typeof req.body?.payoutPerQualifiedCall === "number"
      ? req.body.payoutPerQualifiedCall
      : undefined;
    const resumeFromFailure = req.body?.resumeFromFailure === true && pipelineStatus === "error";
    const priorAgentStates: Record<AgentName, AgentStatusEvent> = {
      "agent-0.5": { ...agentStates["agent-0.5"] },
      "agent-1": { ...agentStates["agent-1"] },
      "agent-2": { ...agentStates["agent-2"] },
      "agent-3": { ...agentStates["agent-3"] },
      "agent-7": { ...agentStates["agent-7"] },
    };
    const resumeAgent = resumeFromFailure ? getResumeAgent(priorAgentStates) : null;
    const resumeIndex = resumeAgent ? pipelineSequence.indexOf(resumeAgent) : -1;
    const shouldRunAgent = (agent: AgentName): boolean => {
      if (!resumeAgent) {
        return true;
      }
      const index = pipelineSequence.indexOf(agent);
      return index >= resumeIndex;
    };

    // Respond immediately — pipeline runs in background
    res.json({ status: "started" });
    resetAgentStates();
    if (resumeAgent) {
      restoreCompletedAgentStates(priorAgentStates, pipelineSequence.slice(0, resumeIndex));
      emitPipelineRun("running", `Resuming from ${resumeAgent} using cached upstream data...`);
    }

    // Run migrations first
    try {
      emitPipelineRun(
        "running",
        resumeAgent
          ? `Resuming from ${resumeAgent} — running migrations...`
          : "Running migrations..."
      );
      await runMigrations(db);
    } catch (err: any) {
      console.error("[dashboard] Migration error:", err.message);
      emitPipelineRun("error", `Migration failed: ${err.message}`);
      return;
    }

    if (citySource === "deployment_candidates" && !offerId) {
      const availableOffers = await getAvailableOfferIds(db);
      if (availableOffers.length > 0) {
        offerId = availableOffers[0];
      }
    }

    if (offerId && rawOfferText) {
      try {
        await parseAndSaveOfferProfile(db, offerId, rawOfferText);
      } catch (err: any) {
        console.error("[dashboard] Offer profile parse error:", err.message);
        emitPipelineRun("error", `Offer profile parsing failed: ${err.message}`);
        return;
      }
    }

    // Build pipeline orchestrator in same process so events flow through the bus
    const env = envDefaults;
    const limiters = createRateLimiters();
    const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
    const codexCli = createCodexCli(env.CODEX_CLI_PATH);
    const geminiCli = createGeminiCli(env.GEMINI_CLI_PATH);
    const llm = createLlmClient(claudeCli, codexCli, limiters, geminiCli);

    if (
      shouldRunAgent("agent-0.5") &&
      citySource === "deployment_candidates" &&
      (offerId || offerZipCodes.length > 0)
    ) {
      try {
        const resolvedOfferId = offerId ?? `offer-${randomUUID()}`;
        offerId = resolvedOfferId;
        await runAgent05(
          {
            offerId: resolvedOfferId,
            zipCodes: offerZipCodes.length > 0 ? offerZipCodes : undefined,
            source: offerZipCodes.length > 0 ? "dashboard-pipeline" : "stored-offer",
          },
          db
        );
      } catch (err: any) {
        emitPipelineRun("error", `Agent 0.5 failed: ${err.message}`);
        return;
      }
    } else if (!shouldRunAgent("agent-0.5") && resumeAgent) {
      console.log("[dashboard] Resuming past Agent 0.5 using cached deployment candidates");
    }

    const agentHandlers = new Map<string, AgentHandler>();

    agentHandlers.set("agent-1", {
      name: "agent-1",
      async execute(payload) {
        const effectiveOfferId =
          typeof payload?.offerId === "string" ? payload.offerId : offerId;
        const offerContext = effectiveOfferId
          ? await getOfferContext(db, effectiveOfferId)
          : { offerProfile: null, verticalProfile: null, niche: DEFAULT_NICHE };
        const payloadCity = typeof payload?.city === "string" ? payload.city : null;
        const payloadState = typeof payload?.state === "string" ? payload.state : null;
        const candidateCities = payloadCity
          ? CANDIDATE_CITIES.filter((entry) =>
              entry.city === payloadCity && (!payloadState || entry.state === payloadState)
            )
          : CANDIDATE_CITIES;
        const payloadCitySource: CitySourceMode =
          payload?.citySource === "deployment_candidates" ? "deployment_candidates" : citySource;
        await runAgent1(
          buildAgent1Config(
            payloadCitySource,
            effectiveOfferId,
            payload?.forceRefresh === true,
            candidateCities.length > 0 ? candidateCities : CANDIDATE_CITIES,
            typeof payload?.payoutPerQualifiedCall === "number"
              ? payload.payoutPerQualifiedCall
              : payoutPerQualifiedCall,
            offerContext.offerProfile,
            offerContext.verticalProfile
          ),
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
          typeof payload?.offerId === "string" ? payload.offerId : offerId;
        const offerContext = effectiveOfferId
          ? await getOfferContext(db, effectiveOfferId)
          : { offerProfile: null, verticalProfile: null, niche: DEFAULT_NICHE };
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
          typeof payload?.offerId === "string" ? payload.offerId : offerId;
        const offerContext = effectiveOfferId
          ? await getOfferContext(db, effectiveOfferId)
          : { offerProfile: null, verticalProfile: null, niche: DEFAULT_NICHE };
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
            env.INDEXATION_KILL_SWITCH_ENABLED &&
            env.SEARCH_CONSOLE_INTEGRATION_ENABLED &&
            enableAgent7,
          searchConsoleIntegrationEnabled: env.SEARCH_CONSOLE_INTEGRATION_ENABLED,
          indexationMinPageAgeDays: env.INDEXATION_MIN_PAGE_AGE_DAYS,
          indexationLookbackDays: env.INDEXATION_LOOKBACK_DAYS,
          minIndexationRatio: env.INDEXATION_RATIO_THRESHOLD,
          ignoreIndexationKillSwitch:
            payload?.ignoreIndexationKillSwitch === true || ignoreIndexationKillSwitch,
        }, llm, db);
        return {};
      },
    });

    agentHandlers.set("agent-7", {
      name: "agent-7",
      async execute() {
        const offerContext = offerId
          ? await getOfferContext(db, offerId)
          : { offerProfile: null, verticalProfile: null, niche: DEFAULT_NICHE };
        await runAgent7(
          { niche: offerContext.niche },
          db,
          env.AGENT7_PROVIDER === "mock"
            ? new MockDataProvider()
            : env.SEARCH_CONSOLE_INTEGRATION_ENABLED
              ? new SearchConsoleDataProvider(db)
              : new DatabaseBackedDataProvider(db)
        );
        return {};
      },
    });

    emitPipelineRun("running", "Creating task queue...");

    try {
      const offerContext = offerId
        ? await getOfferContext(db, offerId)
        : { offerProfile: null, verticalProfile: null, niche: DEFAULT_NICHE };
      const orchestrator = await createOrchestrator({
        agentHandlers,
        pollIntervalMs: 3000,
        maxConcurrent: 1,
      });

      const cacheCandidateCities =
        citySource === "deployment_candidates" && offerId
          ? await loadCandidateCitiesFromDeploymentCandidates(offerId, db, 5)
          : CANDIDATE_CITIES;
      const [agent1WarmBase, agent2WarmBase] = await Promise.all([
        forceKeywordRefresh
          ? Promise.resolve(false)
          : hasFreshAgent1Cache(db, offerContext.niche, cacheCandidateCities.length > 0 ? cacheCandidateCities : CANDIDATE_CITIES),
        forceDesignRefresh ? Promise.resolve(false) : hasFreshAgent2Cache(db, offerContext.niche),
      ]);
      const agent1Warm = !shouldRunAgent("agent-1") || agent1WarmBase;
      const agent2Warm = !shouldRunAgent("agent-2") || agent2WarmBase;

      const currentRunTaskIds = new Set<string>();
      let previousTaskId: string | undefined;

      if (!agent1Warm) {
        const t1 = await orchestrator.scheduler.createTask(
          "keyword_research",
          "agent-1",
          {
            niche: offerContext.niche,
            forceRefresh: forceKeywordRefresh,
            citySource,
            offerId,
            payoutPerQualifiedCall,
          }
        );
        currentRunTaskIds.add(t1);
        previousTaskId = t1;
      } else {
        console.log(
          !shouldRunAgent("agent-1") && resumeAgent
            ? "[dashboard] Resuming past Agent 1 using cached keyword research"
            : "[dashboard] Skipping Agent 1, keyword research cache is fresh"
        );
      }

      if (!agent2Warm) {
        const t2 = await orchestrator.scheduler.createTask(
          "design_research",
          "agent-2",
          { niche: offerContext.niche, forceRefresh: forceDesignRefresh, offerId },
          previousTaskId ? [previousTaskId] : []
        );
        currentRunTaskIds.add(t2);
        previousTaskId = t2;
      } else {
        console.log(
          !shouldRunAgent("agent-2") && resumeAgent
            ? "[dashboard] Resuming past Agent 2 using cached design research"
            : "[dashboard] Skipping Agent 2, design research cache is fresh"
        );
      }

      if (shouldRunAgent("agent-3")) {
        const t3 = await orchestrator.scheduler.createTask(
          "site_build",
          "agent-3",
          { niche: offerContext.niche, offerId, ignoreIndexationKillSwitch },
          previousTaskId ? [previousTaskId] : []
        );
        currentRunTaskIds.add(t3);
        previousTaskId = t3;
      } else if (resumeAgent) {
        console.log("[dashboard] Resuming past Agent 3 using cached site build inputs");
      }

      if (enableAgent7 && shouldRunAgent("agent-7")) {
        const t4 = await orchestrator.scheduler.createTask(
          "performance_monitor",
          "agent-7",
          { niche: offerContext.niche, offerId },
          previousTaskId ? [previousTaskId] : []
        );
        currentRunTaskIds.add(t4);
      } else if (!enableAgent7) {
        console.log("[dashboard] Agent 7 disabled for this run");
      } else if (resumeAgent) {
        console.log("[dashboard] Resuming past Agent 7");
      }

      if (currentRunTaskIds.size === 0) {
        emitPipelineRun("completed", "Nothing to resume; all selected stages are already complete.");
        return;
      }

      emitPipelineRun("running", "Pipeline started — processing tasks...");

      // Run orchestrator in background with a completion check
      const checkCompletion = async () => {
        const tasks = (await orchestrator.scheduler.getAllTasks())
          .filter((t) => currentRunTaskIds.has(t.id));
        if (tasks.length !== currentRunTaskIds.size) {
          return;
        }
        const allDone = tasks.every((t) => t.status === "completed" || t.status === "failed");
        if (allDone && tasks.length > 0) {
          orchestrator.stop();
          const failed = tasks.filter((t) => t.status === "failed").length;
          if (failed > 0) {
            emitPipelineRun("error", `Pipeline finished with ${failed} failed task(s)`);
          } else {
            emitPipelineRun("completed", "Pipeline completed successfully!");
          }
        }
      };

      // Wrap the orchestrator start to detect completion
      const origPoll = 3000;
      const runLoop = async () => {
        orchestrator.start().catch((err) => {
          emitPipelineRun("error", `Pipeline error: ${err.message}`);
        });

        // Check for completion periodically
        const interval = setInterval(async () => {
          try {
            await checkCompletion();
            if (pipelineStatus !== "running") {
              clearInterval(interval);
            }
          } catch {
            // ignore poll errors
          }
        }, origPoll + 1000);
      };

      runLoop();
    } catch (err: any) {
      console.error("[dashboard] Pipeline start error:", err.message);
      emitPipelineRun("error", `Failed to start: ${err.message}`);
    }
  });

  // SPA fallback — serve index.html for any non-API/non-asset route
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });

  function broadcast(event: DashboardEvent) {
    const data = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  // Forward all pipeline events to WebSocket clients
  eventBus.onEvent("dashboard_event", (event) => {
    if (event.type === "agent_start") {
      agentStates[event.agent] = {
        ...agentStates[event.agent],
        status: "running",
        currentStep: "Starting...",
        currentDetail: "",
        lastError: "",
        startedAt: event.timestamp,
        completedAt: null,
        duration: null,
        timestamp: event.timestamp,
      };
    } else if (event.type === "agent_step") {
      const startedAt = agentStates[event.agent].startedAt ?? event.timestamp;
      agentStates[event.agent] = {
        ...agentStates[event.agent],
        status: "running",
        currentStep: event.step,
        currentDetail: event.detail ?? "",
        lastError: "",
        startedAt,
        timestamp: event.timestamp,
      };
    } else if (event.type === "agent_complete") {
      agentStates[event.agent] = {
        ...agentStates[event.agent],
        status: "completed",
        currentStep: "Done!",
        currentDetail: "",
        completedAt: event.timestamp,
        duration: event.duration,
        timestamp: event.timestamp,
      };
    } else if (event.type === "agent_error") {
      console.error(
        `[dashboard] ${event.agent} failed${event.taskId ? ` (${event.taskId})` : ""}: ${event.error}`
      );
      agentStates[event.agent] = {
        ...agentStates[event.agent],
        status: "error",
        currentStep: "Error",
        currentDetail: "",
        lastError: event.error,
        completedAt: event.timestamp,
        timestamp: event.timestamp,
      };
    } else if (event.type === "task_status_change") {
      if (event.to === "pending") {
        agentStates[event.agent] = {
          ...agentStates[event.agent],
          status: "idle",
          currentStep: "Queued",
          currentDetail: "",
          lastError: "",
          duration: null,
          completedAt: null,
          timestamp: event.timestamp,
        };
      } else if (event.to === "running") {
        agentStates[event.agent] = {
          ...agentStates[event.agent],
          status: "running",
          currentStep: agentStates[event.agent].currentStep || "Starting...",
          currentDetail: agentStates[event.agent].currentDetail,
          lastError: "",
          completedAt: null,
          timestamp: event.timestamp,
        };
      }
    }
    broadcast(event);
  });

  // DB polling for pipeline stats
  let statsInterval: ReturnType<typeof setInterval> | null = null;

  async function pollStats() {
    if (!db) return;

    try {
      const [tasksResult, pagesResult, alertsResult] = await Promise.all([
        db.query(`
          SELECT status, COUNT(*)::int as count
          FROM agent_tasks
          GROUP BY status
        `),
        db.query("SELECT COUNT(*)::int as count FROM pages"),
        db.query("SELECT COUNT(*)::int as count FROM alerts WHERE is_resolved = false"),
      ]);

      const statusCounts: Record<string, number> = {};
      for (const row of tasksResult.rows) {
        statusCounts[row.status] = row.count;
      }

      const statsEvent: PipelineStatsEvent = {
        type: "pipeline_stats",
        totalTasks: Object.values(statusCounts).reduce((a, b) => a + b, 0),
        completedTasks: statusCounts["completed"] ?? 0,
        failedTasks: statusCounts["failed"] ?? 0,
        runningTasks: statusCounts["running"] ?? 0,
        pendingTasks: statusCounts["pending"] ?? 0,
        totalPages: pagesResult.rows[0]?.count ?? 0,
        totalAlerts: alertsResult.rows[0]?.count ?? 0,
        timestamp: Date.now(),
      };

      lastPipelineStats = statsEvent;
      broadcast(statsEvent);

      // Also poll health score from latest performance data
      const healthResult = await db.query(`
        SELECT
          COUNT(DISTINCT ps.page_id)::int as pages_with_data,
          COUNT(DISTINCT p.id)::int as total_pages,
          COUNT(CASE WHEN a.severity = 'critical' THEN 1 END)::int as critical_alerts
        FROM pages p
        LEFT JOIN performance_snapshots ps ON ps.page_id = p.id
        LEFT JOIN alerts a ON a.page_id = p.id AND a.is_resolved = false
      `);

      const hr = healthResult.rows[0];
      if (hr && hr.total_pages > 0) {
        const score = Math.max(0, Math.round(
          (hr.pages_with_data / hr.total_pages) * 100 - hr.critical_alerts * 5
        ));
        const healthEvent: HealthScoreEvent = {
          type: "health_score",
          score,
          interpretation: score >= 80 ? "Healthy" : score >= 50 ? "Needs attention" : "Critical",
          indexedPages: hr.pages_with_data,
          totalPages: hr.total_pages,
          criticalAlerts: hr.critical_alerts,
          timestamp: Date.now(),
        };
        lastHealthScore = healthEvent;
        broadcast(healthEvent);
      }
    } catch (err: any) {
      console.error(`[dashboard] Stats poll error: ${err.message}`);
    }
  }

  wss.on("connection", (ws) => {
    console.log(`[dashboard] Client connected (total: ${wss.clients.size})`);

    // Send current pipeline status on connect
    ws.send(JSON.stringify(lastPipelineRun ?? {
      type: "pipeline_run",
      status: pipelineStatus,
      message: pipelineRunMessage || (pipelineStatus === "running" ? "Pipeline is running..." : ""),
      timestamp: Date.now(),
    }));

    for (const agent of Object.values(agentStates)) {
      ws.send(JSON.stringify({ ...agent, timestamp: Date.now() }));
    }

    if (lastPipelineStats) {
      ws.send(JSON.stringify(lastPipelineStats));
    }

    if (lastHealthScore) {
      ws.send(JSON.stringify(lastHealthScore));
    }

    for (const event of logBuffer) {
      ws.send(JSON.stringify(event));
    }

    ws.on("close", () => {
      console.log(`[dashboard] Client disconnected (total: ${wss.clients.size})`);
    });
  });

  return {
    start() {
      server.listen(PORT, () => {
        console.log(`[dashboard] Server running on http://localhost:${PORT}`);
        console.log(`[dashboard] WebSocket on ws://localhost:${PORT}/ws`);
      });

      if (db) {
        statsInterval = setInterval(pollStats, STATS_POLL_MS);
        pollStats();
      }
    },

    stop() {
      if (statsInterval) clearInterval(statsInterval);
      wss.close();
      server.close();
    },

    broadcast,
    wss,
  };
}

async function runMigrations(db: DbClient) {
  const migrationsDir = path.resolve(__dirname, "shared/db/migrations");
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
    console.log(`[dashboard] applying migration: ${file}`);
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

// Allow running standalone
if (process.argv[1]?.endsWith("dashboard-server.ts") || process.argv[1]?.endsWith("dashboard-server.js")) {
  const dbUrl = process.env.DATABASE_URL;
  const db = dbUrl ? createDbClient(dbUrl) : undefined;
  const dashboard = createDashboardServer(db);
  dashboard.start();

  process.on("SIGINT", () => {
    dashboard.stop();
    db?.end();
    process.exit(0);
  });
}
