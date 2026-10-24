import type { Feature, Point } from "geojson";
import type { AtlasPlace } from "./atlas-places";
import type { StaticSearchItem } from "./static-search";

export type Language = "ku" | "ar" | "en";
export type MapMode = "street" | "night" | "satellite";
export type PointKind = "city" | "town" | "settlement";

export type LocalityProperties = {
  id: string;
  name: string;
  name_display?: string;
  name_ku?: string;
  name_ar?: string;
  name_en?: string;
  name_local?: string;
  place?: string;
  search_key?: string;
  admin_governorate_ku?: string;
  admin_governorate_ar?: string;
  admin_governorate_en?: string;
  admin_district_ku?: string;
  admin_district_ar?: string;
  admin_district_en?: string;
  [key: string]: unknown;
};

export type LocalityFeature = Feature<Point, LocalityProperties>;
export type AdministrativeLabelProperties = {
  id: string;
  level: "region" | "governorate";
  name_ku: string;
  name_ar: string;
  name_en: string;
};
export type AdministrativeLabelFeature = Feature<Point, AdministrativeLabelProperties>;
export type RoadLabelProperties = {
  id: string;
  name: string;
  name_ku?: string;
  name_ar?: string;
  name_en?: string;
  ref?: string | null;
  class: "motorway" | "trunk" | "primary" | "secondary" | "tertiary";
  minzoom: number;
  rank: number;
};
export type RoadLabelFeature = Feature<Point, RoadLabelProperties>;
export type OwnerFeature = Feature<Point, { id: string; category: string; name_ku?: string; name_ar?: string | null; name_en?: string | null; marker_icon: string; marker_tier: "landmark" | "community" | "local"; marker_color: string; marker_priority: number }>;
export type BasePoiFeature = Feature<Point, Record<string, unknown>>;
export type SearchChoice =
  | { type: "local"; feature: LocalityFeature }
  | { type: "base"; item: StaticSearchItem }
  | { type: "owner"; place: AtlasPlace };
