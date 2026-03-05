const mockCheckpoints = {
  has: jest.fn(),
  get: jest.fn(),
  mark: jest.fn(async () => undefined),
  clear: jest.fn(async () => undefined),
};

jest.mock("../../shared/checkpoints.js", () => ({
  buildCheckpointScope: jest.fn(() => "scope-key"),
  createCheckpointTracker: jest.fn(async () => mockCheckpoints),
}));

jest.mock("./research-orchestrator.js", () => ({
  runResearchPhase: jest.fn(),
}));

jest.mock("./research-reader.js", () => ({
  readResearchFile: jest.fn(),
  validateResearchFile: jest.fn(),
}));

jest.mock("./prompts.js", () => ({
  buildCompetitorAnalysisPrompt: jest.fn(() => "competitor-prompt"),
  buildDesignSpecPrompt: jest.fn(() => "design-prompt"),
  buildCopyFrameworkPrompt: jest.fn(() => "copy-prompt"),
  buildSchemaTemplatePrompt: jest.fn(() => "schema-prompt"),
  buildSeasonalCalendarPrompt: jest.fn(() => "seasonal-prompt"),
}));

jest.mock("../../shared/self-healing.js", () => ({
  withSelfHealing: jest.fn(),
}));

jest.mock("../../shared/vertical-strategies.js", () => ({
  resolveVerticalStrategy: jest.fn(() => ({})),
}));

import { runAgent2 } from "./index.js";
import { runResearchPhase } from "./research-orchestrator.js";
import { readResearchFile, validateResearchFile } from "./research-reader.js";
import {
  buildCompetitorAnalysisPrompt,
  buildDesignSpecPrompt,
  buildCopyFrameworkPrompt,
  buildSchemaTemplatePrompt,
  buildSeasonalCalendarPrompt,
} from "./prompts.js";
import { withSelfHealing } from "../../shared/self-healing.js";

const mockedRunResearchPhase = runResearchPhase as jest.Mock;
const mockedReadResearchFile = readResearchFile as jest.Mock;
const mockedValidateResearchFile = validateResearchFile as jest.Mock;
const mockedWithSelfHealing = withSelfHealing as jest.Mock;
const mockedBuildCompetitorAnalysisPrompt = buildCompetitorAnalysisPrompt as jest.Mock;
const mockedBuildDesignSpecPrompt = buildDesignSpecPrompt as jest.Mock;
const mockedBuildCopyFrameworkPrompt = buildCopyFrameworkPrompt as jest.Mock;
const mockedBuildSchemaTemplatePrompt = buildSchemaTemplatePrompt as jest.Mock;
const mockedBuildSeasonalCalendarPrompt = buildSeasonalCalendarPrompt as jest.Mock;

function createOfferProfile() {
  return {
    offer_id: "offer-123",
    niche: "pest control",
    vertical: "pest-control",
    raw_offer_text: "test offer",
    constraints: {
      service_scope: "mixed",
      allowed_services: [],
      disallowed_services: [],
      banned_phrases: [],
      required_disclaimer: "",
      allowed_traffic: [],
      prohibited_traffic: [],
      target_call_min_duration_seconds: null,
      target_call_max_duration_seconds: null,
      target_geo_sources: [],
    },
  };
}

function createDbMock() {
  return {
    query: jest.fn(async () => ({ rows: [] })),
  };
}

