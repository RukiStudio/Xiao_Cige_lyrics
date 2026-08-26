import { NextResponse } from "next/server";
import { isLLMConfigured, getDefaultModel, getDefaultBaseURL } from "@/lib/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    llm_configured: isLLMConfigured(),
    model: getDefaultModel(),
    base_url_configured: Boolean(getDefaultBaseURL()),
  });
}
