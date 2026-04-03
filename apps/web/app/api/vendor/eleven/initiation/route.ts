import { NextResponse } from "next/server";
import { getAppContext } from "@/server/appContext";

export const runtime = "nodejs";

export function POST() {
  const ctx = getAppContext();
  if (!ctx.env.ENABLE_ELEVEN_WEBHOOKS) {
    return NextResponse.json({ status: "disabled" }, { status: 202 });
  }

  return NextResponse.json({ status: "accepted" });
}
