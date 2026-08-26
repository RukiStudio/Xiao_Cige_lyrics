import { NextResponse } from "next/server";
import { validateAndNormalizeRequest } from "@/lib/validation";
import { generateLyrics } from "@/lib/orchestrator";
import { LLMConfigError, LLMCallError } from "@/lib/llm";
import type { LyricResponse, ProgressEvent } from "@/lib/types";

// 使用 Node.js runtime，确保长超时与 OpenAI SDK 兼容
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel 函数最大执行时长（vercel.json 也设了 maxDuration: 120）
export const maxDuration = 120;

// SSE：每隔 12 秒发送一个 keepalive 注释，防止代理/浏览器因无数据而 idle 超时
const KEEPALIVE_INTERVAL_MS = 12000;
// 前端无进度事件的空闲超时兜底（由前端控制，这里仅用于注释说明）

function emptyCritique(): import("@/lib/types").CritiqueReport {
  return {
    total_score: 0,
    passed: false,
    dimensions: {
      structure_adherence: 0,
      theme_relevance: 0,
      rhyme_rhythm: 0,
      fluency: 0,
      literary_quality: 0,
      emotion: 0,
      commercial_appeal: 0,
    },
    summary: "",
    issues: [],
    revision_instructions: "",
  };
}

function buildErrorResponse(message: string): LyricResponse {
  return {
    success: false,
    final_lyrics: "",
    final_critique: emptyCritique(),
    status: "error",
    history: [],
    elapsed_ms: 0,
    error: message,
  };
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(buildErrorResponse("请求体不是合法的 JSON"), {
      status: 400,
    });
  }

  const result = validateAndNormalizeRequest(body);
  if (!result.ok || !result.data) {
    return NextResponse.json(
      buildErrorResponse(result.error || "参数校验失败"),
      { status: 400 }
    );
  }

  const req = result.data;
  const encoder = new TextEncoder();

  // SSE 事件封装：每条事件以 `data: <json>\n\n` 形式发送
  const send = (controller: ReadableStreamDefaultController, event: ProgressEvent) => {
    const line = `data: ${JSON.stringify(event)}\n\n`;
    controller.enqueue(encoder.encode(line));
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

      try {
        // 1. 立即发送第一个进度事件，让前端尽快进入加载态
        send(controller, {
          type: "start",
          total_rounds: req.rounds ?? 3,
          threshold: req.threshold ?? 80,
          stage: "参数已确认，准备调用大模型",
        });

        // 2. 启动 keepalive 定时器：周期性发送 SSE 注释行，保持连接活跃
        keepaliveTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            // controller 可能已关闭，忽略
          }
        }, KEEPALIVE_INTERVAL_MS);

        // 3. 运行编排，通过 onProgress 把每个阶段进度推入流
        const response = await generateLyrics(req, (event) => {
          send(controller, event);
        });

        // 4. 推送最终结果并关闭
        send(controller, { type: "done", response });
      } catch (err) {
        const message = err instanceof Error ? err.message : "未知错误";
        let userMessage = message;

        if (err instanceof LLMConfigError) {
          userMessage = message;
        } else if (err instanceof LLMCallError) {
          userMessage = message;
        } else if (/timeout|aborted/i.test(message)) {
          userMessage = `LLM 调用超时：${message}。建议减少迭代轮数或更换更快的模型。`;
        } else {
          userMessage = `生成失败：${message}`;
        }

        send(controller, { type: "error", message: userMessage });
      } finally {
        if (keepaliveTimer) clearInterval(keepaliveTimer);
        try {
          controller.close();
        } catch {
          // 已关闭则忽略
        }
      }
    },
    cancel() {
      // 客户端断开（如刷新/关闭页面）：调度器自动停止，无需额外处理
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 禁用代理缓冲，确保进度事件实时到达前端
      "X-Accel-Buffering": "no",
    },
  });
}
