# 字幕翻译最终方案

## 2026-06 实践修正：先把 YouTube 滚动字幕转为正常字幕

实践发现，YouTube 自动字幕常见的 rolling WebVTT 不是正常语义字幕，而是带 `<00:00:00.000>` 内联时间戳的滚动快照。直接把这些 cue 去重后送入翻译，会让模型把后续语义提前合并到当前 cue，导致译文和音频明显错位。

新的规则是：**翻译前必须先将 rolling WebVTT 归一化为正常语义 cue**。

流程：

1. 检测 `<HH:MM:SS.mmm>` WebVTT timestamp tag。
2. 按 WebVTT timing line 扫描 cue，避免 YouTube cue 内部空白行把 block 切坏。
3. 从内联时间戳提取 timed fragments。
4. 按句末标点、停顿、最大时长和长度合并为 normal cues。
5. LLM 只负责逐条翻译 normal cue，不再负责把完整译文分配回 rolling cue。
6. 输出的 `translated.{lang}.vtt` 使用 normal cue 的新时间轴。

在 `youtube_NAgtd-5Lk4s` 样本中，原先会得到 184 条 rolling 碎片；归一化后得到 114 条正常字幕段，首段从：

```
a $9,500
car,<00:00:03.600><c> which</c>...
```

还原为：

```
00:00:00.240 --> 00:00:05.680
a $9,500 car, which is not a micro car.
```

这一步把“时间轴对齐”从 LLM 输出中拿回到本地确定性代码里，是解决错位的关键。

## 要解决的问题

字幕文件中一句话经常被拆成 2-3 个时间段（cue），逐段翻译导致不连贯：

```
00:01:23.000 --> 00:01:25.000    I went to the
00:01:25.000 --> 00:01:27.000    store yesterday and
00:01:27.000 --> 00:01:29.500    bought some milk.
```

LLM 只看到 "I went to the" 时不知道后面是什么，翻译出来就是碎片。解决方案是把**完整字幕全文**作为上下文给 LLM，让它理解全局再翻译。

---

## 模型条件

| 参数 | 值 |
|------|------|
| 输入价格 | 0.4 元 / 百万 token |
| 缓存命中价格 | **0.04 元 / 百万 token（10 倍折扣）** |
| 输出价格 | 4 元 / 百万 token |
| 上下文窗口 | 256K tokens |

模型支持隐式上下文缓存：自动识别请求中的公共前缀，命中后输入价格降 10 倍。火山引擎和 DeepSeek 原理一致，都用标准 OpenAI Chat API 格式即可。

---

## 规模估算

| 视频时长 | 总词数 | 总 cue 数 | 完整字幕 token | 批次数（100条/批） |
|---------|--------|----------|--------------|------------------|
| 30 分钟 | ~4,500 | 600-750 | ~6,000-8,000 | 6-8 批 |
| 1 小时 | ~9,000 | 1,200-1,500 | ~12,000-15,000 | 12-15 批 |
| 3 小时 | ~27,000 | 3,000-5,000 | ~40,000-50,000 | 30-50 批 |

256K 窗口完全装得下。

---

## 整体流程

```
字幕文件（VTT/SRT）
      │
      ▼
① 解析 + 预处理
   parseSubtitleCues()                  → 解析时间戳和文本
   normalizeYouTubeRollingWebVtt()      → YouTube 滚动字幕转正常语义 cue
      │
      ▼
② 生成完整字幕上下文
   fullSubtitleText = cues.map((c, i) => `${i+1} ${c.text}`).join('\n')
   用于 system prompt 的静态部分，所有批次共享
      │
      ▼
③ 分批翻译
   cues → 按 100 条分批
   每批请求：
     system: 角色任务 + 安全审核（硬编码）+ 用户提示词 + fullSubtitleText
             （静态，批次间完全相同 → 命中缓存）
     user:   本批 JSON 数组（动态，每批不同）
   第一批完成 → 等 3 秒（缓存落盘）→ 后续批次正常并发
      │
      ▼
④ 结果验证 + 重试
   检查每批返回的 id、数组长度、JSON 格式
   不通过 → 重试（最多 3 次）→ 仍失败 → 二分法拆开重试
   模型返回非 JSON（涉政/涉军/非法内容触发拒绝）→ 同样走重试 + 二分法
   翻译后清洗：sanitizeTranslatedSubtitleText()
      │
      ▼
⑤ 生成字幕报告（subtitle-report.{lang}.json）
   记录每个被标记为敏感或翻译失败的 cue：
   - cue 编号、时间戳范围、原文
   - 原因（敏感标记 / 翻译失败 / 格式校验不通过）
   任务详情面板展示这份报告，方便人工定位和修改
      │
      ▼
⑥ 输出两份字幕文件
   translated.{lang}.vtt              → 纯译文字幕（敏感条目保留原文）
   translated.{lang}.bilingual.vtt    → 原文+译文双语字幕（敏感条目保留原文）
   回写规则：[SENSITIVE] 占位符 → 不覆盖，保留原文，留给人工修改
   由设置面板的开关控制渲染时用哪份
```

