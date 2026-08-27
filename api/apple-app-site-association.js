const TEAM_ID_PATTERN = /^[A-Z0-9]{10}$/;
const BUNDLE_ID_PATTERN = /^[A-Za-z0-9.-]+$/;

export default function handler(_request, response) {
  const teamId = String(process.env.APPLE_TEAM_ID || "").trim().toUpperCase();
  const bundleId = String(process.env.NAV_KURD_IOS_BUNDLE_ID || "com.navkurd.app").trim();

  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  response.setHeader("X-Content-Type-Options", "nosniff");

  if (!TEAM_ID_PATTERN.test(teamId) || !BUNDLE_ID_PATTERN.test(bundleId)) {
    response.status(503).json({
      error: "APPLE_TEAM_ID must be configured as the 10-character Apple Developer Team ID."
    });
    return;
  }

  response.status(200).json({
    applinks: {
      apps: [],
      details: [
        {
          appID: `${teamId}.${bundleId}`,
          paths: ["*"]
        }
      ]
    },
    webcredentials: {
      apps: [`${teamId}.${bundleId}`]
    }
  });
}
