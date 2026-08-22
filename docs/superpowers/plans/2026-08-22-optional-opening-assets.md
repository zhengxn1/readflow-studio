# 可选片头素材与独立配音 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新项目改为“片头话术配音 → 书名配音 → 正文”的三段式时间线，并让 MOV、快闪、BGM 和音效按存在情况自动启用。

**Architecture:** 新增纯函数模块统一处理可选素材、正文字幕契约和 schema v3 时间线；准备脚本只负责收集输入并写入已经计算好的 manifest，草稿脚本只消费 manifest 并条件式创建轨道。schema v2 继续走原有逻辑，避免旧项目失效。

**Tech Stack:** Node.js 22+ ESM、`node:test`、FFmpeg/FFprobe、CapCut Mate HTTP API。

---

## 文件结构

- 新建 `scripts/lib/opening-workflow.mjs`：可选素材解析、快闪图片收集、正文字幕校验、schema v3 时间线和开场画面规划。
- 新建 `scripts/lib/draft-plan.mjs`：过滤实际源文件并生成动态轨道清单。
- 新建 `scripts/tests/workflow-opening.test.mjs`：纯函数单元测试。
- 新建 `scripts/tests/workflow-v3-integration.test.mjs`：使用 FFmpeg 生成最小媒体，覆盖准备与草稿干跑。
- 修改 `scripts/prepare-jianying-workflow.mjs`：接受两段独立开头配音并写 schema v3。
- 修改 `scripts/create-jianying-draft.mjs`：条件式创建媒体轨道并兼容 schema v2。
- 修改 `scripts/check.mjs`：把两个新库文件纳入语法检查。
- 修改 `README.md`、`docs/readflow-studio-playbook.md`、`config/workflow.example.json`、`AGENTS.md`：同步新输入契约和可选素材规则。

### Task 1: 建立可测试的时间线与可选素材核心

**Files:**
- Create: `scripts/tests/workflow-opening.test.mjs`
- Create: `scripts/lib/opening-workflow.mjs`
- Modify: `scripts/check.mjs`

- [ ] **Step 1: 写入失败测试**

创建 `scripts/tests/workflow-opening.test.mjs`：

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const loadModule = () => import("../lib/opening-workflow.mjs").catch(() => ({}));

test("schema v3 时间线按三段音频顺序衔接", async () => {
  const { buildV3Timeline } = await loadModule();
  assert.equal(typeof buildV3Timeline, "function");
  assert.deepEqual(buildV3Timeline({
    introVoiceDurationUs: 2_000_000,
    titleVoiceDurationUs: 1_500_000,
    bodyDurationUs: 8_000_000,
  }), {
    introStartUs: 0,
    introEndUs: 2_000_000,
    titleStartUs: 2_000_000,
    titleEndUs: 3_500_000,
    bodyStartUs: 3_500_000,
    bodyEndUs: 11_500_000,
    totalDurationUs: 11_500_000,
  });
});

test("正文字幕从零开始且第一条不能是书名", async () => {
  const { validateBodyCues } = await loadModule();
  assert.equal(typeof validateBodyCues, "function");
  assert.doesNotThrow(() => validateBodyCues([{ startUs: 0, text: "第一句故事" }], "被讨厌的勇气"));
  assert.throws(() => validateBodyCues([], "被讨厌的勇气"), /正文 SRT 不能为空/u);
  assert.throws(() => validateBodyCues([{ startUs: 100_000, text: "第一句故事" }], "被讨厌的勇气"), /00:00:00/u);
  assert.throws(() => validateBodyCues([{ startUs: 0, text: "《被讨厌的勇气》" }], "被讨厌的勇气"), /不再包含书名/u);
});

test("快闪优先于 MOV，缺少两者时使用封面", async () => {
  const { buildOpeningVisualPlan } = await loadModule();
  assert.equal(typeof buildOpeningVisualPlan, "function");
  const flash = buildOpeningVisualPlan({
    flashImages: ["1.png", "2.png", "3.png"],
    introVideo: "intro.mov",
    introVideoDurationUs: 9_000_000,
    introEndUs: 3_000_000,
  });
  assert.equal(flash.mode, "flash");
  assert.deepEqual(flash.flashSegments.map(({ start, end }) => [start, end]), [
    [0, 1_000_000], [1_000_000, 2_000_000], [2_000_000, 3_000_000],
  ]);
  const video = buildOpeningVisualPlan({ flashImages: [], introVideo: "intro.mov", introVideoDurationUs: 1_000_000, introEndUs: 3_000_000 });
  assert.deepEqual(video, {
    mode: "video",
    video: { filePath: "intro.mov", start: 0, end: 1_000_000 },
    coverFill: { start: 1_000_000, end: 3_000_000 },
    flashSegments: [],
  });
  const cover = buildOpeningVisualPlan({ flashImages: [], introVideo: "", introVideoDurationUs: 0, introEndUs: 3_000_000 });
  assert.deepEqual(cover, { mode: "cover", video: null, coverFill: { start: 0, end: 3_000_000 }, flashSegments: [] });
});

