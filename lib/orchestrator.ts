import { callLLM, safeParseJSON, isRetryableNetworkError, LLMCallError } from "./llm";
import {
  GENERATOR_SYSTEM_PROMPT,
  CRITIC_SYSTEM_PROMPT,
  REVISER_SYSTEM_PROMPT,
  INTERPRETER_SYSTEM_PROMPT,
  REVISE_LINE_SYSTEM_PROMPT,
  THEME_EXPANDER_SYSTEM_PROMPT,
  buildGeneratorUserPrompt,
  buildCriticUserPrompt,
  buildReviserUserPrompt,
  buildInterpreterUserPrompt,
  buildReviseLineUserPrompt,
  buildThemeExpanderUserPrompt,
  buildCriticStrictnessSuffix,
  buildGeneratorLanguageSuffix,
  buildCriticLanguageSuffix,
  buildReviserLanguageSuffix,
  buildInterpreterLanguageSuffix,
  buildReviseLineLanguageSuffix,
  type LyricsLanguage,
} from "./prompts";
import {
  DIMENSION_WEIGHTS,
  type CritiqueIssue,
  type CritiqueReport,
  type IterationRecord,
  type LyricInterpretation,
  type LyricRequest,
  type LyricResponse,
  type ProgressEvent,
  type ScoreDimensions,
  type Severity,
  type ThemeExpandRequest,
} from "./types";

const CRITIC_TEMPERATURE = 0.2; // 评审用较低温度，保证稳定性

// 维度键列表
const DIMENSION_KEYS: (keyof ScoreDimensions)[] = [
  "structure_adherence",
  "theme_relevance",
  "rhyme_rhythm",
  "fluency",
  "literary_quality",
  "emotion",
  "commercial_appeal",
];

// 根据维度分数与权重重新计算总分（百分制，四舍五入）
function computeTotalScore(dim: ScoreDimensions): number {
  let sum = 0;
  for (const key of DIMENSION_KEYS) {
    sum += (dim[key] ?? 0) * DIMENSION_WEIGHTS[key];
  }
  return Math.round(sum * 10);
}

// 将解析出的对象规范化为合法的 CritiqueReport
function normalizeCritique(obj: unknown, threshold: number): CritiqueReport {
  const o = (obj ?? {}) as Record<string, unknown>;
  const rawDim = (o.dimensions ?? {}) as Record<string, unknown>;

  const dimensions: ScoreDimensions = {
    structure_adherence: clampScore(rawDim.structure_adherence),
    theme_relevance: clampScore(rawDim.theme_relevance),
    rhyme_rhythm: clampScore(rawDim.rhyme_rhythm),
    fluency: clampScore(rawDim.fluency),
    literary_quality: clampScore(rawDim.literary_quality),
    emotion: clampScore(rawDim.emotion),
    commercial_appeal: clampScore(rawDim.commercial_appeal),
  };

  // 优先使用模型给出的 total_score，若缺失或非法则由维度计算
  const modelScore = Number(o.total_score);
  const total_score =
    Number.isFinite(modelScore) && modelScore >= 0 && modelScore <= 100
      ? Math.round(modelScore)
      : computeTotalScore(dimensions);

  const passed = total_score >= threshold;

  const issues: CritiqueIssue[] = Array.isArray(o.issues)
    ? o.issues
        .map((it) => normalizeIssue(it))
        .filter((it): it is CritiqueIssue => it !== null)
    : [];

  return {
    total_score,
    passed,
    dimensions,
    summary: typeof o.summary === "string" ? o.summary : "",
    issues,
    revision_instructions:
      typeof o.revision_instructions === "string" ? o.revision_instructions : "",
  };
}

function clampScore(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 10);
}

