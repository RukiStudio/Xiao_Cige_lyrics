// 服务商预设：前端下拉选择，后端也可引用作为默认配置
// 标注 free_no_key 的为无需注册即可使用的免费端点

export interface ProviderPreset {
  id: string; // 唯一标识
  name: string; // 显示名称
  base_url: string; // OpenAI 兼容 baseURL
  model: string; // 默认模型
  apiKeyRequired: boolean; // 是否必须填 API Key
  freeNoKey?: boolean; // 是否为免费免注册端点
  website?: string; // 获取 Key 的网址
  note?: string; // 备注
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "pollinations",
    name: "Pollinations 免费免注册（可尝试）",
    base_url: "https://text.pollinations.ai/v1",
    model: "openai",
    apiKeyRequired: false,
    freeNoKey: true,
    website: "https://pollinations.ai",
    note: "无需注册即可尝试，但其 legacy 匿名 API 正在废弃，Node 服务端调用常遇 402 额度限制，不稳定。若失败请改用其他预设并填写 Key。",
  },
  {
    id: "openai",
    name: "OpenAI",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    apiKeyRequired: true,
    website: "https://platform.openai.com/api-keys",
    note: "支持 JSON 模式，评审稳定",
  },
  {
    id: "deepseek",
    name: "DeepSeek 深度求索",
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKeyRequired: true,
    website: "https://platform.deepseek.com/api_keys",
    note: "国内可直连，性价比高",
  },
  {
    id: "moonshot",
    name: "Moonshot 月之暗面 (Kimi)",
    base_url: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    apiKeyRequired: true,
    website: "https://platform.moonshot.cn/console/api-keys",
    note: "中文创作表现优秀",
  },
  {
    id: "qwen",
    name: "通义千问 阿里云",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-turbo",
    apiKeyRequired: true,
    website: "https://dashscope.console.aliyun.com/apiKey",
    note: "OpenAI 兼容模式",
  },
  {
    id: "glm",
    name: "智谱 GLM",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4-flash",
    apiKeyRequired: true,
    website: "https://open.bigmodel.cn/usercenter/apikeys",
    note: "glm-4-flash 免费额度较多",
  },
  {
    id: "siliconflow",
    name: "SiliconFlow 硅基流动",
    base_url: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-7B-Instruct",
    apiKeyRequired: true,
    website: "https://cloud.siliconflow.cn/account/ak",
    note: "聚合多模型，注册送额度",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "google/gemini-flash-1.5",
    apiKeyRequired: true,
    website: "https://openrouter.ai/keys",
    note: "聚合 200+ 模型（OpenAI/Claude/Gemini/Llama 等），模型名格式为 provider/model，部分模型有免费额度",
  },
  {
    id: "sensenova",
    name: "商汤日日新 SenseNova（公测免费）",
    base_url: "https://token.sensenova.cn/v1",
    model: "sensenova-6.8-flash-lite",
    apiKeyRequired: true,
    website: "https://platform.sensenova.cn/",
    note: "公测期 0 元/月，每 5 小时 1500 次调用；OpenAI 兼容协议，可选模型 sensenova-6.8-flash-lite / deepseek-v4-flash / glm-5.2",
  },
  {
    id: "custom",
    name: "自定义 (OpenAI 兼容)",
    base_url: "",
    model: "",
    apiKeyRequired: false,
    note: "填写任意 OpenAI 兼容的 baseURL 与模型",
  },
];

export const DEFAULT_PRESET_ID = "pollinations";

export function getPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}
