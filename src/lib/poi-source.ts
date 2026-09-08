import { POI_EXCLUDED_SOURCE_IDS } from "./poi-taxonomy-classification";

/**
 * Canonical identity and name filter for the vector POI source.
 *
 * This module intentionally knows nothing about icon artwork or rendering.
 * The base map and the optional POI icon enhancement share these source
 * semantics without coupling the critical map style to icon assets.
 */
export const BASE_POI_SOURCE_ID = "kri-canonical-poi-source";
export const BASE_POI_SOURCE_LAYER: string | undefined = undefined;
export const BASE_POI_CLUSTER_LAYER_ID = "kri-poi-clusters";
export const BASE_POI_CLUSTER_COUNT_LAYER_ID = "kri-poi-cluster-count";
export const BASE_POI_DOT_LAYER_ID = "kri-base-pois";
export const NATURAL_POI_SOURCE_ID = "kri-natural-poi-source";
export const NATURAL_POI_DOT_LAYER_ID = "kri-natural-pois";
export const SECURITY_POI_SOURCE_ID = "kri-security-poi-source";
export const SECURITY_POI_DOT_LAYER_ID = "kri-security-pois";
export const REVIEWED_POI_SOURCE_ID = "kri-reviewed-poi-source";
export const REVIEWED_POI_DOT_LAYER_ID = "kri-reviewed-pois";
export const REVIEWED_POI_REPLACED_SOURCE_IDS = ["osm-way-1340868390-muslim"] as const;
export const BASE_POI_DOT_OPACITY = 0.70;

export const POI_NAME_PROPERTY_KEYS = [
  "name_ku", "name_ar", "name_en",
  "name:ckb", "name:ku", "name:ar", "name:en",
  "int_name", "name", "title", "label"
] as const;

export const NAMED_POI_LABEL_EXPRESSION = [
  "to-string",
  ["coalesce",
    ["get", "name_ku"], ["get", "name_ar"], ["get", "name_en"],
    ["get", "name:ckb"], ["get", "name:ku"], ["get", "name:ar"], ["get", "name:en"],
    ["get", "int_name"], ["get", "name"], ["get", "title"], ["get", "label"], ""
  ]
] as const;

const POI_SOURCE_ID_EXPRESSION = ["to-string", ["coalesce", ["get", "id"], ""]] as const;

export const NAMED_POI_FILTER = [
  "all",
  [">", ["length", NAMED_POI_LABEL_EXPRESSION], 1],
  ["!", ["in", ["downcase", NAMED_POI_LABEL_EXPRESSION], ["literal", ["place", "places", "other", "unknown", "unnamed", "شوێن", "هی تر", "مكان", "أخرى", "موقع", "لا يوجد", "لايوجد"]]]],
  ["!", ["in", POI_SOURCE_ID_EXPRESSION, ["literal", [...POI_EXCLUDED_SOURCE_IDS, ...REVIEWED_POI_REPLACED_SOURCE_IDS]]]]
] as unknown as any;
