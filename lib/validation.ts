import type { LyricRequest, LLMConfig } from "./types";

export const LIMITS = {
  MAX_PROMPT_LENGTH: 2000,
  MAX_STRUCTURE_LENGTH: 2000,
  MIN_ROUNDS: 1,
  MAX_ROUNDS: 10,
  MIN_SYLLABLE_FIX_ROUNDS: 1,
  MAX_SYLLABLE_FIX_ROUNDS: 20,
  MIN_THRESHOLD: 0,
  MAX_THRESHOLD: 100,
  MIN_TEMPERATURE: 0,
  MAX_TEMPERATURE: 1.5,
  MAX_API_KEY_LENGTH: 500,
  MAX_BASE_URL_LENGTH: 300,
  MAX_MODEL_LENGTH: 100,
  MAX_CUSTOM_PROMPT_LENGTH: 8000,
  MAX_THEME_LENGTH: 200,
  MIN_CRITIC_STRICTNESS: 1,
  MAX_CRITIC_STRICTNESS: 10,
} as const;

export const DEFAULTS = {
  ROUNDS: 3,
  SYLLABLE_FIX_ROUNDS: 5,
  THRESHOLD: 80,
  TEMPERATURE: 0.8,
  CRITIC_STRICTNESS: 7,
  LYRICS_LANGUAGE: "zh" as const,
} as const;

export interface ValidationResult {
  ok: boolean;
  data?: LyricRequest;
  error?: string;
}