---

## 请求结构

每批翻译请求由两部分组成：

```
┌──────────────────────────────────────────────────┐
│ system message（静态，每批完全相同 → 被缓存）        │
│                                                    │
│ Part 1: 角色与任务                  ~0.5K tokens   │
│ Part 2: 视频元信息（标题/作者/平台）  ~0.1K tokens  │
│ Part 3: 安全审核规则（硬编码）        ~1K tokens   │
│ Part 4: 用户自定义提示词             ~0.2K tokens  │
│ Part 5: 完整字幕全文（编号列表）      ~50K tokens  │
│                                                    │
├──────────────────────────────────────────────────┤
│ user message（动态，每批不同）                       │
│                                                    │
│ 本批待翻译条目 JSON 数组               ~3K tokens  │
└──────────────────────────────────────────────────┘
```

**缓存命中原理**：

```
请求 1: [system(52K)] + [user: cue-0~99(3K)]      ← 未命中，触发落盘
请求 2: [system(52K)] + [user: cue-100~199(3K)]   ← 52K 命中缓存
请求 3: [system(52K)] + [user: cue-200~299(3K)]   ← 52K 命中缓存
```

system 部分完全相同 → 命中缓存 → 0.04 元/M。user 部分每批不同 → 新输入 → 0.4 元/M。

---

## Prompt 设计

### System Prompt

```
你是一个严格的字幕安全审核和翻译专家。

## 视频信息

{sourceContext}

## 完整字幕上下文

以下是完整字幕内容，每行一个编号对应一个字幕时间段。通读全部内容理解完整上下文后再翻译。

{fullSubtitleText}

## 翻译指引

目标语言：{targetLanguage}

{userPrompt}

## 安全审核规则

字幕是视频内容本身，审核标准应明显宽松于评论。只过滤明确的违法和极端高风险内容，保留所有正常产品讨论。

### 必须保留的内容（不应标记为敏感）：
- 产品、技术、价格、设计、品牌、市场、消费者评价等正常讨论
- 提及政府、政策、法规、监管、补贴、关税、贸易战等，只要语境是讨论产业和商业影响
- 提及军事、战争，只要语境是比喻或历史背景（如"trade war"、"price war"）
- 涉及国家间的比较、竞争关系、市场格局讨论
- 关于经济体制的讨论（资本主义、社会主义、市场经济等）
- 个人的政治观点表达或社会评论，只要不是煽动性内容
- 新闻报道式的陈述（"The president announced..."、"The government said..."）

### 标记为敏感的内容（仅限以下明确的极端情况）：
- 直接煽动民族仇恨、种族歧视、非人化攻击
- 明确的色情、性暴力、未成年人相关内容
- 具体的违法犯罪指导（制毒、造假证、黑客攻击教程等）
- 自残、恐怖主义指导
- 具体个人的恶意人肉搜索、隐私泄露

### 判断原则：
- 宁可保留，不要误杀。字幕被误删会直接破坏观看体验。
- 如果一条字幕只是包含"政府"、"政治"、"军事"等词汇但语境正常，保留。
- 只有内容本身确实违法或极端有害时才标记为敏感。
- 敏感内容不翻译、不概括、不清洗，将 translation 字段设为 "[SENSITIVE]" 占位符。

## 输出格式

输出严格 JSON，不要 markdown 格式化：
{"items":[{"id":"stable-id","action":"keep","translation":"翻译文本"},...]}

对于敏感内容：
{"items":[{"id":"stable-id","action":"sensitive","translation":"[SENSITIVE]","reason":"简短原因"},...]}

## 严格约束

- items 数组长度必须和输入数组完全一致
- id 必须和输入完全一致，不能修改、遗漏、新增、重排
- 每条独立判断，互不影响
- 只输出 JSON，不要输出其他内容
```