function normalizeIssue(it: unknown): CritiqueIssue | null {
  if (!it || typeof it !== "object") return null;
  const i = it as Record<string, unknown>;
  const severity: Severity =
    i.severity === "low" || i.severity === "medium" || i.severity === "high"
      ? i.severity
      : "medium";
  return {
    location: typeof i.location === "string" ? i.location : "",
    problem: typeof i.problem === "string" ? i.problem : "",
    suggestion: typeof i.suggestion === "string" ? i.suggestion : "",
    severity,
  };
}

// 当词格符合度未满分（< 10）时，构造一个 critique 副本：
// 在 revision_instructions 最前面追加一条「字数必须完全符合词格」的强约束，
// 并在 issues 顶部插入一条 high 严重度的字数问题，确保 Reviser 优先修正字数。
// 注意：不篡改分数（不得作假），仅增强修改指令。
function withSyllableFixDirective(
  critique: CritiqueReport,
  needFix: boolean,
  language: LyricsLanguage = "zh"
): CritiqueReport {
  if (!needFix) return critique;
  const syllableLabel =
    language === "en" ? "英语音节数（syllable，多音节词按发音拆分计算）" : "字数/音节数";
  const directive =
    `【字数最高优先·强制修正】当前歌词存在字数与词格不符的问题（structure_adherence < 10）。` +
    `修改时必须逐句核对词格要求的${syllableLabel}，确保每一句与词格完全一致，多一个音节或少一个音节都不允许。` +
    `在${syllableLabel}完全符合之前，不要为追求文学性而改变句长。字数修正完成后再处理其他问题。` +
    (language === "en"
      ? ` 注意：英文一个单词可能对应多个音节（如 beautiful = 3 音节），必须逐词核对音节数，不得用"单词数"代替"音节数"。`
      : "");
  const syllableIssue: CritiqueIssue = {
    location: "全篇/逐句",
    problem: `部分乐句${syllableLabel}与词格要求不一致，导致 structure_adherence 未达满分 10`,
    suggestion: `逐句核对词格${language === "en" ? "音节（syllable）数" : "字数"}，增删字词使每句与词格完全一致`,
    severity: "high",
  };
  return {
    ...critique,
    issues: [syllableIssue, ...critique.issues],
    revision_instructions: directive + (critique.revision_instructions ? "\n\n" + critique.revision_instructions : ""),
  };
}

// 调用 Critic：包含一次重试容错
async function callCritic(params: {
  prompt: string;
  structure: string;
  lyrics: string;
  threshold: number;
  model?: string;
  llm?: import("./types").LLMConfig;
  systemPrompt?: string; // 可选，覆盖默认 Critic system prompt
  strictness?: number; // 可选，严格程度 1-10，默认 7
  lyrics_language?: LyricsLanguage;
}): Promise<CritiqueReport> {
  const userPrompt = buildCriticUserPrompt(
    params.prompt,
    params.structure,
    params.lyrics,
    params.threshold
  );
  const baseSystem = params.systemPrompt?.trim() || CRITIC_SYSTEM_PROMPT;
  // 注入严格度附加指令（自定义 prompt 时也注入，保持一致）
  const strictnessSuffix = buildCriticStrictnessSuffix(params.strictness ?? 7);
  // 注入语言模式附加指令（英语模式下按 syllable 校验）
  const languageSuffix = buildCriticLanguageSuffix(params.lyrics_language ?? "zh");
  const systemPrompt = baseSystem + strictnessSuffix + languageSuffix;

  const attempt = async (): Promise<CritiqueReport> => {
    const raw = await callLLMWithInfraRetry({
      system: systemPrompt,
      user: userPrompt,
      temperature: CRITIC_TEMPERATURE,
      model: params.model,
      jsonMode: true,
      llm: params.llm,
    }, undefined, "Critic 评审");
    const parsed = safeParseJSON<unknown>(raw);
    if (!parsed) {
      throw new Error("Critic 返回内容无法解析为 JSON");
    }
    return normalizeCritique(parsed, params.threshold);
  };

  try {
    return await attempt();
  } catch (err) {
    // 解析失败时重试一次（相同参数）
    if (err instanceof Error && /无法解析为 JSON/.test(err.message)) {
      return await attempt();
    }
    throw err;
  }
}