// 参数校验与规整：自动截断越界值，校验必填项与长度
export function validateAndNormalizeRequest(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "请求体必须是一个 JSON 对象" };
  }

  const body = input as Partial<LyricRequest>;

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const structure = typeof body.structure === "string" ? body.structure.trim() : "";

  if (!prompt) {
    return { ok: false, error: "提示词（prompt）不能为空" };
  }
  if (!structure) {
    return { ok: false, error: "词格（structure）不能为空" };
  }
  if (prompt.length > LIMITS.MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      error: `提示词长度不能超过 ${LIMITS.MAX_PROMPT_LENGTH} 字`,
    };
  }
  if (structure.length > LIMITS.MAX_STRUCTURE_LENGTH) {
    return {
      ok: false,
      error: `词格长度不能超过 ${LIMITS.MAX_STRUCTURE_LENGTH} 字`,
    };
  }

  // 非字数修复迭代轮数
  let rounds: number = DEFAULTS.ROUNDS;
  if (body.rounds !== undefined && body.rounds !== null) {
    const r = Number(body.rounds);
    if (!Number.isFinite(r)) {
      return { ok: false, error: "迭代轮数必须是数字" };
    }
    rounds = Math.round(r);
    if (rounds < LIMITS.MIN_ROUNDS) rounds = LIMITS.MIN_ROUNDS;
    if (rounds > LIMITS.MAX_ROUNDS) rounds = LIMITS.MAX_ROUNDS;
  }

  // 纯字数修复迭代轮数（独立计数，不计入主轮次）
  let syllable_fix_rounds: number = DEFAULTS.SYLLABLE_FIX_ROUNDS;
  if (body.syllable_fix_rounds !== undefined && body.syllable_fix_rounds !== null) {
    const s = Number(body.syllable_fix_rounds);
    if (!Number.isFinite(s)) {
      return { ok: false, error: "字数修复轮数必须是数字" };
    }
    syllable_fix_rounds = Math.round(s);
    if (syllable_fix_rounds < LIMITS.MIN_SYLLABLE_FIX_ROUNDS) syllable_fix_rounds = LIMITS.MIN_SYLLABLE_FIX_ROUNDS;
    if (syllable_fix_rounds > LIMITS.MAX_SYLLABLE_FIX_ROUNDS) syllable_fix_rounds = LIMITS.MAX_SYLLABLE_FIX_ROUNDS;
  }

  // 通过阈值
  let threshold: number = DEFAULTS.THRESHOLD;
  if (body.threshold !== undefined && body.threshold !== null) {
    const t = Number(body.threshold);
    if (!Number.isFinite(t)) {
      return { ok: false, error: "通过阈值必须是数字" };
    }
    threshold = Math.min(Math.max(t, LIMITS.MIN_THRESHOLD), LIMITS.MAX_THRESHOLD);
  }

  // 温度
  let temperature: number = DEFAULTS.TEMPERATURE;
  if (body.temperature !== undefined && body.temperature !== null) {
    const tp = Number(body.temperature);
    if (!Number.isFinite(tp)) {
      return { ok: false, error: "温度必须是数字" };
    }
    temperature = Math.min(Math.max(tp, LIMITS.MIN_TEMPERATURE), LIMITS.MAX_TEMPERATURE);
  }

  // Critic 严格程度
  let critic_strictness: number = DEFAULTS.CRITIC_STRICTNESS;
  if (body.critic_strictness !== undefined && body.critic_strictness !== null) {
    const cs = Number(body.critic_strictness);
    if (!Number.isFinite(cs)) {
      return { ok: false, error: "Critic 严格度必须是数字" };
    }
    critic_strictness = Math.min(Math.max(Math.round(cs), LIMITS.MIN_CRITIC_STRICTNESS), LIMITS.MAX_CRITIC_STRICTNESS);
  }

  // 歌词输出语言
  let lyrics_language: "zh" | "en" = DEFAULTS.LYRICS_LANGUAGE;
  if (body.lyrics_language !== undefined && body.lyrics_language !== null) {
    const raw = String(body.lyrics_language).toLowerCase();
    if (raw !== "zh" && raw !== "en") {
      return { ok: false, error: "歌词输出语言必须是 zh 或 en" };
    }
    lyrics_language = raw as "zh" | "en";
  }

  // 模型（可选）
  const model =
    typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  // LLM 配置（可选，请求级覆盖环境变量）
  let llm: LLMConfig | undefined;
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
    // 仅在有任意字段时构造对象
    if (api_key || base_url || llm_model) {
      llm = {
        ...(api_key ? { api_key } : {}),
        ...(base_url ? { base_url } : {}),
        ...(llm_model ? { model: llm_model } : {}),
      };
    }
  }

  // 自定义 Generator 提示词（可选）
  let custom_generator_prompt: string | undefined;
  if (
    body.custom_generator_prompt !== undefined &&
    body.custom_generator_prompt !== null
  ) {
    if (typeof body.custom_generator_prompt !== "string") {
      return { ok: false, error: "自定义 Generator 提示词必须是字符串" };
    }
    custom_generator_prompt = body.custom_generator_prompt.trim();
    if (custom_generator_prompt.length > LIMITS.MAX_CUSTOM_PROMPT_LENGTH) {
      return {
        ok: false,
        error: `自定义 Generator 提示词长度不能超过 ${LIMITS.MAX_CUSTOM_PROMPT_LENGTH} 字`,
      };
    }
    if (custom_generator_prompt.length === 0) custom_generator_prompt = undefined;
  }

  // 自定义 Critic 提示词（可选）
  let custom_critic_prompt: string | undefined;
  if (
    body.custom_critic_prompt !== undefined &&
    body.custom_critic_prompt !== null
  ) {
    if (typeof body.custom_critic_prompt !== "string") {
      return { ok: false, error: "自定义 Critic 提示词必须是字符串" };
    }
    custom_critic_prompt = body.custom_critic_prompt.trim();
    if (custom_critic_prompt.length > LIMITS.MAX_CUSTOM_PROMPT_LENGTH) {
      return {
        ok: false,
        error: `自定义 Critic 提示词长度不能超过 ${LIMITS.MAX_CUSTOM_PROMPT_LENGTH} 字`,
      };
    }
    if (custom_critic_prompt.length === 0) custom_critic_prompt = undefined;
  }

  return {
    ok: true,
    data: {
      prompt,
      structure,
      rounds,
      syllable_fix_rounds,
      critic_strictness,
      lyrics_language,
      threshold,
      temperature,
      model,
      llm,
      custom_generator_prompt,
      custom_critic_prompt,
    },
  };
}
