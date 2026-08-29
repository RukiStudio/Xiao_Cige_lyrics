import OpenAI from "openai";
import type { LLMCallParams, LLMConfig } from "./types";

// 环境配置（回退用）
function getEnvApiKey(): string | undefined {
  return process.env.LLM_API_KEY;
}

export function isLLMConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY);
}

export function getDefaultModel(): string {
  return process.env.LLM_MODEL || "gpt-4o-mini";
}

export function getDefaultBaseURL(): string | undefined {
  return process.env.LLM_BASE_URL || undefined;
}

export function getTimeoutMs(): number {
  const raw = process.env.LLM_TIMEOUT_MS;
  // 默认 60s：免费/慢模型生成长歌词常需 20-40s，30s 易误杀。
  // 配合 SSE keepalive，单次慢调用期间连接仍保持活跃，不会 idle 超时。
  const parsed = raw ? parseInt(raw, 10) : 60000;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60000;
}

// 自定义错误，便于上层区分配置错误与调用错误
export class LLMConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

export class LLMCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMCallError";
  }
}

// 解析本次调用使用的配置：请求级优先，回退环境变量
interface ResolvedConfig {
  apiKey: string;
  baseURL: string | undefined;
  model: string;
}

function resolveConfig(llm?: LLMConfig, modelOverride?: string): ResolvedConfig {
  const envKey = getEnvApiKey();
  const apiKey = (llm?.api_key && llm.api_key.trim()) || envKey || "";
  const baseURL = (llm?.base_url && llm.base_url.trim()) || getDefaultBaseURL();
  const model =
    (modelOverride && modelOverride.trim()) ||
    (llm?.model && llm.model.trim()) ||
    getDefaultModel();

  if (!apiKey && !baseURL) {
    throw new LLMConfigError("未配置 API Key 与 Base URL，请在页面填写服务商配置或设置环境变量 LLM_API_KEY");
  }
  return { apiKey, baseURL, model };
}

// 浏览器拟人化 header：规避部分服务商（如智谱 GLM）对 SDK 直连的风控。
// OpenAI SDK 默认 User-Agent 为 "OpenAI/JS x.x"，易被网关识别为机器人流量，
// 返回中文"当前模型访问量过大"等文案。注入常见浏览器 header 使请求更像真人访问。
// OpenRouter 额外要求 HTTP-Referer / X-Title 以标识来源应用。
function buildBrowserLikeHeaders(baseURL?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
  };
  // OpenRouter 推荐请求头：标识来源应用，有助于避免限流
  if (baseURL && /openrouter\.ai/i.test(baseURL)) {
    headers["HTTP-Referer"] = "https://xiaocige.app";
    headers["X-Title"] = "小词格歌词生成器";
  }
  return headers;
}

// 注意：不覆盖 OpenAI SDK 的默认 fetch。
// Electron 在 ELECTRON_RUN_AS_NODE 模式下，内嵌 Node.js 的全局 fetch（基于 undici）
// 在 HTTPS 请求时可能不可靠（TLS 握手失败、连接被重置等），导致 "Failed to fetch"。
// OpenAI SDK 在 Node.js 环境下默认使用 node-fetch v2（基于 node:http/https），
// 不依赖全局 fetch，在 Electron 内嵌 Node.js 中更稳定。
// 错误信息增强改在 callLLM 的 catch 块中处理。

// 按需创建客户端（每次调用配置可能不同，故不缓存单例）
function createClient(cfg: ResolvedConfig): OpenAI {
  return new OpenAI({
    apiKey: cfg.apiKey || "unused", // 免费免注册端点不需要 key，但 SDK 要求非空
    baseURL: cfg.baseURL || undefined,
    timeout: getTimeoutMs(),
    maxRetries: 0, // SDK 内置重试不便于控制退避与文案识别，改在 callLLM 外层手动重试
    defaultHeaders: buildBrowserLikeHeaders(cfg.baseURL),
  });
}

