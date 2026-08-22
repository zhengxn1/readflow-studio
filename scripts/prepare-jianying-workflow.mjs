#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { findObsidianBook, downloadBookCover } from "./lib/obsidian-books.mjs";
import { parseSrt, shiftCues, formatUs, alignTranslatedCues } from "./lib/srt.mjs";
import { buildStoryboard, storyboardMarkdown } from "./lib/storyboard.mjs";
import { applyVisualDirections, visualDirectionRules } from "./lib/visual-direction.mjs";
import { loadWorkflowConfig, loadLayout, parseCliArgs, slugifyTitle } from "./lib/workflow-config.mjs";
import {
  buildV3Timeline,
  collectFlashImages,
  resolveOptionalMaterial,
  validateBodyCues,
} from "./lib/opening-workflow.mjs";

const ROOT = process.cwd();
const args = parseCliArgs(process.argv.slice(2));

if (!args.book || !args["intro-voice"] || !args["title-voice"] || !args.voice || !args.srt) {
  console.error([
    "用法：",
    "node scripts/prepare-jianying-workflow.mjs --book \"书名\" --intro-voice \"片头话术.mp3\" --title-voice \"书名配音.mp3\" --voice \"正文.mp3\" --srt \"正文中文字幕.srt\" [--srt-en \"英文字幕.srt\" | --no-english] [--cover \"本地路径或网址\"] [--aspect 3:4] [--project \"项目名\"]",
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

function relativeManifestPath(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
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
  const materialLabel = (filePath) => filePath ? path.basename(filePath) : "未启用";
  return [
    "# 素材清单",
    "",
    `- 项目画幅：${manifest.aspect}（${manifest.canvas.width}×${manifest.canvas.height}）`,
    `- 书籍：${manifest.book.title}`,
    `- 作者：${manifest.book.author || "未填写"}`,
    `- Obsidian 笔记：${manifest.book.notePath || "未使用"}`,
    `- 书籍封面：input/${path.basename(manifest.inputs.cover)}`,
    `- 全画幅封面：input/${path.basename(manifest.inputs.fullCover)}（保持原封面比例，背景适配画布）`,
    `- 片头话术配音：${manifest.inputs.introVoice}`,
    `- 书名配音：${manifest.inputs.titleVoice}`,
    `- 正文配音：${manifest.inputs.voice}`,
    `- 中文字幕：input/${path.basename(manifest.inputs.srt)}`,
    `- 英文字幕：${manifest.inputs.englishSrt ? `input/${path.basename(manifest.inputs.englishSrt)}` : "未提供"}`,
    `- 背景音乐：${materialLabel(manifest.fixedMaterials.bgm)}`,
    `- 片头 MOV：${materialLabel(manifest.fixedMaterials.introVideo)}`,
    `- 机械音效：${materialLabel(manifest.fixedMaterials.mechanicalSfx)}`,
    `- 水滴音效：${materialLabel(manifest.fixedMaterials.waterDropSfx)}`,
    `- 正文开头音效：${materialLabel(manifest.fixedMaterials.textStartSfx)}`,
    `- 快闪图片目录：${materialLabel(manifest.fixedMaterials.flashDir)}`,
    `- 片头话术时长：${(manifest.opening.introVoiceDurationUs / 1_000_000).toFixed(3)} 秒`,
    `- 书名配音时长：${(manifest.opening.titleVoiceDurationUs / 1_000_000).toFixed(3)} 秒`,
    `- 正文音频时长：${(manifest.body.durationUs / 1_000_000).toFixed(3)} 秒`,
    `- 成片预计时长：${(manifest.totalDurationUs / 1_000_000).toFixed(3)} 秒`,
    `- 正文开始偏移：${manifest.timeline.bodyStartUs} 微秒`,
    `- 正文字幕偏移：SRT 原始时间 + ${manifest.timeline.bodyStartUs} 微秒`,
    "- 画面规则：所有图片保持宽高比；正文一分镜一张图，不按每句字幕换图。",
    "",
  ].join("\n");
}

const { config, configPath } = loadWorkflowConfig(ROOT, args.config);
const aspect = args.aspect || config.defaults?.aspect || "3:4";
const layout = loadLayout(ROOT, aspect);
const introVoiceSource = path.resolve(args["intro-voice"]);
const titleVoiceSource = path.resolve(args["title-voice"]);
const voiceSource = path.resolve(args.voice);
const srtSource = path.resolve(args.srt);
const englishSrtSource = args["srt-en"] ? path.resolve(args["srt-en"]) : "";
const requireEnglishSubtitles = args.english === false
  ? false
  : config.defaults?.requireEnglishSubtitles !== false;
if (!fs.existsSync(introVoiceSource)) throw new Error(`找不到片头话术音频：${introVoiceSource}`);
if (!fs.existsSync(titleVoiceSource)) throw new Error(`找不到书名配音：${titleVoiceSource}`);
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

const introVoicePath = path.join(inputDir, "intro-voice.mp3");
const titleVoicePath = path.join(inputDir, "title-voice.mp3");
const voicePath = path.join(inputDir, "body-voiceover.mp3");
const srtPath = path.join(inputDir, "body-subtitles.srt");
const englishSrtPath = englishSrtSource ? path.join(inputDir, "body-subtitles-en.srt") : "";
const coverPath = path.join(inputDir, "book-cover.jpg");
const fullCoverPath = path.join(inputDir, `book-cover-full-${aspect.replace(":", "x")}.jpg`);
copyInput(introVoiceSource, introVoicePath);
copyInput(titleVoiceSource, titleVoicePath);
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
  bgm: resolveOptionalMaterial(config, "bgm"),
  introVideo: resolveOptionalMaterial(config, "introVideo"),
  mechanicalSfx: resolveOptionalMaterial(config, "mechanicalSfx"),
  waterDropSfx: resolveOptionalMaterial(config, "waterDropSfx"),
  textStartSfx: resolveOptionalMaterial(config, "textStartSfx"),
  flashDir: resolveOptionalMaterial(config, "flashDir", { kind: "directory" }),
};
const flashImages = collectFlashImages(fixedMaterials.flashDir);
const introVideoDurationUs = fixedMaterials.introVideo && flashImages.length === 0
  ? probeDurationUs(fixedMaterials.introVideo)
  : 0;
const cues = parseSrt(fs.readFileSync(srtPath, "utf8"));
validateBodyCues(cues, args.book);
const englishCues = englishSrtPath ? parseSrt(fs.readFileSync(englishSrtPath, "utf8")) : [];
const alignedEnglishCues = englishCues.length ? alignTranslatedCues(cues, englishCues) : [];
const introVoiceDurationUs = probeDurationUs(introVoicePath);
const titleVoiceDurationUs = probeDurationUs(titleVoicePath);
const voiceDurationUs = probeDurationUs(voicePath);
const bodyDurationUs = Math.max(voiceDurationUs, cues.at(-1).endUs);
const timeline = buildV3Timeline({
  introVoiceDurationUs,
  titleVoiceDurationUs,
  bodyDurationUs,
});
const shiftedCues = shiftCues(cues, timeline.bodyStartUs);
const shiftedEnglishCues = shiftCues(alignedEnglishCues, timeline.bodyStartUs);
const cueCounts = args["scene-cue-counts"]
  ? String(args["scene-cue-counts"]).split(",").map((value) => Number(value.trim()))
  : null;
const scenes = applyVisualDirections(buildStoryboard(cues, timeline.bodyStartUs, { cueCounts }), projectName).map((scene) => ({
  ...scene,
  materialStatus: fs.existsSync(path.join(imagesDir, scene.imageFile)) ? "confirmed" : "generate",
}));
const totalDurationUs = timeline.totalDurationUs;

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
  totalDurationUs,
  inputs: {
    introVoice: relativeManifestPath(episodeDir, introVoicePath),
    titleVoice: relativeManifestPath(episodeDir, titleVoicePath),
    voice: relativeManifestPath(episodeDir, voicePath),
    srt: relativeManifestPath(episodeDir, srtPath),
    englishSrt: englishSrtPath ? relativeManifestPath(episodeDir, englishSrtPath) : "",
    cover: relativeManifestPath(episodeDir, coverPath),
    fullCover: relativeManifestPath(episodeDir, fullCoverPath),
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
fs.writeFileSync(path.join(episodeDir, manifest.generated.imagePrompts), `${JSON.stringify({
  rules: visualDirectionRules(),
  scenes: scenes.map(({ id, text, visualStyle, imagePrompt, imageFile, materialStatus }) => ({
    id, text, visualStyle, imagePrompt, imageFile, materialStatus,
  })),
}, null, 2)}\n`);
const editPlanSubtitleLine = manifest.inputs.englishSrt
  ? "7. 中文和英文使用独立字幕轨，英文沿用中文时间并放在中文下方。"
  : "7. 本期未启用英文字幕，仅保留中文字幕轨。";
const reviewSubtitleLine = manifest.inputs.englishSrt
  ? "- [ ] 中英文字幕条数与时间一致，英文位于中文下方且间距清晰"
  : "- [ ] 本期未启用英文字幕，仅检查中文字幕与正文配音的时间一致";
fs.writeFileSync(path.join(episodeDir, "storyboard.md"), storyboardMarkdown(scenes));
fs.writeFileSync(path.join(episodeDir, "source-manifest.md"), markdownManifest(manifest));
fs.writeFileSync(path.join(episodeDir, "edit-plan.md"), [
  "# 剪辑计划", "",
  "1. 快闪图片、片头 MOV 或全画幅书封承接片头话术；有快闪时优先使用快闪，其次使用片头 MOV，否则以全画幅书封兜底。",
  "2. 片头话术结束时显示全画幅书封，同时开始书名配音和自动生成的书名字幕。",
  "3. 书名配音结束后紧接正文配音、第一条正文字幕和第一张分镜图；小封面按模板进入。",
  "4. BGM、机械音效、水滴音效和正文开头音效仅在对应素材存在时添加。",
  "5. 书名和作者从书名配音结束后持续到视频结束。",
  "6. 每个分镜覆盖 5～10 条正文字幕，一分镜一张图。",
  editPlanSubtitleLine,
  "8. 草稿安装时复制素材到草稿 assets 并重写路径，保留全部轨道可编辑。", "",
].join("\n"));
fs.writeFileSync(path.join(episodeDir, "review-notes.md"), [
  "# 审核记录", "",
  "- [ ] 确认原始封面和目标画幅封面版本",
  "- [ ] 确认分镜均覆盖 5～10 条字幕",
  "- [ ] 所有 scene-*.png 已生成，且无人像近景、文字卡片和画面拉伸",
  "- [ ] 检查片头话术 → 书名配音 → 正文配音的三段音频边界连续且无重叠",
  "- [ ] 检查实际启用的开场素材按快闪图片、片头 MOV、全画幅书封的优先级正确承接片头话术",
  "- [ ] 检查实际启用的可选音效位于对应事件点；未启用的音效不应产生空轨或占位",
  "- [ ] 正文 SRT 从 00:00:00 开始，第一条是第一句正文，并从正文配音起点统一偏移",
  reviewSubtitleLine,
  "- [ ] 书名和作者从书名结束持续到视频结束，且与正文字幕不拥挤",
  "- [ ] 确认字幕未早于声音，并检查开头、中段、结尾",
  "- [ ] 确认字体在本机剪映可用",
  "- [ ] 安装草稿只引用自身 assets，不引用项目或 .tools 临时目录", "",
].join("\n"));
fs.writeFileSync(path.join(imagesDir, "README.md"), [
  "# 正文分镜图片", "", `请按 storyboard.md 生成 ${scenes.length} 张图片。`,
  `画幅：${aspect}，尺寸：${layout.canvas.width}×${layout.canvas.height}。`,
  "文件名必须对应 scene-001.png、scene-002.png……；图片不要带文字，不要拉伸。",
  "人物只能是面积不超过10%的远景背影或剪影，禁止真人近景和清晰五官。",
  "分镜风格与完整提示词见 generated/image-prompts.json。", "",
].join("\n"));

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
  bodyOffset: formatUs(timeline.bodyStartUs),
  next: `确认分镜并补齐 images/scene-*.png 后，运行 npm run workflow:draft -- --project \"${projectName}\"`,
}, null, 2));
