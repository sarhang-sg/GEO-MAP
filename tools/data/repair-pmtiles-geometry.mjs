#!/usr/bin/env node
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { bytesToHeader, tileIdToZxy } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import { fromVectorTileJs } from "@maplibre/vt-pbf";
import Point from "@mapbox/point-geometry";

const HEADER_SIZE = 127;
const SAFE_BUFFER = 256; // 16px at extent 4096: enough for joins, never oversized.

function readVarint(state) {
  let value = 0;
  let shift = 0;
  while (true) {
    const byte = state.buf[state.pos++];
    value += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return value;
    shift += 7;
    if (shift > 49) throw new Error("PMTiles varint exceeds safe JavaScript range");
  }
}

function writeVarint(value, out) {
  let remaining = value;
  while (remaining >= 0x80) {
    out.push((remaining % 128) + 128);
    remaining = Math.floor(remaining / 128);
  }
  out.push(remaining);
}

function deserializeDirectory(buffer) {
  const state = { buf: new Uint8Array(buffer), pos: 0 };
  const count = readVarint(state);
  const entries = [];
  let tileId = 0;
  for (let i = 0; i < count; i += 1) {
    tileId += readVarint(state);
    entries.push({ tileId, runLength: 1, length: 0, offset: 0 });
  }
  for (const entry of entries) entry.runLength = readVarint(state);
  for (const entry of entries) entry.length = readVarint(state);
  for (let i = 0; i < entries.length; i += 1) {
    const encoded = readVarint(state);
    entries[i].offset = encoded === 0 && i > 0
      ? entries[i - 1].offset + entries[i - 1].length
      : encoded - 1;
  }
  return entries;
}

function serializeDirectory(entries) {
  const out = [];
  writeVarint(entries.length, out);
  let previousId = 0;
  for (const entry of entries) {
    writeVarint(entry.tileId - previousId, out);
    previousId = entry.tileId;
  }
  for (const entry of entries) writeVarint(entry.runLength, out);
  for (const entry of entries) writeVarint(entry.length, out);
  for (let i = 0; i < entries.length; i += 1) {
    const contiguous = i > 0 && entries[i].offset === entries[i - 1].offset + entries[i - 1].length;
    writeVarint(contiguous ? 0 : entries[i].offset + 1, out);
  }
  return Uint8Array.from(out);
}

function decompress(buffer, compression) {
  if (compression === 0 || compression === 1) return Buffer.from(buffer);
  if (compression === 2) return zlib.gunzipSync(buffer);
  if (compression === 3) return zlib.brotliDecompressSync(buffer);
  throw new Error(`Unsupported PMTiles compression ${compression}`);
}

function compress(buffer, compression) {
  if (compression === 0 || compression === 1) return Buffer.from(buffer);
  if (compression === 2) return zlib.gzipSync(buffer, { level: 9, mtime: 0 });
  if (compression === 3) return zlib.brotliCompressSync(buffer, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 }
  });
  throw new Error(`Unsupported PMTiles compression ${compression}`);
}

async function readAt(handle, offset, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, offset);
  if (bytesRead !== length) throw new Error(`Short PMTiles read at ${offset}: ${bytesRead}/${length}`);
  return buffer;
}

function samePoint(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

function roundedPoint(x, y) {
  return new Point(Math.round(x), Math.round(y));
}

function clipSegment(a, b, min, max) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks = [
    [-dx, a.x - min],
    [dx, max - a.x],
    [-dy, a.y - min],
    [dy, max - a.y]
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    roundedPoint(a.x + t0 * dx, a.y + t0 * dy),
    roundedPoint(a.x + t1 * dx, a.y + t1 * dy)
  ];
}

function clipLine(line, min, max) {
  const parts = [];
  let current = [];
  for (let i = 1; i < line.length; i += 1) {
    const clipped = clipSegment(line[i - 1], line[i], min, max);
    if (!clipped) {
      if (current.length >= 2) parts.push(current);
      current = [];
      continue;
    }
    const [start, end] = clipped;
    if (!current.length) current.push(start, end);
    else if (samePoint(current[current.length - 1], start)) {
      if (!samePoint(current[current.length - 1], end)) current.push(end);
    } else {
      if (current.length >= 2) parts.push(current);
      current = [start, end];
    }
  }
  if (current.length >= 2) parts.push(current);
  return parts;
}

