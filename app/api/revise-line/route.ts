import { NextResponse } from "next/server";
import { reviseLine } from "@/lib/orchestrator";
import { LLMConfigError, LLMCallError } from "@/lib/llm";
import type { ReviseLineRequest, ReviseLineResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LIMITS = {
  MAX_STRUCTURE_LENGTH: 2000,
  MAX_LYRICS_LENGTH: 8000,
  MAX_LINE_LENGTH: 200,
  MAX_INSTRUCTION_LENGTH: 500,
  MAX_API_KEY_LENGTH: 500,
  MAX_BASE_URL_LENGTH: 300,
  MAX_MODEL_LENGTH: 100,
  MIN_TEMPERATURE: 0,
  MAX_TEMPERATURE: 1.5,
} as const;

function buildErrorResponse(message: string, status = 400): NextResponse {
  const body: ReviseLineResponse = {
    success: false,
    revised_lyrics: "",
    revised_line: "",
    error: message,
  };
  return NextResponse.json(body, { status });
}

interface ParsedBody {
  ok: boolean;
  data?: {
    structure: string;
    lyrics: string;
    lineToRevise: string;
    instruction: string;
    temperature?: number;
    model?: string;
    llm?: ReviseLineRequest["llm"];
    lyrics_language?: "zh" | "en";
  };
  error?: string;
}

function parseBody(input: unknown): ParsedBody {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "请求体必须是一个 JSON 对象" };
  }
  const body = input as Partial<ReviseLineRequest>;

  const structure = typeof body.structure === "string" ? body.structure.trim() : "";
  const lyrics = typeof body.lyrics === "string" ? body.lyrics.trim() : "";
  const lineToRevise =
    typeof body.line_to_revise === "string" ? body.line_to_revise.trim() : "";
  const instruction =
    typeof body.instruction === "string" ? body.instruction.trim() : "";

  if (!structure) return { ok: false, error: "词格（structure）不能为空" };
  if (!lyrics) return { ok: false, error: "当前歌词（lyrics）不能为空" };
  if (!lineToRevise) return { ok: false, error: "待修改单句（line_to_revise）不能为空" };
  if (!instruction) return { ok: false, error: "修改要求（instruction）不能为空" };

  if (structure.length > LIMITS.MAX_STRUCTURE_LENGTH) {
    return { ok: false, error: `词格长度不能超过 ${LIMITS.MAX_STRUCTURE_LENGTH} 字` };
  }
  if (lyrics.length > LIMITS.MAX_LYRICS_LENGTH) {
    return { ok: false, error: `歌词长度不能超过 ${LIMITS.MAX_LYRICS_LENGTH} 字` };
  }
  if (lineToRevise.length > LIMITS.MAX_LINE_LENGTH) {
    return { ok: false, error: `单句长度不能超过 ${LIMITS.MAX_LINE_LENGTH} 字` };
  }
  if (instruction.length > LIMITS.MAX_INSTRUCTION_LENGTH) {
    return { ok: false, error: `修改要求长度不能超过 ${LIMITS.MAX_INSTRUCTION_LENGTH} 字` };
  }

  // 校验待修改单句确实存在于歌词中
  const lyricsLines = lyrics.split(/\r?\n/).map((l) => l.trim());
  if (!lyricsLines.includes(lineToRevise)) {
    return { ok: false, error: "待修改单句必须是当前歌词中真实存在的某一行" };
  }

  // 温度
  let temperature: number | undefined;
  if (body.temperature !== undefined && body.temperature !== null) {
    const t = Number(body.temperature);
    if (!Number.isFinite(t)) {
      return { ok: false, error: "温度必须是数字" };
    }
    temperature = Math.min(
      Math.max(t, LIMITS.MIN_TEMPERATURE),
      LIMITS.MAX_TEMPERATURE
    );
  }

  // 模型
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : undefined;

  // LLM 配置
  let llm: ReviseLineRequest["llm"] | undefined;
  if (body.llm && typeof body.llm === "object") {
    const raw = body.llm as Record<string, unknown>;
    const api_key =
      typeof raw.api_key === "string" ? raw.api_key.trim() : undefined;
    const base_url =
      typeof raw.base_url === "string" ? raw.base_url.trim() : undefined;
    const llm_model =
      typeof raw.model === "string" ? raw.model.trim() : undefined;

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

  // 歌词输出语言（可选）
  let lyrics_language: "zh" | "en" | undefined;
  if (body.lyrics_language !== undefined && body.lyrics_language !== null) {
    const raw = String(body.lyrics_language).toLowerCase();
    if (raw !== "zh" && raw !== "en") {
      return { ok: false, error: "歌词输出语言必须是 zh 或 en" };
    }
    lyrics_language = raw as "zh" | "en";
  }

  return {
    ok: true,
    data: { structure, lyrics, lineToRevise, instruction, temperature, model, llm, lyrics_language },
  };
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
    const result = await reviseLine({
      structure: parsed.data.structure,
      lyrics: parsed.data.lyrics,
      lineToRevise: parsed.data.lineToRevise,
      instruction: parsed.data.instruction,
      temperature: parsed.data.temperature,
      model: parsed.data.model,
      llm: parsed.data.llm,
      lyrics_language: parsed.data.lyrics_language,
    });

    const resp: ReviseLineResponse = {
      success: true,
      revised_lyrics: result.revisedLyrics,
      revised_line: result.revisedLine,
    };
    return NextResponse.json(resp);
  } catch (err) {
    let message = err instanceof Error ? err.message : "未知错误";
    if (err instanceof LLMConfigError) {
      // 配置错误
    } else if (err instanceof LLMCallError) {
      // 调用错误
    } else if (/timeout|aborted/i.test(message)) {
      message = `LLM 调用超时：${message}。建议简化修改要求或更换更快的模型。`;
    } else {
      message = `修改失败：${message}`;
    }
    return buildErrorResponse(message, 500);
  }
}
