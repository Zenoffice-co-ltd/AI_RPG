import type { NextRequest } from "next/server";
import { handleDemoAccess } from "@/lib/roleplay/access-route";

export function POST(request: NextRequest) {
  return handleDemoAccess(request, {
    successPath: "/demo/adecco-roleplay-v25",
    cookiePaths: { ui: "/demo", api: "/api" },
  });
}
