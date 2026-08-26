// 词格高级编辑器
// 标记语言规则（面向用户）：
//   - 输入「汉字」或「0」表示一个音节（普通音节）
//   - 输入「1」表示需要强调的重音音节
//   - 输入「/」表示停顿（占用节奏位置，但不计入字数）
//   - 输入「+」表示延音（与前一个音节共享同一个字/音，占用音符但不占用字数）
//   - 每一行表示一个乐句
// 本模块把用户的分行输入（汉字歌词 或 0/1//+/ 节奏标记 或 二者混合）
// 解析为标准化词格描述文本，供 LLM 读取并遵守。

export interface PhraseStructure {
  lineIndex: number; // 乐句序号，从 1 开始
  raw: string; // 原始输入行（去首尾空白后）
  syllables: number; // 音节/字数总数（汉字 + 0 + 1 计为音节；延音 + 和停顿 / 都不计入字数）
  notes: number; // 音符位置总数（音节数 + 延音数，每个 + 额外占一个音符位）
  accents: number[]; // 重音音节位置（按字数从 1 开始计数）
  pauses: number[]; // 停顿位置：在第几个音节（字数序号）之后插入停顿
  holds: number[]; // 延音位置：在第几个音节（字数序号）之后插入 "+" 延音
  hasLyric: boolean; // 是否含汉字原文
  lyricText: string; // 提取出的汉字原文
}

export interface ConvertResult {
  ok: boolean;
  phrases: PhraseStructure[];
  structure: string; // 转化后的标准化词格描述
  error?: string;
}

// 判断是否为 CJK 汉字
function isHan(ch: string): boolean {
  const code = ch.codePointAt(0);
  if (code === undefined) return false;
  // CJK 统一表意文字基本区 + 扩展A（常见范围）
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf)
  );
}

// 解析单行，返回结构化乐句信息
function parseLine(rawLine: string, lineIndex: number): PhraseStructure {
  const result: PhraseStructure = {
    lineIndex,
    raw: rawLine,
    syllables: 0,
    notes: 0,
    accents: [],
    pauses: [],
    holds: [],
    hasLyric: false,
    lyricText: "",
  };

  for (const ch of rawLine) {
    if (isHan(ch)) {
      result.syllables += 1;
      result.notes += 1;
      result.hasLyric = true;
      result.lyricText += ch;
    } else if (ch === "0") {
      result.syllables += 1;
      result.notes += 1;
    } else if (ch === "1") {
      result.syllables += 1;
      result.notes += 1;
      result.accents.push(result.syllables);
    } else if (ch === "/") {
      // 停顿不计入音节数，记录在第几个音节之后
      result.pauses.push(result.syllables);
    } else if (ch === "+") {
      // 延音：占用一个音符但不占用字数；记录在第几个音节之后
      result.holds.push(result.syllables);
      result.notes += 1;
    }
    // 其他字符（空格、标点等）忽略，不参与词格计算
  }

  return result;
}

// 把单个乐句渲染为可读的节奏串，例如 "音-音-重-延-停-音"
function renderRhythmString(p: PhraseStructure): string {
  if (p.syllables === 0) return "（空）";
  const tokens: string[] = [];
  const pauseSet = new Set(p.pauses);
  const holdSet = new Set(p.holds);
  const accentSet = new Set(p.accents);
  for (let i = 1; i <= p.syllables; i++) {
    tokens.push(accentSet.has(i) ? "重" : "音");
    // 延音排在停顿之前（延音是当前音节的延续，停顿是音符之间的空白）
    if (holdSet.has(i)) {
      tokens.push("延");
    }
    if (pauseSet.has(i)) {
      tokens.push("停");
    }
  }
  return tokens.join("-");
}

