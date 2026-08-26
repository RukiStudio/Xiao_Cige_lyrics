"use client";

import { useEffect, useMemo, useState } from "react";
import type { LyricRequest, ThemeExpandResponse } from "@/lib/types";
import { GENERATOR_SYSTEM_PROMPT, CRITIC_SYSTEM_PROMPT } from "@/lib/prompts";
import {
  PROVIDER_PRESETS,
  DEFAULT_PRESET_ID,
  getPresetById,
} from "@/lib/presets";
import { convertStructuredInput, lyricsToRhythmTags, rhythmTagsToLyrics } from "@/lib/structureConverter";

interface InputPanelProps {
  onGenerate: (req: LyricRequest) => void;
  loading: boolean;
}

type StructureMode = "free" | "auto";

const STRUCTURE_PLACEHOLDER = `主歌1：4句，每句7字，押韵 AABB
主歌2：4句，每句7字，押韵 AABB
副歌：4句，每句10字，押韵 ABAB
桥段：2句，每句5字，不强制押韵`;

// 高级编辑模式占位示例：混合汉字歌词 + 0/1//+/ 节奏标记
const AUTO_PLACEHOLDER = `床前明月光
疑是地上霜
0101/0
001/010`;

const PROMPT_PLACEHOLDER = "例如：中国风、思念、伤感、雨夜、离别";

const STORAGE_KEY = "xiaocige_llm_config";

// 持久化在 localStorage 的服务商配置
interface StoredLLMConfig {
  presetId: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

function loadStored(): StoredLLMConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") {
      return {
        presetId: typeof obj.presetId === "string" ? obj.presetId : DEFAULT_PRESET_ID,
        apiKey: typeof obj.apiKey === "string" ? obj.apiKey : "",
        baseUrl: typeof obj.baseUrl === "string" ? obj.baseUrl : "",
        model: typeof obj.model === "string" ? obj.model : "",
      };
    }
  } catch {
    // 忽略
  }
  return null;
}

