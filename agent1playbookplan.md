# CallForge Agent #1: Pest Control Market Selection Playbook

## Purpose

This document defines the decision logic, data sources, scoring criteria, and automated pipeline for CallForge’s keyword research agent. The agent’s job is to identify the most profitable geographic markets (both standalone cities and suburbs) for pest control pay-per-call site deployment. Every criterion below is designed to be programmable — no manual research steps.

-----

## Industry context the agent needs to understand

The U.S. pest control market generates approximately $26–$28.5 billion annually, growing at 5–6% per year. There are roughly 32,720 pest control companies operating in the U.S., and about two-thirds are single-location operators serving one metro area. The typical company generates ~$400,000 in annual revenue with gross margins above 40%. Residential services account for ~70% of total revenue.

Pay-per-call rates for pest control range from $20–$80 for general pest control to $100–$300 for specialty services (termite, bed bugs). The industry-standard qualified call duration is 90–120 seconds. Call-to-booked-service conversion rate averages ~45%. Average residential customer lifetime value is $1,200–$3,000 (quarterly service at $125–$150/quarter, retained 2–5 years).

-----

## The two parallel pipelines

The agent runs two candidate generation pipelines simultaneously:

**Pipeline A: Standalone Cities** — Self-contained cities with 50K–300K population that have their own pest control market ecosystem. Higher revenue ceiling per site, longer time to rank (3–6 months).

**Pipeline B: Suburbs of Major Metros** — Communities of 25K–100K within metros of 500K+. Faster time to rank (1–4 months), lower per-site revenue, but higher success rate and faster cash flow.

Both pipelines feed into the same scoring and build queue. The agent applies different thresholds based on which pipeline a candidate came from. Target portfolio allocation: **60% suburbs / 40% standalone cities** initially, adjusting based on performance data.

-----

## Step 1A: Generate standalone city candidates

**Data source:** Census Bureau API (api.census.gov), American Community Survey 5-Year dataset.

**API query:** Pull all U.S. places (incorporated cities + CDPs) with the following variables:

- B01003 — Total population
- B25003_002E — Owner-occupied housing units
- B25003_003E — Renter-occupied housing units
- B19013_001E — Median household income
- B25034 — Year structure built (for housing age)
- B25024 — Units in structure (for single-family density)
- B25077 — Median home value

**Filter criteria:**

|Parameter                    |Threshold                                                             |
|-----------------------------|----------------------------------------------------------------------|
|Population                   |50,000–300,000                                                        |
|Homeownership rate           |>55% (calculated: owner-occupied / total occupied)                    |
|Median household income      |>$45,000                                                              |
|5-year population growth     |Positive (compare ACS vintages or use Census Population Estimates API)|
|Single-family housing density|>50% of units are 1-unit structures                                   |

**Expected output:** ~500–1,000 candidate cities from ~19,500 Census-designated places.

-----

## Step 1B: Generate suburb candidates

**Data source:** Census Bureau API + CBSA (Core Based Statistical Area) definitions from OMB.

**Process:**

1. Identify all CBSAs with total population >500,000
1. Enumerate all places (incorporated cities + CDPs) within those CBSAs
1. Exclude the CBSA principal city itself
1. Apply suburb-specific filters

**Filter criteria:**

|Parameter                                 |Threshold                                               |
|------------------------------------------|--------------------------------------------------------|
|Population                                |25,000–100,000                                          |
|Parent metro (CBSA) population            |>500,000                                                |
|Distance from CBSA principal city centroid|10–30 miles                                             |
|Homeownership rate                        |>55%                                                    |
|Median household income                   |>$50,000                                                |
|Place type                                |Incorporated city OR named CDP (not just a neighborhood)|

**Priority metro areas to decompose first** (highest pest pressure + growth + homeownership):

Tier 1 — Start here:

- Houston → Sugar Land, Pearland, League City, Conroe, Missouri City, Katy
- Dallas-Fort Worth → Frisco, McKinney, Allen, Flower Mound, Mansfield, Burleson
- Atlanta → Marietta, Roswell, Johns Creek, Peachtree City, Kennesaw, Lawrenceville
- Tampa-St. Pete → Largo, Palm Harbor, Wesley Chapel, Brandon, Riverview
- Phoenix → Gilbert, Chandler, Surprise, Goodyear, Queen Creek
- Charlotte → Concord, Huntersville, Mooresville, Indian Trail, Matthews
- Nashville → Murfreesboro, Franklin, Hendersonville, Smyrna, Spring Hill
- Jacksonville → Fleming Island, St. Augustine, Orange Park, Ponte Vedra
- San Antonio → New Braunfels, Schertz, Cibolo, Boerne, Kyle

