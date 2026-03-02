import { z } from "zod/v4";
import type { DbClient } from "./db/client.js";
import type { OfferConstraints } from "./offer-profiles.js";

export const VerticalDefinitionSchema = z.object({
  service_scope_default: z.enum(["mixed", "residential_only", "commercial_only"]).default("mixed"),
  core_services: z.array(z.string()).default([]),
  excluded_services: z.array(z.string()).default([]),
  banned_phrases: z.array(z.string()).default([]),
  required_disclaimer_template: z.string().default(""),
  keyword_guidance: z.object({
    include_emergency: z.boolean().default(true),
    include_near_me: z.boolean().default(true),
    include_pricing: z.boolean().default(true),
    notes: z.array(z.string()).default([]),
  }).default({
    include_emergency: true,
    include_near_me: true,
    include_pricing: true,
    notes: [],
  }),
  design_guidance: z.object({
    phone_first: z.boolean().default(true),
    no_forms: z.boolean().default(true),
    archetype_bias: z.array(z.string()).default([]),
    notes: z.array(z.string()).default([]),
  }).default({
    phone_first: true,
    no_forms: true,
    archetype_bias: [],
    notes: [],
  }),
});

export const VerticalProfileSchema = z.object({
  vertical_key: z.string().min(1),
  niche: z.string().min(1),
  definition: VerticalDefinitionSchema,
});

export type VerticalDefinition = z.infer<typeof VerticalDefinitionSchema>;
export type VerticalProfile = z.infer<typeof VerticalProfileSchema>;

const DEFAULT_VERTICAL_PROFILES: Record<string, VerticalProfile> = {
  "pest-control": {
    vertical_key: "pest-control",
    niche: "pest-control",
    definition: {
      service_scope_default: "mixed",
      core_services: [
        "ants",
        "spiders",
        "cockroaches",
        "termites",
        "mice",
        "rats",
        "rodent-control",
        "silverfish",
        "earwigs",
        "centipedes",
        "millipedes",
        "clothes-moths",
        "house-crickets",
      ],
      excluded_services: [
        "bed-bugs",
        "bees",
        "wasps",
        "wildlife-removal",
        "animal-control",
        "bats",
        "raccoons",
        "squirrels",
      ],
      banned_phrases: [],
      required_disclaimer_template: "",
      keyword_guidance: {
        include_emergency: true,
        include_near_me: true,
        include_pricing: true,
        notes: [
          "Focus on common household pests over specialty infestations.",
          "Prioritize homeowner-intent keywords over commercial facility intent unless explicitly allowed.",
        ],
      },
      design_guidance: {
        phone_first: true,
        no_forms: true,
        archetype_bias: [
          "Emergency Responder",
          "Full-Service Converter",
          "Pest-Specific Specialist",
        ],
        notes: [
          "Trust signals should emphasize licensing, fast routing, and household safety.",
          "Pages should be organized around city hub plus pest-specific service pages.",
        ],
      },
    },
  },
  hvac: {
    vertical_key: "hvac",
    niche: "hvac",
    definition: {
      service_scope_default: "mixed",
      core_services: [
        "ac-repair",
        "air-conditioning-installation",
        "heating-repair",
        "furnace-repair",
        "heat-pump-service",
        "hvac-maintenance",
      ],
      excluded_services: [],
      banned_phrases: [],
      required_disclaimer_template: "",
      keyword_guidance: {
        include_emergency: true,
        include_near_me: true,
        include_pricing: true,
        notes: [
          "Split content between cooling, heating, and maintenance service intent.",
        ],
      },
      design_guidance: {
        phone_first: true,
        no_forms: true,
        archetype_bias: [
          "Emergency Responder",
          "Full-Service Converter",
        ],
        notes: [
          "Seasonality should emphasize cooling vs heating demand windows.",
        ],
      },
    },
  },
  roofing: {
    vertical_key: "roofing",
    niche: "roofing",
    definition: {
      service_scope_default: "mixed",
      core_services: [
        "roof-repair",
        "roof-replacement",
        "roof-inspection",
        "storm-damage-roofing",
      ],
      excluded_services: [],
      banned_phrases: [],
      required_disclaimer_template: "",
      keyword_guidance: {
        include_emergency: true,
        include_near_me: true,
        include_pricing: true,
        notes: [
          "Prioritize repair/replacement intent over informational roofing trivia.",
        ],
      },
      design_guidance: {
        phone_first: true,
        no_forms: true,
        archetype_bias: [
          "Emergency Responder",
          "Local Authority",
        ],
        notes: [
          "Storm restoration and leak urgency should be first-class page intents.",
        ],
      },
    },
  },
};

