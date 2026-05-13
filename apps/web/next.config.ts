import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  productionBrowserSourceMaps: false,
  transpilePackages: [
    "@top-performer/domain",
    "@top-performer/firestore",
    "@top-performer/grok-realtime-relay-auth",
    "@top-performer/vendors",
    "@top-performer/scenario-engine",
    "@top-performer/scoring"
  ],
  serverExternalPackages: ["firebase-admin"],
  outputFileTracingIncludes: {
    "/*": [
      "../../packages/scoring/src/prompts/**/*.md",
      "../../config/voice-profiles/**/*.json",
      "../../data/generated/scenarios/**/*.json",
      // PLS lexicon (.pls) — read at runtime by buildLivePronunciationGuide
      // for Grok Voice instructions injection. Without this, the standalone
      // bundle returns ENOENT and the v3 session route 502s.
      "../../data/pronunciation/**/*.pls",
      // Verified Audio Artifact pipeline (PR #92 / PR-93). The manifest
      // JSON + per-intent PCM artifacts are read at server cold start by
      // apps/web/server/registeredSpeech/manifestLoader.ts (sha256 verify
      // + forbidden-suffix scan), and the bytes are then base64-streamed
      // into /api/v3/session as `registeredSpeech.artifacts`. Without this
      // include, the standalone Next.js bundle ships manifestLoader code
      // but NOT the data — bundle assembly throws ENOENT, the session
      // route surfaces no `registeredSpeech` field, and the deterministic-
      // mode client refuses mic with "音声バンドルの整合性が確認できない".
      "../../data/generated/registered-speech/**",
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
              "connect-src 'self' https://api.elevenlabs.io wss://*.elevenlabs.io https://*.elevenlabs.io https://*.livekit.cloud wss://*.livekit.cloud https://api.x.ai wss://api.x.ai https://voice.mendan.biz wss://voice.mendan.biz wss://*.hosted.app ws://localhost:* ws://127.0.0.1:*",
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
