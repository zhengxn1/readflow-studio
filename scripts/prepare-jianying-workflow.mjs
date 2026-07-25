#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findObsidianBook, downloadBookCover } from "./lib/obsidian-books.mjs";
import { parseSrt, shiftCues, formatUs, alignTranslatedCues } from "./lib/srt.mjs";
import { buildStoryboard, storyboardMarkdown } from "./lib/storyboard.mjs";
import { applyVisualDirections, visualDirectionRules } from "./lib/visual-direction.mjs";
import { loadWorkflowConfig, loadLayout, parseCliArgs, resolveMaterialPath, slugifyTitle } from "./lib/workflow-config.mjs";
import { buildTemplateAiAssetPlan } from "./lib/template-ai-assets.mjs";

const ROOT = process.cwd();
const args = parseCliArgs(process.argv.slice(2));

if (!args.book || !args.voice || !args.srt) {
  console.error([
    "用法：",
    "node scripts/prepare-jianying-workflow.mjs --book \"书名\" --voice \"正文.mp3\" --srt \"中文字幕.srt\" [--srt-en \"英文字幕.srt\" | --no-english] [--cover \"本地路径或网址\"] [--aspect 3:4] [--project \"项目名\"]",
  ].join("\n"));
  process.exit(1);
}

function probeDurationUs(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { encoding: "utf8", shell: false });
  const seconds = Number(result.stdout?.trim());
  if (result.status !== 0 || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`无法读取音频时长：${filePath}`);
  }
  return Math.round(seconds * 1_000_000);
}