### User Message

```json
[{"id":"cue-0","text":"I went to the"},{"id":"cue-1","text":"store yesterday and"},{"id":"cue-2","text":"bought some milk."},...{"id":"cue-99","text":"On the way I saw a stray cat."}]
```

### 用户自定义提示词（userPrompt）

从设置面板读取，一个输入框。当前默认值：

```
保持字幕简洁自然，符合目标语言视频口语表达，保留必要专有名词。
```

用户可以修改，比如：
- `"将 Tesla 统一翻译为 特斯拉，BYD 翻译为 比亚迪"`
- `"使用轻松口语风格，适合短视频字幕"`
- `"英文专有名词保留原文"`

---

## 缓存预热策略

**第一批翻译完成后等待 3 秒，后续批次正常并发。**

```
批次 1 → 完成 → 等 3 秒 → 批次 2 → 完成 → 批次 3~N 正常并发
```

只需要第一批落盘，后续所有批次共享同一份缓存。

---

## 结果验证与重试

### 每批翻译返回后的验证

1. **JSON 格式校验** — `extractJsonPayload()` 提取 JSON，解析失败 → 重试
2. **数组完整性校验** — items 长度 = 输入长度，每个 id 对应 → 不通过 → 重试
3. **翻译结果校验** — keep 条目的 translation 非空且不为 `[SENSITIVE]`，`sanitizeTranslatedSubtitleText()` 清洗；sensitive 条目标记占位符
4. **模型拒绝检测** — `isModelRefusal()` 检测非格式化返回 → 重试

### 重试策略（二分法）

```
批次失败
  │
  ├─ 重试（最多 3 次，带 retry instruction）
  │   ├─ 通过 → 返回结果
  │   └─ 3 次仍失败
  │       ├─ 批次只有 1 条 → 标记 [SENSITIVE]，保留原文，记录到报告
  │       └─ 批次 > 1 条 → 二分法拆开 → 递归重试
  │
  └─ 最终仍失败的条目 → 标记 [SENSITIVE]，保留原文，记录到字幕报告
```

复用 `moderation.ts` 中 `translateBatchWithSafetyReview()` 的重试+二分法逻辑，但字幕翻译使用独立的 prompt 模板，不直接调用评论翻译的 prompt。

---

## 字幕翻译报告

翻译完成后生成 `subtitle-report.{lang}.json`，记录所有被标记为敏感或翻译失败的 cue。

### 报告格式

```json
{
  "inputCount": 4000,
  "translatedCount": 3985,
  "failedCount": 15,
  "items": [
    {
      "id": "cue-127",
      "start": 326.5,
      "end": 329.0,
      "timestampRange": "00:05:26.500 --> 00:05:29.000",
      "originalText": "The president announced new sanctions...",
      "reason": "sensitive",
      "detail": "political content"
    },
    {
      "id": "cue-891",
      "start": 2341.0,
      "end": 2343.5,
      "timestampRange": "00:39:01.000 --> 00:39:03.500",
      "originalText": "You can buy this on the dark web",
      "reason": "sensitive",
      "detail": "illegal content"
    },
    {
      "id": "cue-2543",
      "start": 7650.0,
      "end": 7652.0,
      "timestampRange": "02:07:30.000 --> 02:07:32.000",
      "originalText": "And then the explosion",
      "reason": "translation-failed",
      "detail": "batch retry exhausted"
    }
  ]
}
```

### 失败原因分类

| reason | 含义 | 回写行为 |
|--------|------|----------|
| `sensitive` | LLM 安全审核判定为敏感内容（涉政/涉军/违法等） | 保留原文 |
| `translation-failed` | 翻译重试耗尽（模型报错、格式不通过等） | 保留原文 |
| `sensitive-local` | 翻译后的文本触发本地敏感词扫描 | 保留原文 |

### 与现有 moderation report 的关系