// 增强 APIConnectionError 的错误信息（SDK 默认只报 "Connection error." 无细节）
function enhanceConnectionError(err: Error): Error {
  const msg = err.message || "";
  // 仅增强连接类错误，避免误改业务错误
  if (/connection error|fetch fail|network|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|请求超时|无响应|自动中断/i.test(msg)) {
    const enhanced = new Error(
      `Connection error (fetch 失败: ${msg})。请检查网络连接、DNS 解析、代理设置，以及服务商 baseURL 是否可访问。`
    );
    (enhanced as Error & { cause?: unknown }).cause = err;
    return enhanced;
  }
  return err;
}

// 判断错误是否可能由 response_format 引起（部分服务商/免费端点不支持 JSON 模式）
function isJsonModeUnsupported(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    /response_format|json_object|json mode|not support|unsupported|400|bad request/.test(msg) &&
    !/timeout|aborted/.test(msg)
  );
}

// 判断是否为限流/风控类错误（智谱 GLM 返回中文"访问量过大"文案，HTTP 可能 429/500/200带错误体）
function isRateLimitedOrThrottled(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return (
    /访问量过大|当前模型|稍后再试|请稍后|频繁|rate.?limit|429|too many requests|throttl|overload|capacity|busy/.test(
      msg
    )
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MAX_RETRY = 5; // 超时/限流类错误最多重试 5 次

// 判断是否为可重试的网络/连接类错误（超时、连接中断、网络不可达等）
export function isRetryableNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return /timeout|timed out|etimedout|esockettimedout|request timed out|connection timed out|deadline exceeded|econnreset|socket hang up|fetch failed|network error|connection error|connection refused|econnrefused|enotfound|eai_again|econnaborted|disconnected|getaddrinfo|请求超时|无响应|自动中断/.test(
    msg
  );
}

// 核心 LLM 调用函数
export async function callLLM({
  system,
  user,
  temperature,
  model,
  jsonMode = false,
  llm,
}: LLMCallParams): Promise<string> {
  const cfg = resolveConfig(llm, model);

  // doSingleCall：单次实际请求；doCallWithRetry：限流时指数退避重试
  const doSingleCall = async (withJsonMode: boolean): Promise<string> => {
    // 每次重试都新建客户端（保证 header 一致，避免连接池复用影响）
    const openai = createClient(cfg);

    // 兜底超时：用 AbortController 确保请求不会无限挂起
    // SDK 自身的 timeout 参数在某些场景（连接已建立但服务端长时间不返回数据）可能不触发，
    // 此处用 AbortSignal 做第二道防线
    const timeoutMs = getTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const completion = await openai.chat.completions.create(
        {
          model: cfg.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          temperature,
          ...(withJsonMode ? { response_format: { type: "json_object" } } : {}),
        },
        { signal: controller.signal }
      );

      const content = completion.choices?.[0]?.message?.content;
      if (!content) {
        throw new LLMCallError("LLM 返回了空内容");
      }
      return content.trim();
    } catch (err) {
      // AbortController 触发的超时
      if (err instanceof Error && (err.name === "AbortError" || /aborted/i.test(err.message))) {
        throw new LLMCallError(
          `请求超时（${timeoutMs / 1000}s 内无响应，已自动中断）。可能原因：模型推理过慢、网络不稳定、服务商内部排队。将自动重试。`
        );
      }
      // 增强连接类错误的错误信息（SDK 默认 "Connection error." 无细节）
      if (err instanceof Error) {
        throw enhanceConnectionError(err);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  };

  const doCallWithRetry = async (withJsonMode: boolean): Promise<string> => {
    let lastErr: unknown;
    // 首次调用 + 最多 MAX_RETRY 次重试 = MAX_RETRY + 1 次总调用
    for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
      try {
        return await doSingleCall(withJsonMode);
      } catch (err) {
        lastErr = err;
        // 配置错误不重试
        if (err instanceof LLMConfigError) throw err;

        if (err instanceof Error) {
          // 鉴权错误不重试
          if (/401|authentication|api key|unauthor/i.test(err.message)) {
            throw new LLMConfigError("LLM API Key 无效或未授权，请检查页面填写的 Key 或环境变量 LLM_API_KEY");
          }
          // 免费免注册端点常见：额度受限或 legacy API 废弃（不重试）
          if (/402|payment required/i.test(err.message)) {
            const isPollinations = /pollinations/i.test(cfg.baseURL || "");
            const hint = isPollinations
              ? "Pollinations 免费匿名额度受限或 legacy API 废弃中。建议注册获取 Key，或在页面切换到其他服务商（如智谱 GLM、SiliconFlow 注册送额度）。"
              : "该服务商返回 402 额度不足，请检查账户余额或更换服务商。";
            throw new LLMCallError(`LLM 调用失败: ${err.message}。${hint}`);
          }
          // 可重试的网络错误或限流/风控：指数退避重试，最多 MAX_RETRY（5）次
          const isNetworkErr = isRetryableNetworkError(err);
          const isRateLimited = isRateLimitedOrThrottled(err);
          if (attempt < MAX_RETRY && (isNetworkErr || isRateLimited)) {
            const reason = isNetworkErr ? "网络/连接错误" : "限流/风控";
            const base = 1000 * 2 ** attempt; // 1s, 2s, 4s, 8s, 16s
            const jitter = Math.random() * 600;
            const wait = Math.min(base + jitter, 16000);
            // 打印详细错误信息便于排查（包括 cause/stack）
            const cause = (err as Error & { cause?: unknown }).cause;
            console.warn(
              `[llm] ${reason}，第 ${attempt + 1}/${MAX_RETRY} 次重试，等待 ${Math.round(wait)}ms：${err.message}`,
              cause ? { cause: cause instanceof Error ? cause.message : String(cause) } : ""
            );
            await sleep(wait);
            continue;
          }
          // 不可重试的错误，直接抛出（附带 cause 信息）
          const cause = (err as Error & { cause?: unknown }).cause;
          const causeStr = cause instanceof Error ? ` (cause: ${cause.message})` : "";
          throw new LLMCallError(`LLM 调用失败: ${err.message}${causeStr}`);
        }
        throw new LLMCallError("LLM 调用失败: 未知错误");
      }
    }
    // 重试用尽
    const msg = lastErr instanceof Error ? lastErr.message : "未知错误";
    throw new LLMCallError(
      `LLM 调用失败（重试 ${MAX_RETRY} 次后仍失败）: ${msg}。建议稍后再试、降低迭代轮数，或在页面切换服务商。`
    );
  };

  try {
    return await doCallWithRetry(jsonMode);
  } catch (err) {
    // 如果是 JSON 模式引发的兼容问题，回退为不带 response_format 的请求
    if (jsonMode && err instanceof Error && isJsonModeUnsupported(err)) {
      return await doCallWithRetry(false);
    }
    throw err;
  }
}

// JSON 解析容错：
// 1. 直接 JSON.parse
// 2. 去除首尾空白
// 3. 提取 ```json ... ``` 代码块
// 4. 正则提取第一个 { 到最后一个 }
// 5. 返回 null 表示解析失败，由上层决定是否重试
export function safeParseJSON<T = unknown>(raw: string): T | null {
  if (!raw) return null;

  // 1. 直接尝试
  try {
    return JSON.parse(raw) as T;
  } catch {
    // 继续
  }

  const trimmed = raw.trim();

  // 2. 去除 ```json ... ``` 或 ``` ... ``` 代码块
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as T;
    } catch {
      // 继续
    }
  }

  // 3. 正则提取第一个 { 到最后一个 }
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const extracted = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(extracted) as T;
    } catch {
      // 继续
    }
  }

  return null;
}
