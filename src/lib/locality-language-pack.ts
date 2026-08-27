import type { FeatureCollection, Point } from "geojson";
import { dataAssetUrl } from "./release";
import { fetchPersistentJson } from "./persistent-json-cache";
import type { Language, LocalityFeature, LocalityProperties } from "./types";
import { readHardwareProfile, recommendedLanguagePackLimit, type HardwareProfile } from "./hardware-profile";

type LanguagePackEntry = {
  file: string;
  records: number;
  named_records: number;
  bytes: number;
  sha256?: string;
  properties_file?: string;
  properties_bytes?: number;
  properties_sha256?: string;
};

type LanguagePackManifest = {
  schema: string;
  version: string;
  runtime_policy?: string;
  geometry_file?: string;
  geometry_records?: number;
  geometry_bytes?: number;
  geometry_sha256?: string;
  files: Record<Language, LanguagePackEntry>;
};

type LanguagePayload = FeatureCollection<Point, LocalityProperties> & { language?: Language };
type GeometryPayload = FeatureCollection<Point, LocalityProperties> & { schema?: string; version?: string; records?: number };
type LanguagePropertyRow = [string, string, number, string, string, string, string, string];
type LanguagePropertyPayload = {
  schema: string;
  version: string;
  language: Language;
  records: number;
  items: LanguagePropertyRow[];
};

const MANIFEST_PATH = "data/kri/kri-localities-language-manifest.json";
const LANGUAGE_APPLY_CHUNK_SIZE = 2_048;

const LANGUAGE_PROPERTY_KEYS = [
  "name_ku", "name_ar", "name_en",
  "admin_governorate_ku", "admin_governorate_ar", "admin_governorate_en",
  "admin_district_ku", "admin_district_ar", "admin_district_en",
  "admin_subdistrict_ku", "admin_subdistrict_ar", "admin_subdistrict_en",
  "category_ku", "category_ar", "category_en",
  "name_ku_status"
] as const;

/**
 * Loads locality geometry once, then switches language through compact property
 * packs keyed by the canonical locality id. This avoids re-downloading and
 * re-parsing 6–7 MiB of duplicate geometry on every language change.
 */
export class LocalityLanguagePackController {
  private manifestPromise: Promise<LanguagePackManifest> | null = null;
  private activeLanguage: Language | null = null;
  private activeFeatures: LocalityFeature[] = [];
  private inflightLanguage: Language | null = null;
  private inflightPromise: Promise<LocalityFeature[]> | null = null;
  private readonly propertyPacks = new Map<Language, LanguagePropertyPayload>();
  private readonly propertyPackLimit: number;

  constructor(profile: HardwareProfile = readHardwareProfile()) {
    this.propertyPackLimit = recommendedLanguagePackLimit(profile);
  }

  get language(): Language | null { return this.activeLanguage; }
  get features(): readonly LocalityFeature[] { return this.activeFeatures; }

  async load(language: Language): Promise<LocalityFeature[]> {
    if (this.activeLanguage === language && this.activeFeatures.length > 0) return this.activeFeatures;
    if (this.inflightLanguage === language && this.inflightPromise) return this.inflightPromise;

    const task = (this.activeFeatures.length === 0 ? this.loadInitial(language) : this.applyLanguage(language))
      .finally(() => {
        if (this.inflightPromise === task) {
          this.inflightLanguage = null;
          this.inflightPromise = null;
        }
      });
    this.inflightLanguage = language;
    this.inflightPromise = task;
    return task;
  }

  async prepare(language: Language): Promise<void> {
    await this.properties(language);
  }

  release(): void {
    this.activeLanguage = null;
    this.activeFeatures = [];
    this.inflightLanguage = null;
    this.inflightPromise = null;
    this.propertyPacks.clear();
  }

  private manifest(): Promise<LanguagePackManifest> {
    if (!this.manifestPromise) {
      this.manifestPromise = fetchPersistentJson<LanguagePackManifest>(
        dataAssetUrl(MANIFEST_PATH),
        "Locality language manifest"
      ).catch((error) => {
        this.manifestPromise = null;
        throw error;
      });
    }
    return this.manifestPromise;
  }

