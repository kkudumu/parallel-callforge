import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
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
import { runAgent1 } from "./agents/agent-1-keywords/index.js";
import { runAgent2 } from "./agents/agent-2-design/index.js";
import { runAgent3 } from "./agents/agent-3-builder/index.js";
import { runAgent7 } from "./agents/agent-7-monitor/index.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { getEnv } from "./config/env.js";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.DASHBOARD_PORT ?? 3847);
const STATS_POLL_MS = 3000;
const MAX_LOG_BUFFER = 300;

const NICHE = "pest-control";
const HUGO_SITE_PATH = path.resolve("hugo-site");

function getAgentFromSource(source?: string): AgentName | null {
  const normalized = source?.toLowerCase() ?? "";
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
    "agent-1": createAgentStatus("agent-1"),
    "agent-2": createAgentStatus("agent-2"),
    "agent-3": createAgentStatus("agent-3"),
    "agent-7": createAgentStatus("agent-7"),
  };
  let lastPipelineStats: PipelineStatsEvent | null = null;
  let lastHealthScore: HealthScoreEvent | null = null;
  let lastPipelineRun: PipelineRunEvent | null = null;
  const logBuffer: DashboardEvent[] = [];

  function resetAgentStates() {
    for (const agent of Object.keys(agentStates) as AgentName[]) {
      agentStates[agent] = createAgentStatus(agent);
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

  app.get("/api/pipeline/status", (_req, res) => {
    res.json({ status: pipelineStatus });
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

  app.post("/api/pipeline/start", async (_req, res) => {
    if (pipelineStatus === "running") {
      res.status(409).json({ error: "Pipeline is already running" });
      return;
    }
    if (!db) {
      res.status(503).json({ error: "No database connection" });
      return;
    }

    // Respond immediately — pipeline runs in background
    res.json({ status: "started" });
    resetAgentStates();

    // Run migrations first
    try {
      emitPipelineRun("running", "Running migrations...");
      await runMigrations(db);
    } catch (err: any) {
      console.error("[dashboard] Migration error:", err.message);
      emitPipelineRun("error", `Migration failed: ${err.message}`);
      return;
    }

    // Build pipeline orchestrator in same process so events flow through the bus
    const env = getEnv();
    const limiters = createRateLimiters();
    const claudeCli = createClaudeCli(env.CLAUDE_CLI_PATH);
    const codexCli = createCodexCli(env.CODEX_CLI_PATH);
    const geminiCli = createGeminiCli(env.GEMINI_CLI_PATH);
    const llm = createLlmClient(claudeCli, codexCli, limiters, geminiCli);

    const agentHandlers = new Map<string, AgentHandler>();

    agentHandlers.set("agent-1", {
      name: "agent-1",
      async execute() {
        await runAgent1({ niche: NICHE, candidateCities: CANDIDATE_CITIES }, llm, db);
        return {};
      },
    });

    agentHandlers.set("agent-2", {
      name: "agent-2",
      async execute() {
        await runAgent2({ niche: NICHE }, llm, db);
        return {};
      },
    });

    agentHandlers.set("agent-3", {
      name: "agent-3",
      async execute() {
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
      async execute() {
        await runAgent7({ niche: NICHE }, db);
        return {};
      },
    });

    emitPipelineRun("running", "Creating task queue...");

    try {
      const orchestrator = await createOrchestrator({
        agentHandlers,
        pollIntervalMs: 3000,
        maxConcurrent: 1,
      });

      // Seed initial tasks with dependency chain
      const t1 = await orchestrator.scheduler.createTask("keyword_research", "agent-1", { niche: NICHE });
      const t2 = await orchestrator.scheduler.createTask("design_research", "agent-2", { niche: NICHE }, [t1]);
      const t3 = await orchestrator.scheduler.createTask("site_build", "agent-3", { niche: NICHE }, [t2]);
      const t4 = await orchestrator.scheduler.createTask("performance_monitor", "agent-7", { niche: NICHE }, [t3]);
      const currentRunTaskIds = new Set([t1, t2, t3, t4]);

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
