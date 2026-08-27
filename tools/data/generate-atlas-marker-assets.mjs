#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const taxonomyPath = resolve(root, "src/lib/atlas-taxonomy.ts");
const outputDir = resolve(root, "public/assets/icons/atlas");
const source = await readFile(taxonomyPath, "utf8");
const releaseConfig = JSON.parse(await readFile(resolve(root, "release.config.json"), "utf8"));
const releaseDate = String(releaseConfig.releaseId ?? "").match(/^\d{4}-\d{2}-\d{2}/u)?.[0];
if (!releaseDate) throw new Error("release.config.json releaseId must begin with YYYY-MM-DD.");
const generatedAt = `${releaseDate}T00:00:00.000Z`;

const entryPattern = /\{ id: "([^"]+)", group: "([^"]+)", label: \{ ku: "([^"]*)", ar: "([^"]*)", en: "([^"]*)" \}, aliases: \[([^\]]*)\] \}/g;
const entries = [...source.matchAll(entryPattern)].map((match) => ({
  id: match[1],
  group: match[2],
  label: { ku: match[3], ar: match[4], en: match[5] }
}));

if (entries.length < 400) throw new Error(`Expected at least 400 taxonomy entries for the final NAV KURD catalog, found ${entries.length}.`);

const palettes = {
  settlement_admin: ["#62B5FF", "#6A5CFF"],
  government_public: ["#9A7CFF", "#6553D8"],
  emergency_security: ["#FF6D91", "#C84468"],
  health: ["#4ED9B5", "#2A9E91"],
  education_research: ["#68A8FF", "#5166E8"],
  transport_logistics: ["#FFB85C", "#D97B2E"],
  food_hospitality: ["#FF8F7A", "#D85A66"],
  retail_commerce: ["#D98BFF", "#914BD1"],
  finance_professional: ["#67D7E7", "#277E9B"],
  culture_religion_media: ["#F7C76B", "#A96DB6"],
  tourism_nature_heritage: ["#73D083", "#2F8E74"],
  sports_leisure: ["#72B9FF", "#7C5CE6"],
  utilities_infrastructure: ["#7DC8E8", "#5265A7"],
  industry_agriculture: ["#8BCB68", "#4C8A57"],
  residential_buildings: ["#B6A6FF", "#7763C4"],
  communications_technology: ["#5FE0FF", "#5C61E6"],
  border_route: ["#FFD27A", "#9C744B"]
};

const glyphs = {
  settlement: '<path d="M4 18h16M6 18v-7l6-4 6 4v7M9 18v-4h6v4"/>',
  government: '<path d="M3 9h18M5 9V7l7-4 7 4v2M6 9v9M10 9v9M14 9v9M18 9v9M3 20h18"/>',
  office: '<path d="M5 20V5h14v15M8 8h2M14 8h2M8 12h2M14 12h2M9 20v-4h6v4"/>',
  shield: '<path d="M12 3l7 3v5c0 4.6-2.6 7.7-7 10-4.4-2.3-7-5.4-7-10V6l7-3Z"/><path d="m9.5 12 1.7 1.8 3.8-4"/>',
  fire: '<path d="M13 3c1.4 3.2-.5 4.8-.5 6.4 0 1.1.8 1.9 1.8 1.9 1.8 0 2.8-1.7 2.7-3.4 2.2 2 3 4.4 2.2 6.8C18.3 18.5 15.5 21 12 21s-6.3-2.4-7.2-5.8c-.7-2.7.3-5.4 2.6-7.4-.1 2.2.8 3.6 2.3 3.6 2.5 0 1.5-4.8 3.3-8.4Z"/>',
  medical: '<path d="M9 4h6v5h5v6h-5v5H9v-5H4V9h5V4Z"/>',
  pharmacy: '<path d="M6 4h12M8 4v4l-3 5a5 5 0 0 0 4.4 7h5.2A5 5 0 0 0 19 13l-3-5V4M7 12h10"/>',
  school: '<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 12v5c3 2 7 2 10 0v-5M21 9v6"/>',
  book: '<path d="M4 5c3-1 5 0 8 2v13c-3-2-5-3-8-2V5Zm16 0c-3-1-5 0-8 2v13c3-2 5-3 8-2V5Z"/>',
  plane: '<path d="m3 12 18-7-5 7 5 7-18-7Zm7 0h6"/>',
  car: '<path d="M5 16h14l-1-6-3-3H9l-3 3-1 6Z"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>',
  bus: '<rect x="5" y="4" width="14" height="15" rx="3"/><path d="M7 8h10M7 13h10"/><circle cx="8" cy="17" r="1"/><circle cx="16" cy="17" r="1"/>',
  train: '<rect x="6" y="3" width="12" height="15" rx="3"/><path d="M8 7h8M9 18l-2 3M15 18l2 3M8 21h8"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>',
  road: '<path d="M9 3 6 21M15 3l3 18M12 4v3M12 10v4M12 17v3"/>',
  fuel: '<path d="M6 21V5h9v16M6 9h9M15 8h2l2 2v7a2 2 0 0 1-4 0v-3"/>',
  food: '<path d="M7 3v8M4 3v5c0 2 1 3 3 3s3-1 3-3V3M7 11v10M16 3v18M16 3c3 2 4 5 4 8h-4"/>',
  cafe: '<path d="M5 7h12v6a6 6 0 0 1-12 0V7Z"/><path d="M17 9h2a3 3 0 0 1 0 6h-2M7 4h8M4 20h15"/>',
  hotel: '<path d="M4 20V6h16v14M7 10h4v4H7v-4Zm7 0h3v4h-3v-4ZM8 20v-4h8v4"/>',
  shop: '<path d="M4 10h16l-2-6H6l-2 6Zm2 0v10h12V10M9 20v-6h6v6"/>',
  cart: '<path d="M3 5h2l2 10h10l3-7H6M9 19h.01M17 19h.01"/>',
  bank: '<path d="m3 9 9-5 9 5H3Zm2 10h14M6 9v8M10 9v8M14 9v8M18 9v8"/>',
  briefcase: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 7V5h6v2M4 12h16M10 12v2h4v-2"/>',
  mosque: '<path d="M6 20V10a6 6 0 0 1 12 0v10M9 20v-5h6v5M12 3V1M20 20V8M19 8h2"/>',
  church: '<path d="M8 20V9l4-4 4 4v11M12 5V1M10 3h4M6 20h12M10 14h4v6"/>',
  media: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>',
  museum: '<path d="m3 9 9-5 9 5H3Zm2 10h14M6 9v8M10 9v8M14 9v8M18 9v8"/><circle cx="12" cy="6.5" r="1"/>',
  mountain: '<path d="m3 20 7-12 3 5 2-3 6 10H3Z"/><path d="m8.5 10.5 1.5 2 1.2-1.3"/>',
  water: '<path d="M12 3c4 5 6 8 6 11a6 6 0 1 1-12 0c0-3 2-6 6-11Z"/><path d="M9 16c1 1 2 1.5 3 1.5"/>',
  tree: '<path d="M12 3 6 12h4l-4 6h12l-4-6h4l-6-9ZM12 18v3"/>',
  park: '<path d="M12 3 6 12h4l-4 6h12l-4-6h4l-6-9ZM12 18v3"/><path d="M3 21h18"/>',
  stadium: '<ellipse cx="12" cy="12" rx="9" ry="6"/><ellipse cx="12" cy="12" rx="5" ry="3"/><path d="M3 12h18M12 6v12"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="m12 7 3 2-1 4h-4L9 9l3-2ZM6 8l3 1M5 15l5-2M18 8l-3 1M19 15l-5-2M9 19l1-6M15 19l-1-6"/>',
  martial: '<circle cx="12" cy="5" r="2"/><path d="m12 7-2 5 2 3 3-4M10 12 5 9M12 15l-4 6M12 15l6 5M15 11l4-3"/>',
  boxing: '<path d="M7 5c2 0 4 2 4 4v5H6c-2 0-3-1-3-3V8c0-2 2-3 4-3Zm10 0c-2 0-4 2-4 4v5h5c2 0 3-1 3-3V8c0-2-2-3-4-3ZM7 14v6M17 14v6"/>',
  runner: '<circle cx="14" cy="4" r="2"/><path d="m12 7-3 5 4 2 2-4M9 12l-5 2M13 14l-4 7M13 14l6 4M15 10l5 1"/>',
  yoga: '<circle cx="12" cy="5" r="2"/><path d="M12 8v6M12 10 6 7M12 10l6-3M12 14 7 19M12 14l5 5M4 20h16"/>',
  climbing: '<path d="M5 21 15 3h4L9 21H5Z"/><circle cx="11" cy="8" r="2"/><path d="m10 10-2 4 3 2 3-5M8 14l-3 1M11 16l-2 4M11 16l4 2"/>',
  music: '<path d="M9 18V6l9-2v12M9 10l9-2"/><circle cx="6" cy="18" r="3"/><circle cx="15" cy="16" r="3"/>',
  bicycle: '<circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="m6 17 4-7 4 7h-8Zm4-7h5l3 7M9 7h3"/>',
  parcel: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 5v5M15 5v5M9 15h6"/>',
  bolt: '<path d="M13 2 5 14h6l-1 8 9-13h-6V2Z"/>',
  factory: '<path d="M4 20V10l5 3v-3l5 3v-3l6 3v7H4ZM7 16h2M12 16h2M17 16h1"/><path d="M5 10V5h4v7"/>',
  agriculture: '<path d="M12 21V8M12 12c-4 0-7-2-8-6 4 0 7 2 8 6Zm0 4c4 0 7-2 8-6-4 0-7 2-8 6Z"/>',
  home: '<path d="m3 11 9-7 9 7-2 2v8H5v-8l-2-2Z"/><path d="M9 21v-6h6v6"/>',
  tower: '<path d="M8 21h8l-1-16H9L8 21ZM9 9h6M9 14h6M7 21h10"/>',
  wifi: '<path d="M3 9a14 14 0 0 1 18 0M6 13a9 9 0 0 1 12 0M9.5 17a4 4 0 0 1 5 0"/><circle cx="12" cy="20" r="1"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M9 5h6M11 19h2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 4 6 4 9s-1 6-4 9c-3-3-4-6-4-9s1-6 4-9Z"/>',
  border: '<path d="M5 21V4M19 21V4M5 7h14M8 4h8M8 11h8M12 11v10"/>',
  prison: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 4v16M15 4v16M5 9h14M5 15h14"/>',
  bridge: '<path d="M3 17h18M5 17V9M19 17V9M5 13c4-6 10-6 14 0M3 20h18"/>',
  cemetery: '<path d="M9 20V8a3 3 0 0 1 6 0v12M7 20h10M12 4V2M9 8h6"/>',
  cinema: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="m10 9 5 3-5 3V9ZM4 9h16M4 15h16"/>',
  camera: '<path d="M4 8h4l2-3h4l2 3h4v11H4V8Z"/><circle cx="12" cy="13" r="4"/>',
  dam: '<path d="M5 4h14l-2 16H7L5 4Z"/><path d="M8 8h8M7 13h10M4 21c2-2 4-2 6 0 2-2 4-2 6 0 2-2 4-2 6 0"/>',
  generic: '<path d="M12 3a7 7 0 0 1 7 7c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 7-7Z"/><circle cx="12" cy="10" r="2.5"/>'
};

const rules = [
  [/mosque|islam|shrine/, "mosque"],
  [/church|cathedral|monastery|christian/, "church"],
  [/hospital|clinic|health|medical|dentist|ambulance|laborator|blood_bank|maternity|dialysis|optical/, "medical"],
  [/pharmacy|chemist/, "pharmacy"],
  [/school|kindergarten|academy|university|college|institute|education|training|research|library/, "school"],
  [/airport|airfield|airstrip|helipad|aviation/, "plane"],
  [/bus|coach|taxi|shuttle/, "bus"],
  [/rail|train|metro/, "train"],
  [/fuel|petrol|gas_station|charging/, "fuel"],
  [/street|road|avenue|boulevard|lane|highway|junction|toll|weigh_station|rest_area/, "road"],
  [/bridge/, "bridge"],
  [/restaurant|food|kebab|bakery|butcher|sweet|juice|dining|fast_food/, "food"],
  [/cafe|tea|coffee|bar|pub/, "cafe"],
  [/hotel|motel|guesthouse|hostel|resort|lodg|accommodation/, "hotel"],
  [/market|shop|store|supermarket|mall|showroom|boutique|retail/, "shop"],
  [/bank|atm|exchange|finance|insurance|credit/, "bank"],
  [/office|company|agency|consult|lawyer|account|business/, "briefcase"],
  [/parliament|ministry|government|directorate|municipality|court|notary|customs|tax_office|civil_registry|public_service/, "government"],
  [/police|security|checkpoint|military|army|peshmerga|guard|rescue/, "shield"],
  [/fire_station|firefighting/, "fire"],
  [/prison|detention|jail/, "prison"],
  [/museum|heritage|archaeological|citadel|castle|monument|memorial|historic|ruins/, "museum"],
  [/cinema|theatre|theater|festival|media|television|radio|broadcast/, "media"],
  [/camera|photography|gallery|studio/, "camera"],
  [/mountain|peak|pass|cliff|canyon|valley|cave/, "mountain"],
  [/river|lake|waterfall|spring|reservoir|water|wetland/, "water"],
  [/forest|tree|woodland|orchard|garden|nursery/, "tree"],
  [/park|picnic|playground|zoo|theme_park/, "park"],
  [/kung_fu|taekwondo|karate|jeet_kune_do|wushu|shaolin|judo|martial_arts/, "martial"],
  [/mma|boxing|kickboxing|muay_thai|wrestling/, "boxing"],
  [/parkour|fitness_trail/, "runner"],
  [/yoga/, "yoga"],
  [/climbing/, "climbing"],
  [/dance|music_school/, "music"],
  [/cycling|bicycle/, "bicycle"],
  [/parcel_locker/, "parcel"],
  [/stadium|arena|sports_center|sports_centre|pitch|field|gym|swimming|sport/, "stadium"],
  [/football|basketball|volleyball|tennis|game|esport/, "ball"],
  [/power|electric|transformer|solar|wind|substation/, "bolt"],
  [/factory|industrial|workshop|quarry|mine|sawmill|warehouse|storage|slaughterhouse/, "factory"],
  [/farm|agricultural|greenhouse|livestock|poultry|beekeeping|irrigation/, "agriculture"],
  [/house|home|apartment|villa|dormitory|residential|building|tower|compound|barracks|cabin/, "home"],
  [/internet|wifi|telecom|technology|software|startup|computer|satellite|call_center|maker_space/, "wifi"],
  [/mobile|phone/, "phone"],
  [/border|crossing|customs_checkpoint/, "border"],
  [/cemetery|grave|burial/, "cemetery"],
  [/dam|hydro/, "dam"],
  [/city|town|village|hamlet|locality|neighbourhood|suburb|district|subdistrict|governorate|region|settlement|quarter|ward/, "settlement"]
];

function hashText(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function glyphFor(entry) {
  const haystack = `${entry.id} ${entry.label.en}`.toLowerCase();
  for (const [pattern, glyph] of rules) if (pattern.test(haystack)) return glyph;
  const groupFallback = {
    settlement_admin: "settlement",
    government_public: "government",
    emergency_security: "shield",
    health: "medical",
    education_research: "school",
    transport_logistics: "car",
    food_hospitality: "food",
    retail_commerce: "shop",
    finance_professional: "briefcase",
    culture_religion_media: "museum",
    tourism_nature_heritage: "mountain",
    sports_leisure: "stadium",
    utilities_infrastructure: "bolt",
    industry_agriculture: "factory",
    residential_buildings: "home",
    communications_technology: "wifi",
    border_route: "border"
  };
  return groupFallback[entry.group] || "generic";
}

function accentDots(id, color) {
  const hash = hashText(id);
  const positions = [[49,13],[52,22],[52,32],[49,43],[42,50],[13,49],[10,37],[11,22]];
  const start = hash % positions.length;
  const count = 1 + ((hash >>> 5) % 3);
  return Array.from({ length: count }, (_, index) => {
    const [x,y] = positions[(start + index * 2) % positions.length];
    const radius = 1.35 + (((hash >>> (index + 8)) & 1) * .45);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="${color}" opacity=".92"/>`;
  }).join("");
}

function svgFor(entry) {
  const palette = palettes[entry.group] || ["#9A7CFF", "#6553D8"];
  const hash = hashText(entry.id);
  const [start, end] = palette;
  const glyph = glyphFor(entry);
  const rotate = ((hash % 5) - 2) * 1.2;
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${entry.label.en.replace(/&/g, "&amp;").replace(/\"/g, "&quot;")}">\n` +
`  <defs><linearGradient id="g" x1="8" y1="7" x2="55" y2="57" gradientUnits="userSpaceOnUse"><stop stop-color="${start}"/><stop offset="1" stop-color="${end}"/></linearGradient><filter id="s" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#060914" flood-opacity=".58"/></filter></defs>\n` +
`  <rect x="5" y="5" width="54" height="54" rx="17" fill="#0B102A" filter="url(#s)"/>\n` +
`  <rect x="6" y="6" width="52" height="52" rx="16" fill="url(#g)" opacity=".28"/>\n` +
`  <rect x="7" y="7" width="50" height="50" rx="15" fill="none" stroke="${start}" stroke-opacity=".72" stroke-width="1.4"/>\n` +
`  <circle cx="32" cy="32" r="17" fill="#111733" fill-opacity=".92" stroke="white" stroke-opacity=".12"/>\n` +
`  <g transform="translate(18.5 18.5) scale(1.125) rotate(${rotate} 12 12)" fill="none" stroke="#F7FAFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${glyphs[glyph] || glyphs.generic}</g>\n` +
`  ${accentDots(entry.id, start)}\n` +
`</svg>\n`;
}

await mkdir(outputDir, { recursive: true });
const manifest = [];
for (const entry of entries) {
  const glyph = glyphFor(entry);
  const palette = palettes[entry.group] || ["#9A7CFF", "#6553D8"];
  const asset = `assets/icons/atlas/${entry.id}.svg`;
  await writeFile(resolve(root, "public", asset), svgFor(entry));
  manifest.push({ id: entry.id, group: entry.group, glyph, color: palette[0], accent: palette[1], asset });
}
await writeFile(resolve(outputDir, "manifest.json"), `${JSON.stringify({ schema: "NAV KURD Atlas Marker Assets v2", count: manifest.length, generatedAt, items: manifest }, null, 2)}\n`);
console.log(`Generated ${manifest.length} dedicated NAV KURD atlas marker SVG assets.`);