// 调用 Interpreter：生成词解与风格关键词（容错：失败时返回空对象，不阻断主流程）
async function callInterpreter(params: {
  prompt: string;
  structure: string;
  lyrics: string;
  model?: string;
  llm?: import("./types").LLMConfig;
  lyrics_language?: LyricsLanguage;
}): Promise<LyricInterpretation | undefined> {
  const userPrompt = buildInterpreterUserPrompt(
    params.prompt,
    params.structure,
    params.lyrics
  );
  const systemPrompt =
    INTERPRETER_SYSTEM_PROMPT +
    buildInterpreterLanguageSuffix(params.lyrics_language ?? "zh");

  const attempt = async (): Promise<LyricInterpretation | undefined> => {
    const raw = await callLLM({
      system: systemPrompt,
      user: userPrompt,
      temperature: 0.4, // 词解用较低温度，保证文风稳定
      model: params.model,
      jsonMode: true,
      llm: params.llm,
    });
    const parsed = safeParseJSON<unknown>(raw);
    if (!parsed) {
      throw new Error("Interpreter 返回内容无法解析为 JSON");
    }
    const o = (parsed ?? {}) as Record<string, unknown>;
    const interpretation =
      typeof o.interpretation === "string" ? o.interpretation.trim() : "";
    const style_keywords = Array.isArray(o.style_keywords)
      ? o.style_keywords
          .filter((k): k is string => typeof k === "string" && k.trim().length > 0)
          .map((k) => k.trim())
          .slice(0, 8)
      : [];
    if (!interpretation && style_keywords.length === 0) return undefined;
    return { interpretation, style_keywords };
  };

  try {
    return await attempt();
  } catch (err) {
    if (err instanceof Error && /无法解析为 JSON/.test(err.message)) {
      try {
        return await attempt();
      } catch {
        return undefined;
      }
    }
    // 词解为附加价值，失败时不阻断主流程
    return undefined;
  }
}

// 基础设施层重试：当 callLLM 因超时/网络错误失败时（内部已重试 5 次仍失败），
// 在编排层再做最多 2 次重试，不计入任何迭代轮次。
// 这样单次 callLLM 失败不会浪费用户的迭代配额。
const INFRA_MAX_RETRY = 2; // 编排层额外重试次数（不含 callLLM 内部的 5 次）
const INFRA_RETRY_DELAY_MS = 3000;

async function callLLMWithInfraRetry(
  params: Parameters<typeof callLLM>[0],
  emit?: (event: ProgressEvent) => void,
  stageLabel?: string
): Promise<string> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= INFRA_MAX_RETRY; attempt++) {
    try {
      return await callLLM(params);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      // 仅对网络/超时类错误重试；配置错误或空内容错误直接抛出
      if (!isRetryableNetworkError(lastErr)) throw lastErr;
      if (attempt < INFRA_MAX_RETRY) {
        emit?.({
          type: "revising",
          stage: `${stageLabel || "LLM 调用"}超时/网络错误，${INFRA_RETRY_DELAY_MS / 1000}s 后重试（第 ${attempt + 1}/${INFRA_MAX_RETRY} 次，不计入迭代轮次）`,
        });
        await new Promise((r) => setTimeout(r, INFRA_RETRY_DELAY_MS));
      }
    }
  }
  throw new LLMCallError(
    `基础设施层重试 ${INFRA_MAX_RETRY} 次后仍失败：${lastErr?.message || "未知错误"}。建议检查网络或更换服务商后重试。`
  );
}

