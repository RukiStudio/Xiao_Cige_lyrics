"use client";

import { useMemo, useState } from "react";
import type { CritiqueReport, LyricInterpretation } from "@/lib/types";
import ScoreDisplay from "./ScoreDisplay";

interface FinalLyricsProps {
  lyrics: string;
  critique: CritiqueReport;
  status: "passed" | "max_rounds_reached";
  threshold: number;
  elapsedMs: number;
  interpretation?: LyricInterpretation;
  /** 单句修改请求回调；返回 true 表示修改成功并已替换 lyrics */
  onReviseLine?: (line: string, instruction: string) => Promise<boolean>;
  /** 当前是否正在执行单句修改（用于禁用按钮与 loading 态） */
  revisingLine?: boolean;
}

// 单行编辑状态
interface LineEditState {
  line: string; // 待修改的原句
  instruction: string; // 用户的修改要求
}

export default function FinalLyrics({
  lyrics,
  critique,
  status,
  threshold,
  elapsedMs,
  interpretation,
  onReviseLine,
  revisingLine = false,
}: FinalLyricsProps) {
  const [copied, setCopied] = useState(false);
  const [edit, setEdit] = useState<LineEditState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  // 将歌词按行切分，区分段落标记行与歌词行
  const lines = useMemo(() => {
    return lyrics.split(/\r?\n/).map((raw, idx) => {
      const text = raw.trim();
      const isSection = /^\[.+\]$/.test(text);
      const isEmpty = text.length === 0;
      return { idx, raw: text, isSection, isEmpty };
    });
  }, [lyrics]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(lyrics);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // 忽略剪贴板权限错误
    }
  };

  const openEdit = (line: string) => {
    if (!onReviseLine) return;
    setEditError(null);
    setEdit({ line, instruction: "" });
  };

  const cancelEdit = () => {
    setEdit(null);
    setEditError(null);
  };

  const submitEdit = async () => {
    if (!edit || !onReviseLine) return;
    const inst = edit.instruction.trim();
    if (!inst) {
      setEditError("请填写修改要求");
      return;
    }
    setEditError(null);
    try {
      const ok = await onReviseLine(edit.line, inst);
      if (ok) {
        setEdit(null);
      } else {
        setEditError("修改失败，请稍后重试或调整修改要求");
      }
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "修改失败");
    }
  };

  return (
    <div className="animate-fade-in flex flex-col gap-4 rounded-2xl border-2 border-indigo-300 bg-white p-5 shadow-md dark:border-indigo-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
          最终歌词
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              status === "passed"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
            }`}
          >
            {status === "passed" ? "达标通过" : "达到最大轮次"}
          </span>
          <span className="text-xs text-slate-400">
            耗时 {(elapsedMs / 1000).toFixed(1)}s
          </span>
        </div>
      </div>

      {/* 风格关键词 */}
      {interpretation?.style_keywords && interpretation.style_keywords.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            风格关键词
          </span>
          {interpretation.style_keywords.map((kw, i) => (
            <span
              key={`${kw}-${i}`}
              className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:ring-indigo-700/50"
            >
              {kw}
            </span>
          ))}
        </div>
      )}

      {/* 歌词 + 词解 平行布局 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 左：歌词（可逐行修改） */}
        <div className="lyric-scroll max-h-96 overflow-auto rounded-lg bg-slate-50 p-4 dark:bg-slate-800/60">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              歌词
            </span>
            {onReviseLine && (
              <span className="text-[10px] text-slate-400">
                点击非标记行可单句修改
              </span>
            )}
          </div>
          <div className="flex flex-col">
            {lines.map(({ idx, raw, isSection, isEmpty }) => {
              if (isEmpty) {
                return <div key={idx} className="h-2" aria-hidden />;
              }
              if (isSection) {
                return (
                  <div
                    key={idx}
                    className="mt-2 first:mt-0 text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400"
                  >
                    {raw}
                  </div>
                );
              }
              const canEdit = Boolean(onReviseLine) && !revisingLine;
              return (
                <div
                  key={idx}
                  className={`group flex items-start gap-1 rounded px-1 py-0.5 ${
                    canEdit
                      ? "cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                      : ""
                  }`}
                  onClick={() => canEdit && openEdit(raw)}
                  title={canEdit ? "点击修改此句" : undefined}
                  role={canEdit ? "button" : undefined}
                >
                  <span className="flex-1 text-sm leading-relaxed text-slate-800 dark:text-slate-100">
                    {raw}
                  </span>
                  {canEdit && (
                    <span className="mt-0.5 hidden text-xs text-indigo-400 group-hover:inline">
                      ✎
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* 行内修改浮层 */}
          {edit && (
            <div className="mt-3 rounded-lg border border-indigo-200 bg-white p-3 dark:border-indigo-700 dark:bg-slate-800">
              <div className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                修改单句
              </div>
              <div className="mb-2 rounded bg-slate-100 px-2 py-1 text-sm text-slate-700 dark:bg-slate-700/50 dark:text-slate-200">
                {edit.line}
              </div>
              <textarea
                value={edit.instruction}
                onChange={(e) =>
                  setEdit({ ...edit, instruction: e.target.value })
                }
                placeholder="修改要求，如：换一个更有画面感的意象 / 调整为更克制的语气 / 与上句押韵"
                rows={3}
                maxLength={500}
                className="w-full resize-none rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                disabled={revisingLine}
                autoFocus
              />
              {editError && (
                <div className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                  {editError}
                </div>
              )}
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={revisingLine}
                  className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  disabled={revisingLine || !edit.instruction.trim()}
                  className="rounded bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {revisingLine ? "修改中..." : "提交修改"}
                </button>
              </div>
              <div className="mt-1 text-[10px] text-slate-400">
                字数将保持与原句完全一致
              </div>
            </div>
          )}
        </div>

        {/* 右：词解 */}
        <div className="max-h-96 overflow-auto rounded-lg bg-amber-50/60 p-4 dark:bg-amber-900/10">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            词解
          </div>
          {interpretation?.interpretation ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-100">
              {interpretation.interpretation}
            </p>
          ) : (
            <p className="text-sm italic text-slate-400">
              词解生成失败或未提供
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <ScoreDisplay
          dimensions={critique.dimensions}
          totalScore={critique.total_score}
          passed={critique.passed}
          threshold={threshold}
        />
      </div>

      {critique.summary && (
        <p className="text-sm italic text-slate-600 dark:text-slate-300">
          “{critique.summary}”
        </p>
      )}

      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex items-center justify-center gap-2 self-start rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
      >
        {copied ? "已复制 ✓" : "复制歌词"}
      </button>
    </div>
  );
}
