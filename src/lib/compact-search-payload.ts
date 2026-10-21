import type { StaticSearchItem } from "./static-search";
import type { Language } from "./types";

export type CompactSearchRow = [
  name: string,
  queryTail: string,
  kindIndex: number,
  categoryIndex: number,
  x: number,
  y: number
];
export type CompactSearchPayload = {
  schema: "NAV KURD compact search runtime v1";
  version: string;
  language: Language;
  records: number;
  coordinate_scale: number;
  kinds: string[];
  categories: string[];
  items: CompactSearchRow[];
};
export type SearchPayload = CompactSearchPayload;

export function isCompactSearchPayload(payload: SearchPayload): payload is CompactSearchPayload {
  return Boolean(payload && "schema" in payload && payload.schema === "NAV KURD compact search runtime v1");
}

export function decodeSearchPayload(payload: SearchPayload, language: Language): StaticSearchItem[] {
  if (!isCompactSearchPayload(payload)) throw new Error("Search runtime payload is invalid.");
  if (payload.language !== language) {
    throw new Error(`Compact search language mismatch: expected ${language}, received ${payload.language}.`);
  }
  const scale = Number(payload.coordinate_scale) || 100000;
  return payload.items.map((row) => {
    const name = String(row[0] ?? "");
    const queryTail = String(row[1] ?? "");
    return {
      n: name,
      q: queryTail ? `${name} | ${queryTail}` : name,
      k: payload.kinds[row[2]] ?? "place",
      c: payload.categories[row[3]] ?? "place",
      x: row[4] / scale,
      y: row[5] / scale,
      s: "",
      [`n_${language}`]: name,
      [`q_${language}`]: queryTail ? `${name} | ${queryTail}` : name,
      [`c_${language}`]: payload.categories[row[3]] ?? "place"
    } as StaticSearchItem;
  });
}
