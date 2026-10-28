import { ATLAS_MARKER_PROFILES, type AtlasMarkerTier } from "./atlas-marker-catalog";
import {
  POI_COARSE_CATEGORY_FALLBACKS,
  POI_SOURCE_CLASS_TO_TAXONOMY,
  POI_SOURCE_ID_OVERRIDES,
  poiTaxonomyIdForProperties
} from "./poi-taxonomy-classification";
import type { AtlasPlaceTypeId } from "./atlas-taxonomy";

export type PoiIconTier = AtlasMarkerTier;

export type PoiIconDefinition = {
  id: AtlasPlaceTypeId;
  imageId: string;
  asset: string;
  group: string;
  tier: PoiIconTier;
  fclasses: readonly string[];
  categories: readonly string[];
  sourceIds: readonly string[];
};

const grouped = new Map<AtlasPlaceTypeId, { fclasses: string[]; categories: string[]; sourceIds: string[] }>();

function groupFor(id: AtlasPlaceTypeId): { fclasses: string[]; categories: string[]; sourceIds: string[] } {
  const current = grouped.get(id);
  if (current) return current;
  const created = { fclasses: [], categories: [], sourceIds: [] };
  grouped.set(id, created);
  return created;
}

for (const [sourceClass, taxonomyId] of Object.entries(POI_SOURCE_CLASS_TO_TAXONOMY)) {
  groupFor(taxonomyId).fclasses.push(sourceClass);
}
for (const [category, taxonomyId] of Object.entries(POI_COARSE_CATEGORY_FALLBACKS)) {
  groupFor(taxonomyId).categories.push(category);
}
for (const [sourceId, taxonomyId] of Object.entries(POI_SOURCE_ID_OVERRIDES)) {
  groupFor(taxonomyId).sourceIds.push(sourceId);
}

/**
 * Canonical static-POI registry.
 *
 * The basemap's 142 source fclasses are mapped to the same taxonomy and marker
 * assets used by owner-managed places. This removes the old coarse 18-icon
 * approximation, prevents camera/surveillance POIs from inheriting museum art,
 * and keeps map, picker, list, popup and detail identity under one design system.
 */
export const POI_ICON_DEFINITIONS: readonly PoiIconDefinition[] = ATLAS_MARKER_PROFILES
  .map((profile) => {
    const id = profile.id as AtlasPlaceTypeId;
    const source = grouped.get(id) ?? { fclasses: [], categories: [], sourceIds: [] };
    return {
      id,
      imageId: profile.imageId,
      asset: profile.asset,
      group: profile.group,
      tier: profile.tier,
      fclasses: [...source.fclasses].sort(),
      categories: [...source.categories].sort(),
      sourceIds: [...source.sourceIds].sort()
    };
  })
  .sort((a, b) => b.sourceIds.length - a.sourceIds.length || b.fclasses.length - a.fclasses.length || a.id.localeCompare(b.id));

export const POI_ICON_LAYER_IDS = [
  "kri-base-poi-icons-landmark",
  "kri-base-poi-icons-community",
  "kri-base-poi-icons-local"
] as const;

export const NATURAL_POI_ICON_LAYER_IDS = [
  "kri-natural-poi-icons-landmark",
  "kri-natural-poi-icons-community",
  "kri-natural-poi-icons-local"
] as const;

export const SECURITY_POI_ICON_LAYER_IDS = [
  "kri-security-poi-icons-landmark",
  "kri-security-poi-icons-community",
  "kri-security-poi-icons-local"
] as const;

export const REVIEWED_POI_ICON_LAYER_IDS = [
  "kri-reviewed-poi-icons-landmark",
  "kri-reviewed-poi-icons-community",
  "kri-reviewed-poi-icons-local"
] as const;

export const ALL_POI_ICON_LAYER_IDS = [
  ...POI_ICON_LAYER_IDS,
  ...NATURAL_POI_ICON_LAYER_IDS,
  ...SECURITY_POI_ICON_LAYER_IDS,
  ...REVIEWED_POI_ICON_LAYER_IDS
] as const;

export const BASE_POI_INTERACTIVE_LAYER_IDS = [
  ...ALL_POI_ICON_LAYER_IDS,
  "kri-base-pois",
  "kri-natural-pois",
  "kri-security-pois",
  "kri-reviewed-pois"
] as const;

