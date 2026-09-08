import { ATLAS_TAXONOMY, atlasTaxonomyEntry } from "./atlas-taxonomy";

export type AtlasMarkerTier = "landmark" | "community" | "local";

export type AtlasMarkerProfile = {
  id: string;
  category: string;
  group: string;
  imageId: string;
  asset: string;
  tier: AtlasMarkerTier;
  priority: number;
  color: string;
  accent: string;
};

const GROUP_VISUALS: Readonly<Record<string, { color: string; accent: string; defaultTier: AtlasMarkerTier }>> = {
  settlement_admin: { color: "#62B5FF", accent: "#6A5CFF", defaultTier: "community" },
  government_public: { color: "#9A7CFF", accent: "#6553D8", defaultTier: "community" },
  emergency_security: { color: "#FF6D91", accent: "#C84468", defaultTier: "community" },
  health: { color: "#4ED9B5", accent: "#2A9E91", defaultTier: "community" },
  education_research: { color: "#68A8FF", accent: "#5166E8", defaultTier: "community" },
  transport_logistics: { color: "#FFB85C", accent: "#D97B2E", defaultTier: "community" },
  food_hospitality: { color: "#FF8F7A", accent: "#D85A66", defaultTier: "local" },
  retail_commerce: { color: "#D98BFF", accent: "#914BD1", defaultTier: "local" },
  finance_professional: { color: "#67D7E7", accent: "#277E9B", defaultTier: "local" },
  culture_religion_media: { color: "#F7C76B", accent: "#A96DB6", defaultTier: "community" },
  tourism_nature_heritage: { color: "#73D083", accent: "#2F8E74", defaultTier: "community" },
  sports_leisure: { color: "#72B9FF", accent: "#7C5CE6", defaultTier: "community" },
  utilities_infrastructure: { color: "#7DC8E8", accent: "#5265A7", defaultTier: "community" },
  industry_agriculture: { color: "#8BCB68", accent: "#4C8A57", defaultTier: "local" },
  residential_buildings: { color: "#B6A6FF", accent: "#7763C4", defaultTier: "local" },
  communications_technology: { color: "#5FE0FF", accent: "#5C61E6", defaultTier: "local" },
  border_route: { color: "#FFD27A", accent: "#9C744B", defaultTier: "community" }
};

const LANDMARK_IDS = new Set([
  "city", "governorate", "region", "parliament", "ministry", "general_directorate",
  "hospital", "specialist_hospital", "university", "airport", "international_airport",
  "stadium", "museum", "citadel", "castle", "archaeological_site", "monument", "memorial",
  "mosque", "grand_mosque", "church", "cathedral", "mountain", "peak", "lake", "reservoir",
  "dam", "waterfall", "border_crossing", "international_border_crossing", "industrial_zone",
  "power_station", "oil_refinery", "television_station", "radio_station", "broadcast_tower"
]);

const COMMUNITY_TOKEN_PATTERN = /(directorate|government|police|security|fire|rescue|emergency|health|clinic|pharmacy|school|college|institute|airport|bus|station|terminal|market|mall|hotel|museum|park|stadium|mosque|church|cemetery|library|theatre|cinema|factory|warehouse|border|checkpoint|bridge|municipality|court|prison|university|hospital|bank|post|telecom|tower|power|water|dam)/;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function markerTier(category: string, defaultTier: AtlasMarkerTier): AtlasMarkerTier {
  if (LANDMARK_IDS.has(category)) return "landmark";
  if (COMMUNITY_TOKEN_PATTERN.test(category)) return "community";
  return defaultTier;
}

function markerPriority(category: string, tier: AtlasMarkerTier): number {
  const base = tier === "landmark" ? 300 : tier === "community" ? 200 : 100;
  return base + (stableHash(category) % 89);
}

export const ATLAS_MARKER_PROFILES: readonly AtlasMarkerProfile[] = ATLAS_TAXONOMY.map((entry) => {
  const visual = GROUP_VISUALS[entry.group] ?? { color: "#9A7CFF", accent: "#6553D8", defaultTier: "local" as const };
  const tier = markerTier(entry.id, visual.defaultTier);
  return {
    id: entry.id,
    category: entry.id,
    group: entry.group,
    imageId: `nav-kurd-atlas-${entry.id}`,
    asset: `assets/icons/atlas/${entry.id}.svg`,
    tier,
    priority: markerPriority(entry.id, tier),
    color: visual.color,
    accent: visual.accent
  };
});

const PROFILE_BY_ID = new Map(ATLAS_MARKER_PROFILES.map((profile) => [profile.id, profile]));

export function atlasMarkerProfile(category: unknown): AtlasMarkerProfile {
  const normalized = atlasTaxonomyEntry(category)?.id ?? "other";
  return PROFILE_BY_ID.get(normalized) ?? PROFILE_BY_ID.get("other") ?? ATLAS_MARKER_PROFILES[0];
}

export function atlasMarkerProfilesForCategories(categories: readonly unknown[]): AtlasMarkerProfile[] {
  const ids = new Set(categories.map((category) => atlasMarkerProfile(category).id));
  return ATLAS_MARKER_PROFILES.filter((profile) => ids.has(profile.id));
}

export function atlasMarkerProfilesForTier(tier: AtlasMarkerTier, profiles: readonly AtlasMarkerProfile[] = ATLAS_MARKER_PROFILES): AtlasMarkerProfile[] {
  return profiles.filter((profile) => profile.tier === tier);
}

export function atlasMarkerAssetUrl(category: unknown, baseUrl = import.meta.env.BASE_URL): string {
  return `${baseUrl}${atlasMarkerProfile(category).asset.replace(/^\//, "")}`;
}
