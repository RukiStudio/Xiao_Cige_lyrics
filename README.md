# 小词格 · AI 歌词生成器

纯大模型驱动、可自我迭代、多轮对抗修改、全自动生成高质量歌词的 Web 应用。

核心原则：**所有歌词生成、词格解析、质量评判、修改建议、最终修改均由大模型（LLM）完成**，代码中不编写任何规则式歌词校验逻辑（除 JSON 解析与基础容错外）。

## 项目介绍

小词格通过三个大模型智能体协同工作：

- **Generator（生成代理）**：根据用户提供的词格和提示词创作歌词。
- **Critic（评审代理）**：从词格符合度、主题契合度、押韵韵律、流畅度、文学性、情感、商业传唱度 7 个维度评分，并给出具体到句子的修改建议。
- **Reviser（修改代理）**：根据评审报告修改歌词，保留词格不变。

三者形成「生成 → 评审 → 修改」的多轮对抗循环，直到达到通过阈值或达到最大迭代轮数。

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置大模型（两种方式任选其一）

**方式 A：在 Web 页面直接配置（推荐）**

启动后打开页面，在左侧「大模型服务商」下拉中选择预设并填写 API Key 即可，配置仅保存在你的浏览器，无需改环境变量。

默认预设为 **Pollinations 免费免注册**，可无需任何 Key 直接尝试。

> ⚠️ 现实说明：截至 2026 年，网络上「完全免费 + 免注册 + 稳定可程序化调用」的 LLM API 已基本不存在。Pollinations 的 legacy 匿名端点正在废弃，Node 服务端调用常遇 `402 Payment Required`，体验不稳定。若默认预设失败，请在页面切换到其他预设并填写 API Key（多数国内服务商注册即送免费额度，如智谱 GLM-4-Flash、SiliconFlow、DeepSeek 等）。

内置预设：

| 预设 | 是否需 Key | Base URL | 默认模型 |
|------|-----------|----------|---------|
| Pollinations 免费免注册（可尝试） | 否 | `https://text.pollinations.ai/v1` | `openai` |
| OpenAI | 是 | `https://api.openai.com/v1` | `gpt-4o-mini` |
| DeepSeek 深度求索 | 是 | `https://api.deepseek.com/v1` | `deepseek-chat` |
| Moonshot 月之暗面 | 是 | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 通义千问 | 是 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-turbo` |
| 智谱 GLM | 是 | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-flash` |
| SiliconFlow 硅基流动 | 是 | `https://api.siliconflow.cn/v1` | `Qwen/Qwen2.5-7B-Instruct` |
| 自定义 | 视情况 | 自行填写 | 自行填写 |

> 推荐「注册即送免费额度」的服务商：智谱 GLM（glm-4-flash 免费额度大）、SiliconFlow（注册送）、DeepSeek（便宜）。

**方式 B：通过环境变量配置（服务端默认值）**

复制 `.env.example` 为 `.env`，填入配置：

```bash
cp .env.example .env
```

```env
LLM_API_KEY=sk-xxxxxxxxxxxxxxxx
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
LLM_TIMEOUT_MS=30000
```

页面留空的字段会回退到这些环境变量。

### 3. 启动开发服务器

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可使用。

### 4. 生产构建

```bash
npm run build
npm run start
```

## 环境变量说明

环境变量仅作为服务端默认值；页面填写的配置（API Key / Base URL / 模型）会优先于环境变量生效。

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `LLM_API_KEY` | 否 | — | LLM 服务商的 API Key（页面未填时回退到此） |
| `LLM_BASE_URL` | 否 | `https://api.openai.com/v1` | 兼容 OpenAI 接口的 baseURL |
| `LLM_MODEL` | 否 | `gpt-4o-mini` | 默认使用的模型 |
| `LLM_TIMEOUT_MS` | 否 | `30000` | 单次 LLM 调用超时（毫秒） |

> 即使完全不配置环境变量，只要在页面选择「Pollinations 免费免注册」预设即可直接使用。

## 部署到 Vercel

1. 将本仓库推送到 GitHub/GitLab。
2. 在 Vercel 中导入该项目。
3. 在 Vercel 项目的 **Settings → Environment Variables** 中添加：
   - `LLM_API_KEY`（必填）
   - `LLM_BASE_URL`、`LLM_MODEL`、`LLM_TIMEOUT_MS`（可选）
4. 点击 Deploy。`vercel.json` 已配置 `maxDuration: 120`，满足多轮迭代所需的长超时。
5. 部署完成后访问 Vercel 分配的域名即可使用。

> 注意：Vercel Hobby 计划函数最大执行时间为 60s，多轮迭代可能超时。建议使用 Pro 计划或将 `rounds` 调小。

## 词格格式说明与示例

词格为**自由文本**，由大模型自动理解并遵守。建议按以下格式书写，描述每段的句数、每句字数与押韵模式：

### 示例 1：标准流行歌结构

```
主歌1：4句，每句7字，押韵 AABB
主歌2：4句，每句7字，押韵 AABB
副歌：4句，每句10字，押韵 ABAB
桥段：2句，每句5字，不强制押韵
```

### 示例 2：中国风五言结构

```
主歌：4句，每句5字，押韵 AAAA
副歌：4句，每句7字，押韵 AABB
尾声：2句，每句5字，押韵 AA
```

### 示例 3：自由段落

```
A段：3句，字数不限，押韵不强制
B段：4句，每句8字，押韵 ABAB
高潮：4句，每句12字，押韵 AABB
```

> 段落标记会以方括号形式出现在歌词中（如 `[主歌1]`、`[副歌]`），段落名称需与词格描述一致。

## API 接口

### `POST /api/generate`

请求体：

```json
{
  "prompt": "中国风，思念，伤感，雨夜，离别",
  "structure": "主歌1：4句，每句7字，押韵 AABB；副歌：4句，每句10字，押韵 ABAB",
  "rounds": 3,
  "threshold": 80,
  "temperature": 0.8
}
```

返回：完整歌词 + 迭代历史 + 最终评审报告。详见 `lib/types.ts` 中的 `LyricResponse`。

### `GET /api/health`

返回 `{ "status": "ok", "llm_configured": true }`，用于检查 LLM 是否配置成功。

## 项目结构

```
lyrics-generator/
├── app/
│   ├── api/
│   │   ├── generate/route.ts      # POST /api/generate
│   │   └── health/route.ts        # GET /api/health
│   ├── page.tsx                   # 主页面
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── InputPanel.tsx             # 输入区
│   ├── IterationHistory.tsx       # 迭代历史时间线
│   ├── FinalLyrics.tsx            # 最终歌词卡片
│   ├── ScoreDisplay.tsx           # 评分展示
│   └── LoadingState.tsx           # 加载状态
├── lib/
│   ├── llm.ts                     # LLM 调用封装 + JSON 容错
│   ├── prompts.ts                 # 所有 system prompt
│   ├── orchestrator.ts            # 多智能体迭代循环
│   ├── validation.ts              # 请求参数校验
│   └── types.ts                   # 类型定义
├── .env.example
├── vercel.json
├── package.json
├── tailwind.config.ts
└── README.md
```
