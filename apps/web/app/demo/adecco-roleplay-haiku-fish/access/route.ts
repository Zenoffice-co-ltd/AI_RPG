import type { NextRequest } from "next/server";
import { handleDemoAccess } from "@/lib/roleplay/access-route";

export async function POST(request: NextRequest) {
  return handleDemoAccess(request, {
    successPath: "/demo/adecco-roleplay-haiku-fish",
    cookiePaths: {
      ui: "/demo/adecco-roleplay-haiku-fish",
      api: "/api/haiku-fish",
    },
  });
}
