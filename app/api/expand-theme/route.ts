import { NextResponse } from "next/server";
import { expandTheme } from "@/lib/orchestrator";
import { LLMConfigError, LLMCallError } from "@/lib/llm";
import { LIMITS } from "@/lib/validation";
import type { ThemeExpandRequest, ThemeExpandResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function buildErrorResponse(message: string, status = 400): NextResponse {
  const body: ThemeExpandResponse = {
    success: false,
    expanded_prompt: "",
    error: message,
  };
  return NextResponse.json(body, { status });
}

interface ParsedBody {
  ok: boolean;
  data?: {
    theme: string;
    temperature?: number;
    model?: string;
    llm?: ThemeExpandRequest["llm"];
  };
  error?: string;
}

function parseBody(input: unknown): ParsedBody {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "请求体必须是一个 JSON 对象" };
  }
  const body = input as Partial<ThemeExpandRequest>;

  const theme = typeof body.theme === "string" ? body.theme.trim() : "";
  if (!theme) return { ok: false, error: "主题关键词（theme）不能为空" };
  if (theme.length > LIMITS.MAX_THEME_LENGTH) {
    return { ok: false, error: `主题长度不能超过 ${LIMITS.MAX_THEME_LENGTH} 字` };
  }

  // 温度
  let temperature: number | undefined;
  if (body.temperature !== undefined && body.temperature !== null) {
    const t = Number(body.temperature);
    if (!Number.isFinite(t)) {
      return { ok: false, error: "温度必须是数字" };
    }
    temperature = Math.min(Math.max(t, LIMITS.MIN_TEMPERATURE), LIMITS.MAX_TEMPERATURE);
  }

  // 模型
  const model =
    typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  // LLM 配置
  let llm: ThemeExpandRequest["llm"] | undefined;
  if (body.llm && typeof body.llm === "object") {
    const raw = body.llm as Record<string, unknown>;
    const api_key = typeof raw.api_key === "string" ? raw.api_key.trim() : undefined;
    const base_url = typeof raw.base_url === "string" ? raw.base_url.trim() : undefined;
    const llm_model = typeof raw.model === "string" ? raw.model.trim() : undefined;

    if (api_key && api_key.length > LIMITS.MAX_API_KEY_LENGTH) {
      return { ok: false, error: `API Key 长度不能超过 ${LIMITS.MAX_API_KEY_LENGTH}` };
    }
    if (base_url && base_url.length > LIMITS.MAX_BASE_URL_LENGTH) {
      return { ok: false, error: `Base URL 长度不能超过 ${LIMITS.MAX_BASE_URL_LENGTH}` };
    }
    if (llm_model && llm_model.length > LIMITS.MAX_MODEL_LENGTH) {
      return { ok: false, error: `模型名长度不能超过 ${LIMITS.MAX_MODEL_LENGTH}` };
    }
    if (api_key || base_url || llm_model) {
      llm = {
        ...(api_key ? { api_key } : {}),
        ...(base_url ? { base_url } : {}),
        ...(llm_model ? { model: llm_model } : {}),
      };
    }
  }

  return { ok: true, data: { theme, temperature, model, llm } };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return buildErrorResponse("请求体不是合法的 JSON");
  }

  const parsed = parseBody(body);
  if (!parsed.ok || !parsed.data) {
    return buildErrorResponse(parsed.error || "参数校验失败");
  }

  try {
    const expanded = await expandTheme({
      theme: parsed.data.theme,
      temperature: parsed.data.temperature,
      model: parsed.data.model,
      llm: parsed.data.llm,
    });

    const resp: ThemeExpandResponse = {
      success: true,
      expanded_prompt: expanded,
    };
    return NextResponse.json(resp);
  } catch (err) {
    let message = err instanceof Error ? err.message : "未知错误";
    if (err instanceof LLMConfigError) {
      // 配置错误
    } else if (err instanceof LLMCallError) {
      // 调用错误
    } else if (/timeout|aborted/i.test(message)) {
      message = `LLM 调用超时：${message}。请稍后重试。`;
    } else {
      message = `主题扩写失败：${message}`;
    }
    return buildErrorResponse(message, 500);
  }
}
