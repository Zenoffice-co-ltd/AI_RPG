import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  productionBrowserSourceMaps: false,
  transpilePackages: [
    "@top-performer/domain",
    "@top-performer/firestore",
    "@top-performer/vendors",
    "@top-performer/scenario-engine",
    "@top-performer/scoring"
  ],
  serverExternalPackages: ["firebase-admin"],
  outputFileTracingIncludes: {
    "/*": [
      "../../packages/scoring/src/prompts/**/*.md",
      "../../config/voice-profiles/**/*.json",
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob:",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "media-src 'self' blob:",
              "connect-src 'self' https://api.elevenlabs.io wss://*.elevenlabs.io https://*.elevenlabs.io https://*.livekit.cloud wss://*.livekit.cloud",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