Tier 2 — Expand to:

- Orlando, Raleigh-Durham, Austin, Memphis, Birmingham, Savannah, Charleston, Baton Rouge, Greenville SC, Knoxville, Columbia SC, Mobile AL

**Expected output:** ~500–1,500 suburb candidates.

-----

## Step 2: Climate and pest-pressure scoring

**Applies to both pipelines.**

**Data sources:**

- NOAA Climate Data Online API (ncei.noaa.gov/cdo-web/api/v2) — free, 10,000 requests/day
- Frostline dataset (github.com/waldoj/frostline) — USDA Hardiness Zones by zip code, local data file
- HUD Termite Infestation Probability (TIP) zone data — available at archives.hud.gov

**Scoring model (0–400 composite, normalize to 0–100):**

|Factor                    |Source      |Scoring                                               |
|--------------------------|------------|------------------------------------------------------|
|Average annual temperature|NOAA CDO API|>70°F = 100pts; 60–70°F = 75; 50–60°F = 50; <50°F = 25|
|Annual precipitation      |NOAA CDO API|>50in = 100; 40–50 = 75; 30–40 = 50; <30 = 25         |
|TIP Zone                  |HUD data    |Zone 1 = 100; Zone 2 = 75; Zone 3 = 40; Zone 4 = 10   |
|USDA Hardiness Zone       |Frostline   |Zone 10+ = 100; 8–9 = 80; 7 = 60; 5–6 = 40; <5 = 20   |

**Pest pressure score** = (temp_score + precip_score + tip_score + hardiness_score) / 4

**Filter:** Pest pressure score >50. Disqualify candidates below 30.

**Why this matters:** Cities in TIP Zone 1 (FL, LA, MS, AL, GA, SC, eastern TX) have year-round pest demand. HUD/VA mortgage lenders require termite inspections in Zones 1–2, creating demand independent of consumer choice. Average temperature >60°F supports year-round pest breeding cycles. High precipitation creates moisture conditions that attract termites, mosquitoes, and roaches.

**Regional pest profiles for keyword targeting:**