function copyInput(source, destination) {
  const absoluteSource = path.resolve(source);
  if (!fs.existsSync(absoluteSource)) throw new Error(`找不到输入文件：${absoluteSource}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (absoluteSource !== path.resolve(destination)) fs.copyFileSync(absoluteSource, destination);
  return absoluteSource;
}

function createFullCanvasCover(source, destination, canvas) {
  const filter = [
    `[0:v]split=2[background][foreground]`,
    `[background]scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=increase,crop=${canvas.width}:${canvas.height},boxblur=24:2[blurred]`,
    `[foreground]scale=${canvas.width}:${canvas.height}:force_original_aspect_ratio=decrease[cover]`,
    `[blurred][cover]overlay=(W-w)/2:(H-h)/2`,
  ].join(";");
  const result = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", "-i", source,
    "-filter_complex", filter, "-frames:v", "1", "-q:v", "2", destination,
  ], { encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(`无法生成目标画幅封面：${result.stderr?.trim() || destination}`);
}

function markdownManifest(manifest) {
  if (manifest.draftTemplate === "cassette-player") {
    return [
      "# 素材清单",
      "",
      "- 使用模板：唱片夜读·沉浸播放器",
      `- 项目画幅：16:9（${manifest.canvas.width}×${manifest.canvas.height}）`,
      `- 书籍：${manifest.book.title}`,
      `- 作者：${manifest.book.author || "未填写"}`,
      `- 正文音频：input/${path.basename(manifest.inputs.voice)}`,
      `- 中文字幕：input/${path.basename(manifest.inputs.srt)}`,
      `- 英文字幕：${manifest.inputs.englishSrt ? `input/${path.basename(manifest.inputs.englishSrt)}` : "未提供"}`,
      "- AI生成：1024×1024主题书封、1920×1080内容主题背景。",
      "- 固定素材：唱片播放器素材包、片头、IP形象和正方形快闪目录。",
      "- 生成清单：generated/ai-assets.json",
      "",
    ].join("\n");
  }
  if (manifest.draftTemplate === "knowledge-card") {
    return [
      "# 素材清单",
      "",
      "- 使用模板：三分钟精读·知识导航",
      `- 项目画幅：4:3（${manifest.canvas.width}×${manifest.canvas.height}）`,
      `- 书籍：${manifest.book.title}`,
      `- 作者：${manifest.book.author || "未填写"}`,
      `- 正文音频：input/${path.basename(manifest.inputs.voice)}`,
      `- 中文字幕：input/${path.basename(manifest.inputs.srt)}`,
      "- 用户上传：4:3背景模板。",
      "- AI生成：与每段正文对应的风景或象征画面；生成后抠图为透明RGBA PNG。",
      "- 固定素材：三分钟精读片头、打开书透明图和BGM。",
      "- 生成清单：generated/ai-assets.json",
      "",
    ].join("\n");
  }
  return [
    "# 素材清单",
    "",
    `- 项目画幅：${manifest.aspect}（${manifest.canvas.width}×${manifest.canvas.height}）`,
    `- 书籍：${manifest.book.title}`,
    `- 作者：${manifest.book.author || "未填写"}`,
    `- Obsidian 笔记：${manifest.book.notePath}`,
    `- 书籍封面：input/${path.basename(manifest.inputs.cover)}`,
    `- 全画幅封面：input/${path.basename(manifest.inputs.fullCover)}（保持原封面比例，背景适配画布）`,
    `- 正文音频：input/${path.basename(manifest.inputs.voice)}`,
    `- 中文字幕：input/${path.basename(manifest.inputs.srt)}`,
    `- 英文字幕：${manifest.inputs.englishSrt ? `input/${path.basename(manifest.inputs.englishSrt)}` : "未提供"}`,
    `- 水滴音效：${path.basename(manifest.fixedMaterials.waterDropSfx)}`,
    `- 正文开头音效：${path.basename(manifest.fixedMaterials.textStartSfx)}`,
    `- 片头时长：${(manifest.intro.durationUs / 1_000_000).toFixed(3)} 秒`,
    `- 正文音频时长：${(manifest.body.durationUs / 1_000_000).toFixed(3)} 秒`,
    `- 成片预计时长：${(manifest.totalDurationUs / 1_000_000).toFixed(3)} 秒`,
    `- 字幕时间：SRT 原始时间 + ${manifest.intro.captionOffsetUs} 微秒（从书封面出现时开始）`,
    `- 片头字幕：不显示“${manifest.intro.text}”字幕`,
    "- 画面规则：所有图片保持宽高比；正文一分镜一张图，不按每句字幕换图。",
    "",
  ].join("\n");
}

function srtTimestamp(us) {
  const totalMs = Math.max(0, Math.round(us / 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

function cuesToSrt(cues) {
  return `${cues.map((cue, index) => [
    index + 1,
    `${srtTimestamp(cue.startUs)} --> ${srtTimestamp(cue.endUs)}`,
    cue.text,
  ].join("\n")).join("\n\n")}\n`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const { config, configPath } = loadWorkflowConfig(ROOT, args.config);
const requestedTemplate = String(args.template || "classic");
const cassettePlayerTemplate = ["second", "template-2", "第二个模板", "cassette-player"].includes(requestedTemplate);
const knowledgeCardTemplate = ["third", "template-3", "第三个模板", "knowledge-card"].includes(requestedTemplate);
const aspect = args.aspect
  || (cassettePlayerTemplate ? "16:9" : knowledgeCardTemplate ? "4:3" : null)
  || config.defaults?.aspect
  || "3:4";
const layout = loadLayout(ROOT, aspect);
const voiceSource = path.resolve(args.voice);
const srtSource = path.resolve(args.srt);
const englishSrtSource = args["srt-en"] ? path.resolve(args["srt-en"]) : "";
const requireEnglishSubtitles = args.english === false
  ? false
  : config.defaults?.requireEnglishSubtitles !== false;
if (!fs.existsSync(voiceSource)) throw new Error(`找不到正文音频：${voiceSource}`);
if (!fs.existsSync(srtSource)) throw new Error(`找不到字幕文件：${srtSource}`);
if (englishSrtSource && !fs.existsSync(englishSrtSource)) throw new Error(`找不到英文字幕文件：${englishSrtSource}`);
if (requireEnglishSubtitles && !englishSrtSource) {
  throw new Error("当前模板要求每条中文字幕对应一条英文字幕。请提供 --srt-en；如本期明确不要英文字幕，可加 --no-english。");
}

let book;
try {
  book = findObsidianBook({
    vaultPath: config.obsidian.vaultPath,
    wereadFolder: config.obsidian.wereadFolder || "00_INPUT/微信读书",
    title: args.book,
  });
} catch (error) {
  if (!args.cover) throw error;
  if (!args.author) throw new Error(`${error.message}\n使用 --cover 绕过 Obsidian 封面时还必须提供 --author。`);
  book = { title: args.book, author: args.author, cover: "", bookId: "", isbn: "", filePath: "" };
}

const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
const projectName = slugifyTitle(args.project || `${today}-${args.book}`);
const episodeDir = path.join(ROOT, "episodes", projectName);
const inputDir = path.join(episodeDir, "input");
const imagesDir = path.join(episodeDir, "images");
const generatedDir = path.join(episodeDir, "generated");
fs.mkdirSync(inputDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(generatedDir, { recursive: true });

const voicePath = path.join(inputDir, "body-voiceover.mp3");
const srtPath = path.join(inputDir, "body-subtitles.srt");
const englishSrtPath = englishSrtSource ? path.join(inputDir, "body-subtitles-en.srt") : "";
const coverPath = path.join(inputDir, "book-cover.jpg");
const fullCoverPath = path.join(inputDir, `book-cover-full-${aspect.replace(":", "x")}.jpg`);
copyInput(voiceSource, voicePath);
copyInput(srtSource, srtPath);
if (englishSrtSource) copyInput(englishSrtSource, englishSrtPath);
if (args.cover) {
  if (/^https?:\/\//iu.test(String(args.cover))) await downloadBookCover(args.cover, coverPath);
  else copyInput(args.cover, coverPath);
} else {
  await downloadBookCover(book.cover, coverPath);
}
createFullCanvasCover(coverPath, fullCoverPath, layout.canvas);

const fixedMaterials = {
  bgm: resolveMaterialPath(config, "bgm"),
  introVideo: resolveMaterialPath(config, "introVideo"),
  introVoice: resolveMaterialPath(config, "introVoice"),
  mechanicalSfx: resolveMaterialPath(config, "mechanicalSfx"),
  waterDropSfx: resolveMaterialPath(config, "waterDropSfx"),
  textStartSfx: resolveMaterialPath(config, "textStartSfx"),
  flashDir: resolveMaterialPath(config, "flashDir"),
};
const introVideoDurationUs = probeDurationUs(fixedMaterials.introVideo);
const flashDurationUs = Number(config.defaults?.flashDurationUs ?? config.defaults?.flashEndUs ?? 1_080_000);
const coverHoldDurationUs = Number(config.defaults?.coverHoldDurationUs ?? 1_300_000);
const flashStartUs = introVideoDurationUs;
const flashEndUs = flashStartUs + flashDurationUs;
const coverStartUs = flashEndUs;
const introDurationUs = coverStartUs + coverHoldDurationUs;
let cues = parseSrt(fs.readFileSync(srtPath, "utf8"));
const normalizedBookTitle = String(args.book).replace(/[《》\s]/g, "");
const rawFirstCueText = String(cues[0]?.text || "");
const normalizedFirstCue = rawFirstCueText.replace(/[《》\s]/g, "");
let titlePrefixWasSplit = false;
if (knowledgeCardTemplate && normalizedFirstCue !== normalizedBookTitle && normalizedFirstCue.startsWith(normalizedBookTitle)) {
  const titlePrefix = new RegExp(`^[《]?\\s*${escapeRegExp(args.book)}\\s*[》]?`, "u");
  const remainder = rawFirstCueText.replace(titlePrefix, "").trim();
  if (remainder) {
    const first = cues[0];
    const durationUs = first.endUs - first.startUs;
    const titleRatio = Math.max(0.22, Math.min(0.45, normalizedBookTitle.length / (normalizedBookTitle.length + remainder.length)));
    const splitUs = Math.min(first.endUs - 200_000, first.startUs + Math.max(650_000, Math.round(durationUs * titleRatio)));
    cues = [
      { ...first, text: args.book, endUs: splitUs },
      { ...first, text: remainder, startUs: splitUs },
      ...cues.slice(1),
    ].map((cue, index) => ({ ...cue, index: index + 1 }));
    fs.writeFileSync(srtPath, cuesToSrt(cues));
    titlePrefixWasSplit = true;
  }
}
const englishCues = englishSrtPath ? parseSrt(fs.readFileSync(englishSrtPath, "utf8")) : [];
const alignedEnglishCues = englishCues.length ? alignTranslatedCues(cues, englishCues) : [];
const captionOffsetUs = coverStartUs;
const shiftedCues = shiftCues(cues, captionOffsetUs);
const shiftedEnglishCues = shiftCues(alignedEnglishCues, captionOffsetUs);
const firstCueIsBookTitle = String(cues[0]?.text || "").replace(/[《》\s]/g, "") === normalizedBookTitle;
if (!firstCueIsBookTitle) {
  throw new Error(`中文字幕第一条必须是书名《${args.book}》，以便全画幅封面、书名朗读和正文切换准确同步。`);
}
const storyboardCues = firstCueIsBookTitle ? cues.slice(1) : cues;
const cueCounts = args["scene-cue-counts"]
  ? String(args["scene-cue-counts"]).split(",").map((value) => Number(value.trim()))
  : null;
const scenes = applyVisualDirections(buildStoryboard(storyboardCues, captionOffsetUs, { cueCounts }), projectName).map((scene) => ({
  ...scene,
  materialStatus: fs.existsSync(path.join(imagesDir, scene.imageFile)) ? "confirmed" : "generate",
}));
const draftTemplate = cassettePlayerTemplate ? "cassette-player" : knowledgeCardTemplate ? "knowledge-card" : "classic";
const aiAssetPlan = buildTemplateAiAssetPlan({
  templateId: draftTemplate,
  book: { title: args.book, author: args.author || book.author },
  cues: storyboardCues,
  scenes,
});
const voiceDurationUs = probeDurationUs(voicePath);
const bodyDurationUs = Math.max(voiceDurationUs, cues.at(-1).endUs);
const totalDurationUs = captionOffsetUs + bodyDurationUs;

const manifest = {
  schemaVersion: 2,
  createdAt: new Date().toISOString(),
  configPath: path.relative(ROOT, configPath),
  projectName,
  draftTemplate,
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
  intro: {
    text: args.intro || config.defaults?.introText || "今天我们要分享的是",
    durationUs: introDurationUs,
    videoDurationUs: introVideoDurationUs,
    flashStartUs,
    flashEndUs,
    coverStartUs,
    coverHoldDurationUs,
    captionOffsetUs,
    firstCueIsBookTitle,
    titlePrefixWasSplit,
  },
  body: { durationUs: bodyDurationUs, srtCueCount: cues.length, englishSrtCueCount: englishCues.length, sceneCount: scenes.length },
  totalDurationUs,
  inputs: {
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
    aiAssets: path.join("generated", "ai-assets.json"),
  },
};

fs.writeFileSync(path.join(episodeDir, "workflow.json"), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(episodeDir, manifest.generated.shiftedCaptions), `${JSON.stringify(shiftedCues, null, 2)}\n`);
if (manifest.generated.shiftedEnglishCaptions) {
  fs.writeFileSync(path.join(episodeDir, manifest.generated.shiftedEnglishCaptions), `${JSON.stringify(shiftedEnglishCues, null, 2)}\n`);
}
fs.writeFileSync(path.join(episodeDir, manifest.generated.segments), `${JSON.stringify(cues.map((cue) => ({
  id: `s${String(cue.index).padStart(3, "0")}`,
  text: cue.text,
  type: "statement",
  startUs: cue.startUs,
  endUs: cue.endUs,
  duration: Number(((cue.endUs - cue.startUs) / 1_000_000).toFixed(3)),
})), null, 2)}\n`);
fs.writeFileSync(path.join(episodeDir, manifest.generated.storyboard), `${JSON.stringify(scenes, null, 2)}\n`);
fs.writeFileSync(path.join(episodeDir, manifest.generated.aiAssets), `${JSON.stringify(aiAssetPlan, null, 2)}\n`);
fs.writeFileSync(path.join(episodeDir, manifest.generated.imagePrompts), `${JSON.stringify({
  rules: visualDirectionRules(),
  scenes: scenes.map(({ id, text, visualStyle, imagePrompt, imageFile, materialStatus }) => ({
    id, text, visualStyle, imagePrompt, imageFile, materialStatus,
  })),
}, null, 2)}\n`);
fs.writeFileSync(path.join(episodeDir, "storyboard.md"), storyboardMarkdown(scenes));
fs.writeFileSync(path.join(episodeDir, "source-manifest.md"), markdownManifest(manifest));
const editPlanLines = cassettePlayerTemplate ? [
  "# 剪辑计划", "",
  "1. 使用唱片夜读·沉浸播放器，不混入模板1或模板3素材。",
  "2. AI依据本期正文生成1024×1024主题书封和1920×1080背景。",
  "3. 片头IP、12张方形快闪和本期主题书封只在左侧方形窗口显示。",
  "4. 正文从6.20秒开始，书名、作者和字幕位于右侧。",
  "5. 唱片、小播放器、音波、时间、进度点和播放控件保持独立轨道。",
  "6. 草稿安装时复制素材到草稿assets并重写路径。", "",
] : knowledgeCardTemplate ? [
  "# 剪辑计划", "",
  "1. 使用三分钟精读·知识导航，不混入模板1或模板2素材。",
  "2. 背景使用用户上传的4:3参考模板，不由AI擅自更换。",
  "3. AI逐镜生成与正文对应的风景或象征画面，并抠图为透明RGBA PNG。",
  "4. 打开书只显示到第一句正文开始，正文图片统一居中。",
  "5. 四个知识分块从头显示到尾，不添加进度条。",
  "6. 每句字幕关键词必须来自对应原句。",
  "7. 所有前景图使用80%到85%的缩放关键帧。", "",
] : [
  "# 剪辑计划", "",
  "1. 使用书封快闪·双语精读，不混入模板2或模板3素材。",
  "2. 片头MOV与片头语音同步，不显示片头字幕，也不播放机械音效。",
  "3. MOV结束后快闪素材与机械音效同步。",
  "4. 快闪结束后全画幅封面以水滴遮罩进入。",
  "5. AI根据每个分镜的正文文案生成对应图片，一镜一图。",
  "6. 中文和英文使用独立字幕轨。",
  "7. 草稿安装时复制素材到草稿assets并重写路径。", "",
];
const reviewLines = cassettePlayerTemplate ? [
  "# 审核记录", "",
  "- [ ] AI主题书封为1024×1024且对应正文",
  "- [ ] AI背景为1920×1080且对应正文",
  "- [ ] 播放器固定素材包完整",
  "- [ ] 中文字幕第一条为书名",
  "- [ ] 正文从6.20秒开始",
  "- [ ] 安装草稿只引用自身assets", "",
] : knowledgeCardTemplate ? [
  "# 审核记录", "",
  "- [ ] 背景为用户上传的4:3模板",
  "- [ ] AI风景或象征画面与对应文案一致",
  "- [ ] 所有正文图为透明RGBA PNG",
  "- [ ] 四个分块从头显示到尾且没有进度条",
  "- [ ] 每句关键词属于字幕原句",
  "- [ ] 所有前景图缩放为80%到85%",
  "- [ ] 安装草稿只引用自身assets", "",
] : [
  "# 审核记录", "",
  "- [ ] 每张AI分镜图与对应正文一致",
  "- [ ] 每镜覆盖5到10条字幕",
  "- [ ] 所有scene图片无文字、水印、人物近景或拉伸",
  "- [ ] 片头、快闪、封面揭示和音效同步",
  "- [ ] 中英文字幕时间一致",
  "- [ ] 安装草稿只引用自身assets", "",
];
const imageReadmeLines = cassettePlayerTemplate ? [
  "# 模板2 AI图片", "",
  "按 generated/ai-assets.json 生成：",
  "- cassette-square-cover.png：1024×1024主题书封",
  "- cassette-background.png：1920×1080内容主题背景", "",
] : knowledgeCardTemplate ? [
  "# 模板3 AI图片", "",
  "背景使用用户上传模板。按 generated/ai-assets.json 逐镜生成绿色背景素材，",
  "中间文件放入 images/chroma/，抠图后的透明RGBA PNG放入 images/cutouts/。", "",
] : [
  "# 模板1 AI分镜图片", "", `按 storyboard.md 和 generated/ai-assets.json 生成 ${scenes.length} 张图片。`,
  `画幅：${aspect}，尺寸：${layout.canvas.width}×${layout.canvas.height}。`,
  "文件名必须对应scene-001.png、scene-002.png……；每张图必须对应分镜正文。", "",
];
fs.writeFileSync(path.join(episodeDir, "edit-plan.md"), editPlanLines.join("\n"));
fs.writeFileSync(path.join(episodeDir, "review-notes.md"), reviewLines.join("\n"));
fs.writeFileSync(path.join(imagesDir, "README.md"), imageReadmeLines.join("\n"));

const next = cassettePlayerTemplate
  ? `按 generated/ai-assets.json 生成方形书封和16:9背景后，运行 npm run workflow:draft -- --project "${projectName}" --template second`
  : knowledgeCardTemplate
    ? `按 generated/ai-assets.json 生成并抠出透明正文图后，运行 npm run workflow:draft -- --project "${projectName}" --template third`
    : `按 generated/ai-assets.json 补齐AI分镜图后，运行 npm run workflow:draft -- --project "${projectName}" --template classic`;
console.log(JSON.stringify({
  ok: true,
  projectName,
  episodeDir,
  aspect,
  canvas: layout.canvas,
  book: `${args.book} / ${args.author || book.author}`,
  cover: coverPath,
  captions: cues.length,
  scenes: scenes.length,
  introOffset: formatUs(captionOffsetUs),
  next,
}, null, 2));