test("可选素材缺失时返回空值而不是抛错", async () => {
  const { resolveOptionalMaterial, collectFlashImages } = await loadModule();
  assert.equal(typeof resolveOptionalMaterial, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-optional-"));
  const warnings = [];
  try {
    const config = { materials: { root, bgm: "不存在.mp3", flashDir: "快闪素材" } };
    assert.equal(resolveOptionalMaterial(config, "bgm", { onMissing: (message) => warnings.push(message) }), "");
    assert.deepEqual(collectFlashImages(""), []);
    assert.equal(warnings.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行测试并确认按预期失败**

Run: `node --test scripts/tests/workflow-opening.test.mjs`

Expected: FAIL，首个失败信息为 `actual: 'undefined'`、`expected: 'function'`，证明新模块尚不存在。

- [ ] **Step 3: 写入最小核心实现**

创建 `scripts/lib/opening-workflow.mjs`：

```js
import fs from "node:fs";
import path from "node:path";

function positiveDuration(name, value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`${name}时长必须大于 0`);
  return Math.round(duration);
}

function normalizedTitle(value) {
  return String(value || "").replace(/[《》\s]/gu, "");
}

export function buildV3Timeline({ introVoiceDurationUs, titleVoiceDurationUs, bodyDurationUs }) {
  const introDuration = positiveDuration("片头话术配音", introVoiceDurationUs);
  const titleDuration = positiveDuration("书名配音", titleVoiceDurationUs);
  const bodyDuration = positiveDuration("正文配音", bodyDurationUs);
  const titleStartUs = introDuration;
  const bodyStartUs = titleStartUs + titleDuration;
  const bodyEndUs = bodyStartUs + bodyDuration;
  return {
    introStartUs: 0,
    introEndUs: introDuration,
    titleStartUs,
    titleEndUs: bodyStartUs,
    bodyStartUs,
    bodyEndUs,
    totalDurationUs: bodyEndUs,
  };
}

export function validateBodyCues(cues, bookTitle) {
  if (!Array.isArray(cues) || !cues.length) throw new Error("正文 SRT 不能为空");
  if (Number(cues[0].startUs) !== 0) throw new Error("正文 SRT 必须从 00:00:00 开始");
  if (normalizedTitle(cues[0].text) === normalizedTitle(bookTitle)) {
    throw new Error("正文 SRT 不再包含书名；请删除第一条书名字幕");
  }
}

export function resolveOptionalMaterial(config, key, { kind = "file", onMissing = console.warn } = {}) {
  const relative = config.materials?.[key];
  if (!relative) return "";
  const candidate = path.resolve(config.materials.root, relative);
  let valid = false;
  try {
    const stat = fs.statSync(candidate);
    valid = kind === "directory" ? stat.isDirectory() : stat.isFile();
  } catch {
    valid = false;
  }
  if (!valid) {
    onMissing(`跳过可选素材 materials.${key}：${candidate}`);
    return "";
  }
  return candidate;
}

export function collectFlashImages(directory) {
  if (!directory) return [];
  try {
    return fs.readdirSync(directory)
      .filter((name) => /\.(png|jpe?g|webp)$/iu.test(name))
      .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
      .map((name) => path.join(directory, name));
  } catch {
    return [];
  }
}

export function buildOpeningVisualPlan({ flashImages = [], introVideo = "", introVideoDurationUs = 0, introEndUs }) {
  const end = positiveDuration("片头话术配音", introEndUs);
  if (flashImages.length) {
    const unit = Math.floor(end / flashImages.length);
    return {
      mode: "flash",
      video: null,
      coverFill: null,
      flashSegments: flashImages.map((filePath, index) => ({
        filePath,
        start: index * unit,
        end: index === flashImages.length - 1 ? end : (index + 1) * unit,
      })),
    };
  }
  if (introVideo) {
    const videoEnd = Math.min(end, positiveDuration("片头 MOV", introVideoDurationUs));
    return {
      mode: "video",
      video: { filePath: introVideo, start: 0, end: videoEnd },
      coverFill: videoEnd < end ? { start: videoEnd, end } : null,
      flashSegments: [],
    };
  }
  return { mode: "cover", video: null, coverFill: { start: 0, end }, flashSegments: [] };
}
```

在 `scripts/check.mjs` 的 `scriptFiles` 数组加入：

```js
"scripts/lib/opening-workflow.mjs",
```

- [ ] **Step 4: 运行新增测试和全部测试**

Run: `node --test scripts/tests/workflow-opening.test.mjs`

Expected: 4 tests PASS。

Run: `npm run check`

Expected: 原 7 项与新增 4 项全部通过，结尾为 `ReadFlow Studio checks: ok`。

- [ ] **Step 5: 提交核心模块**

```bash
git add scripts/lib/opening-workflow.mjs scripts/tests/workflow-opening.test.mjs scripts/check.mjs
git commit -m "feat: add optional opening timeline planner"
```

### Task 2: 准备 schema v3 三段音频项目

**Files:**
- Create: `scripts/tests/workflow-v3-integration.test.mjs`
- Modify: `scripts/prepare-jianying-workflow.mjs`

- [ ] **Step 1: 写入准备阶段失败集成测试**

创建 `scripts/tests/workflow-v3-integration.test.mjs`，使用真实 FFmpeg 生成最小媒体并调用 CLI：

```js
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "../..");

function run(command, args, cwd = ROOT) {
  return spawnSync(command, args, { cwd, encoding: "utf8", shell: false });
}

function makeAudio(filePath, seconds) {
  const result = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(seconds), "-q:a", "9", filePath]);
  assert.equal(result.status, 0, result.stderr);
}

function makeCover(filePath) {
  const result = run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=300x400", "-frames:v", "1", filePath]);
  assert.equal(result.status, 0, result.stderr);
}

test("准备 schema v3 项目并复制三段独立音频", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-v3-"));
  const project = `test-v3-${process.pid}-${Date.now()}`;
  const episode = path.join(ROOT, "episodes", project);
  try {
    const introVoice = path.join(temp, "intro.mp3");
    const titleVoice = path.join(temp, "title.mp3");
    const bodyVoice = path.join(temp, "body.mp3");
    const cover = path.join(temp, "cover.jpg");
    const srt = path.join(temp, "body.srt");
    makeAudio(introVoice, 2);
    makeAudio(titleVoice, 1.5);
    makeAudio(bodyVoice, 4);
    makeCover(cover);
    fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,000\n第一句正文\n\n2\n00:00:02,000 --> 00:00:04,000\n第二句正文\n");
    const configPath = path.join(temp, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({
      obsidian: { vaultPath: temp, wereadFolder: "notes" },
      materials: {
        root: temp,
        bgm: "missing-bgm.mp3",
        introVideo: "missing-intro.mov",
        mechanicalSfx: "missing-mechanical.mp3",
        waterDropSfx: "missing-water.mp3",
        textStartSfx: "missing-start.mp3",
        flashDir: "missing-flash",
      },
      capcutMate: { baseUrl: "http://127.0.0.1:30000/openapi/capcut-mate/v1" },
      defaults: { aspect: "3:4", requireEnglishSubtitles: false },
    }, null, 2));
    const prepared = run(process.execPath, [
      "scripts/prepare-jianying-workflow.mjs",
      "--book", "测试书",
      "--author", "测试作者",
      "--cover", cover,
      "--intro-voice", introVoice,
      "--title-voice", titleVoice,
      "--voice", bodyVoice,
      "--srt", srt,
      "--no-english",
      "--project", project,
      "--config", configPath,
    ]);
    assert.equal(prepared.status, 0, prepared.stderr);
    const workflow = JSON.parse(fs.readFileSync(path.join(episode, "workflow.json"), "utf8"));
    assert.equal(workflow.schemaVersion, 3);
    assert.equal(workflow.inputs.introVoice, "input/intro-voice.mp3");
    assert.equal(workflow.inputs.titleVoice, "input/title-voice.mp3");
    assert.equal(workflow.inputs.voice, "input/body-voiceover.mp3");
    assert.equal(workflow.timeline.titleStartUs, workflow.opening.introVoiceDurationUs);
    assert.equal(workflow.timeline.bodyStartUs, workflow.opening.introVoiceDurationUs + workflow.opening.titleVoiceDurationUs);
    assert.equal(workflow.fixedMaterials.bgm, "");
    const captions = JSON.parse(fs.readFileSync(path.join(episode, workflow.generated.shiftedCaptions), "utf8"));
    assert.equal(captions[0].startUs, workflow.timeline.bodyStartUs);
    assert.equal(captions[0].text, "第一句正文");
  } finally {
    fs.rmSync(episode, { recursive: true, force: true });
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: 运行测试并确认按旧契约失败**

Run: `node --test scripts/tests/workflow-v3-integration.test.mjs`

Expected: FAIL；准备脚本因仍要求旧固定素材或仍要求首条字幕为书名而返回非零状态。

- [ ] **Step 3: 修改准备脚本的参数与输入复制**

将 `scripts/prepare-jianying-workflow.mjs` 的导入改为：

```js
import { loadWorkflowConfig, loadLayout, parseCliArgs, slugifyTitle } from "./lib/workflow-config.mjs";
import {
  buildV3Timeline,
  collectFlashImages,
  resolveOptionalMaterial,
  validateBodyCues,
} from "./lib/opening-workflow.mjs";
```

将必需参数检查改为：

```js
if (!args.book || !args["intro-voice"] || !args["title-voice"] || !args.voice || !args.srt) {
  console.error([
    "用法：",
    "node scripts/prepare-jianying-workflow.mjs --book \"书名\" --intro-voice \"片头话术.mp3\" --title-voice \"书名配音.mp3\" --voice \"正文.mp3\" --srt \"正文字幕.srt\" [--srt-en \"英文字幕.srt\" | --no-english] [--cover \"本地路径或网址\"] [--aspect 3:4] [--project \"项目名\"]",
  ].join("\n"));
  process.exit(1);
}
```

在读取每期输入时增加：

```js
const introVoiceSource = path.resolve(args["intro-voice"]);
const titleVoiceSource = path.resolve(args["title-voice"]);
if (!fs.existsSync(introVoiceSource)) throw new Error(`找不到片头话术配音：${introVoiceSource}`);
if (!fs.existsSync(titleVoiceSource)) throw new Error(`找不到书名配音：${titleVoiceSource}`);
```

在 `inputDir` 中复制：

```js
const introVoicePath = path.join(inputDir, "intro-voice.mp3");
const titleVoicePath = path.join(inputDir, "title-voice.mp3");
copyInput(introVoiceSource, introVoicePath);
copyInput(titleVoiceSource, titleVoicePath);
```

- [ ] **Step 4: 改为可选固定素材并计算 schema v3 时间线**

用以下结构替换强制 `resolveMaterialPath` 和旧片头偏移计算：

```js
const fixedMaterials = {
  bgm: resolveOptionalMaterial(config, "bgm"),
  introVideo: resolveOptionalMaterial(config, "introVideo"),
  mechanicalSfx: resolveOptionalMaterial(config, "mechanicalSfx"),
  waterDropSfx: resolveOptionalMaterial(config, "waterDropSfx"),
  textStartSfx: resolveOptionalMaterial(config, "textStartSfx"),
  flashDir: resolveOptionalMaterial(config, "flashDir", { kind: "directory" }),
};
const flashImages = collectFlashImages(fixedMaterials.flashDir);
const introVideoDurationUs = fixedMaterials.introVideo ? probeDurationUs(fixedMaterials.introVideo) : 0;
const cues = parseSrt(fs.readFileSync(srtPath, "utf8"));
validateBodyCues(cues, args.book);
const englishCues = englishSrtPath ? parseSrt(fs.readFileSync(englishSrtPath, "utf8")) : [];
const alignedEnglishCues = englishCues.length ? alignTranslatedCues(cues, englishCues) : [];
const introVoiceDurationUs = probeDurationUs(introVoicePath);
const titleVoiceDurationUs = probeDurationUs(titleVoicePath);
const voiceDurationUs = probeDurationUs(voicePath);
const bodyDurationUs = Math.max(voiceDurationUs, cues.at(-1).endUs);
const timeline = buildV3Timeline({ introVoiceDurationUs, titleVoiceDurationUs, bodyDurationUs });
const shiftedCues = shiftCues(cues, timeline.bodyStartUs);
const shiftedEnglishCues = shiftCues(alignedEnglishCues, timeline.bodyStartUs);
```

正文分镜不再删除第一条字幕：

```js
const scenes = applyVisualDirections(buildStoryboard(cues, timeline.bodyStartUs, { cueCounts }), projectName).map((scene) => ({
  ...scene,
  materialStatus: fs.existsSync(path.join(imagesDir, scene.imageFile)) ? "confirmed" : "generate",
}));
```

将 manifest 的核心字段改为：

```js
const manifest = {
  schemaVersion: 3,
  createdAt: new Date().toISOString(),
  configPath: path.relative(ROOT, configPath),
  projectName,
  episodeDir: path.relative(ROOT, episodeDir),
  aspect,
  canvas: layout.canvas,
  book: {
    title: args.book,
    sourceTitle: book.title,
    author: args.author || book.author,
    bookId: book.bookId,
    isbn: book.isbn,
    notePath: book.filePath,
    sourceCoverUrl: /^https?:\/\//iu.test(String(args.cover || book.cover)) ? String(args.cover || book.cover) : "",
  },
  timeline,
  opening: {
    introVoiceDurationUs,
    titleVoiceDurationUs,
    introVideoDurationUs,
    flashImageCount: flashImages.length,
  },
  body: { durationUs: bodyDurationUs, srtCueCount: cues.length, englishSrtCueCount: englishCues.length, sceneCount: scenes.length },
  totalDurationUs: timeline.totalDurationUs,
  inputs: {
    introVoice: path.relative(episodeDir, introVoicePath),
    titleVoice: path.relative(episodeDir, titleVoicePath),
    voice: path.relative(episodeDir, voicePath),
    srt: path.relative(episodeDir, srtPath),
    englishSrt: englishSrtPath ? path.relative(episodeDir, englishSrtPath) : "",
    cover: path.relative(episodeDir, coverPath),
    fullCover: path.relative(episodeDir, fullCoverPath),
  },
  fixedMaterials,
  generated: {
    shiftedCaptions: path.join("generated", "shifted-captions.json"),
    shiftedEnglishCaptions: englishCues.length ? path.join("generated", "shifted-captions-en.json") : "",
    segments: path.join("generated", "segments.json"),
    storyboard: path.join("generated", "storyboard.json"),
    imagePrompts: path.join("generated", "image-prompts.json"),
  },
};
```

同时删除旧的 `firstCueIsBookTitle`、`storyboardCues`、`captionOffsetUs` 和 `intro` manifest 计算。为保证本任务结束时脚本可运行，将 `markdownManifest` 中所有 `manifest.intro.*` 引用替换为以下 v3 字段：

```js
`- 片头话术时长：${(manifest.opening.introVoiceDurationUs / 1_000_000).toFixed(3)} 秒`,
`- 书名配音时长：${(manifest.opening.titleVoiceDurationUs / 1_000_000).toFixed(3)} 秒`,
`- 正文音频时长：${(manifest.body.durationUs / 1_000_000).toFixed(3)} 秒`,
`- 成片预计时长：${(manifest.totalDurationUs / 1_000_000).toFixed(3)} 秒`,
`- 正文字幕时间：SRT 原始时间 + ${manifest.timeline.bodyStartUs} 微秒`,
```

命令末尾的控制台摘要改为：

```js
bodyOffset: formatUs(timeline.bodyStartUs),
```

- [ ] **Step 5: 运行准备测试并确认通过**

Run: `node --test scripts/tests/workflow-v3-integration.test.mjs`

Expected: 1 test PASS；临时项目被测试的 `finally` 清理。

Run: `npm run check`

Expected: 所有测试通过。

- [ ] **Step 6: 提交 schema v3 准备流程**

```bash
git add scripts/prepare-jianying-workflow.mjs scripts/tests/workflow-v3-integration.test.mjs
git commit -m "feat: prepare three-part voice workflow"
```

### Task 3: 生成只包含实际素材的草稿计划

**Files:**
- Create: `scripts/lib/draft-plan.mjs`
- Modify: `scripts/tests/workflow-opening.test.mjs`
- Modify: `scripts/check.mjs`

- [ ] **Step 1: 添加动态轨道失败测试**

向 `scripts/tests/workflow-opening.test.mjs` 追加：

```js
test("草稿计划过滤缺失素材和空轨道", async () => {
  const module = await import("../lib/draft-plan.mjs").catch(() => ({}));
  assert.equal(typeof module.buildV3DraftPlan, "function");
  const plan = module.buildV3DraftPlan({
    workflow: {
      projectName: "测试项目",
      aspect: "3:4",
      canvas: { width: 720, height: 960 },
      fixedMaterials: { bgm: "", mechanicalSfx: "机械.mp3", waterDropSfx: "", textStartSfx: "" },
      inputs: { introVoice: "intro.mp3", titleVoice: "title.mp3", voice: "body.mp3" },
    },
    openingPlan: { mode: "flash", flashSegments: [{ filePath: "flash.png", start: 0, end: 2_000_000 }], video: null, coverFill: null },
    sceneFiles: ["scene.png"],
    coverFiles: ["full.jpg", "cover.jpg"],
    hasEnglish: false,
    hasAuthor: true,
    hasNickname: false,
    hasSourceNote: false,
    introOnly: false,
  });
  assert.deepEqual(plan.tracks.audio, ["A1 正文旁白", "A2 片头话术", "A3 书名配音", "A4 机械音效"]);
  assert.deepEqual(plan.tracks.video, ["V1 快闪素材", "V2 全画幅书籍封面", "V3 正文分镜图片", "V4 缩小书籍封面"]);
  assert.equal(plan.sourceFiles.includes(""), false);
});

test("schema v2 时间字段保持旧片头和书名内嵌语义", async () => {
  const module = await import("../lib/draft-plan.mjs").catch(() => ({}));
  assert.equal(typeof module.normalizeDraftTimeline, "function");
  assert.deepEqual(module.normalizeDraftTimeline({
    schemaVersion: 2,
    intro: { durationUs: 3_500_000, captionOffsetUs: 2_000_000 },
    totalDurationUs: 12_000_000,
  }, [
    { startUs: 2_000_000, endUs: 3_000_000 },
    { startUs: 3_100_000, endUs: 5_000_000 },
  ]), {
    introEndUs: 3_500_000,
    titleStartUs: 2_000_000,
    titleEndUs: 3_000_000,
    bodyAudioStartUs: 2_000_000,
    firstBodySentenceStartUs: 3_100_000,
    totalEndUs: 12_000_000,
  });
});
```

- [ ] **Step 2: 运行并确认失败**

Run: `node --test --test-name-pattern="草稿计划过滤" scripts/tests/workflow-opening.test.mjs`

Expected: FAIL，`buildV3DraftPlan` 为 `undefined`。

- [ ] **Step 3: 创建动态草稿计划实现**

创建 `scripts/lib/draft-plan.mjs`：

```js
export function compactPaths(paths) {
  return [...new Set(paths.filter((value) => typeof value === "string" && value.length > 0))];
}

export function normalizeDraftTimeline(workflow, shiftedCues = []) {
  if (Number(workflow.schemaVersion) >= 3) {
    return {
      introEndUs: workflow.timeline.introEndUs,
      titleStartUs: workflow.timeline.titleStartUs,
      titleEndUs: workflow.timeline.titleEndUs,
      bodyAudioStartUs: workflow.timeline.bodyStartUs,
      firstBodySentenceStartUs: workflow.timeline.bodyStartUs,
      totalEndUs: workflow.totalDurationUs,
    };
  }
  return {
    introEndUs: workflow.intro.durationUs,
    titleStartUs: workflow.intro.captionOffsetUs,
    titleEndUs: shiftedCues[0]?.endUs || workflow.intro.durationUs,
    bodyAudioStartUs: workflow.intro.captionOffsetUs,
    firstBodySentenceStartUs: shiftedCues[1]?.startUs || workflow.intro.durationUs,
    totalEndUs: workflow.totalDurationUs,
  };
}

export function buildV3DraftPlan({
  workflow,
  openingPlan,
  sceneFiles,
  coverFiles,
  hasEnglish,
  hasAuthor,
  hasNickname,
  hasSourceNote,
  introOnly,
}) {
  const fixed = workflow.fixedMaterials || {};
  const video = [];
  if (openingPlan.mode === "flash") video.push("V1 快闪素材");
  if (openingPlan.mode === "video") video.push("V1 片头 MOV");
  video.push(`V${video.length + 1} 全画幅书籍封面`);
  if (!introOnly) {
    video.push(`V${video.length + 1} 正文分镜图片`);
    video.push(`V${video.length + 1} 缩小书籍封面`);
  }
  const audio = [];
  if (!introOnly) audio.push(`A${audio.length + 1} 正文旁白`);
  audio.push(`A${audio.length + 1} 片头话术`, `A${audio.length + 2} 书名配音`);
  if (fixed.bgm) audio.push(`A${audio.length + 1} 背景音乐`);
  if (fixed.mechanicalSfx) audio.push(`A${audio.length + 1} 机械音效`);
  if (fixed.waterDropSfx) audio.push(`A${audio.length + 1} 水滴音效`);
  if (fixed.textStartSfx && !introOnly) audio.push(`A${audio.length + 1} 正文开头音效`);
  const text = ["T1 书名"];
  if (!introOnly) text.push("T2 正文中文字幕");
  if (!introOnly && hasEnglish) text.push("T3 英文字幕");
  if (!introOnly) text.push(`T${text.length + 1} 常驻书名`);
  if (!introOnly && hasAuthor) text.push(`T${text.length + 1} 作者`);
  if (!introOnly && hasNickname) text.push(`T${text.length + 1} 昵称`);
  if (!introOnly && hasSourceNote) text.push(`T${text.length + 1} 来源说明`);
  return {
    schemaVersion: 2,
    project: workflow.projectName,
    aspect: workflow.aspect,
    canvas: workflow.canvas,
    tracks: { video, text, audio },
    sourceFiles: compactPaths([
      openingPlan.video?.filePath,
      ...openingPlan.flashSegments.map((item) => item.filePath),
      ...coverFiles,
      ...sceneFiles,
      workflow.inputs.introVoice,
      workflow.inputs.titleVoice,
      ...(introOnly ? [] : [workflow.inputs.voice]),
      fixed.bgm,
      fixed.mechanicalSfx,
      fixed.waterDropSfx,
      ...(introOnly ? [] : [fixed.textStartSfx]),
    ]),
  };
}
```

在 `scripts/check.mjs` 的 `scriptFiles` 数组加入：

```js
"scripts/lib/draft-plan.mjs",
```

- [ ] **Step 4: 运行测试并提交**

Run: `node --test scripts/tests/workflow-opening.test.mjs`

Expected: 6 tests PASS。

```bash
git add scripts/lib/draft-plan.mjs scripts/tests/workflow-opening.test.mjs scripts/check.mjs
git commit -m "feat: build dynamic draft track plan"
```

### Task 4: 让草稿生成器消费 schema v3 并保持 v2 兼容

**Files:**
- Modify: `scripts/tests/workflow-v3-integration.test.mjs`
- Modify: `scripts/create-jianying-draft.mjs`

- [ ] **Step 1: 扩展集成测试覆盖 dry-run**

在准备测试读取 `workflow` 后、`finally` 前增加一张分镜占位图并运行干跑：

```js
    const storyboard = JSON.parse(fs.readFileSync(path.join(episode, workflow.generated.storyboard), "utf8"));
    for (const scene of storyboard) fs.writeFileSync(path.join(episode, "images", scene.imageFile), "test-image");
    const dryRun = run(process.execPath, [
      "scripts/create-jianying-draft.mjs",
      "--project", project,
      "--config", configPath,
      "--dry-run",
    ]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    const draftPlan = JSON.parse(fs.readFileSync(path.join(episode, "draft-plan.json"), "utf8"));
    assert.equal(draftPlan.sourceFiles.includes(""), false);
    assert.deepEqual(draftPlan.tracks.audio, ["A1 正文旁白", "A2 片头话术", "A3 书名配音"]);
    assert.deepEqual(draftPlan.tracks.video, ["V1 全画幅书籍封面", "V2 正文分镜图片", "V3 缩小书籍封面"]);
```

- [ ] **Step 2: 运行并确认 dry-run 因旧强制素材逻辑失败**

Run: `node --test scripts/tests/workflow-v3-integration.test.mjs`

Expected: FAIL；`create-jianying-draft.mjs` 在空快闪目录或缺失固定音频上报错。

- [ ] **Step 3: 在草稿生成器中建立 v3 归一化数据**

增加导入：

```js
import { buildOpeningVisualPlan, collectFlashImages } from "./lib/opening-workflow.mjs";
import { buildV3DraftPlan, normalizeDraftTimeline } from "./lib/draft-plan.mjs";
```

删除 `create-jianying-draft.mjs` 中原有的本地 `collectFlashImages` 函数，避免与共享模块的同名导入冲突。将旧的无条件空目录错误改为仅约束 schema v2：

```js
const flashImages = collectFlashImages(workflow.fixedMaterials.flashDir);
if (!isV3 && !flashImages.length) {
  throw new Error(`快闪素材目录没有图片：${workflow.fixedMaterials.flashDir}`);
}
```

现有 `allFiles` 数组保留给 `legacyPlan`，但不得在 v3 分支中用于媒体服务或逐项探测；v3 只使用动态 plan 过滤后的 `sourceFiles`。

读取 manifest 后增加：

```js
const isV3 = Number(workflow.schemaVersion) >= 3;
const introVoicePath = isV3 ? resolveEpisodeAsset(workflow.inputs.introVoice) : "";
const titleVoicePath = isV3 ? resolveEpisodeAsset(workflow.inputs.titleVoice) : "";
const flashImages = collectFlashImages(workflow.fixedMaterials.flashDir);
const timelineEndUs = introOnly
  ? (isV3 ? workflow.timeline.bodyStartUs : workflow.intro.durationUs)
  : workflow.totalDurationUs;
const draftTimeline = normalizeDraftTimeline(workflow, shiftedCues);
```

仅对存在的音频读取时长：

```js
const optionalDurationUs = (filePath) => filePath ? probeDurationUs(filePath) : 0;
const audioDurations = {
  bodyVoice: probeDurationUs(bodyVoicePath),
  introVoice: isV3 ? probeDurationUs(introVoicePath) : probeDurationUs(workflow.fixedMaterials.introVoice),
  titleVoice: isV3 ? probeDurationUs(titleVoicePath) : 0,
  bgm: optionalDurationUs(workflow.fixedMaterials.bgm),
  mechanicalSfx: optionalDurationUs(workflow.fixedMaterials.mechanicalSfx),
  waterDropSfx: optionalDurationUs(workflow.fixedMaterials.waterDropSfx),
  textStartSfx: optionalDurationUs(workflow.fixedMaterials.textStartSfx),
};
```

为 v3 创建开场画面和动态 plan；v2 保留当前固定 plan 与时间字段：

```js
const openingPlan = isV3 ? buildOpeningVisualPlan({
  flashImages,
  introVideo: workflow.fixedMaterials.introVideo,
  introVideoDurationUs: workflow.opening.introVideoDurationUs,
  introEndUs: workflow.timeline.introEndUs,
}) : null;
const legacyPlan = {
  schemaVersion: 1,
  project: workflow.projectName,
  aspect: workflow.aspect,
  canvas: workflow.canvas,
  timeline: {
    introEndUs: workflow.intro.durationUs,
    bodyStartUs: workflow.intro.captionOffsetUs,
    totalEndUs: timelineEndUs,
  },
  tracks: {
    video: ["V1 片头 MOV", "V2 快闪素材", "V3 全画幅书籍封面", "V4 正文分镜图片", "V5 缩小书籍封面"],
    text: ["T1 正文中文字幕", "T2 英文字幕", "T3 书名", "T4 作者", "T5 昵称", "T6 来源说明"],
    audio: ["A1 正文旁白", "A2 背景音乐", "A3 片头语音", "A4 机械音效", "A5 水滴音效", "A6 正文开头音效"],
  },
  sourceFiles: allFiles,
};
const plan = isV3
  ? {
      ...buildV3DraftPlan({
        workflow: {
          ...workflow,
          inputs: {
            ...workflow.inputs,
            introVoice: introVoicePath,
            titleVoice: titleVoicePath,
            voice: bodyVoicePath,
          },
        },
        openingPlan,
        sceneFiles,
        coverFiles: [fullBookCoverPath, bookCoverPath],
        hasEnglish: shiftedEnglishCues.length > 0,
        hasAuthor: Boolean(workflow.book.author),
        hasNickname: Boolean(config.defaults?.nickname),
        hasSourceNote: Boolean(config.defaults?.sourceNote),
        introOnly,
      }),
      timeline: {
        introEndUs: workflow.timeline.introEndUs,
        titleEndUs: workflow.timeline.titleEndUs,
        bodyStartUs: workflow.timeline.bodyStartUs,
        totalEndUs: timelineEndUs,
      },
    }
  : legacyPlan;
```

后续书名、正文和常驻文字的节点统一读取 `draftTimeline`。v3 的 `bodyAudioStartUs` 与 `firstBodySentenceStartUs` 相同；v2 仍分别对应“含书名的正文音频起点”和“第二条字幕起点”。

- [ ] **Step 4: 条件式创建 v3 视频、音频和字幕**

在 `startMediaServer` 前确保 v3 使用 `plan.sourceFiles`，并将 v3 添加轨道逻辑写成以下条件：

```js
if (isV3 && openingPlan.video) {
  await client.addVideos(draftUrl, [{
    video_url: mediaServer.urlFor(openingPlan.video.filePath),
    start: openingPlan.video.start,
    end: openingPlan.video.end,
    duration: workflow.opening.introVideoDurationUs,
    volume: 0,
  }]);
}
if (isV3 && openingPlan.flashSegments.length) {
  await client.addImages(draftUrl, openingPlan.flashSegments.map((segment) => ({
    image_url: mediaServer.urlFor(segment.filePath), start: segment.start, end: segment.end,
  })), { scaleX: 1, scaleY: 1 });
}
```

v3 全画幅书封的开始点为片头画面补位点或书名开始点，结束点为正文开始点：

```js
const fullCoverStartUs = isV3
  ? (openingPlan.coverFill?.start ?? workflow.timeline.titleStartUs)
  : intro.coverStartUs;
const fullCoverEndUs = isV3 ? workflow.timeline.bodyStartUs : coverEndUs;
```

v3 音频调用使用一个过滤后的数组，一次性加入：

```js
if (isV3) {
  const openingAudios = [
    capAudio(mediaServer.urlFor(introVoicePath), 0, audioDurations.introVoice, workflow.timeline.introEndUs, Number(d.introVoiceVolume ?? 1)),
    capAudio(mediaServer.urlFor(titleVoicePath), workflow.timeline.titleStartUs, audioDurations.titleVoice, workflow.timeline.titleEndUs, Number(d.bodyVoiceVolume ?? 1)),
  ];
  if (!introOnly) openingAudios.push(capAudio(
    mediaServer.urlFor(bodyVoicePath), workflow.timeline.bodyStartUs, audioDurations.bodyVoice,
    workflow.timeline.bodyStartUs + audioDurations.bodyVoice, Number(d.bodyVoiceVolume ?? 1),
  ));
  await client.addAudios(draftUrl, openingAudios);
}
```

分别用 `if (workflow.fixedMaterials.bgm)`、`if (workflow.fixedMaterials.mechanicalSfx)`、`if (workflow.fixedMaterials.waterDropSfx)` 和 `if (workflow.fixedMaterials.textStartSfx)` 包裹对应的现有 `addAudios` 调用。机械音效起点为 `0`，水滴音效起点为 `workflow.timeline.titleStartUs`，正文开头音效起点为 `workflow.timeline.bodyStartUs`。旧的强制片头视频、快闪和音频添加代码全部放进 `if (!isV3)` 分支，防止 v3 重复添加或读取空路径。

启动媒体服务时使用：

```js
const mediaFiles = isV3 ? plan.sourceFiles : allFiles;
const mediaServer = await startMediaServer(mediaFiles, {
  host: config.capcutMate.mediaHost,
  port: config.capcutMate.mediaPort,
});
```

v3 书名字幕由 manifest 直接生成：

```js
if (isV3) {
  await client.addCaptions(draftUrl, [{
    start: workflow.timeline.titleStartUs,
    end: workflow.timeline.titleEndUs,
    text: `《${workflow.book.title}》`,
  }], layout.style.bodyCaption);
}
```

正文字幕仅在 `!introOnly` 时添加；v3 的常驻书名、作者和小封面从 `workflow.timeline.bodyStartUs` 开始。schema v2 保留当前 `shiftedCues[0]` 书名结束点逻辑。

- [ ] **Step 5: 运行集成测试、单元测试和完整检查**

Run: `node --test scripts/tests/workflow-v3-integration.test.mjs`

Expected: PASS，`draft-plan.json` 不含空路径和空素材轨道。

Run: `npm run check`

Expected: 所有测试通过，结尾为 `ReadFlow Studio checks: ok`。

- [ ] **Step 6: 提交草稿生成兼容改造**

```bash
git add scripts/create-jianying-draft.mjs scripts/tests/workflow-v3-integration.test.mjs
git commit -m "feat: create drafts from optional opening assets"
```

### Task 5: 更新生成文档和用户文档

**Files:**
- Modify: `scripts/prepare-jianying-workflow.mjs`
- Modify: `README.md`
- Modify: `docs/readflow-studio-playbook.md`
- Modify: `config/workflow.example.json`
- Modify: `AGENTS.md`

- [ ] **Step 1: 写入文档契约测试**

向 `scripts/tests/workflow-v3-integration.test.mjs` 的准备测试追加：

```js
    const sourceManifest = fs.readFileSync(path.join(episode, "source-manifest.md"), "utf8");
    const editPlan = fs.readFileSync(path.join(episode, "edit-plan.md"), "utf8");
    assert.match(sourceManifest, /片头话术配音：input\/intro-voice\.mp3/u);
    assert.match(sourceManifest, /书名配音：input\/title-voice\.mp3/u);
    assert.match(sourceManifest, /背景音乐：未启用/u);
    assert.match(editPlan, /快闪图片、片头 MOV 或全画幅书封/u);
    assert.match(editPlan, /书名配音和自动生成的书名字幕/u);
```

- [ ] **Step 2: 运行并确认生成文档仍为旧文案**

Run: `node --test scripts/tests/workflow-v3-integration.test.mjs`

Expected: FAIL，`source-manifest.md` 中找不到独立片头话术和书名配音说明。

- [ ] **Step 3: 更新准备脚本生成的三份审核文档**

在 `markdownManifest` 中用安全显示函数处理可选素材：

```js
const materialLabel = (filePath) => filePath ? path.basename(filePath) : "未启用";
```

并输出以下核心条目：

```js
`- 片头话术配音：input/${path.basename(manifest.inputs.introVoice)}`,
`- 书名配音：input/${path.basename(manifest.inputs.titleVoice)}`,
`- 正文配音：input/${path.basename(manifest.inputs.voice)}`,
`- 背景音乐：${materialLabel(manifest.fixedMaterials.bgm)}`,
`- 机械音效：${materialLabel(manifest.fixedMaterials.mechanicalSfx)}`,
`- 水滴音效：${materialLabel(manifest.fixedMaterials.waterDropSfx)}`,
`- 正文开头音效：${materialLabel(manifest.fixedMaterials.textStartSfx)}`,
`- 正文开始偏移：${manifest.timeline.bodyStartUs} 微秒`,
```

把 `edit-plan.md` 的前四步改为：

```js
"1. 快闪图片、片头 MOV 或全画幅书封承接片头话术配音。",
"2. 片头话术结束后显示全画幅书封，书名配音和自动生成的书名字幕同步开始。",
"3. 书名配音结束后，正文配音、第一条正文字幕和第一张分镜同步开始。",
"4. BGM 和三类音效仅在素材存在时加入对应节点。",
```

把 `review-notes.md` 改为检查三段音频边界、开场画面兜底和可选轨道，不再要求固定 MOV 与全部音效存在。

- [ ] **Step 4: 更新 README、制作手册、示例配置和 Agent 规则**

在 README 与制作手册的准备命令中加入：

```powershell
--intro-voice "D:/素材/本期片头话术.mp3" `
--title-voice "D:/素材/本期书名配音.mp3" `
--voice "D:/素材/本期正文.mp3" `
--srt "D:/素材/本期正文字幕.srt"
```

明确正文 MP3/SRT 都从第一句故事开始，SRT 时间从 `00:00:00` 开始。将固定素材表述改为“同名文件存在即启用”；在 `config/workflow.example.json` 中删除 `materials.introVoice`，因为片头话术已经改为每期输入，其余固定素材键保持不变。

在 `AGENTS.md` 同步三段配音契约、可选素材规则和 schema v2 兼容要求。

- [ ] **Step 5: 运行文档测试和公共发布检查**

Run: `node --test scripts/tests/workflow-v3-integration.test.mjs`

Expected: PASS。

Run: `npm run check:public`

Expected: 退出码 0，不包含本机绝对路径、私密素材或当期输出。

Run: `npm run check`

Expected: 全部测试通过。

- [ ] **Step 6: 提交文档同步**

```bash
git add scripts/prepare-jianying-workflow.mjs README.md docs/readflow-studio-playbook.md config/workflow.example.json AGENTS.md scripts/tests/workflow-v3-integration.test.mjs
git commit -m "docs: describe replaceable three-part voice workflow"
```

### Task 6: 最终验证与本机配置迁移

**Files:**
- Modify: `.readflow.local.json`（被 Git 忽略，仅更新本机配置）
- Verify: all changed tracked files

- [ ] **Step 1: 删除本机配置中的旧固定片头配音字段**

从 `.readflow.local.json` 的 `materials` 中删除：

```json
"introVoice": "今天我们分享的是.mp3"
```

保留 `introVideo`、`bgm`、`mechanicalSfx`、`waterDropSfx`、`textStartSfx` 和 `flashDir`，它们均为可选。

- [ ] **Step 2: 运行完整验证**

Run: `npm run init`

Expected: Node、FFmpeg、FFprobe、Git、uv、config、capcutMate 全部为 `true`。

Run: `npm run check`

Expected: 现有测试、新增单元测试和 v3 集成测试全部通过，0 failures。

Run: `npm run check:public`

Expected: 退出码 0。

Run: `git diff --check`

Expected: 无输出，退出码 0。

- [ ] **Step 3: 核对需求覆盖和工作区状态**

Run: `git status --short --branch`

Expected: 当前分支为 `codex/optional-opening-assets`，只允许 `.readflow.local.json` 这类被忽略的本机配置不出现在状态中，已跟踪文件无未提交修改。

核对以下验收点：

```text
片头话术与书名配音是每期独立输入
正文 MP3/SRT 不含书名
快闪优先，MOV 次之，封面兜底
BGM 和音效存在即用、缺失即跳过
schema v2 旧项目仍可读取
dry-run 不引用空路径或缺失素材
```

- [ ] **Step 4: 如最终验证产生必要修正，单独提交**

仅当 Step 2 暴露实际缺陷并完成修正时执行：

```bash
git add -u
git commit -m "fix: complete optional opening verification"
```

如果没有修正，不创建空提交。