// 主转化函数：把分行输入解析为标准化词格描述
export function convertStructuredInput(input: string): ConvertResult {
  if (!input || !input.trim()) {
    return { ok: false, phrases: [], structure: "", error: "输入为空" };
  }

  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { ok: false, phrases: [], structure: "", error: "没有有效的非空行" };
  }

  const phrases = lines.map((line, idx) => parseLine(line, idx + 1));

  // 校验：至少有一个音节
  const totalSyllables = phrases.reduce((s, p) => s + p.syllables, 0);
  const totalHolds = phrases.reduce((s, p) => s + p.holds.length, 0);
  if (totalSyllables === 0) {
    return {
      ok: false,
      phrases,
      structure: "",
      error: "未识别到任何音节（汉字或 0 或 1），请检查输入",
    };
  }

  // 构造标准化词格描述文本
  const parts: string[] = [];
  parts.push("【词格（高级编辑）】");
  parts.push(
    `标记规则：0/汉字=普通音节（占1字数+1音符），1=重音音节（占1字数+1音符），/=停顿（占节奏空位，不计字数），+=延音（与前一音节同字、唱时拉长，占用1个额外音符但不占用字数），每行=一个乐句。`
  );
  parts.push(
    `共 ${phrases.length} 个乐句，合计 ${totalSyllables} 个音节（字数）、${totalHolds} 个延音位、${totalSyllables + totalHolds} 个音符位置。`
  );
  parts.push("");

  phrases.forEach((p) => {
    const rhythm = renderRhythmString(p);
    const accentStr =
      p.accents.length > 0 ? `重音位置=[${p.accents.join(",")}]` : "无重音";
    const pauseStr =
      p.pauses.length > 0
        ? `停顿位置=第${p.pauses.join("、")}音节后`
        : "无停顿";
    const holdStr =
      p.holds.length > 0
        ? `延音位置=第${p.holds.join("、")}音节后（对应位置歌词请用长音处理：中文可用"呀/哦/啊"拉长或重复字尾，英文可用元音拉长 "oooh / aaaah / yeaaah"）`
        : "无延音";
    const lyricStr = p.hasLyric ? `原文：${p.lyricText}` : "（纯节奏标记）";

    parts.push(
      `乐句${p.lineIndex}：音节(字数)=${p.syllables}，延音=${p.holds.length}，音符位=${p.notes}，${accentStr}，${pauseStr}，${holdStr}，${lyricStr}`
    );
    parts.push(`  节奏串：${rhythm}`);
  });

  parts.push("");
  parts.push(
    "生成要求：严格遵循上述每个乐句的音节（字数）数，不要把延音位当成额外的字数。延音位（+）：中文请在对应位置把前一个字唱长（或用呀/哦/啊/～/重复元音/拉长字尾体现长音）；英文请把前一个词的末尾元音拉长（如 yeaaah、oooh、neeeever、hold ooon），**不要**为延音额外增加新的单词或音节。停顿处可使用气口或短促断句。"
  );

  return {
    ok: true,
    phrases,
    structure: parts.join("\n"),
  };
}

// 汉字歌词 → 节奏标记（0/1//+/）
// 每个汉字转为 "0"，保持原有换行；非汉字字符（空格/标点）转为 "/" 表示停顿
export function lyricsToRhythmTags(input: string): string {
  if (!input || !input.trim()) return "";
  return input
    .split(/\r?\n/)
    .map((line) =>
      Array.from(line)
        .map((ch) => {
          if (isHan(ch)) return "0";
          if (ch === "0") return "0";
          if (ch === "1") return "1";
          if (ch === "/") return "/";
          if (ch === "+") return "+";
          // 空格直接忽略
          if (/\s/.test(ch)) return "";
          // 中英文标点转为停顿
          if (/[，。、；：！？""''…—\-,.!?;:]/.test(ch)) return "/";
          return "";
        })
        .join("")
    )
    .filter((l) => l.length > 0)
    .join("\n");
}

// 节奏标记（0/1//+/）→ 汉字占位
// "0" → "音"，"1" → "重"，"/" → "｜"，"+" → "～"，保持换行
export function rhythmTagsToLyrics(input: string): string {
  if (!input || !input.trim()) return "";
  return input
    .split(/\r?\n/)
    .map((line) =>
      Array.from(line)
        .map((ch) => {
          if (ch === "0") return "音";
          if (ch === "1") return "重";
          if (ch === "/") return "｜";
          if (ch === "+") return "～";
          return ch;
        })
        .join("")
    )
    .filter((l) => l.length > 0)
    .join("\n");
}
