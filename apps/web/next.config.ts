import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  allowedDevOrigins: ["127.0.0.1"],
  transpilePackages: [
    "@top-performer/domain",
    "@top-performer/firestore",
    "@top-performer/vendors",
    "@top-performer/scenario-engine",
    "@top-performer/scoring"
  ],
  serverExternalPackages: [
    "@google-cloud/tasks",
    "firebase-admin",
    "google-gax",
    "protobufjs"
  ]
};

export default nextConfig;
