
const APPLICATION_ID = process.env.NAV_KURD_ANDROID_APPLICATION_ID?.trim() || "com.navkurd.app";
// Public certificate metadata only. Keeping the release fingerprint as a
// fallback makes verified App Links deterministic when the optional Vercel
// environment variable has not been configured yet.
const RELEASE_FINGERPRINT = "A2:45:75:43:8C:D4:E1:AF:D6:11:FE:2E:C8:F7:2E:EF:70:D5:C1:1F:3F:E9:BA:EF:0E:75:D5:76:EC:CE:12:46";
function fingerprints() {
  const configured = (process.env.ANDROID_APP_LINK_SHA256 || "").split(",").map((value) => value.trim().toUpperCase()).filter((value) => /^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/.test(value));
  return [...new Set(configured.length ? configured : [RELEASE_FINGERPRINT])];
}
export default function handler(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") return response.status(405).setHeader("Allow", "GET, HEAD").end();
  const values = fingerprints();
  const body = values.length ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: APPLICATION_ID, sha256_cert_fingerprints: values } }] : [];
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
  response.status(200).send(request.method === "HEAD" ? undefined : JSON.stringify(body));
}