// 主编排函数：多智能体生成 -> 评审 -> 修改 循环
// onProgress：可选的进度回调，用于流式推送每个阶段的状态
export async function generateLyrics(
  req: LyricRequest,
  onProgress?: (event: ProgressEvent) => void
): Promise<LyricResponse> {
  const start = Date.now();
  const {
    prompt,
    structure,
    rounds = 3,
    syllable_fix_rounds = 5,
    threshold = 80,
    temperature = 0.8,
    model,
    llm,
    custom_generator_prompt,
    custom_critic_prompt,
    critic_strictness = 7,
    lyrics_language = "zh",
  } = req;

  // rounds 语义为"最少迭代轮数"：即使评分达标也至少迭代 N 轮
  // 超过最少轮数后若评分达标则停止，未达标则继续直到达标或达到 maxRounds 上限
  // maxRounds 上限 = max(rounds * 3, rounds + 5)，且不超过 30，避免无限循环
  const maxRounds = Math.min(Math.max(rounds * 3, rounds + 5), 30);

  // 用户自定义 system prompt 优先，否则用默认
  // 语言模式附加指令无论是否自定义都注入（保证中英文切换生效）
  const generatorSystem =
    (custom_generator_prompt?.trim() || GENERATOR_SYSTEM_PROMPT) +
    buildGeneratorLanguageSuffix(lyrics_language);
  const criticSystem = custom_critic_prompt?.trim() || undefined; // undefined 时 callCritic 内部用默认 + 注入语言
  const reviserSystem = REVISER_SYSTEM_PROMPT + buildReviserLanguageSuffix(lyrics_language);

  const emit = (event: ProgressEvent) => {
    try {
      onProgress?.(event);
    } catch {
      // 回调失败不影响主流程
    }
  };

  emit({
    type: "start",
    total_rounds: maxRounds,
    syllable_fix_total_rounds: syllable_fix_rounds,
    threshold,
    stage: `参数已确认：最少迭代 ${rounds} 轮（未达标则继续，上限 ${maxRounds} 轮），纯字数修复 ${syllable_fix_rounds} 轮上限`,
  });

  // 1. 初始生成
  emit({ type: "generating", stage: "初始生成：根据词格与提示词创作首版歌词" });
  let currentLyrics = await callLLMWithInfraRetry({
    system: generatorSystem,
    user: buildGeneratorUserPrompt(prompt, structure),
    temperature,
    model,
    llm,
  }, emit, "初始生成");

  const history: IterationRecord[] = [];
  const suggestions: string[] = [];
  let syllableFixUsed = 0; // 已使用的纯字数修复轮次

  // 判定：当前 critique 的问题是否"纯字数导致"
  // 规则：structure_adherence < 10 且 其余维度都 >= 7（其他维度问题不重）
  function isPurelySyllableIssue(c: CritiqueReport): boolean {
    if (c.dimensions.structure_adherence >= 10) return false;
    const rest = (["theme_relevance", "rhyme_rhythm", "fluency", "literary_quality", "emotion", "commercial_appeal"] as const).every(
      (k) => c.dimensions[k] >= 7
    );
    return rest;
  }

  // 已达标时的快速返回：async 返回 LyricResponse
  // reachedMinRounds：是否已达到最少迭代轮数；未达到时不提前返回，继续迭代以充分打磨
  async function attemptEarlyReturn(
    crit: CritiqueReport,
    roundLabel: number,
    syllableFixLabel: number | undefined,
    reachedMinRounds: boolean
  ): Promise<LyricResponse | null> {
    const structurePerfect = crit.dimensions.structure_adherence >= 10;
    const scorePassed = crit.passed || crit.total_score >= threshold;
    if (scorePassed && structurePerfect && reachedMinRounds) {
      // 词解生成（不阻断主流程，失败留空）
      emit({
        type: "interpreting",
        round: roundLabel,
        syllable_fix_round: syllableFixLabel,
        stage: "词解生成：Interpreter 正在解读歌词并提炼风格关键词",
      });
      let interpretation: LyricInterpretation | undefined;
      try {
        interpretation = await callInterpreter({
          prompt,
          structure,
          lyrics: currentLyrics,
          model,
          llm,
          lyrics_language,
        });
      } catch {
        interpretation = undefined;
      }
      return {
        success: true,
        final_lyrics: currentLyrics,
        final_critique: crit,
        status: "passed",
        history,
        elapsed_ms: Date.now() - start,
        ...(interpretation ? { interpretation } : {}),
        ...(suggestions.length ? { suggestions } : {}),
      };
    }
    return null;
  }

  // 封装：执行一次"评审 → 判定 → 修改"迭代
  // 返回值：
  //   - kind: "passed"：已达标（带 response）
  //   - kind: "syllable_only"：纯字数问题（不计入主轮次），修改完成返回继续
  //   - kind: "normal"：主轮次迭代，修改完成返回继续
  //   - kind: "finalize"：主轮次用尽或字数修复用尽，进入最终评审
  type IterResult =
    | { kind: "passed"; response: LyricResponse }
    | { kind: "syllable_only" }
    | { kind: "normal" }
    | { kind: "finalize"; reason: "rounds_exhausted" | "syllable_exhausted" };

  async function runOneIteration(
    mainRound: number,
    inSyllableFix: boolean
  ): Promise<IterResult> {
    // 评审
    emit({
      type: "critiquing",
      round: mainRound,
      syllable_fix_round: inSyllableFix ? syllableFixUsed : undefined,
      stage: inSyllableFix
        ? `字数修复第 ${syllableFixUsed}/${syllable_fix_rounds} 轮评审`
        : `第 ${mainRound}/${maxRounds} 轮评审：Critic 正在打分与挑刺${mainRound > rounds ? "（已达最少轮数，未达标继续）" : ""}`,
    });
    const critique = await callCritic({
      prompt,
      structure,
      lyrics: currentLyrics,
      threshold,
      model,
      llm,
      systemPrompt: criticSystem,
      strictness: critic_strictness,
      lyrics_language,
    });

    history.push({
      round: inSyllableFix ? -syllableFixUsed : mainRound,
      lyrics: currentLyrics,
      critique,
    });

    emit({
      type: "critique_done",
      round: mainRound,
      syllable_fix_round: inSyllableFix ? syllableFixUsed : undefined,
      score: critique.total_score,
      passed: critique.passed,
      stage: inSyllableFix
        ? `字数修复第 ${syllableFixUsed}/${syllable_fix_rounds} 轮评审完成：词格符合度 ${critique.dimensions.structure_adherence}/10`
        : `第 ${mainRound} 轮评审完成：得分 ${critique.total_score}（词格符合度 ${critique.dimensions.structure_adherence}/10）`,
    });

    // 达标快速返回：仅在达到最少轮数 rounds 后才允许提前返回
    // 未达到最少轮数时即使达标也继续迭代，以充分打磨歌词
    const early = await attemptEarlyReturn(critique, mainRound, inSyllableFix ? syllableFixUsed : undefined, mainRound >= rounds);
    if (early) return { kind: "passed", response: early };

    // 判定是否纯字数问题
    const structurePerfect = critique.dimensions.structure_adherence >= 10;
    const pureSyllable = !structurePerfect && isPurelySyllableIssue(critique);

    // 字数修复分支：当结构未满分且是纯字数问题 → 不计入主轮次
    if (!structurePerfect && (pureSyllable || inSyllableFix)) {
      if (syllableFixUsed >= syllable_fix_rounds) {
        suggestions.push(
          `词格字数修复已达 ${syllable_fix_rounds} 轮上限，词格符合度仍未到 10 分。建议更换推理能力更强的大模型（如 gpt-4o / glm-4-plus / 同级别），并适当提高 API 超时配置。`
        );
        return { kind: "finalize", reason: "syllable_exhausted" };
      }
      // 执行字数修复（不增加主轮次）
      syllableFixUsed += 1;
      const critiqueForReviser = withSyllableFixDirective(critique, true, lyrics_language);
      emit({
        type: "revising",
        round: mainRound,
        syllable_fix_round: syllableFixUsed,
        stage: `纯字数修复第 ${syllableFixUsed}/${syllable_fix_rounds} 轮（不计入主轮次）：逐句校正字数与词格对齐`,
      });
      const revised = await callLLMWithInfraRetry({
        system: reviserSystem,
        user: buildReviserUserPrompt(
          prompt,
          structure,
          currentLyrics,
          JSON.stringify(critiqueForReviser, null, 2)
        ),
        temperature,
        model,
        llm,
      }, emit, `字数修复第 ${syllableFixUsed} 轮`);
      history[history.length - 1].revised_lyrics = revised;
      currentLyrics = revised;
      return { kind: "syllable_only" };
    }

    // 正常主轮次分支
    // 达到 maxRounds 上限前继续修改；达到上限后进入最终评审
    if (mainRound < maxRounds) {
      const critiqueForReviser = withSyllableFixDirective(critique, !structurePerfect, lyrics_language);
      emit({
        type: "revising",
        round: mainRound,
        syllable_fix_round: inSyllableFix ? syllableFixUsed : undefined,
        stage: !structurePerfect
          ? `第 ${mainRound}/${maxRounds} 轮修改：词格+内容综合改进${mainRound >= rounds ? "（已达最少轮数，未达标继续）" : ""}`
          : `第 ${mainRound}/${maxRounds} 轮修改：Reviser 根据评审意见改进歌词${mainRound >= rounds ? "（已达最少轮数，未达标继续）" : ""}`,
      });
      const revised = await callLLMWithInfraRetry({
        system: reviserSystem,
        user: buildReviserUserPrompt(
          prompt,
          structure,
          currentLyrics,
          JSON.stringify(critiqueForReviser, null, 2)
        ),
        temperature,
        model,
        llm,
      }, emit, `第 ${mainRound} 轮修改`);
      history[history.length - 1].revised_lyrics = revised;
      currentLyrics = revised;
      return { kind: "normal" };
    }

    return { kind: "finalize", reason: "rounds_exhausted" };
  }

  // 2. 主迭代：主轮次（内嵌套纯字数修复子循环）
  // 至少迭代 rounds 轮，未达标则继续直到 maxRounds 上限
  let mainRound = 1;
  outer: while (mainRound <= maxRounds) {
    emit({
      type: "round_start",
      round: mainRound,
      total_rounds: maxRounds,
      syllable_fix_round: syllableFixUsed || undefined,
      syllable_fix_total_rounds: syllable_fix_rounds,
      stage: mainRound <= rounds
        ? `进入第 ${mainRound}/${rounds} 轮（最少 ${rounds} 轮）内容迭代`
        : `进入第 ${mainRound}/${maxRounds} 轮内容迭代（已达最少轮数 ${rounds}，未达标继续）`,
    });

    // 进入本次迭代前，先做一次评审-修改
    let first = true;
    while (true) {
      const r = await runOneIteration(mainRound, !first && syllableFixUsed > 0);
      if (r.kind === "passed") {
        return r.response;
      }
      if (r.kind === "finalize") {
        break outer;
      }
      if (r.kind === "normal") {
        // 正常轮次修改后，下一次进入字数修复模式（若仍是纯字数问题）
        mainRound += 1;
        break;
      }
      // syllable_only：字数修复不计入主轮次，继续循环评审
      first = false;
    }
  }

  // 3. 达到最大轮数上限或字数修复上限后：最终评审
  emit({
    type: "final_critique",
    round: maxRounds,
    syllable_fix_round: syllableFixUsed || undefined,
    stage: `最终评审：已达 ${maxRounds} 轮上限，对最后一版歌词做总评`,
  });
  const finalCritique = await callCritic({
    prompt,
    structure,
    lyrics: currentLyrics,
    threshold,
    model,
    llm,
    systemPrompt: criticSystem,
    strictness: critic_strictness,
    lyrics_language,
  });

  history.push({
    round: maxRounds + 1,
    lyrics: currentLyrics,
    critique: finalCritique,
  });

  emit({
    type: "critique_done",
    round: maxRounds + 1,
    score: finalCritique.total_score,
    passed: finalCritique.passed,
    stage: `最终评审完成：得分 ${finalCritique.total_score}（词格符合度 ${finalCritique.dimensions.structure_adherence}/10）`,
  });

  // 如果最终仍词格不满分，提示建议
  if (finalCritique.dimensions.structure_adherence < 10 && suggestions.length === 0) {
    suggestions.push(
      `最终评审词格符合度 ${finalCritique.dimensions.structure_adherence}/10，仍未达到满分 10。建议：1) 尝试更简单明确的词格描述；2) 更换更强推理能力的大模型；3) 提高温度(≥0.8)让模型跳出局部最优。`
    );
  }

  // 词解生成（不阻断主流程，失败留空）
  emit({ type: "interpreting", round: maxRounds + 1, stage: "词解生成：Interpreter 正在解读歌词并提炼风格关键词" });
  const interpretation = await callInterpreter({
    prompt,
    structure,
    lyrics: currentLyrics,
    model,
    llm,
    lyrics_language,
  });

  return {
    success: true,
    final_lyrics: currentLyrics,
    final_critique: finalCritique,
    status: "max_rounds_reached",
    history,
    elapsed_ms: Date.now() - start,
    ...(interpretation ? { interpretation } : {}),
    ...(suggestions.length ? { suggestions } : {}),
  };
}

