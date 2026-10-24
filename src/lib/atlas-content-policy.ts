import type { AtlasMetadataFieldDefinition } from "./atlas-editor-fields";

export type AtlasTextLimit = {
  maxChars: number;
  maxWords: number;
};

export type AtlasScriptPolicy = "kurdish" | "arabic" | "latin";

export const ATLAS_TEXT_LIMITS = {
  name: { maxChars: 120, maxWords: 18 },
  description: { maxChars: 1200, maxWords: 220 },
  caption: { maxChars: 240, maxWords: 45 },
  tags: { maxChars: 600, maxWords: 80 },
  metadata: { maxChars: 180, maxWords: 32 },
  email: { maxChars: 254, maxWords: 1 },
  url: { maxChars: 500, maxWords: 1 },
  tel: { maxChars: 32, maxWords: 3 },
  reference: { maxChars: 120, maxWords: 12 }
} as const satisfies Record<string, AtlasTextLimit>;

export const ATLAS_TAG_LIMITS = {
  maxItems: 24,
  maxCharsPerItem: 40
} as const;

export const ATLAS_MEDIA_POLICY = {
  maxBytes: 10 * 1024 * 1024,
  maxPhotosPerPlace: 12,
  allowedMimeTypes: ["image/jpeg", "image/png", "image/webp"] as const,
  accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
} as const;

export type AtlasNumericPolicy = {
  min: number;
  max: number;
  integerOnly: boolean;
};

const NUMERIC_OVERRIDES: Record<string, AtlasNumericPolicy> = {
  beds: { min: 0, max: 100000, integerOnly: true },
  student_capacity: { min: 0, max: 1000000, integerOnly: true },
  parking_capacity: { min: 0, max: 100000, integerOnly: true },
  stars: { min: 0, max: 7, integerOnly: true },
  rooms: { min: 0, max: 100000, integerOnly: true },
  capacity: { min: 0, max: 1000000, integerOnly: true },
  building_levels: { min: 0, max: 300, integerOnly: true },
  units: { min: 0, max: 1000000, integerOnly: true }
};

const UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u;
const BIDI_OVERRIDE_RE = /[\u202A-\u202E\u2066-\u2069]/u;
const LETTER_RE = /\p{Letter}/u;
const ARABIC_LETTER_RE = /\p{Script=Arabic}/u;
const LATIN_LETTER_RE = /\p{Script=Latin}/u;
const KURDISH_ONLY_LETTER_RE = /[پچژڤگڕڵێۆە]/u;
const KURDISH_CHARACTER_MAP: Readonly<Record<string, string>> = {
  "ك": "ک",
  "ي": "ی",
  "ى": "ی",
  "ة": "ە",
  "ۀ": "ە",
  "ھ": "ه",
  "ؤ": "ۆ"
};
const ARABIC_CHARACTER_MAP: Readonly<Record<string, string>> = {
  "ک": "ك",
  "ی": "ي"
};

export function countAtlasWords(value: string): number {
  return value.trim() ? value.trim().split(/\s+/u).filter(Boolean).length : 0;
}

export function normalizeAtlasHumanText(value: string | null | undefined): string {
  const normalized = String(value ?? "").normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (UNSAFE_CONTROL_RE.test(normalized) || BIDI_OVERRIDE_RE.test(normalized)) {
    throw new Error("Text contains unsupported control characters.");
  }
  return normalized;
}

export function normalizeAtlasLocalizedText(value: string | null | undefined, script: AtlasScriptPolicy): string {
  const normalized = normalizeAtlasHumanText(value);
  if (script === "latin") return normalized;
  const characterMap = script === "kurdish" ? KURDISH_CHARACTER_MAP : ARABIC_CHARACTER_MAP;
  return Array.from(normalized, (character) => characterMap[character] ?? character).join("");
}

