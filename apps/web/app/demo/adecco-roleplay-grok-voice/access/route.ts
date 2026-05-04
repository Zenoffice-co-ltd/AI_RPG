import type { NextRequest } from "next/server";
import { handleDemoAccess } from "@/lib/roleplay/access-route";

export async function POST(request: NextRequest) {
  // Broad cookie paths (/demo + /api) so a single login covers all three
  // A/B routes — see /demo/adecco-roleplay/access for context.
  return handleDemoAccess(request, {
    successPath: "/demo/adecco-roleplay-grok-voice",
    cookiePaths: { ui: "/demo", api: "/api" },
  });
}