export function getDefaultVerticalProfile(verticalKey: string): VerticalProfile {
  return (
    DEFAULT_VERTICAL_PROFILES[verticalKey] ?? {
      vertical_key: verticalKey,
      niche: verticalKey,
      definition: {
        service_scope_default: "mixed",
        core_services: [],
        excluded_services: [],
        banned_phrases: [],
        required_disclaimer_template: "",
        keyword_guidance: {
          include_emergency: true,
          include_near_me: true,
          include_pricing: true,
          notes: [],
        },
        design_guidance: {
          phone_first: true,
          no_forms: true,
          archetype_bias: [],
          notes: [],
        },
      },
    }
  );
}

export async function loadVerticalProfile(
  db: DbClient,
  verticalKey: string
): Promise<VerticalProfile> {
  const result = await db.query<{
    vertical_key: string;
    niche: string;
    definition: unknown;
  }>(
    `SELECT vertical_key, niche, definition
     FROM vertical_profiles
     WHERE vertical_key = $1
     LIMIT 1`,
    [verticalKey]
  );

  const row = result.rows[0];
  if (row) {
    return VerticalProfileSchema.parse({
      ...row,
      definition:
        typeof row.definition === "string"
          ? JSON.parse(row.definition)
          : row.definition,
    });
  }

  const fallback = getDefaultVerticalProfile(verticalKey);
  await db.query(
    `INSERT INTO vertical_profiles (vertical_key, niche, definition, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (vertical_key) DO UPDATE SET
       niche = EXCLUDED.niche,
       definition = EXCLUDED.definition,
       updated_at = now()`,
    [fallback.vertical_key, fallback.niche, JSON.stringify(fallback.definition)]
  );
  return fallback;
}

export async function saveVerticalProfile(
  db: DbClient,
  profile: VerticalProfile
): Promise<void> {
  const parsed = VerticalProfileSchema.parse(profile);
  await db.query(
    `INSERT INTO vertical_profiles (vertical_key, niche, definition, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (vertical_key) DO UPDATE SET
       niche = EXCLUDED.niche,
       definition = EXCLUDED.definition,
       updated_at = now()`,
    [parsed.vertical_key, parsed.niche, JSON.stringify(parsed.definition)]
  );
}

function uniq(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

export function mergeOfferConstraints(
  definition: VerticalDefinition,
  override?: OfferConstraints | null
): OfferConstraints {
  const mergedAllowed = uniq([
    ...definition.core_services,
    ...(override?.allowed_services ?? []),
  ]).filter(
    (value) => !uniq([...(override?.disallowed_services ?? []), ...definition.excluded_services]).includes(value)
  );

  const mergedDisallowed = uniq([
    ...definition.excluded_services,
    ...(override?.disallowed_services ?? []),
  ]);

  const requiredDisclaimer =
    override?.required_disclaimer?.trim() ||
    definition.required_disclaimer_template ||
    "";

  return {
    service_scope: override?.service_scope ?? definition.service_scope_default,
    allowed_services: mergedAllowed,
    disallowed_services: mergedDisallowed,
    banned_phrases: uniq([
      ...definition.banned_phrases,
      ...(override?.banned_phrases ?? []),
    ]),
    required_disclaimer: requiredDisclaimer,
    allowed_traffic: override?.allowed_traffic ?? [],
    prohibited_traffic: override?.prohibited_traffic ?? [],
    target_call_min_duration_seconds:
      override?.target_call_min_duration_seconds ?? null,
    target_call_max_duration_seconds:
      override?.target_call_max_duration_seconds ?? null,
    target_geo_sources: override?.target_geo_sources ?? [],
  };
}
