"use client";

import { useEffect, useRef, useState } from "react";
import type { ProgressEvent } from "@/lib/types";

interface LoadingStateProps {
  progress: ProgressEvent | null;
  totalRounds?: number;
  syllableFixTotalRounds?: number;
  onStop?: () => void;
}

// 单条进度日志（用于时间线展示）
interface LogEntry {
  id: number;
  text: string;
  tone: "info" | "score" | "pass" | "fail";
}

// 当前阶段的可读化
function stageLabel(p: ProgressEvent | null): string {
  if (!p) return "正在连接服务端...";
  return p.stage || "处理中...";
}

// 顶部大标题随阶段切换
function mainTitle(p: ProgressEvent | null): string {
  if (!p) return "正在连接服务端";
  switch (p.type) {
    case "start":
      return "准备就绪";
    case "generating":
      return "Generator 创作中";
    case "round_start":
      return `第 ${p.round} 轮迭代`;
    case "critiquing":
      return p.syllable_fix_round
        ? `字数修复第 ${p.syllable_fix_round} 轮评审`
        : `第 ${p.round ?? "?"} 轮评审`;
    case "critique_done":
      return p.passed ? `第 ${p.round} 轮达标` : `${p.syllable_fix_round ? `字数修复第 ${p.syllable_fix_round} 轮` : `第 ${p.round} 轮`}评审完成`;
    case "revising":
      return p.syllable_fix_round
        ? `字数修复第 ${p.syllable_fix_round} 轮修改`
        : `第 ${p.round ?? "?"} 轮修改`;
    case "final_critique":
      return "最终评审";
    case "interpreting":
      return "词解生成中";
    case "done":
      return "完成";
    default:
      return "处理中";
  }
}

export default function LoadingState({
  progress,
  totalRounds,
  syllableFixTotalRounds,
  onStop,
}: LoadingStateProps) {
  // 累积日志：每次 progress 变化时追加一条
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const lastKeyRef = useRef<string>("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!progress) return;
    // 同一类型同一轮次 + 字数修复轮次 只记一次
    const key = `${progress.type}-${progress.round ?? 0}-${progress.syllable_fix_round ?? 0}`;
    if (lastKeyRef.current === key) return;
    lastKeyRef.current = key;

    let tone: LogEntry["tone"] = "info";
    let text = progress.stage || progress.type;
    if (progress.type === "critique_done") {
      tone = progress.passed ? "pass" : "fail";
      text = `${progress.stage}（${progress.score} 分${progress.passed ? " · 达标" : ""}）`;
    }

    logIdRef.current += 1;
    setLogs((prev) => [...prev, { id: logIdRef.current, text, tone }]);
  }, [progress]);

  // 自动滚动到最新日志
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const round = progress?.round;
  const total = progress?.total_rounds ?? totalRounds ?? 3;
  const syllableRound = progress?.syllable_fix_round;
  const syllableTotal = progress?.syllable_fix_total_rounds ?? syllableFixTotalRounds ?? 5;

  // 进度百分比（粗略）：按阶段推进
  const progressPct = (() => {
    if (!progress) return 5;
    if (progress.type === "done") return 100;
    if (progress.type === "generating") return 10;
    if (progress.type === "start") return 5;
    if (progress.round) {
      const perRound = 75 / total;
      let within = 0;
      if (progress.type === "round_start") within = 0;
      else if (progress.type === "critiquing") within = perRound * 0.35;
      else if (progress.type === "critique_done") within = perRound * 0.5;
      else if (progress.type === "revising") within = perRound * 0.9;
      else if (progress.type === "final_critique") return 88;
      else if (progress.type === "interpreting") return 96;
      return Math.min(96, 10 + (progress.round - 1) * perRound + within);
    }
    return 50;
  })();

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {/* 顶部：标题 + 停止按钮 */}
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 shrink-0 animate-spin rounded-full border-[3px] border-indigo-200 border-t-indigo-600" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {mainTitle(progress)}
            </span>
            <div className="ml-2 flex shrink-0 items-center gap-2">
              {progress?.type === "critique_done" && typeof progress.score === "number" && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    progress.passed
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                  }`}
                >
                  {progress.score} 分
                </span>
              )}
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 active:scale-[0.98] dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-900/50"
                  title="停止当前生成流程"
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
                  停止生成
                </button>
              )}
            </div>
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {stageLabel(progress)}
          </p>
        </div>
      </div>

      {/* 进度条 */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      {(round || syllableRound) && (
        <div className="-mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-slate-400">
          <span>
            {round ? `内容迭代 ${round}/${total}` : `内容迭代 0/${total}`}
          </span>
          {syllableRound ? (
            <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300">
              字数修复 {syllableRound}/{syllableTotal}（不计入主轮次）
            </span>
          ) : null}
          <span>{progressPct}%</span>
        </div>
      )}

      {/* 实时日志时间线 */}
      {logs.length > 0 && (
        <div
          ref={scrollRef}
          className="lyric-scroll max-h-44 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-700 dark:bg-slate-800/60"
        >
          <div className="flex flex-col gap-1.5">
            {logs.map((log) => (
              <div
                key={log.id}
                className={`flex items-start gap-2 text-xs ${
                  log.tone === "pass"
                    ? "text-emerald-700 dark:text-emerald-300"
                    : log.tone === "fail"
                      ? "text-amber-700 dark:text-amber-300"
                      : log.tone === "score"
                        ? "text-indigo-700 dark:text-indigo-300"
                        : "text-slate-600 dark:text-slate-300"
                }`}
              >
                <span className="mt-0.5 select-none">
                  {log.tone === "pass" ? "✓" : log.tone === "fail" ? "•" : "›"}
                </span>
                <span className="leading-relaxed">{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        多智能体迭代：生成 → 评审 → 修改；字数修复单独计数，不计入 3 轮内容迭代上限。
      </p>
    </div>
  );
}
