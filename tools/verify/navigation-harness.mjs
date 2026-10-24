import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from "./typescript-transform.mjs";
const root = new URL('../../', import.meta.url);
export function loadNavigationModule(path, globals, names) {
  const source = fs.readFileSync(new URL(path, root), 'utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, '');
  const context = vm.createContext(globals);
  vm.runInContext(stripTypeScriptTypes(source, {mode:'transform'}).replace(/\bexport /g, '') + `\nglobalThis.api={${names}}`, context);
  return context.api;
}
export const navigationGeo = loadNavigationModule('src/lib/location.ts', {}, 'distanceMeters,bearingBetween,normalizeHeading,shortestHeadingDelta');
export const navigationTracking = loadNavigationModule('src/lib/navigation-tracking.ts', navigationGeo, 'MovementCourseTracker,navigationProfile,trustedTravelCourse,followCameraBearing');