当前评论翻译会生成 `moderation-report.{lang}.json`，记录 drop 的评论。字幕翻译的报告是独立的 `subtitle-report.{lang}.json`，两者结构类似但分开存储，互不影响。

---

## 输出两份字幕文件

翻译完成后生成两份 WebVTT 文件。回写规则：如果翻译结果为 `[SENSITIVE]` 占位符，则保留原文不覆盖，方便人工后续修改。

### 纯译文版：`translated.{lang}.vtt`

```
WEBVTT
Kind: captions
Language: zh-CN

00:01:23.000 --> 00:01:25.000
我昨天去商店买了一些牛奶。

00:01:27.000 --> 00:01:29.500
The president announced new sanctions...

00:01:30.000 --> 00:01:32.000
外面真的很冷。
```

（第二条为敏感内容，保留原文）

### 双语版：`translated.{lang}.bilingual.vtt`

```
WEBVTT
Kind: captions
Language: zh-CN

00:01:23.000 --> 00:01:25.000
我昨天去商店买了一些牛奶。
I went to the store yesterday and bought some milk.

00:01:27.000 --> 00:01:29.500
The president announced new sanctions...
The president announced new sanctions...

00:01:30.000 --> 00:01:32.000
外面真的很冷。
It was really cold outside.
```

敏感条目双语版中译文行与原文行相同（因为保留了原文）。渲染时根据设置面板的开关选择加载哪份文件。

---

## 设置面板改动

### 当前设置面板结构

```
翻译与审核设置
├── 目标语言                    input       → production.subtitleTargetLanguage / commentTargetLanguage
├── 目标语言继续翻译            select      → production.subtitleRetranslateTargetLanguage / ...
├── 正面提示词                  textarea    → production.subtitlePositivePrompt / commentPositivePrompt
└── 负面提示词                  textarea    → production.subtitleNegativePrompt / commentNegativePrompt
```

### 改动后的设置面板结构

```
翻译与审核设置
├── 目标语言                    input       → production.subtitleTargetLanguage / commentTargetLanguage
├── 目标语言继续翻译            select      → production.subtitleRetranslateTargetLanguage / ...
├── 双语字幕                    select      → production.bilingualSubtitles（新增）
├── 翻译提示词                  textarea    → production.subtitlePrompt / commentPrompt（合并为一个）
└── （安全审核规则硬编码，不在面板展示）
```

具体改动：

1. **合并提示词为一个输入框**：当前"正面提示词"和"负面提示词"两个 textarea 合并为一个"翻译提示词"textarea。安全审核规则硬编码在代码中，不在设置面板展示。
2. **新增双语字幕开关**：`bilingualSubtitles` select（开/关），控制渲染时加载纯译文还是双语字幕。
3. **后端 settings.ts**：
   - `subtitlePositivePrompt` + `subtitleNegativePrompt` → 合并为 `subtitlePrompt`
   - `commentPositivePrompt` + `commentNegativePrompt` → 合并为 `commentPrompt`
   - 新增 `bilingualSubtitles: boolean`
4. **前端 index.html**：翻译与审核设置卡片中，删掉两个提示词 textarea，换成一个；新增双语字幕 select。
5. **前端 client.js**：`renderSettings()` 和 `collectSettings()` 对应更新字段映射。

### settings.ts 数据结构

```typescript
production: {
  subtitleTargetLanguage: string;           // 默认 "zh-CN"
  subtitleRetranslateTargetLanguage: boolean;
  subtitlePrompt: string;                   // 合并后的用户提示词
  bilingualSubtitles: boolean;              // 新增
  commentTargetLanguage: string;
  commentRetranslateTargetLanguage: boolean;
  commentPrompt: string;                    // 合并后的用户提示词
}
```

---

## 任务详情面板改动

### 当前展示

翻译步骤（`translating-assets`）只展示一行汇总：

```
字幕输入/拦截    4000 / 15
评论输入/拦截    800 / 3
评论报告        /path/to/moderation-report.json
```

### 改动后展示