function installSelfHealingSuccessMocks() {
  mockedWithSelfHealing.mockImplementation(async (opts: any) => {
    switch (opts.step) {
      case "competitor_analysis":
        return {
          patterns: [],
          top_cta_patterns: [],
          trust_signal_types: [],
          layout_order: [],
        };
      case "design_spec":
        return {
          niche: "pest control",
          archetype: "authority",
          layout: {},
          components: {},
          colors: {},
          typography: {},
          responsive_breakpoints: {},
        };
      case "copy_framework":
        return {
          niche: "pest control",
          headlines: ["h1"],
          ctas: ["c1"],
          cta_microcopy: ["m1"],
          trust_signals: ["t1"],
          guarantees: ["g1"],
          reading_level: {},
          vertical_angles: {},
          faq_templates: [],
          pas_scripts: [],
        };
      case "schema_templates":
        return {
          niche: "pest control",
          jsonld_templates: {
            local_business: {},
          },
        };
      case "seasonal_calendar":
        return {
          niche: "pest control",
          months: [
            {
              month: 1,
              name: "January",
              primary_pests: ["rodents"],
              content_topics: ["winter prevention"],
              messaging_priority: "prevention",
              seasonal_keywords: ["winter pests"],
            },
          ],
        };
      default:
        throw new Error(`Unexpected step: ${opts.step}`);
    }
  });
}

describe("runAgent2 research integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckpoints.mark.mockResolvedValue(undefined);
  });

  it("re-runs deep research when checkpoint exists but files are missing/invalid", async () => {
    const checkpointSet = new Set<string>(["research_complete"]);
    mockCheckpoints.has.mockImplementation((key: string) => checkpointSet.has(key));
    mockCheckpoints.mark.mockImplementation(async (key: string) => {
      checkpointSet.add(key);
    });

    mockedReadResearchFile.mockReturnValue(null);
    mockedValidateResearchFile.mockReturnValue(false);
    mockedRunResearchPhase.mockResolvedValue({
      competitors: "comp data",
      croData: "cro data",
      design: "design data",
      copy: "copy data",
      schema: "schema data",
      seasonal: "seasonal data",
    });
    installSelfHealingSuccessMocks();

    const db = createDbMock();
    const llm = { call: jest.fn() };

    await runAgent2(
      { niche: "pest control", offerProfile: createOfferProfile() as any },
      llm as any,
      db as any
    );

    expect(mockedRunResearchPhase).toHaveBeenCalledTimes(1);
    const expectedContext = expect.objectContaining({
      competitorResearch: "comp data",
      croResearch: "cro data",
      designResearch: "design data",
      copyResearch: "copy data",
      schemaResearch: "schema data",
      seasonalResearch: "seasonal data",
    });
    expect(mockedBuildCompetitorAnalysisPrompt).toHaveBeenCalledWith("pest control", expectedContext);
    expect(mockedBuildDesignSpecPrompt).toHaveBeenCalledWith(
      "pest control",
      expect.any(String),
      expectedContext
    );
    expect(mockedBuildCopyFrameworkPrompt).toHaveBeenCalledWith("pest control", expectedContext);
    expect(mockedBuildSchemaTemplatePrompt).toHaveBeenCalledWith("pest control", expectedContext);
    expect(mockedBuildSeasonalCalendarPrompt).toHaveBeenCalledWith("pest control", expectedContext);
    expect(mockedWithSelfHealing).toHaveBeenCalledTimes(5);
  });

  it("degrades gracefully when deep research throws", async () => {
    const checkpointSet = new Set<string>();
    mockCheckpoints.has.mockImplementation((key: string) => checkpointSet.has(key));
    mockCheckpoints.mark.mockImplementation(async (key: string) => {
      checkpointSet.add(key);
    });

    mockedRunResearchPhase.mockRejectedValue(new Error("sdk down"));
    installSelfHealingSuccessMocks();

    const db = createDbMock();
    const llm = { call: jest.fn() };

    await expect(
      runAgent2(
        { niche: "pest control", offerProfile: createOfferProfile() as any },
        llm as any,
        db as any
      )
    ).resolves.toBeUndefined();

    expect(mockedRunResearchPhase).toHaveBeenCalledTimes(1);
    expect(mockedWithSelfHealing).toHaveBeenCalledTimes(5);
    expect(mockCheckpoints.mark).not.toHaveBeenCalledWith("research_complete", expect.anything());
  });
});
