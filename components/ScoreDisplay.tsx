"use client";

import { DIMENSION_LABELS, type ScoreDimensions } from "@/lib/types";

interface ScoreDisplayProps {
  dimensions: ScoreDimensions;
  totalScore: number;
  passed: boolean;
  threshold: number;
}

export default function ScoreDisplay({
  dimensions,
  totalScore,
  passed,
  threshold,
}: ScoreDisplayProps) {
  const entries = Object.entries(dimensions) as [keyof ScoreDimensions, number][];

  return (
    <div className="flex flex-col gap-4">
      {/* 总分卡片 */}
      <div className="flex items-center gap-4">
        <div
          className={`flex h-20 w-20 flex-col items-center justify-center rounded-full border-4 ${
            passed
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400"
              : "border-amber-500 text-amber-600 dark:text-amber-400"
          }`}
        >
          <span className="text-2xl font-bold leading-none">{totalScore}</span>
          <span className="text-[10px] text-slate-400">/100</span>
        </div>
        <div>
          <div
            className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
              passed
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            {passed ? "已通过阈值" : `未达阈值 ${threshold}`}
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            多维度评分（满分 10）
          </div>
        </div>
      </div>

      {/* 各维度条形图 */}
      <div className="flex flex-col gap-2.5">
        {entries.map(([key, value]) => {
          const pct = Math.min(100, (value / 10) * 100);
          const label = DIMENSION_LABELS[key];
          return (
            <div key={key} className="flex items-center gap-3">
              <span className="w-24 shrink-0 text-xs text-slate-600 dark:text-slate-300">
                {label}
              </span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs font-medium tabular-nums text-slate-700 dark:text-slate-200">
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