export function atlasTextMatchesScript(value: string | null | undefined, script: AtlasScriptPolicy): boolean {
  const normalized = normalizeAtlasLocalizedText(value, script);
  for (const character of normalized) {
    if (!LETTER_RE.test(character)) continue;
    if ((script === "kurdish" || script === "arabic") && !ARABIC_LETTER_RE.test(character)) return false;
    if (script === "latin" && !LATIN_LETTER_RE.test(character)) return false;
  }
  if (script === "arabic" && KURDISH_ONLY_LETTER_RE.test(normalized)) return false;
  return true;
}

export function assertAtlasText(value: string | null | undefined, limit: AtlasTextLimit, label: string): string {
  const normalized = normalizeAtlasHumanText(value);
  if (normalized.length > limit.maxChars) throw new Error(`${label} must be ${limit.maxChars} characters or fewer.`);
  const words = countAtlasWords(normalized);
  if (words > limit.maxWords) throw new Error(`${label} must be ${limit.maxWords} words or fewer.`);
  return normalized;
}

export function assertAtlasLocalizedText(
  value: string | null | undefined,
  limit: AtlasTextLimit,
  label: string,
  script: AtlasScriptPolicy
): string {
  const normalized = assertAtlasText(normalizeAtlasLocalizedText(value, script), limit, label);
  if (!atlasTextMatchesScript(normalized, script)) {
    throw new Error(`${label} contains letters outside the allowed writing system.`);
  }
  return normalized;
}

export function atlasMetadataTextLimit(field: AtlasMetadataFieldDefinition): AtlasTextLimit | null {
  if (field.type === "number" || field.type === "select") return null;
  if (field.type === "email") return ATLAS_TEXT_LIMITS.email;
  if (field.type === "url") return ATLAS_TEXT_LIMITS.url;
  if (field.type === "tel") return ATLAS_TEXT_LIMITS.tel;
  const maxChars = Math.min(field.maxLength ?? ATLAS_TEXT_LIMITS.metadata.maxChars, field.type === "textarea" ? 600 : ATLAS_TEXT_LIMITS.metadata.maxChars);
  const maxWords = Math.max(1, Math.min(field.type === "textarea" ? 100 : ATLAS_TEXT_LIMITS.metadata.maxWords, Math.ceil(maxChars / 6)));
  return { maxChars, maxWords };
}

export function atlasNumericPolicy(field: AtlasMetadataFieldDefinition): AtlasNumericPolicy | null {
  if (field.type !== "number") return null;
  return NUMERIC_OVERRIDES[field.key] ?? { min: 0, max: 1000000, integerOnly: true };
}

export function parseAtlasNumber(value: unknown, policy: AtlasNumericPolicy, label: string): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (!/^-?\d+(?:\.\d+)?$/u.test(raw)) throw new Error(`${label} must contain numbers only.`);
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) throw new Error(`${label} is not a valid number.`);
  if (policy.integerOnly && !Number.isInteger(numeric)) throw new Error(`${label} must be a whole number.`);
  if (numeric < policy.min || numeric > policy.max) throw new Error(`${label} must be between ${policy.min} and ${policy.max}.`);
  return numeric;
}

export function normalizeAtlasTags(values: readonly string[]): string[] {
  const normalized = Array.from(new Set(values
    .map((value) => value.trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_"))
    .filter(Boolean)));
  if (normalized.length > ATLAS_TAG_LIMITS.maxItems) throw new Error(`Use no more than ${ATLAS_TAG_LIMITS.maxItems} tags.`);
  for (const tag of normalized) {
    if (tag.length > ATLAS_TAG_LIMITS.maxCharsPerItem) throw new Error(`Each tag must be ${ATLAS_TAG_LIMITS.maxCharsPerItem} characters or fewer.`);
  }
  return normalized;
}

export function atlasLimitAttributes(limit: AtlasTextLimit): string {
  return `maxlength="${limit.maxChars}" data-max-chars="${limit.maxChars}" data-max-words="${limit.maxWords}" data-limit-counter`;
}