export default function InputPanel({ onGenerate, loading }: InputPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [structure, setStructure] = useState("");
  const [structureMode, setStructureMode] = useState<StructureMode>("free");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rounds, setRounds] = useState(3);
  const [syllableFixRounds, setSyllableFixRounds] = useState(5); // 字数修复独立轮次上限
  const [criticStrictness, setCriticStrictness] = useState(7); // Critic 严格程度 1-10，默认 7 偏严格
  const [lyricsLanguage, setLyricsLanguage] = useState<"zh" | "en">("zh"); // 歌词输出语言
  const [threshold, setThreshold] = useState(80);
  const [temperature, setTemperature] = useState(0.8);

  // 主题帮写
  const [expanding, setExpanding] = useState(false);
  const [expandError, setExpandError] = useState<string | null>(null);
  const [lastTheme, setLastTheme] = useState<string>("");

  // 自定义 Generator 提示词（默认显示系统默认，用户可编辑）
  const [customGeneratorPrompt, setCustomGeneratorPrompt] = useState(GENERATOR_SYSTEM_PROMPT);
  const [showPromptEditor, setShowPromptEditor] = useState(false);

  // 自定义 Critic 提示词（默认显示系统默认，用户可编辑）
  const [customCriticPrompt, setCustomCriticPrompt] = useState(CRITIC_SYSTEM_PROMPT);
  const [showCriticEditor, setShowCriticEditor] = useState(false);

  // 高级编辑模式：实时把分行输入（汉字/0/1//+/）解析为标准化词格描述
  const autoConvert = useMemo(
    () => convertStructuredInput(structure),
    [structure]
  );

  // 服务商配置
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // 首次挂载读取 localStorage
  useEffect(() => {
    const stored = loadStored();
    if (stored) {
      setPresetId(stored.presetId);
      setApiKey(stored.apiKey);
      setBaseUrl(stored.baseUrl);
      setModel(stored.model);
    } else {
      // 无存储时，应用默认预设
      const preset = getPresetById(DEFAULT_PRESET_ID);
      if (preset) {
        setBaseUrl(preset.base_url);
        setModel(preset.model);
      }
    }
    setHydrated(true);
  }, []);

  // 配置变更后持久化
  useEffect(() => {
    if (!hydrated) return;
    const payload: StoredLLMConfig = { presetId, apiKey, baseUrl, model };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // 忽略写入失败
    }
  }, [hydrated, presetId, apiKey, baseUrl, model]);

  // 选择预设时，自动填充 baseUrl 与 model（不覆盖用户已填的 key 以免丢失）
  const handlePresetChange = (id: string) => {
    setPresetId(id);
    const preset = getPresetById(id);
    if (preset && id !== "custom") {
      setBaseUrl(preset.base_url);
      setModel(preset.model);
      // 免费免注册预设清空 key
      if (preset.freeNoKey) {
        setApiKey("");
      }
    }
  };

  const currentPreset = getPresetById(presetId);
  const needsKey = currentPreset?.apiKeyRequired ?? false;

  // 高级编辑模式：提交前需校验转化成功
  const structureReady =
    structureMode === "free"
      ? !!structure.trim()
      : autoConvert.ok && autoConvert.structure.length > 0;

  const canSubmit =
    !!prompt.trim() &&
    structureReady &&
    !loading &&
    !expanding &&
    // 需 key 的服务商必须填写；免费免注册或自定义可不填（回退环境变量或免费端点）
    (!needsKey || apiKey.trim() !== "");

  // 构造 llm 配置对象（供生成与主题帮写复用）
  const buildLlmConfig = () => {
    return apiKey.trim() || baseUrl.trim() || model.trim()
      ? {
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          ...(baseUrl.trim() ? { base_url: baseUrl.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
        }
      : undefined;
  };

  // 主题帮写：以当前 prompt 作为主题，扩写为 100 字左右提示词并替换 prompt
  const callExpand = async (theme: string) => {
    setExpanding(true);
    setExpandError(null);
    try {
      const res = await fetch("/api/expand-theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theme,
          temperature: 0.85,
          model: model.trim() || undefined,
          llm: buildLlmConfig(),
        }),
      });
      const data: ThemeExpandResponse = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "主题帮写失败");
      }
      setPrompt(data.expanded_prompt);
    } catch (err) {
      setExpandError(err instanceof Error ? err.message : "主题帮写失败");
    } finally {
      setExpanding(false);
    }
  };

  const handleExpand = () => {
    const theme = prompt.trim();
    if (!theme) {
      setExpandError("请先输入简短主题，再点击帮写");
      return;
    }
    setLastTheme(theme);
    callExpand(theme);
  };

  const handleRegenerate = () => {
    if (!lastTheme) return;
    callExpand(lastTheme);
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    // 高级编辑模式：用转化后的标准化词格作为最终 structure
    const finalStructure =
      structureMode === "auto"
        ? autoConvert.structure
        : structure.trim();

    const llm = buildLlmConfig();

    // 仅当用户修改了默认提示词时才传 custom_*_prompt
    const customGeneratorPromptTrimmed = customGeneratorPrompt.trim();
    const custom_generator_prompt =
      customGeneratorPromptTrimmed && customGeneratorPromptTrimmed !== GENERATOR_SYSTEM_PROMPT.trim()
        ? customGeneratorPromptTrimmed
        : undefined;
    const customCriticPromptTrimmed = customCriticPrompt.trim();
    const custom_critic_prompt =
      customCriticPromptTrimmed && customCriticPromptTrimmed !== CRITIC_SYSTEM_PROMPT.trim()
        ? customCriticPromptTrimmed
        : undefined;

    onGenerate({
      prompt: prompt.trim(),
      structure: finalStructure,
      rounds,
      syllable_fix_rounds: syllableFixRounds,
      critic_strictness: criticStrictness,
      lyrics_language: lyricsLanguage,
      threshold,
      temperature,
      llm,
      custom_generator_prompt,
      custom_critic_prompt,
    });
  };

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
            提示词 <span className="text-rose-500">*</span>
          </label>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleExpand}
              disabled={expanding || loading}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
              title="将当前输入作为简短主题，自动扩写为 100 字左右提示词"
            >
              {expanding ? "扩写中…" : "✦ 帮写"}
            </button>
            {lastTheme && !expanding && (
              <button
                type="button"
                onClick={handleRegenerate}
                disabled={loading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                title={`基于上次的主题「${lastTheme}」重新扩写`}
              >
                ↻ 重新生成
              </button>
            )}
          </div>
        </div>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={PROMPT_PLACEHOLDER}
          rows={3}
          maxLength={2000}
          className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
          disabled={expanding}
        />
        <div className="mt-1 flex items-center justify-between text-xs">
          <span className="text-rose-500">{expandError || ""}</span>
          <span className="text-slate-400">{prompt.length}/2000</span>
        </div>
        {lastTheme && (
          <p className="mt-1 text-[11px] text-slate-400">
            上次帮写主题：<span className="text-slate-500">{lastTheme}</span>
          </p>
        )}
      </div>

      {/* 歌词输出语言切换 */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/50">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
            歌词输出语言
          </label>
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 text-xs dark:border-slate-700 dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setLyricsLanguage("zh")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                lyricsLanguage === "zh"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              🇨🇳 中文歌词
            </button>
            <button
              type="button"
              onClick={() => setLyricsLanguage("en")}
              className={`rounded-md px-3 py-1 font-medium transition ${
                lyricsLanguage === "en"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              🇺🇸 English
            </button>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
          {lyricsLanguage === "zh"
            ? "中文歌词模式：评审、词解、修改说明全部使用中文；按「单字 = 单音节」匹配词格。"
            : "English 模式：歌词用英文创作（Critic、词解、修改说明仍为中文）；注意多音节词：英文一个单词可能对应多个音节（如 beautiful=3），系统会按 syllable 数而非字符数匹配词格，延音位(+) 请用拉长元音重复字母体现（如 yeaaah / hold ooon）。"}
        </p>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
            词格 <span className="text-rose-500">*</span>
          </label>
          <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5 text-xs dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setStructureMode("free")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                structureMode === "free"
                  ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-300"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              自由文本
            </button>
            <button
              type="button"
              onClick={() => setStructureMode("auto")}
              className={`rounded-md px-2.5 py-1 font-medium transition ${
                structureMode === "auto"
                  ? "bg-white text-indigo-600 shadow-sm dark:bg-slate-700 dark:text-indigo-300"
                  : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
            >
              高级编辑
            </button>
          </div>
        </div>

        {structureMode === "auto" && (
          <div className="mb-2 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2 text-xs leading-relaxed text-indigo-700 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300">
            <span className="font-semibold">词格标记规则：</span>
            输入 <code className="rounded bg-white/70 px-1 dark:bg-slate-800">0</code> 表示一个音节，
            输入 <code className="rounded bg-white/70 px-1 dark:bg-slate-800">1</code> 表示需要强调的重音，
            输入 <code className="rounded bg-white/70 px-1 dark:bg-slate-800">/</code> 表示停顿，
            输入 <code className="rounded bg-white/70 px-1 dark:bg-slate-800">+</code> 表示延音（与前一音节同字、唱时拉长，不计入字数），
            每一行表示一个乐句。也可直接输入汉字歌词自动计算词格。
          </div>
        )}

        {structureMode === "auto" && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!structure.trim()) return;
                setStructure(lyricsToRhythmTags(structure));
              }}
              disabled={!structure.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 dark:hover:bg-indigo-900/50"
              title="把汉字歌词转为 0/1// 节奏标记"
            >
              汉字 → 词格
            </button>
            <button
              type="button"
              onClick={() => {
                if (!structure.trim()) return;
                setStructure(rhythmTagsToLyrics(structure));
              }}
              disabled={!structure.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
              title="把 0/1// 节奏标记转为汉字占位（音/重/｜）"
            >
              词格 → 汉字
            </button>
          </div>
        )}

        <textarea
          value={structure}
          onChange={(e) => setStructure(e.target.value)}
          placeholder={structureMode === "free" ? STRUCTURE_PLACEHOLDER : AUTO_PLACEHOLDER}
          rows={6}
          maxLength={2000}
          className="lyric-scroll w-full resize-y rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
        />
        <div className="mt-1 text-right text-xs text-slate-400">
          {structure.length}/2000
        </div>

        {structureMode === "auto" && structure.trim() && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-800/60">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-semibold text-slate-600 dark:text-slate-300">
                转化预览
              </span>
              {autoConvert.ok ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                  {autoConvert.phrases.length} 乐句 ·{" "}
                  {autoConvert.phrases.reduce((s, p) => s + p.syllables, 0)} 音节
                </span>
              ) : (
                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">
                  {autoConvert.error || "无法转化"}
                </span>
              )}
            </div>
            {autoConvert.ok ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                {autoConvert.structure}
              </pre>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                请输入汉字歌词或 0/1// 节奏标记，每行一个乐句。
              </p>
            )}
          </div>
        )}
      </div>

      {/* 服务商配置 */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            大模型服务商
          </label>
          {currentPreset?.freeNoKey && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
              免费免注册
            </span>
          )}
        </div>

        <select
          value={presetId}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
        >
          {PROVIDER_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {currentPreset?.note && (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {currentPreset.note}
          </p>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              API Key
              {currentPreset?.website && (
                <a
                  href={currentPreset.website}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-indigo-500 hover:underline"
                >
                  获取 →
                </a>
              )}
              {needsKey && <span className="ml-1 text-rose-500">*</span>}
            </label>
            <div className="relative">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={needsKey ? "必填" : "无需填写（免费免注册或回退环境变量）"}
                autoComplete="off"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 pr-10 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                模型
              </label>
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o-mini"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
              />
            </div>
          </div>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
          配置仅保存在你的浏览器（localStorage）。留空字段将回退到服务端环境变量。
        </p>
      </div>

      {/* 自定义 Generator 提示词（独立分区，默认折叠） */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowPromptEditor((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-200"
          >
            <span>{showPromptEditor ? "▾" : "▸"}</span>
            自定义 Generator 提示词
            {customGeneratorPrompt.trim() !== GENERATOR_SYSTEM_PROMPT.trim() && (
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                已修改
              </span>
            )}
          </button>
          {showPromptEditor && (
            <button
              type="button"
              onClick={() => setCustomGeneratorPrompt(GENERATOR_SYSTEM_PROMPT)}
              className="text-[11px] text-indigo-500 hover:underline"
            >
              恢复默认
            </button>
          )}
        </div>
        {showPromptEditor && (
          <div className="mt-2">
            <textarea
              value={customGeneratorPrompt}
              onChange={(e) => setCustomGeneratorPrompt(e.target.value)}
              rows={8}
              maxLength={8000}
              className="lyric-scroll max-h-[40vh] w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-indigo-900"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              修改后将以该提示词覆盖默认 Generator system prompt；保持默认则使用系统内置版本。
            </p>
          </div>
        )}
      </div>

      {/* 自定义 Critic 提示词（独立分区，默认折叠） */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowCriticEditor((v) => !v)}
            className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-indigo-600 dark:text-slate-200"
          >
            <span>{showCriticEditor ? "▾" : "▸"}</span>
            自定义 Critic 提示词
            {customCriticPrompt.trim() !== CRITIC_SYSTEM_PROMPT.trim() && (
              <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                已修改
              </span>
            )}
          </button>
          {showCriticEditor && (
            <button
              type="button"
              onClick={() => setCustomCriticPrompt(CRITIC_SYSTEM_PROMPT)}
              className="text-[11px] text-indigo-500 hover:underline"
            >
              恢复默认
            </button>
          )}
        </div>
        {showCriticEditor && (
          <div className="mt-2">
            <textarea
              value={customCriticPrompt}
              onChange={(e) => setCustomCriticPrompt(e.target.value)}
              rows={10}
              maxLength={8000}
              className="lyric-scroll max-h-[40vh] w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-900 dark:focus:ring-indigo-900"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              修改后将以该提示词覆盖默认 Critic system prompt；Critic 负责打分、挑刺、给出 revision_instructions，建议保留结构权重与 JSON 输出约束。
            </p>
          </div>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          <span>{showAdvanced ? "▾" : "▸"}</span>
          高级设置
        </button>

        {showAdvanced && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                内容迭代轮数（1-10）
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={rounds}
                onChange={(e) =>
                  setRounds(Math.min(10, Math.max(1, Number(e.target.value) || 1)))
                }
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                非字数类修改计入此上限（默认 3 轮）
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                字数修复轮次上限（1-20）
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={syllableFixRounds}
                onChange={(e) =>
                  setSyllableFixRounds(Math.min(20, Math.max(1, Number(e.target.value) || 1)))
                }
                className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:focus:ring-indigo-900"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                纯字数修复不计入主轮次，默认 5 轮；达上限仍不达标将建议更换模型
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Critic 严格度：{criticStrictness} / 10
                {criticStrictness <= 3 ? "（宽松）" : criticStrictness <= 6 ? "（标准）" : criticStrictness <= 8 ? "（严格）" : "（极严）"}
              </label>
              <input
                type="range"
                min={1}
                max={10}
                step={1}
                value={criticStrictness}
                onChange={(e) => setCriticStrictness(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
              <p className="mt-1 text-[10px] text-slate-400">
                控制 Critic 评审严格程度。越高越挑剔，低分越难通过；默认 7（偏严格）
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                通过阈值：{threshold}
              </label>
              <input
                type="range"
                min={0}
                max={100}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                温度：{temperature.toFixed(2)}
              </label>
              <input
                type="range"
                min={0}
                max={1.5}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-400"
      >
        {loading ? "生成中..." : "生成歌词"}
      </button>

      {needsKey && !apiKey.trim() && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          当前服务商需要 API Key，请填写后再生成。
        </p>
      )}
    </div>
  );
}
