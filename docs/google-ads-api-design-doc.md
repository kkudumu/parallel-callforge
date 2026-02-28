# CallForge — Google Ads API Integration Design Document

## 1. Product Overview

CallForge is a local SEO content automation platform. It researches keywords for local service niches (e.g., pest control, plumbing), scores target cities by search demand, and generates optimized landing pages deployed to Netlify.

**Architecture:** Node.js pipeline with 4 agents running sequentially:
- Agent 1: Keyword research and city scoring
- Agent 2: Design and copy framework generation
- Agent 3: Content generation and site deployment
- Agent 7: Performance monitoring

## 2. Google Ads API Usage

### API Services Used
- **KeywordPlanIdeaService.GenerateKeywordIdeas** — the only endpoint we call

### What We Query
- Keyword suggestions for local service terms (e.g., "pest control santa cruz")
- Monthly search volume estimates
- Competition level and index
- Top-of-page bid estimates

### What We Do NOT Do
- We do NOT create, modify, or manage ad campaigns
- We do NOT access billing or payment data
- We do NOT modify any Google Ads account settings
- Read-only keyword research only

## 3. Data Flow

```
User configures: niche + candidate cities
        │
        ▼
Agent 1: Keyword Research
  1. LLM generates 20-30 keyword templates (e.g., "{city} pest control")
  2. Templates expanded per city (e.g., "Santa Cruz pest control")
  3. ──► Google Ads API: GenerateKeywordIdeas ◄──
     - Input: expanded keyword list, geo target (US state)
     - Output: search volume, competition, bid estimates
  4. LLM scores cities using keyword metrics + population data
  5. LLM clusters keywords into URL-mapped groups
  6. Results stored in PostgreSQL
        │
        ▼
Agent 2: Design Research (no API usage)
        │
        ▼
Agent 3: Content Generation + Deployment (no API usage)
        │
        ▼
Agent 7: Performance Monitoring (no API usage)
```

## 4. API Call Volume

- **Per pipeline run:** 1-3 API calls to GenerateKeywordIdeas
- **Keywords per call:** 50-200 expanded keywords
- **Frequency:** On-demand, triggered manually via dashboard button
- **Estimated daily volume:** Under 50 operations (well within Basic access 15,000/day limit)

## 5. Authentication Flow

- OAuth2 with offline access (refresh token)
- Credentials stored in server-side .env file, never exposed to frontend
- Single Google Ads customer account used for keyword lookups

## 6. Technical Stack

- Runtime: Node.js 22 + TypeScript
- API Client: `google-ads-api` npm package (Opteo)
- Database: PostgreSQL (stores keyword clusters, city scores)
- Frontend: React dashboard for pipeline monitoring
- Deployment: Self-hosted server

## 7. Rate Limiting

- Application-level rate limiter using `bottleneck` library
- Max 1 concurrent API request
- Minimum 2-second spacing between calls
- Exponential backoff on transient errors

## 8. Data Retention

- Keyword metrics stored in PostgreSQL `keyword_clusters` table
- Used for content targeting decisions
- No raw API response data is resold or redistributed
- Data used exclusively for internal content strategy
