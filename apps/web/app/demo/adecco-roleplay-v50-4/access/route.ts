import type { NextRequest } from "next/server";
import { handleDemoAccess } from "@/lib/roleplay/access-route";

export async function POST(request: NextRequest) {
  return handleDemoAccess(request, {
    successPath: "/demo/adecco-roleplay-v50-4",
    cookiePaths: { ui: "/demo", api: "/api" },
  });
}
