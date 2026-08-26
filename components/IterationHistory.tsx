"use client";

import type { IterationRecord } from "@/lib/types";
import ScoreDisplay from "./ScoreDisplay";

interface IterationHistoryProps {
  history: IterationRecord[];
}

const SEVERITY_STYLE: Record<string, string> = {
  low: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
  medium:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
};

export default function IterationHistory({ history }: IterationHistoryProps) {
  if (!history.length) return null;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-base font-bold text-slate-700 dark:text-slate-200">
        迭代历史（共 {history.length} 轮）
      </h3>

      <div className="relative border-l-2 border-slate-200 pl-6 dark:border-slate-700">
        {history.map((record, idx) => {
          const isLast = idx === history.length - 1;
          const isFinal =
            isLast && !record.revised_lyrics;
          return (
            <div
              key={record.round}
              className="mb-6 last:mb-0 animate-fade-in"
            >
              {/* 时间线节点 */}
              <span
                className={`absolute -left-[7px] mt-1 h-3 w-3 rounded-full border-2 border-white dark:border-slate-950 ${
                  record.critique.passed
                    ? "bg-emerald-500"
                    : "bg-amber-500"
                }`}
              />

              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-bold text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      第 {record.round} 轮
                    </span>
                    {isFinal && (
                      <span className="rounded-md bg-purple-100 px-2 py-0.5 text-xs font-bold text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">
                        最终评审
                      </span>
                    )}
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                        record.critique.passed
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                          : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                      }`}
                    >
                      {record.critique.passed ? "通过" : "未通过"} ·{" "}
                      {record.critique.total_score} 分
                    </span>
                  </div>
                </div>

                {/* 本轮歌词（评审前） */}
                <details className="mb-3 group">
                  <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-indigo-600 dark:text-slate-400">
                    查看{isFinal ? "" : "本轮"}歌词
                  </summary>
                  <pre className="lyric-scroll mt-2 max-h-60 overflow-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                    {record.lyrics}
                  </pre>
                </details>

                {/* 评分 */}
                <ScoreDisplay
                  dimensions={record.critique.dimensions}
                  totalScore={record.critique.total_score}
                  passed={record.critique.passed}
                  threshold={record.critique.total_score /* 仅作展示用 */}
                />

                {/* 总评 */}
                {record.critique.summary && (
                  <p className="mt-3 text-xs italic text-slate-500 dark:text-slate-400">
                    {record.critique.summary}
                  </p>
                )}

                {/* 问题列表 */}
                {record.critique.issues.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                      评审问题（{record.critique.issues.length}）
                    </div>
                    <ul className="flex flex-col gap-1.5">
                      {record.critique.issues.map((issue, i) => (
                        <li
                          key={i}
                          className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                SEVERITY_STYLE[issue.severity] || SEVERITY_STYLE.medium
                              }`}
                            >
                              {issue.severity}
                            </span>
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {issue.location || "整体"}
                            </span>
                          </div>
                          <div className="mt-1 text-slate-600 dark:text-slate-300">
                            {issue.problem}
                          </div>
                          {issue.suggestion && (
                            <div className="mt-0.5 text-slate-500 dark:text-slate-400">
                              建议：{issue.suggestion}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 修改后歌词 */}
                {record.revised_lyrics && (
                  <details className="mt-3 group">
                    <summary className="cursor-pointer text-xs font-medium text-emerald-600 hover:underline dark:text-emerald-400">
                      查看修改后歌词
                    </summary>
                    <pre className="lyric-scroll mt-2 max-h-60 overflow-auto rounded-lg bg-emerald-50 p-3 text-xs text-slate-700 dark:bg-emerald-900/20 dark:text-slate-200">
                      {record.revised_lyrics}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