const sourceClassExpression = [
  "downcase",
  [
    "to-string",
    [
      "coalesce",
      ["get", "fclass"],
      ["get", "class"],
      ["get", "type"],
      ["get", "amenity"],
      ["get", "shop"],
      ["get", "tourism"],
      ["get", "leisure"],
      ["get", "office"],
      ["get", "healthcare"],
      ["get", "historic"],
      ["get", "natural"],
      ""
    ]
  ]
] as const;

const sourceCategoryExpression = [
  "downcase",
  ["to-string", ["coalesce", ["get", "category"], ""]]
] as const;

// Canonical runtime features carry a verified taxonomy id directly.
// Prefer this stable identity before compatibility category inference.
const sourceIconIdExpression = [
  "downcase",
  ["to-string", ["coalesce", ["get", "icon_id"], ""]]
] as const;

const sourceIdExpression = ["to-string", ["coalesce", ["get", "id"], ""]] as const;
const overrideSourceIds = Object.keys(POI_SOURCE_ID_OVERRIDES);
const isAnyOverrideSourceIdExpression = overrideSourceIds.length
  ? ["match", sourceIdExpression, overrideSourceIds, true, false]
  : ["literal", false];

function listMatchExpression(expression: readonly unknown[], values: readonly string[]): unknown[] | null {
  if (!values.length) return null;
  return ["match", expression, [...values], true, false];
}

function definitionMatchExpression(definition: PoiIconDefinition): unknown[] {
  const canonicalIconMatch = listMatchExpression(sourceIconIdExpression, [definition.id]);
  const sourceIdMatch = listMatchExpression(sourceIdExpression, definition.sourceIds);
  const classMatch = listMatchExpression(sourceClassExpression, definition.fclasses);
  const categoryMatch = listMatchExpression(sourceCategoryExpression, definition.categories);
  const semanticMatches = [classMatch, categoryMatch].filter((value): value is unknown[] => Boolean(value));
  const semanticMatch = semanticMatches.length === 0
    ? null
    : semanticMatches.length === 1
      ? semanticMatches[0]
      : ["any", ...semanticMatches];
  const safeSemanticMatch = semanticMatch
    ? ["all", ["!", isAnyOverrideSourceIdExpression], semanticMatch]
    : null;
  const matches = [canonicalIconMatch, sourceIdMatch, safeSemanticMatch].filter((value): value is unknown[] => Boolean(value));
  if (matches.length === 0) return ["literal", false];
  return matches.length === 1 ? matches[0] : ["any", ...matches];
}

export function definitionsForTier(
  tier: PoiIconTier,
  definitions: readonly PoiIconDefinition[] = POI_ICON_DEFINITIONS
): PoiIconDefinition[] {
  return definitions.filter((definition) => definition.tier === tier);
}

export function poiIconFilterExpression(
  tier: PoiIconTier,
  definitions: readonly PoiIconDefinition[] = POI_ICON_DEFINITIONS
): unknown[] {
  const matches = definitionsForTier(tier, definitions).map(definitionMatchExpression);
  return matches.length ? ["any", ...matches] : ["literal", false];
}

export function poiIconImageExpression(
  tier: PoiIconTier,
  definitions: readonly PoiIconDefinition[] = POI_ICON_DEFINITIONS
): unknown[] {
  const tierDefinitions = definitionsForTier(tier, definitions);
  const canonicalBranches = tierDefinitions.flatMap((definition) => [
    listMatchExpression(sourceIconIdExpression, [definition.id])!, definition.imageId
  ]);
  const overrideBranches = tierDefinitions.flatMap((definition) => {
    const sourceIdMatch = listMatchExpression(sourceIdExpression, definition.sourceIds);
    return sourceIdMatch ? [sourceIdMatch, definition.imageId] : [];
  });
  const sourceBranches = tierDefinitions.flatMap((definition) => {
    const classMatch = listMatchExpression(sourceClassExpression, definition.fclasses);
    const categoryMatch = listMatchExpression(sourceCategoryExpression, definition.categories);
    const matches = [classMatch, categoryMatch].filter((value): value is unknown[] => Boolean(value));
    if (!matches.length) return [];
    const semanticMatch = matches.length === 1 ? matches[0] : ["any", ...matches];
    return [["all", ["!", isAnyOverrideSourceIdExpression], semanticMatch], definition.imageId];
  });
  return ["case", ...canonicalBranches, ...overrideBranches, ...sourceBranches, ""];
}


export function poiIconIdForProperties(properties: Record<string, unknown>): AtlasPlaceTypeId | null {
  return poiTaxonomyIdForProperties(properties);
}