  private async loadInitial(language: Language): Promise<LocalityFeature[]> {
    const manifest = await this.manifest();
    const entry = manifest.files?.[language];
    if (!entry?.file) throw new Error(`Locality language pack is missing: ${language}`);

    if (manifest.geometry_file) {
      const [geometry, properties] = await Promise.all([
        fetchPersistentJson<GeometryPayload>(
          dataAssetUrl(`data/kri/${manifest.geometry_file}`),
          "Locality runtime geometry"
        ),
        this.properties(language)
      ]);
      const features = (geometry.features ?? []).filter((feature): feature is LocalityFeature =>
        feature.geometry?.type === "Point" && Boolean(feature.properties?.id)
      );
      const expectedRecords = manifest.geometry_records ?? entry.records;
      if (geometry.version && geometry.version !== manifest.version) {
        throw new Error("Locality runtime geometry version mismatch.");
      }
      if (features.length !== expectedRecords || features.length !== entry.records) {
        throw new Error(`Locality runtime geometry record mismatch: ${features.length}/${entry.records}.`);
      }
      if (!properties) throw new Error(`Locality language properties are missing: ${language}`);
      await this.applyPropertyPayload(features, properties, language);
      this.activeLanguage = language;
      this.activeFeatures = features;
      return features;
    }

    const payload = await fetchPersistentJson<LanguagePayload>(
      dataAssetUrl(`data/kri/${entry.file}`),
      `Locality language pack (${language})`
    );
    if (payload.language && payload.language !== language) {
      throw new Error(`Locality language pack mismatch: expected ${language}, received ${payload.language}.`);
    }
    const features = (payload.features ?? []).filter((feature): feature is LocalityFeature =>
      feature.geometry?.type === "Point" && Boolean(feature.properties?.id)
    );
    if (features.length !== entry.records) {
      throw new Error(`Locality language pack record mismatch: ${features.length}/${entry.records}.`);
    }
    this.activeLanguage = language;
    this.activeFeatures = features;
    return features;
  }

  private async properties(language: Language): Promise<LanguagePropertyPayload | null> {
    const cached = this.propertyPacks.get(language);
    if (cached) {
      this.propertyPacks.delete(language);
      this.propertyPacks.set(language, cached);
      return cached;
    }
    const manifest = await this.manifest();
    const entry = manifest.files?.[language];
    if (!entry?.properties_file) return null;
    const payload = await fetchPersistentJson<LanguagePropertyPayload>(
      dataAssetUrl(`data/kri/${entry.properties_file}`),
      `Locality language properties (${language})`
    );
    if (payload.schema !== "NAV KURD locality language properties v1"
      || payload.language !== language
      || payload.version !== manifest.version
      || payload.records !== entry.records
      || payload.items.length !== entry.records) {
      throw new Error(`Locality language property pack mismatch: ${language}.`);
    }
    this.propertyPacks.set(language, payload);
    while (this.propertyPacks.size > this.propertyPackLimit) {
      const oldest = this.propertyPacks.keys().next().value as Language | undefined;
      if (!oldest) break;
      this.propertyPacks.delete(oldest);
    }
    return payload;
  }

  private async applyPropertyPayload(
    features: LocalityFeature[],
    payload: LanguagePropertyPayload,
    language: Language
  ): Promise<void> {
    for (let index = 0; index < features.length; index += 1) {
      const feature = features[index];
      const row = payload.items[index];
      if (!row || row[0] !== feature.properties.id) {
        throw new Error(`Locality language property identity mismatch at row ${index}.`);
      }
      const properties = feature.properties as LocalityProperties & Record<string, unknown>;
      for (const key of LANGUAGE_PROPERTY_KEYS) delete properties[key];
      const [id, name, verified, governorate, district, subdistrict, category, nameStatus] = row;
      properties.id = id;
      properties.name = name;
      properties[`name_${language}`] = name;
      properties.name_verified = verified === 1;
      properties[`admin_governorate_${language}`] = governorate;
      properties[`admin_district_${language}`] = district;
      properties[`admin_subdistrict_${language}`] = subdistrict;
      properties[`category_${language}`] = category;
      if (language === "ku") properties.name_ku_status = nameStatus;
      if ((index + 1) % LANGUAGE_APPLY_CHUNK_SIZE === 0) {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
      }
    }
  }

  private async applyLanguage(language: Language): Promise<LocalityFeature[]> {
    const payload = await this.properties(language);
    if (!payload) {
      this.activeFeatures = [];
      return this.loadInitial(language);
    }
    await this.applyPropertyPayload(this.activeFeatures, payload, language);
    this.activeLanguage = language;
    return this.activeFeatures;
  }
}
