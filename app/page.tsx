"use client";

import { useEffect, useRef, useState } from "react";
import InputPanel from "@/components/InputPanel";
import LoadingState from "@/components/LoadingState";
import FinalLyrics from "@/components/FinalLyrics";
import IterationHistory from "@/components/IterationHistory";
import type {
  LyricRequest,
  LyricResponse,
  ProgressEvent,
  ReviseLineRequest,
  ReviseLineResponse,
} from "@/lib/types";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<LyricResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reqParams, setReqParams] = useState<LyricRequest | null>(null);
  const [llmConfigured, setLlmConfigured] = useState<boolean | null>(null);
  const [dark, setDark] = useState(false);
  // 实时进度
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  // 单句修改状态
  const [revisingLine, setRevisingLine] = useState(false);

  const finalRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 健康检查
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setLlmConfigured(Boolean(d.llm_configured)))
      .catch(() => setLlmConfigured(false));
  }, []);

  // 暗色模式切换
  useEffect(() => {
    if (dark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [dark]);

  // 结果返回后自动滚动到最终歌词
  useEffect(() => {
    if (result && finalRef.current) {
      finalRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [result]);

  const handleGenerate = async (req: LyricRequest) => {
    setLoading(true);
    setError(null);
    setResult(null);
    setReqParams(req);
    setProgress(null);

    // 每个请求独立一个 AbortController，支持"停止生成"
    const controller = new AbortController();
    abortRef.current = controller;
    const onAbort = () => {
      try { controller.abort(); } catch { /* noop */ }
    };

    try {
      // 流式读取 SSE：实时接收每个阶段的进度事件
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: controller.signal,
      });

      if (!res.body) {
        throw new Error("服务端未返回数据流");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResponse: LyricResponse | null = null;
      let errorMessage: string | null = null;

      // 逐块读取并解析 SSE 事件（以 `data: <json>\n\n` 分隔）
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // 按事件边界（空行）切分
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;
          // 跳过 keepalive 注释行（以 : 开头）
          if (trimmed.startsWith(":")) continue;
          // 解析 `data: <json>`
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const event: ProgressEvent = JSON.parse(jsonStr);
            if (event.type === "done" && event.response) {
              finalResponse = event.response;
            } else if (event.type === "error") {
              errorMessage = event.message || "生成失败";
            } else {
              // 更新实时进度
              setProgress(event);
            }
          } catch {
            // 单条事件解析失败不影响整体
          }
        }
      }

      if (errorMessage) {
        setError(errorMessage);
      } else if (finalResponse) {
        if (finalResponse.success) {
          setResult(finalResponse);
        } else {
          setError(finalResponse.error || "生成失败");
        }
      } else {
        setError("未收到完整响应");
      }
    } catch (err) {
      // AbortError（用户点"停止生成"）不显示红色错误
      if (err instanceof Error && err.name === "AbortError") {
        setError("已停止生成");
      } else {
        setError(err instanceof Error ? err.message : "网络错误");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      void onAbort;
      setLoading(false);
      setProgress(null);
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* noop */ }
      abortRef.current = null;
    }
  };

  // 单句修改：调用 /api/revise-line，成功后用新歌词替换 result.final_lyrics
  const handleReviseLine = async (
    line: string,
    instruction: string
  ): Promise<boolean> => {
    if (!result || !reqParams) return false;

    setRevisingLine(true);
    try {
      const payload: ReviseLineRequest = {
        structure: reqParams.structure,
        lyrics: result.final_lyrics,
        line_to_revise: line,
        instruction,
        temperature: reqParams.temperature,
        model: reqParams.model,
        llm: reqParams.llm,
        lyrics_language: reqParams.lyrics_language ?? "zh",
      };
      const res = await fetch("/api/revise-line", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data: ReviseLineResponse = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "单句修改失败");
      }
      setResult((prev) =>
        prev ? { ...prev, final_lyrics: data.revised_lyrics } : prev
      );
      return true;
    } catch (err) {
      throw err instanceof Error ? err : new Error("单句修改失败");
    } finally {
      setRevisingLine(false);
    }
  };

  return (
    <main className="min-h-screen">
      {/* 顶部标题 */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-50">
              小词格
              <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                AI 歌词生成器
              </span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              纯大模型驱动 · 多轮自我迭代 · 对抗评审修改
            </p>
          </div>
          <div className="flex items-center gap-3">
            {llmConfigured === false && (
              <span className="hidden rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700 sm:inline dark:bg-amber-900/40 dark:text-amber-300">
                未配置服务端 Key，可在左侧选免费免注册预设
              </span>
            )}
            <button
              type="button"
              onClick={() => setDark((v) => !v)}
              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {dark ? "浅色" : "深色"}
            </button>
          </div>
        </div>
      </header>

      {/* 主体 */}
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[minmax(320px,420px)_1fr]">
        {/* 左侧输入 */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <InputPanel onGenerate={handleGenerate} loading={loading} />
        </div>

        {/* 右侧结果 */}
        <div className="flex flex-col gap-6">
          {loading && (
            <LoadingState
              progress={progress}
              totalRounds={reqParams?.rounds}
              syllableFixTotalRounds={reqParams?.syllable_fix_rounds}
              onStop={handleStop}
            />
          )}

          {!loading && result?.suggestions && result.suggestions.length > 0 && (
            <div className="animate-fade-in rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
              <div className="mb-2 flex items-center gap-2 font-bold">
                <span>💡</span>
                <span>建议</span>
              </div>
              <ul className="list-disc space-y-1 pl-5">
                {result.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <div className="animate-fade-in rounded-2xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
              <div className="mb-1 font-bold">生成失败</div>
              <div>{error}</div>
            </div>
          )}

          {!loading && !result && !error && (
            <div className="flex h-full min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
              <div className="text-4xl">🎵</div>
              <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                输入提示词与词格，点击「生成歌词」开始
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                系统将自动进行多轮「生成 → 评审 → 修改」迭代
              </p>
            </div>
          )}

          {result && (
            <div ref={finalRef} className="flex flex-col gap-6">
              <FinalLyrics
                lyrics={result.final_lyrics}
                critique={result.final_critique}
                status={result.status === "passed" ? "passed" : "max_rounds_reached"}
                threshold={reqParams?.threshold ?? 80}
                elapsedMs={result.elapsed_ms}
                interpretation={result.interpretation}
                onReviseLine={handleReviseLine}
                revisingLine={revisingLine}
              />
              <IterationHistory history={result.history} />
            </div>
          )}
        </div>
      </div>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400 dark:border-slate-800">
        小词格 · 纯大模型驱动的歌词生成器
      </footer>
    </main>
  );
}
