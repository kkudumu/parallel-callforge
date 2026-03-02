import type { OfferProfile } from "../shared/offer-profiles.js";
import type { VerticalProfile } from "../shared/vertical-profiles.js";

export interface VerticalStrategyContext {
  offerProfile?: OfferProfile | null;
  verticalProfile?: VerticalProfile | null;
}

export interface VerticalStrategy {
  verticalKey: string;
  buildKeywordTemplateContext(context: VerticalStrategyContext): string;
  buildDesignResearchContext(context: VerticalStrategyContext): string;
  buildContentGenerationContext(context: VerticalStrategyContext): string;
  getKeywordTemplatePrompt(niche: string, context: VerticalStrategyContext): string;
  getCityScoringPrompt(input: {
    cityData: string;
    keywordData: string;
  }, context: VerticalStrategyContext): string;
  getKeywordClusteringPrompt(input: {
    city: string;
    state: string;
    keywordsJson: string;
  }, context: VerticalStrategyContext): string;
  getCompetitorAnalysisPrompt(niche: string, context: VerticalStrategyContext): string;
  getDesignSpecPrompt(input: {
    niche: string;
    competitorAnalysisJson: string;
  }, context: VerticalStrategyContext): string;
  getCopyFrameworkPrompt(niche: string, context: VerticalStrategyContext): string;
  getSchemaTemplatePrompt(niche: string, context: VerticalStrategyContext): string;
  getSeasonalCalendarPrompt(niche: string, context: VerticalStrategyContext): string;
  getCityHubPrompt(input: {
    city: string;
    state: string;
    keyword: string;
    phone: string;
    agent1Summary: string;
    agent2Summary: string;
    seasonalGuidance: string;
  }, context: VerticalStrategyContext): string;
  getServiceSubpagePrompt(input: {
    city: string;
    state: string;
    pestType: string;
    keyword: string;
    phone: string;
    agent1Summary: string;
    agent2Summary: string;
    seasonalGuidance: string;
  }, context: VerticalStrategyContext): string;
  isServiceAllowed(serviceText: string, context: VerticalStrategyContext): boolean;
}
