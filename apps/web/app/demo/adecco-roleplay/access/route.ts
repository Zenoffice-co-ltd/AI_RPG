import type { NextRequest } from "next/server";
import { handleDemoAccess } from "@/lib/roleplay/access-route";

export async function POST(request: NextRequest) {
  return handleDemoAccess(request, "/demo/adecco-roleplay");
}