// 单句修改：基于原词格与完整歌词，仅修改指定单句，保持其余部分一字不变
// 失败时返回 success=false，由 API 层包装错误响应
export async function reviseLine(params: {
  structure: string;
  lyrics: string;
  lineToRevise: string;
  instruction: string;
  temperature?: number;
  model?: string;
  llm?: import("./types").LLMConfig;
  lyrics_language?: LyricsLanguage;
}): Promise<{ success: boolean; revisedLyrics: string; revisedLine: string }> {
  const systemPrompt =
    REVISE_LINE_SYSTEM_PROMPT +
    buildReviseLineLanguageSuffix(params.lyrics_language ?? "zh");
  const raw = await callLLM({
    system: systemPrompt,
    user: buildReviseLineUserPrompt(
      params.structure,
      params.lyrics,
      params.lineToRevise,
      params.instruction
    ),
    temperature: params.temperature ?? 0.7,
    model: params.model,
    llm: params.llm,
  });

  // Reviser 输出完整歌词，需定位出修改后的单句
  const revisedLyrics = raw.trim();

  // 提取修改后的单句：在完整歌词中查找原句所在行，取对应行
  const revisedLine = extractRevisedLine(params.lyrics, revisedLyrics, params.lineToRevise);

  return { success: true, revisedLyrics, revisedLine };
}

// 给定原歌词、修改后完整歌词、原句，定位修改后的对应单句
// 策略：按行对齐，找到原句所在行索引，取修改后歌词的对应行
function extractRevisedLine(
  originalLyrics: string,
  revisedLyrics: string,
  originalLine: string
): string {
  const originalLines = originalLyrics.split(/\r?\n/);
  const revisedLines = revisedLyrics.split(/\r?\n/);
  const targetTrim = originalLine.trim();
  const idx = originalLines.findIndex((l) => l.trim() === targetTrim);
  if (idx >= 0 && idx < revisedLines.length) {
    return revisedLines[idx].trim();
  }
  // 回退：直接返回原句（前端可不做高亮）
  return targetTrim;
}

// 主题扩写：把简短主题扩展为 100 字左右的创作提示词
export async function expandTheme(params: {
  theme: string;
  temperature?: number;
  model?: string;
  llm?: import("./types").LLMConfig;
}): Promise<string> {
  const raw = await callLLM({
    system: THEME_EXPANDER_SYSTEM_PROMPT,
    user: buildThemeExpanderUserPrompt(params.theme),
    temperature: params.temperature ?? 0.85,
    model: params.model,
    llm: params.llm,
  });
  return raw.trim();
}