- Southeast/Gulf Coast: termites, roaches, mosquitoes, fire ants, wildlife (year-round)
- Southwest/Desert: scorpions, termites, rodents, rattlesnakes (year-round)
- Northeast: rodents (#1 concern — 35% of residents report mice), bed bugs, stink bugs (seasonal peaks)
- Midwest: ants, rodents, bed bugs, wasps (strong seasonal, moderate off-season)
- Pacific NW: rodents, ants, moisture pests, wildlife (year-round moderate)

-----

## Step 3: Keyword volume and CPC screening

**Data sources:**

- Google Keyword Planner (free with Google Ads account, exact volumes require ~$1/day minimum spend)
- Google Trends API (alpha, launched July 2025 — developers.google.com/search/blog/2025/07/trends-api)
- Google Autocomplete (public endpoint: google.com/complete/search)

### For standalone cities (Pipeline A):

**Keywords to check per city:**

- “pest control [city]”
- “exterminator [city]”
- “termite control [city]”
- “[city] pest control”
- “exterminator near me” (geo-targeted to city zip)

**Filter criteria:**

|Metric                                             |Threshold                                |
|---------------------------------------------------|-----------------------------------------|
|Aggregate monthly search volume (all pest keywords)|≥50/month                                |
|Google Ads CPC for primary keyword                 |≥$12                                     |
|CPC sweet spot                                     |$15–$45 (healthy market)                 |
|CPC red flag                                       |>$55 (saturated) or <$10 (weak economics)|

**Note:** Aggregate volume across all pest-related keywords (general pest, termite, bed bug, rodent, ant, mosquito, wildlife) typically runs 3–5× the primary “pest control [city]” keyword volume. The agent should sum all related terms.

### For suburbs (Pipeline B):

**Keywords to check per suburb:**

- “pest control [suburb name]”
- “exterminator [suburb name]”
- “[suburb name] pest control”

**Filter criteria:**

|Metric                        |Threshold                                                                                          |
|------------------------------|---------------------------------------------------------------------------------------------------|
|Primary keyword monthly volume|≥10/month                                                                                          |
|CPC                           |≥$12 (use metro-level CPC data if suburb-specific isn’t available — the economics are metro-driven)|

**REQUIRED: Search identity test.** A suburb is only viable if residents search using the suburb’s name. The agent must confirm at least ONE of:

1. Google Keyword Planner shows any measurable volume for “[suburb] pest control” (even 10–20/month)
1. Google Autocomplete suggests the suburb name when typing “pest control “ with location bias set to the suburb’s zip code
1. Google Trends shows any signal for “[suburb] pest control” at the DMA level
1. Searching “pest control [suburb]” returns localized results, not just metro-level results

If ALL four tests return zero signal, disqualify the suburb.

### Seasonality check (both pipelines):

Use Google Trends to assess search seasonality for “pest control” in the target area’s DMA. Score:

- Year-round interest stays above 25% of peak = 100 (ideal)
- Interest drops to 10–25% of peak for 2–3 months = 75 (acceptable)
- Interest drops below 10% of peak for 4+ months = 40 (seasonal risk)
- Interest effectively zero for 5+ months = disqualify

-----

## Step 4: Competition scoring

**Data sources:**

- Google Custom Search API (100 free queries/day)
- Google PageSpeed Insights API (25,000 queries/day free)
- Moz API free tier (25,000 rows/month — provides Domain Authority, Page Authority, Spam Score)
- Google Maps Places API (pay-per-use, ~$17/1,000 requests — for GBP data)
- WhoisXML API (500 free domain age lookups/month)
- HEAD requests to competitor URLs (free — checks HTTPS, server response)

### For standalone cities (Pipeline A):

Search “pest control [city]” and analyze top 10 organic results.

**Scoring (+points = opportunity, −points = risk):**

|Signal                                                               |Score|
|---------------------------------------------------------------------|-----|
|Directory sites (Yelp, Angi, Yellow Pages, Facebook) in top 5 organic|+3   |
|No Local Service Ads (LSA) present in SERP                           |+2   |
|All top 5 competitor DAs <25                                         |+2   |
|Google Maps pack average review count <75                            |+2   |
|Any HTTP (non-HTTPS) sites in top 10                                 |+1   |
|Any competitor with PageSpeed score <50                              |+1   |
|Competitors lack schema markup (LocalBusiness, Service)              |+1   |
|Competitors have no dedicated city/service pages (just a homepage)   |+1   |
|Orkin or Terminix in top 3 organic positions                         |−3   |
|Any single GBP with 300+ reviews                                     |−2   |
|3+ active Local Service Ads                                          |−2   |
|3+ competitors with DA >35                                           |−2   |

**Competition score range:** −9 to +13. Filter: score ≥5.

### For suburbs (Pipeline B):

Search “pest control [suburb name]” and classify results.

**Scoring:**

|Signal                                                                                  |Score|
|----------------------------------------------------------------------------------------|-----|
|Top 5 results are all metro-focused (no suburb name in title tags)                      |+4   |
|Directory sites (Yelp, Angi) rank in top 3                                              |+3   |
|No site has suburb name in domain or title tag                                          |+3   |
|All competitors with DA <20                                                             |+2   |
|Zero suburb-specific GBP listings                                                       |+2   |
|No Local Service Ads showing for suburb-specific search                                 |+1   |
|Suburb-specific pest control site ranks #1 with 50+ reviews                             |−3   |
|Another rank-and-rent operator clearly present (generic brand name, residential address)|−2   |
|National franchise has suburb-specific landing page ranking                             |−1   |

**Competition score range:** −6 to +15. Filter: score ≥5.

-----

## Step 5: Monetization viability check

**Data sources:**

- Google Maps Places API (Text Search: “pest control near [city/suburb]”)
- Google Ads transparency / ad presence detection (search and note which businesses are bidding)
- Census County Business Patterns (NAICS 561710 — pest control establishments per zip)

### For standalone cities (Pipeline A):

|Check                           |Criteria                                                                         |
|--------------------------------|---------------------------------------------------------------------------------|
|Pest control GBP count          |5–20 (need buyers, but not saturated)                                            |
|Review distribution             |No single business has >3× reviews of second-highest                             |
|Active advertisers              |At least 2–3 businesses running Google Ads (signals willingness to pay for leads)|
|Google Guaranteed / LSA presence|1–3 is positive (advertisers = lead buyers); 5+ is saturated                     |
|Franchise presence              |1–2 national brands = positive (franchises buy third-party leads); 4+ = risk     |

### For suburbs (Pipeline B):

Suburb monetization is evaluated at the **metro level**, not the suburb level. Pest control companies in the parent metro serve the suburb — they’re the buyers.

|Check                                 |Criteria                              |
|--------------------------------------|--------------------------------------|
|Metro-area pest control businesses    |>10 total                             |
|Actively advertising in metro         |At least 3–5 running Google Ads       |
|Franchise presence in metro           |1–3 national brands (lead buyers)     |
|No need for suburb-specific businesses|Metro companies service suburban areas|

### Franchise detection (automatable):

Query franchise location finders for the target market:

- orkin.com location pages
- terminix.com (now Rentokil) location pages
- aptive.com location pages
- abchomeandcommercial.com location pages

Cross-reference with Google Places API results. Count unique national brand presences.

**Franchise scoring:**

- 0–1 national brands: Best for competition, acceptable for monetization
- 2–3 national brands: Best for monetization (franchises are frequent third-party lead buyers), moderate competition
- 4+ national brands: High risk — saturated paid competition, CPCs pushed to $45–$65

**Rentokil/Terminix disruption window:** Rentokil’s acquisition of Terminix (closed Oct 2022) created operational chaos — North American organic growth slowed to 1.5% in FY2024 vs. 5%+ industry growth, branch consolidation delayed. Markets where Terminix historically dominated have weakened lead generation, creating displacement demand. This is a temporary 12–24 month window. Flag former Terminix-dominant markets as higher priority.

-----

## Step 6: Composite scoring and ranking

### Standalone city score:

```text
city_score = (search_volume × cpc × competition_score × pest_pressure_score) / (population / 100000)
```

### Suburb score:

```text
suburb_score = (search_volume × cpc × competition_score × pest_pressure_score × search_identity_confidence) / (population / 25000)
```

**search_identity_confidence** is a multiplier from 0.5 to 1.0:

- Google Keyword Planner shows 20+ monthly volume = 1.0
- Keyword Planner shows 10–20 volume = 0.8
- Only autocomplete confirms, no Keyword Planner volume = 0.6
- Only SERP localization confirms = 0.5

### Ranking:

Score all candidates (both pipelines) on a normalized 0–100 scale. Rank descending. Top 30 markets proceed to the site build queue.

### Priority interleaving:

When building the queue, alternate: 2 suburbs then 1 standalone city. This ensures fast cash flow from suburb sites while city sites are ramping.

-----

## Step 7: Niche keyword expansion per market

Once a market passes scoring, the agent expands keywords to identify which pest control niches to target within that market. This determines what sites/pages to build.

**Niche priority ranking by profitability:**

|Niche            |Pay-Per-Call Rate|Avg Job Value     |Organic Competition|Year-Round?|Target Keywords                                                          |
|-----------------|-----------------|------------------|-------------------|-----------|-------------------------------------------------------------------------|
|Wildlife Removal |$40–$80          |$300–$1,500       |Low                |Yes        |“wildlife removal [city]”, “raccoon removal [city]”, “bat removal [city]”|
|Bed Bug Treatment|$100–$300        |$1,000–$5,000     |Medium             |Yes        |“bed bug treatment [city]”, “bed bug exterminator [city]”                |
|Commercial Pest  |Custom contracts |$30,000+/yr       |Low                |Yes        |“commercial pest control [city]”, “restaurant pest control [city]”       |
|Termite Control  |$100–$300        |$250–$4,000       |High               |Regional   |“termite inspection [city]”, “termite treatment [city]”                  |
|Rodent Control   |$25–$50          |$150–$600         |Medium             |Yes        |“rodent control [city]”, “mouse exterminator [city]”                     |
|Mosquito Control |$20–$40          |$350–$1,000/season|Low-Medium         |Seasonal   |“mosquito control [city]”, “mosquito treatment [city]”                   |
|General Pest     |$20–$45          |$100–$500         |Very High          |Yes        |“pest control [city]”, “exterminator [city]”                             |

**Niche × suburb stacking:** A single suburb can support 2–3 niche-specific sites or pages. Instead of one “pest control [suburb]” site, the agent can queue:

- “wildlife removal [suburb]”
- “bed bug treatment [suburb]”
- “termite inspection [suburb]”

This multiplies lead generation potential per market without additional market research.

**For each market, check niche viability:**

1. Google Keyword Planner → does the niche keyword show any volume for this market?
1. Google search → how many competitors specifically target this niche + location combo?
1. Climate/region check → does this niche make sense here? (e.g., don’t target mosquito control in Phoenix; don’t target scorpion control in Michigan)

-----

## Red flags: markets to auto-disqualify

These signals, all detectable programmatically, indicate a market that looks good on paper but will be difficult to monetize.

|Red Flag                                                         |Detection Method                         |Why It Kills the Market                                             |
|-----------------------------------------------------------------|-----------------------------------------|--------------------------------------------------------------------|
|Median household income <$40,000                                 |Census API (B19013)                      |Companies won’t pay meaningful rates for leads from low-income areas|
|Single dominant operator with 3×+ reviews vs. #2                 |Google Places API                        |Map Pack is effectively locked                                      |
|Franchise stealth saturation (4+ national brands)                |Franchise location finder cross-reference|Will eventually outspend any lead gen operation                     |
|Extreme seasonality (<4 months real pest season)                 |Google Trends seasonal analysis          |Zero off-season revenue                                             |
|CPC <$10 for primary keyword                                     |Google Keyword Planner                   |Businesses unwilling to pay for leads                               |
|Homeownership rate <45%                                          |Census API (B25003)                      |Renters call landlords, not pest companies                          |
|Existing lead gen saturation (fake GBPs at residential addresses)|Google Places API address analysis       |Other rank-and-rent operators already present                       |
|Negative 5-year population growth                                |Census Population Estimates API          |Shrinking customer base                                             |
|Suburb fails search identity test (zero signal on all 4 checks)  |Google KP + Autocomplete + Trends + SERP |Residents search parent metro name, not suburb name                 |

-----

## Free tool and API reference

### Tier 1: Must-implement (all free)

|Tool                     |Data Provided                                                                                        |Endpoint                         |Rate Limit               |
|-------------------------|-----------------------------------------------------------------------------------------------------|---------------------------------|-------------------------|
|Census Bureau API        |Population, homeownership, income, housing age, single-family density, business counts (NAICS 561710)|api.census.gov                   |Unlimited with API key   |
|Google PageSpeed Insights|Competitor site quality, Core Web Vitals                                                             |googleapis.com/pagespeedonline/v5|25,000/day               |
|NOAA Climate Data API    |Temperature, precipitation, humidity by station                                                      |ncei.noaa.gov/cdo-web/api/v2     |10,000/day               |
|Frostline (GitHub)       |USDA Hardiness Zones by zip code                                                                     |github.com/waldoj/frostline      |Unlimited (local dataset)|
|Moz API (free tier)      |Domain Authority, Page Authority, Spam Score                                                         |moz.com/products/api             |25,000 rows/month        |
|Google Custom Search API |SERP results for competition analysis                                                                |googleapis.com/customsearch/v1   |100 queries/day          |

### Tier 2: High-value with limitations

|Tool                     |Data Provided                             |Access                                              |Limitation                              |
|-------------------------|------------------------------------------|----------------------------------------------------|----------------------------------------|
|Google Keyword Planner   |Search volume ranges, CPC by geo          |Free with Google Ads account                        |Exact volumes need ~$1/day ad spend     |
|Google Trends API (alpha)|Interest data by region, seasonality      |developers.google.com/search/blog/2025/07/trends-api|Alpha access required                   |
|Google Autocomplete      |Actual user queries by location           |google.com/complete/search (public)                 |No official rate limit but be reasonable|
|Google Maps Places API   |GBP listings, ratings, review counts, URLs|Pay-per-use ~$17/1,000 requests                     |Budget-dependent                        |
|WhoisXML API             |Domain age lookups                        |whoisxmlapi.com                                     |500 free/month                          |

### Tier 3: Supplementary

|Tool               |Data Provided                                 |Access                  |
|-------------------|----------------------------------------------|------------------------|
|BLS Public Data API|Pest control employment by metro (SOC 37-2021)|api.bls.gov (free)      |
|Zillow Research    |Home values by zip (CSV download)             |zillow.com/research/data|
|HUD TIP Zone data  |Termite Infestation Probability zones         |archives.hud.gov        |

### Key Census API variables for ACS 5-Year query:

- B01003 — Total population
- B25003 — Tenure (owner vs. renter occupied)
- B25034 — Year structure built
- B25024 — Units in structure
- B19013 — Median household income
- B25077 — Median home value

-----

## Google’s local search algorithm: what the agent needs to know

### Current local pack ranking factors (Whitespark 2026 study, 47 experts):

- **GBP signals: 32%** — Primary category is the single most important factor
- **Reviews: 20%** — Quantity, sentiment, recency, velocity all matter
- **On-page: 19%** — Keywords in title, headers, content; NAP consistency
- **Links: 8%** — Quality over quantity; PBN links are being devalued
- **Behavioral: 8%** — Click-through rate, calls, direction requests
- **Citations: 7%** — NAP consistency across directories
- **Personalization: 6%** — Search history, location

### Proximity dominance (post-Vicinity Update):

- 0–3 miles from verification point: Strong ranking potential
- 3–5 miles: Viable but declining
- 10+ miles: Significant dropoff

**Implication for market selection:** Cities of 50K–200K are structurally advantaged — one well-placed site can cover most of the metro. In cities of 2M+, proximity limits coverage to a small fraction. This is why suburbs of large metros work so well — the suburb’s geographic footprint fits within a single site’s proximity radius.

### GBP restrictions for lead gen:

Google’s guidelines explicitly prohibit lead generation companies from having Business Profiles. Video verification (standard since 2024) requires showing a real physical location, branded equipment, and proof of operations. Google sued rank-and-rent operators (GMBEye/Rafadigital, June 2023) for creating 350+ fake profiles.

**Agent implication:** The strategy is organic-first, GBP-optional. Sites must be able to generate calls through organic rankings and direct traffic without relying on Map Pack presence. Partner with licensed pest control operators for GBP access if needed — their business provides verification while CallForge provides marketing.

### AI Overviews impact:

AI Overviews trigger on 13–16% of all queries, but local service queries with transactional intent (“pest control near me”, “exterminator [city]”) primarily trigger local packs, not AI Overviews. Over 50% of home services decisions happen within 4 hours of search. Net impact on pest control pay-per-call: moderate, not severe. The agent should not deprioritize markets based on AIO concerns.

-----

## Regulatory flags

Several states require pest control license numbers in all advertising including websites:

- Florida, North Carolina, Tennessee, Nevada, Michigan

The agent should flag markets in these states so the site deployment process includes a compliance step (tenant’s license number must appear on site).

No state bans pay-per-call or lead generation for pest control. The FCC’s “one-to-one” consent rule for lead gen was vacated by the 11th Circuit Court in January 2025, preserving multi-party consent models.

-----

## Expected economics by market type

|Market Type            |Monthly Rent/Revenue|Monthly Leads|Time to Rank|Setup Cost|
|-----------------------|--------------------|-------------|------------|----------|
|Suburb (25K–100K pop)  |$150–$750           |5–20         |1–4 months  |$100–$300 |
|Small city (50K–100K)  |$300–$750           |10–20        |3–6 months  |$100–$300 |
|Medium city (100K–300K)|$500–$2,000         |20–50        |4–8 months  |$100–$500 |

**Revenue formula:** Monthly leads × close rate × avg job value × 10% = approximate monthly rent justification.

Example: Suburb site generating 15 leads/month × 50% close × $300 avg job = $2,250 monthly revenue to client → justifies $225–$450/month rent.

-----

## Summary: complete pipeline flow

```text
STEP 1A: Census API → standalone cities (50K–300K, homeownership >55%, income >$45K, growing, >50% single-family)
STEP 1B: Census API → suburbs in 500K+ metros (25K–100K, homeownership >55%, income >$50K, 10–30mi from metro center)
    ↓
STEP 2: NOAA + Frostline + HUD TIP → pest pressure score → filter >50
    ↓
STEP 3: Google Keyword Planner + Trends → volume + CPC screening
         Cities: aggregate volume ≥50/month, CPC ≥$12
         Suburbs: primary keyword ≥10/month, CPC ≥$12, MUST PASS search identity test
    ↓
STEP 4: Google Custom Search + PageSpeed + Moz → competition scoring
         Cities: score ≥5/13
         Suburbs: score ≥5/15
    ↓
STEP 5: Google Places API → monetization viability
         Cities: 5–20 GBPs, no single dominant operator, 2–3 active advertisers
         Suburbs: >10 businesses in parent metro, 3–5 actively advertising
    ↓
STEP 6: Composite score → rank all candidates → top 30 to build queue
         Interleave: 2 suburbs then 1 city for cash flow optimization
    ↓
STEP 7: Niche expansion per market → wildlife removal, bed bugs, termite, commercial, rodent, mosquito, general
         Stack 2–3 niches per suburb for maximum output per market
```

**Decision thresholds quick reference:**

|Parameter                      |Standalone City         |Suburb                            |
|-------------------------------|------------------------|----------------------------------|
|Population                     |50K–300K                |25K–100K                          |
|Parent metro population        |N/A                     |>500K                             |
|Aggregate monthly search volume|≥50                     |≥10 (primary keyword)             |
|Google Ads CPC                 |≥$12, sweet spot $15–$45|≥$12 (metro-level acceptable)     |
|Top competitor DA              |<25 ideal, <40 max      |<20 ideal                         |
|Top competitor review count    |<100 ideal, <300 max    |<50 suburb-specific               |
|GBP listings in market         |5–20                    |0–5 suburb-specific (10+ in metro)|
|Homeownership rate             |>55%                    |>55%                              |
|Median household income        |>$45K                   |>$50K                             |
|Population growth (5-year)     |Positive                |Positive                          |
|Pest pressure score            |>50                     |>50                               |
|Search identity test           |N/A                     |REQUIRED — must pass              |
|National franchise count       |1–2 ideal, avoid 4+     |Evaluated at metro level          |
|Expected ranking timeline      |3–6 months              |1–4 months                        |
|Expected monthly revenue       |$300–$2,000             |$150–$750                         |

## Step-by-Step Coding Tasks

1. Add explicit pipeline labels to candidate records and reasoning:
   `standalone_city` and `suburb` as first-class values, with `metro_parent` and `cluster` retained as support metadata.
2. Update Agent 0.5 deterministic thresholds to match the playbook:
   standalone cities `50K–300K`, suburbs `25K–100K`, parent metro proxy `>500K`, suburb distance proxy `10–30 miles`.
3. Restore city-first ranking in Agent 0.5:
   remove cluster population from primary sort order, keep cluster data as advisory metadata only.
4. Keep shortlist persistence behavior:
   persist only the selected `topN` candidates into `deployment_candidates`.
5. Update `deployment_candidates.reasoning` payload shape:
   include `pipeline`, `metro_parent`, `cluster`, and leave room for future `search_identity_confidence`, `competition_score`, and `pest_pressure_score`.
6. Update Agent 1 loader to prefer playbook order:
   standalone cities first, then suburbs, then any fallback rows if the shortlist is thin.
7. Update Agent 1 scoring prompt to reflect the two-pipeline model:
   standalone cities use city thresholds, suburbs are validated in parent-metro context.
8. Add schema/type updates so candidate payloads include:
   `pipeline`, `cluster`, `metro_parent`, and future scoring fields without drift.
9. Add tests that prove:
   city-first ranking is stable, suburb classification survives, and `topN` persists only the shortlist.
10. Add placeholder hooks for future API integrations:
   Census ACS/CBSA, NOAA, HUD TIP, Google Keyword Planner, Google Trends, Google Autocomplete, Google Places, Moz, and Google Custom Search.
11. Implement future deterministic scoring modules incrementally:
   `search_identity`, `competition_score`, `pest_pressure_score`, and `monetization_score` should be separate composable functions.
12. Implement queue interleaving later:
   alternate `2 suburbs : 1 standalone city` when building the deployment queue, after the upstream scoring data exists.