```
字幕翻译
  输入    4000 条
  成功    3985 条
  失败    15 条

  [展开待处理详情 ▼]
  ┌──────────────────────────────────────────────────────────┐
  │ cue-127  00:05:26.500 --> 00:05:29.000                  │
  │ 原文: The president announced new sanctions...           │
  │ 原因: sensitive - political content（已保留原文）          │
  ├──────────────────────────────────────────────────────────┤
  │ cue-891  00:39:01.000 --> 00:39:03.500                  │
  │ 原文: You can buy this on the dark web                   │
  │ 原因: sensitive - illegal content（已保留原文）            │
  ├──────────────────────────────────────────────────────────┤
  │ cue-2543  02:07:30.000 --> 02:07:32.000                 │
  │ 原文: And then the explosion                             │
  │ 原因: translation-failed - batch retry exhausted（已保留原文）│
  └──────────────────────────────────────────────────────────┘

评论翻译
  输入    800 条
  成功    797 条
  失败    3 条
  评论报告  /path/to/moderation-report.json
```

### 前端改动

`stepDetail()` 函数中 `translating-assets` 分支：

1. 读取 `subtitles.reportPath` 获取 `subtitle-report.{lang}.json` 路径
2. 通过 `GET /api/jobs/:id/artifact?path=...` 加载报告 JSON
3. 渲染汇总统计（输入/成功/失败数量）
4. 渲染可展开的失败详情列表，每条显示：时间戳范围、原文、失败原因

---

## 代码改动清单

### 后端

**`src/settings.ts`**：
- `subtitlePositivePrompt` + `subtitleNegativePrompt` → `subtitlePrompt`
- `commentPositivePrompt` + `commentNegativePrompt` → `commentPrompt`
- 新增 `bilingualSubtitles: boolean`（默认 false）
- 更新 `defaultSettings` 默认值

**`src/jobs/translate-job.ts`**：
- 新增 `buildFullSubtitleContext(cues)` — 生成编号列表格式完整字幕
- 修改 `translateSubtitleFile()` — 生成 fullSubtitleText 传入翻译函数；生成两份字幕文件；生成 `subtitle-report.{lang}.json`
- 修改 `translateSubtitles()` — 输出路径包含双语文件；metadata 中记录 reportPath
- 保留 `parseSubtitleCues` / `normalizeYouTubeRollingWebVtt` / `sanitizeTranslatedSubtitleText`

**`src/jobs/moderation.ts`**：
- 新增 `subtitleContextAwarePrompt()` — 独立的字幕翻译 prompt 模板（带视频元信息 + 完整字幕上下文 + 安全审核 + 用户提示词）
- 不复用 `batchSafetyReviewTranslationPrompt()`，避免字幕和评论耦合
- 保留重试、二分法、JSON 解析、id 校验逻辑

**`src/translate/openai-compatible.ts`**：
- 修改 `translateJSON()` — 支持传入完整 system prompt

**`src/jobs/render-job.ts`**：
- `pickSubtitle()` — 根据 `bilingualSubtitles` 开关选择 `.vtt` 或 `.bilingual.vtt`

### 前端

**`src/ui/index.html`**：
- 翻译与审核设置卡片：两个提示词 textarea 合并为一个；新增双语字幕 select

**`src/ui/client.js`**：
- `renderSettings()` / `collectSettings()` — 更新字段映射（prompt 合并、新增 bilingualSubtitles）
- `stepDetail()` — translating-assets 步骤展示字幕翻译报告详情（可展开的失败 cue 列表）

---

## 成本估算

### 3 小时电影（4000 条，40 批）

| 项目 | 计算 | 费用 |
|------|------|------|
| 首批 system（未命中） | 52K × 0.4 元/M | 0.021 元 |
| 后续 39 批 system（命中缓存） | 52K × 39 × 0.04 元/M | 0.081 元 |
| user message × 40 批 | 120K × 0.4 元/M | 0.048 元 |
| 翻译输出 × 40 批 | 120K × 4 元/M | 0.48 元 |
| **合计** | | **约 0.63 元** |

### 30 分钟视频（700 条，7 批）

| 项目 | 计算 | 费用 |
|------|------|------|
| 首批 system（未命中） | 7K × 0.4 元/M | 0.003 元 |
| 后续 6 批 system（命中缓存） | 42K × 0.04 元/M | 0.002 元 |
| user message × 7 批 | 21K × 0.4 元/M | 0.008 元 |
| 翻译输出 × 7 批 | 21K × 4 元/M | 0.084 元 |
| **合计** | | **约 0.10 元** |
