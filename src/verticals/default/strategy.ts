import type { VerticalStrategy, VerticalStrategyContext } from "../types.js";
import {
  KEYWORD_TEMPLATE_PROMPT,
  CITY_SCORING_PROMPT,
  KEYWORD_CLUSTERING_PROMPT,
} from "../../agents/agent-1-keywords/prompts.js";
import {
  COMPETITOR_ANALYSIS_PROMPT,
  DESIGN_SPEC_PROMPT,
  COPY_FRAMEWORK_PROMPT,
  SCHEMA_TEMPLATE_PROMPT,
  SEASONAL_CALENDAR_PROMPT,
} from "../../agents/agent-2-design/prompts.js";
import {
  CITY_HUB_PROMPT,
  SERVICE_SUBPAGE_PROMPT,
} from "../../agents/agent-3-builder/prompts.js";

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function textMatchesTerm(value: string, term: string): boolean {
  const haystack = normalizeToken(value);
  const needle = normalizeToken(term);
  return Boolean(needle) && haystack.includes(needle);
}

function defaultServiceAllowed(serviceText: string, context: VerticalStrategyContext): boolean {
  const constraints = context.offerProfile?.constraints;
  if (!constraints) {
    return true;
  }

  if (constraints.disallowed_services.some((term) => textMatchesTerm(serviceText, term))) {
    return false;
  }

  if (constraints.allowed_services.length === 0) {
    return true;
  }

  return constraints.allowed_services.some((term) => textMatchesTerm(serviceText, term));
}

function buildSharedContextHeader(context: VerticalStrategyContext): string {
  const verticalProfile = context.verticalProfile;
  const offerProfile = context.offerProfile;
  if (!verticalProfile && !offerProfile) {
    return "";
  }

  const verticalSection = verticalProfile
    ? `- Vertical: ${verticalProfile.vertical_key}
- Core services: ${verticalProfile.definition.core_services.join(", ") || "none"}
- Excluded defaults: ${verticalProfile.definition.excluded_services.join(", ") || "none"}`
    : "";
  const offerSection = offerProfile
    ? `
- Service scope: ${offerProfile.constraints.service_scope}
- Allowed services: ${offerProfile.constraints.allowed_services.join(", ") || "broad core services only"}
- Disallowed services: ${offerProfile.constraints.disallowed_services.join(", ") || "none"}
- Banned phrases: ${offerProfile.constraints.banned_phrases.join(", ") || "none"}
- Required disclaimer: ${offerProfile.constraints.required_disclaimer || "none"}`
    : "";

  return `${verticalSection}${offerSection}`.trim();
}

export function createDefaultStrategy(verticalKey: string): VerticalStrategy {
  return {
    verticalKey,
    buildKeywordTemplateContext(context) {
      const verticalNotes = context.verticalProfile?.definition.keyword_guidance.notes.join(" | ") || "none";
      const header = buildSharedContextHeader(context);
      return header
        ? `\nVertical strategy:\n${header}\n- Keyword notes: ${verticalNotes}`
        : "";
    },
    buildDesignResearchContext(context) {
      const designNotes = context.verticalProfile?.definition.design_guidance.notes.join(" | ") || "none";
      const header = buildSharedContextHeader(context);
      return header
        ? `\nVertical strategy:\n${header}\n- Design notes: ${designNotes}`
        : "";
    },
    buildContentGenerationContext(context) {
      const designNotes = context.verticalProfile?.definition.design_guidance.notes.join(" | ") || "none";
      const header = buildSharedContextHeader(context);
      return header
        ? `\nVertical strategy:\n${header}\n- Content notes: ${designNotes}`
        : "";
    },
    getKeywordTemplatePrompt(niche, context) {
      const basePrompt = KEYWORD_TEMPLATE_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildKeywordTemplateContext(context)}`;
    },
    getCityScoringPrompt(input) {
      return CITY_SCORING_PROMPT
        .replace("{city_data}", input.cityData)
        .replace("{keyword_data}", input.keywordData);
    },
    getKeywordClusteringPrompt(input) {
      return KEYWORD_CLUSTERING_PROMPT
        .replace("{city}", input.city)
        .replace("{state}", input.state)
        .replace("{keywords}", input.keywordsJson);
    },
    getCompetitorAnalysisPrompt(niche, context) {
      const basePrompt = COMPETITOR_ANALYSIS_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getDesignSpecPrompt(input, context) {
      const basePrompt = DESIGN_SPEC_PROMPT
        .replace("{niche}", input.niche)
        .replace("{competitor_analysis}", input.competitorAnalysisJson);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getCopyFrameworkPrompt(niche, context) {
      const basePrompt = COPY_FRAMEWORK_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getSchemaTemplatePrompt(niche, context) {
      const basePrompt = SCHEMA_TEMPLATE_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getSeasonalCalendarPrompt(niche, context) {
      const basePrompt = SEASONAL_CALENDAR_PROMPT.replace("{niche}", niche);
      return `${basePrompt}${this.buildDesignResearchContext(context)}`;
    },
    getCityHubPrompt(input, context) {
      const basePrompt = `${CITY_HUB_PROMPT
        .replace(/\{city\}/g, input.city)
        .replace(/\{state\}/g, input.state)
        .replace(/\{keyword\}/g, input.keyword)
        .replace(/\{phone\}/g, input.phone)}

Agent 1 city keyword map (authoritative):
${input.agent1Summary}

Agent 2 design research (authoritative):
${input.agent2Summary}
- Seasonal guidance: ${input.seasonalGuidance}`;
      return `${basePrompt}${this.buildContentGenerationContext(context)}`;
    },
    getServiceSubpagePrompt(input, context) {
      const basePrompt = `${SERVICE_SUBPAGE_PROMPT
        .replace(/\{city\}/g, input.city)
        .replace(/\{state\}/g, input.state)
        .replace(/\{pest_type\}/g, input.pestType)
        .replace(/\{keyword\}/g, input.keyword)
        .replace(/\{phone\}/g, input.phone)}

Agent 1 city keyword map (authoritative):
${input.agent1Summary}

Agent 2 design research (authoritative):
${input.agent2Summary}
- Seasonal guidance: ${input.seasonalGuidance}`;
      return `${basePrompt}${this.buildContentGenerationContext(context)}`;
    },
    isServiceAllowed(serviceText, context) {
      return defaultServiceAllowed(serviceText, context);
    },
  };
}
