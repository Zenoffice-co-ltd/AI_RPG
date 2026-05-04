import type { NextRequest } from "next/server";
import { handleDemoAccess } from "@/lib/roleplay/access-route";

export async function POST(request: NextRequest) {
  // Use broad cookie paths (/demo and /api) so a single AccessGate login
  // grants access to all three A/B routes (ElevenLabs, Haiku Fish, Grok Voice)
  // without making the user re-enter the password per backend.
  return handleDemoAccess(request, {
    successPath: "/demo/adecco-roleplay",
    cookiePaths: { ui: "/demo", api: "/api" },
  });
}