function clipPolygonAgainst(points, inside, intersect) {
  if (!points.length) return [];
  const output = [];
  let previous = points[points.length - 1];
  let previousInside = inside(previous);
  for (const current of points) {
    const currentInside = inside(current);
    if (currentInside) {
      if (!previousInside) output.push(intersect(previous, current));
      output.push(current);
    } else if (previousInside) output.push(intersect(previous, current));
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

function clipPolygonRing(ring, min, max) {
  let points = ring.map((point) => roundedPoint(point.x, point.y));
  if (points.length > 1 && samePoint(points[0], points[points.length - 1])) points = points.slice(0, -1);
  const verticalIntersection = (x) => (a, b) => {
    const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
    return roundedPoint(x, a.y + t * (b.y - a.y));
  };
  const horizontalIntersection = (y) => (a, b) => {
    const t = b.y === a.y ? 0 : (y - a.y) / (b.y - a.y);
    return roundedPoint(a.x + t * (b.x - a.x), y);
  };
  points = clipPolygonAgainst(points, (p) => p.x >= min, verticalIntersection(min));
  points = clipPolygonAgainst(points, (p) => p.x <= max, verticalIntersection(max));
  points = clipPolygonAgainst(points, (p) => p.y >= min, horizontalIntersection(min));
  points = clipPolygonAgainst(points, (p) => p.y <= max, horizontalIntersection(max));
  const deduped = [];
  for (const point of points) if (!samePoint(deduped[deduped.length - 1], point)) deduped.push(point);
  if (deduped.length < 3) return null;
  if (!samePoint(deduped[0], deduped[deduped.length - 1])) deduped.push(deduped[0].clone());
  return deduped.length >= 4 ? deduped : null;
}

function clippedGeometry(feature) {
  const extent = feature.extent || 4096;
  const min = -SAFE_BUFFER;
  const max = extent + SAFE_BUFFER;
  const geometry = feature.loadGeometry();
  if (feature.type === 1) {
    return geometry
      .map((ring) => ring.filter((point) => point.x >= min && point.x <= max && point.y >= min && point.y <= max))
      .filter((ring) => ring.length > 0);
  }
  if (feature.type === 2) return geometry.flatMap((line) => clipLine(line, min, max));
  if (feature.type === 3) return geometry.map((ring) => clipPolygonRing(ring, min, max)).filter(Boolean);
  return [];
}

function sanitizeVectorTile(tile) {
  const layers = {};
  for (const [name, layer] of Object.entries(tile.layers)) {
    const features = [];
    for (let i = 0; i < layer.length; i += 1) {
      const source = layer.feature(i);
      const geometry = clippedGeometry(source);
      if (!geometry.length) continue;
      features.push({
        id: source.id,
        type: source.type,
        properties: source.properties,
        extent: source.extent,
        loadGeometry: () => geometry
      });
    }
    layers[name] = {
      name,
      version: layer.version || 2,
      extent: layer.extent || 4096,
      length: features.length,
      feature: (index) => features[index]
    };
  }
  return { layers };
}

function writeUint64(view, offset, value) {
  const low = value >>> 0;
  const high = Math.floor(value / 2 ** 32) >>> 0;
  view.setUint32(offset, low, true);
  view.setUint32(offset + 4, high, true);
}

function writeHeader(header, layout) {
  const buffer = Buffer.alloc(HEADER_SIZE);
  buffer.write("PMTiles", 0, "ascii");
  buffer[7] = 3;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  writeUint64(view, 8, layout.rootOffset);
  writeUint64(view, 16, layout.rootLength);
  writeUint64(view, 24, layout.metadataOffset);
  writeUint64(view, 32, layout.metadataLength);
  writeUint64(view, 40, layout.leafOffset);
  writeUint64(view, 48, 0);
  writeUint64(view, 56, layout.tileDataOffset);
  writeUint64(view, 64, layout.tileDataLength);
  writeUint64(view, 72, layout.numAddressedTiles);
  writeUint64(view, 80, layout.numTileEntries);
  writeUint64(view, 88, layout.numTileContents);
  view.setUint8(96, 1);
  view.setUint8(97, header.internalCompression);
  view.setUint8(98, header.tileCompression);
  view.setUint8(99, header.tileType);
  view.setUint8(100, header.minZoom);
  view.setUint8(101, header.maxZoom);
  view.setInt32(102, Math.round(header.minLon * 1e7), true);
  view.setInt32(106, Math.round(header.minLat * 1e7), true);
  view.setInt32(110, Math.round(header.maxLon * 1e7), true);
  view.setInt32(114, Math.round(header.maxLat * 1e7), true);
  view.setUint8(118, header.centerZoom);
  view.setInt32(119, Math.round(header.centerLon * 1e7), true);
  view.setInt32(123, Math.round(header.centerLat * 1e7), true);
  return buffer;
}

async function readArchive(file) {
  const handle = await fsp.open(file, "r");
  const headerBytes = await readAt(handle, 0, HEADER_SIZE);
  const header = bytesToHeader(headerBytes.buffer.slice(headerBytes.byteOffset, headerBytes.byteOffset + headerBytes.byteLength));
  const rootRaw = await readAt(handle, header.rootDirectoryOffset, header.rootDirectoryLength);
  const root = deserializeDirectory(decompress(rootRaw, header.internalCompression));
  const entries = [];
  for (const entry of root) {
    if (entry.runLength !== 0) entries.push(entry);
    else {
      const leafRaw = await readAt(handle, header.leafDirectoryOffset + entry.offset, entry.length);
      entries.push(...deserializeDirectory(decompress(leafRaw, header.internalCompression)));
    }
  }
  const metadataRaw = await readAt(handle, header.jsonMetadataOffset, header.jsonMetadataLength);
  const metadata = JSON.parse(decompress(metadataRaw, header.internalCompression).toString("utf8"));
  return { handle, header, entries, metadata };
}

async function repair(input, output) {
  const archive = await readArchive(input);
  const tileChunks = [];
  const outputEntries = [];
  let tileOffset = 0;
  let processed = 0;
  for (const entry of archive.entries) {
    const raw = await readAt(archive.handle, archive.header.tileDataOffset + entry.offset, entry.length);
    const decoded = decompress(raw, archive.header.tileCompression);
    const vectorTile = new VectorTile(new PbfReader(decoded));
    const sanitized = sanitizeVectorTile(vectorTile);
    const encoded = fromVectorTileJs(sanitized);
    const compressed = compress(encoded, archive.header.tileCompression);
    tileChunks.push(compressed);
    outputEntries.push({
      tileId: entry.tileId,
      runLength: entry.runLength,
      offset: tileOffset,
      length: compressed.length
    });
    tileOffset += compressed.length;
    processed += 1;
    if (processed % 250 === 0) process.stdout.write(`\r${path.basename(input)}: ${processed}/${archive.entries.length}`);
  }
  process.stdout.write(`\r${path.basename(input)}: ${processed}/${archive.entries.length}\n`);
  await archive.handle.close();

  const directory = compress(serializeDirectory(outputEntries), archive.header.internalCompression);
  const metadata = compress(Buffer.from(JSON.stringify(archive.metadata), "utf8"), archive.header.internalCompression);
  const rootOffset = HEADER_SIZE;
  const metadataOffset = rootOffset + directory.length;
  const leafOffset = metadataOffset + metadata.length;
  const tileDataOffset = leafOffset;
  const tileData = Buffer.concat(tileChunks);
  const header = writeHeader(archive.header, {
    rootOffset,
    rootLength: directory.length,
    metadataOffset,
    metadataLength: metadata.length,
    leafOffset,
    tileDataOffset,
    tileDataLength: tileData.length,
    numAddressedTiles: outputEntries.reduce((sum, entry) => sum + entry.runLength, 0),
    numTileEntries: outputEntries.length,
    numTileContents: outputEntries.length
  });
  const temporary = `${output}.tmp`;
  await fsp.writeFile(temporary, Buffer.concat([header, directory, metadata, tileData]));
  await fsp.rename(temporary, output);
  console.log(`${path.basename(output)} repaired: ${(tileData.length / 1024 / 1024).toFixed(2)} MiB tile data`);
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("Usage: node tools/data/repair-pmtiles-geometry.mjs file.pmtiles [...]");
  process.exit(2);
}
for (const file of files) {
  const resolved = path.resolve(file);
  await repair(resolved, resolved);
}
