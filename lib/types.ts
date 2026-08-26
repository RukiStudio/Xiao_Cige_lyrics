// 请求级 LLM 配置：优先于环境变量，用于在 WebUI 上动态切换服务商
export interface LLMConfig {
  api_key?: string; // 可选；为空时回退到环境变量或免费免注册端点
  base_url?: string; // 可选；OpenAI 兼容 baseURL
  model?: string; // 可选；模型名
}

// 用户请求
export interface LyricRequest {
  prompt: string; // 提示词，如"中国风 思念 雨夜"
  structure: string; // 词格描述，自由文本
  rounds?: number; // 最大非字数修复迭代轮数，默认 3，范围 1-10（纯字数修复不计入）
  syllable_fix_rounds?: number; // 最大纯字数修复轮数上限，默认 5，范围 1-20
  threshold?: number; // 通过阈值，默认 80，范围 0-100
  temperature?: number; // LLM 温度，默认 0.8
  model?: string; // 可选模型覆盖（向后兼容，优先级低于 llm.model）
  llm?: LLMConfig; // 可选；WebUI 上的服务商配置
  custom_generator_prompt?: string; // 可选；用户自定义 Generator system prompt，覆盖默认
  custom_critic_prompt?: string; // 可选；用户自定义 Critic system prompt，覆盖默认
  critic_strictness?: number; // 可选；Critic 严格程度 1-10，默认 7（偏严格）
  lyrics_language?: "zh" | "en"; // 可选；歌词输出语言：zh=中文（默认），en=英文。中文评审不变
}

// 评分维度（每项 0-10 分）
export interface ScoreDimensions {
  structure_adherence: number; // 词格符合度
  theme_relevance: number; // 主题契合度
  rhyme_rhythm: number; // 押韵与韵律
  fluency: number; // 语言流畅度
  literary_quality: number; // 文学性与意象
  emotion: number; // 情感表达
  commercial_appeal: number; // 商业传唱度
}

// 问题严重程度
export type Severity = "low" | "medium" | "high";

// 单个问题条目
export interface CritiqueIssue {
  location: string; // 问题位置，如"副歌第2句"
  problem: string; // 问题描述
  suggestion: string; // 修改建议
  severity: Severity;
}

// 评审报告
export interface CritiqueReport {
  total_score: number; // 百分制 0-100
  passed: boolean; // 是否达到阈值
  dimensions: ScoreDimensions;
  summary: string; // 总评
  issues: CritiqueIssue[];
  revision_instructions: string; // 可操作的修改指令
}

// 单轮迭代记录
export interface IterationRecord {
  round: number;
  lyrics: string; // 本轮评审前的歌词
  critique: CritiqueReport;
  revised_lyrics?: string; // 本轮修改后的歌词（最后一轮可能没有）
}

// 歌词解读产物：词解 + 风格关键词
export interface LyricInterpretation {
  interpretation: string; // 词解正文（200-400 字）
  style_keywords: string[]; // 3-6 个风格关键词
}

// API 响应状态
export type LyricStatus = "passed" | "max_rounds_reached" | "error";

// API 响应
export interface LyricResponse {
  success: boolean;
  final_lyrics: string;
  final_critique: CritiqueReport;
  status: LyricStatus;
  history: IterationRecord[];
  elapsed_ms: number;
  interpretation?: LyricInterpretation; // 词解与风格关键词（生成完成后填充）
  suggestions?: string[]; // 模型/用户侧建议（如字数修复仍失败时提示更换更高性能模型）
  error?: string;
}

// 单句修改请求
export interface ReviseLineRequest {
  structure: string; // 原词格
  lyrics: string; // 当前完整歌词
  line_to_revise: string; // 待修改的单句原文
  instruction: string; // 修改要求（自然语言）
  temperature?: number; // LLM 温度，默认 0.7
  model?: string; // 可选模型覆盖
  llm?: LLMConfig; // 可选；服务商配置
  lyrics_language?: "zh" | "en"; // 可选；歌词语言（zh 或 en），默认 zh
}

// 单句修改响应
export interface ReviseLineResponse {
  success: boolean;
  revised_lyrics: string; // 修改后的完整歌词
  revised_line: string; // 修改后的单句（便于前端高亮）
  error?: string;
}

// 主题扩写请求
export interface ThemeExpandRequest {
  theme: string; // 简短主题关键词
  temperature?: number; // LLM 温度，默认 0.85
  model?: string; // 可选模型覆盖
  llm?: LLMConfig; // 可选；服务商配置
}

// 主题扩写响应
export interface ThemeExpandResponse {
  success: boolean;
  expanded_prompt: string; // 扩写后的 100 字左右提示词
  error?: string;
}

// LLM 调用参数
export interface LLMCallParams {
  system: string;
  user: string;
  temperature: number;
  model?: string;
  jsonMode?: boolean;
  llm?: LLMConfig; // 请求级配置覆盖
}

// 迭代进度阶段标签
export type ProgressStage =
  | "start" // 开始：参数确认
  | "generating" // 初始生成中
  | "round_start" // 进入第 N 轮
  | "critiquing" // 评审中
  | "critique_done" // 评审完成，输出分数
  | "revising" // 修改中
  | "final_critique" // 最终评审中
  | "interpreting" // 词解生成中
  | "done" // 全部完成，携带完整响应
  | "error"; // 出错

// 流式进度事件（SSE 传输单元）
export interface ProgressEvent {
  type: ProgressStage;
  round?: number; // 当前非字数修复轮次（从 1 开始）
  total_rounds?: number; // 非字数修复最大轮数
  syllable_fix_round?: number; // 当前纯字数修复轮次（独立计数，不计入主轮次）
  syllable_fix_total_rounds?: number; // 纯字数修复最大轮数
  stage?: string; // 可读的阶段文案（中文）
  score?: number; // 评审得分（critique_done 时携带）
  passed?: boolean; // 是否通过阈值（critique_done 时携带）
  threshold?: number; // 通过阈值（start 时携带）
  message?: string; // 附加信息（error 时为错误文案）
  response?: LyricResponse; // 完整响应（done 时携带）
}

// 维度权重，与 Critic System Prompt 保持一致
export const DIMENSION_WEIGHTS = {
  structure_adherence: 0.2,
  theme_relevance: 0.15,
  rhyme_rhythm: 0.15,
  fluency: 0.1,
  literary_quality: 0.15,
  emotion: 0.15,
  commercial_appeal: 0.1,
} as const;

// 维度中文标签，供前端展示
export const DIMENSION_LABELS: Record<keyof ScoreDimensions, string> = {
  structure_adherence: "词格符合度",
  theme_relevance: "主题契合度",
  rhyme_rhythm: "押韵与韵律",
  fluency: "语言流畅度",
  literary_quality: "文学性与意象",
  emotion: "情感表达",
  commercial_appeal: "商业传唱度",
};
