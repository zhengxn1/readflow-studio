import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSrt, shiftCues, alignTranslatedCues } from "../lib/srt.mjs";
import { buildStoryboard } from "../lib/storyboard.mjs";
import { findObsidianBook } from "../lib/obsidian-books.mjs";
import { loadLayout, loadDraftTemplate } from "../lib/workflow-config.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("SRT 时间可解析并整体增加片头偏移", () => {
  const cues = parseSrt(`1\n00:00:00,000 --> 00:00:02,000\n第一句\n\n2\n00:00:02,200 --> 00:00:04,500\n第二句`);
  const shifted = shiftCues(cues, 2_380_000);
  assert.equal(shifted[0].startUs, 2_380_000);
  assert.equal(shifted[1].endUs, 6_880_000);
});

test("默认每个分镜合并 5～10 条字幕，但字幕条目仍保留", () => {
  const cues = parseSrt(Array.from({ length: 12 }, (_, index) => [
    index + 1,
    `00:00:${String(index).padStart(2, "0")},000 --> 00:00:${String(index + 1).padStart(2, "0")},000`,
    `第${index + 1}句`,
  ].join("\n")).join("\n\n"));
  const scenes = buildStoryboard(cues, 2_380_000);
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0].subtitleIndexes, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(scenes[1].subtitleIndexes, [7, 8, 9, 10, 11, 12]);
  assert.equal(scenes[0].draftStartUs, 2_380_000);
  assert.equal(scenes[0].imageFile, "scene-001.png");
});

test("可按每个分镜指定的字幕条数合并", () => {
  const cues = parseSrt(Array.from({ length: 10 }, (_, index) => [
    index + 1,
    `00:00:${String(index).padStart(2, "0")},000 --> 00:00:${String(index + 1).padStart(2, "0")},000`,
    `第${index + 1}句`,
  ].join("\n")).join("\n\n"));
  const scenes = buildStoryboard(cues, 2_000_000, { cueCounts: [5, 5] });
  assert.equal(scenes.length, 2);
  assert.deepEqual(scenes[0].subtitleIndexes, [1, 2, 3, 4, 5]);
  assert.deepEqual(scenes[1].subtitleIndexes, [6, 7, 8, 9, 10]);
});

test("拒绝少于 5 条或多于 10 条的显式分镜", () => {
  const cues = parseSrt(Array.from({ length: 10 }, (_, index) => [
    index + 1,
    `00:00:${String(index).padStart(2, "0")},000 --> 00:00:${String(index + 1).padStart(2, "0")},000`,
    `第${index + 1}句`,
  ].join("\n")).join("\n\n"));
  assert.throws(() => buildStoryboard(cues, 0, { cueCounts: [4, 6] }), /5～10/u);
});

test("英文字幕强制沿用中文字幕时间线", () => {
  const chinese = parseSrt(`1\n00:00:00,000 --> 00:00:02,000\n中文一\n\n2\n00:00:02,200 --> 00:00:04,000\n中文二`);
  const english = parseSrt(`1\n00:00:00,100 --> 00:00:01,800\nEnglish one\n\n2\n00:00:02,500 --> 00:00:03,800\nEnglish two`);
  const aligned = alignTranslatedCues(chinese, english);
  assert.equal(aligned[0].startUs, chinese[0].startUs);
  assert.equal(aligned[1].endUs, chinese[1].endUs);
  assert.equal(aligned[0].text, "English one");
});

test("Obsidian 书籍元数据优先读取 frontmatter 封面", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-vault-"));
  const folder = path.join(vault, "00_INPUT", "微信读书");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "被讨厌的勇气.md"), [
    "---", "title: 被讨厌的勇气", "author: 岸见一郎", "cover: https://example.com/cover.jpg", "---", "# 元数据", "",
  ].join("\n"));
  const book = findObsidianBook({ vaultPath: vault, wereadFolder: "00_INPUT/微信读书", title: "被讨厌的勇气" });
  assert.equal(book.author, "岸见一郎");
  assert.equal(book.cover, "https://example.com/cover.jpg");
});

test("三种画幅按扣子基准画布缩放位置参数", () => {
  const portrait = loadLayout(ROOT, "9:16");
  const threeFour = loadLayout(ROOT, "3:4");
  const landscape = loadLayout(ROOT, "4:3");
  assert.deepEqual(portrait.canvas, { width: 1080, height: 1920 });
  assert.deepEqual(threeFour.canvas, { width: 720, height: 960 });
  assert.deepEqual(landscape.canvas, { width: 960, height: 720 });
  assert.equal(threeFour.style.bodyCaption.transformY, -365);
  assert.equal(threeFour.style.englishCaption.transformY, -480);
  assert.equal(threeFour.style.bookTitle.transformY, 470);
  assert.equal(threeFour.style.author.transformY, 346);
  assert.equal(landscape.style.bookTitle.transformY, 353);
  assert.equal(threeFour.style.cover.transformX, -564);
});

test("16:9 画幅和唱片播放器模板可独立加载", () => {
  const landscape = loadLayout(ROOT, "16:9");
  const cassette = loadDraftTemplate(ROOT, "cassette-player");
  assert.deepEqual(landscape.canvas, { width: 1920, height: 1080 });
  assert.equal(cassette.aspect, "16:9");
  assert.deepEqual(cassette.canvas, { width: 1920, height: 1080 });
  assert.equal(cassette.displayName, "唱片夜读·沉浸播放器");
  assert.equal(cassette.templateRole, "second");
  assert.equal(cassette.templateVersion, 2);
  assert.equal(cassette.materials.bigRecord, "播放器模板/大唱片.png");
  assert.equal(cassette.materials.smallPlayer, "播放器模板/彩色小播放器.png");
  assert.equal(cassette.layout.bigRecord.scale, 0.53);
  assert.equal(cassette.layout.smallPlayer.scale, 0.32);
  assert.deepEqual(cassette.layout.sideWaveLeft, { scale: 0.15, transformX: -1632, transformY: -918 });
  assert.deepEqual(cassette.layout.sideWaveRight, { scale: 0.15, transformX: 1632, transformY: -918 });
  assert.deepEqual(cassette.layout.timeDisplay, { scale: 0.06, transformX: -1700, transformY: -820 });
  assert.equal(cassette.layout.coverWindow.transformX, -1200);
  assert.equal(cassette.layout.coverWindow.roundCorner, 20);
  assert.equal(cassette.text.bookTitle.fontSize, 10);
  assert.equal(cassette.text.caption.fontSize, 5);
  assert.equal(cassette.layout.progressDot.endX, 1545);
});

test("第三个模板使用 4:3 知识卡片布局", () => {
  const template = loadDraftTemplate(ROOT, "knowledge-card");
  assert.equal(template.displayName, "三分钟精读·知识导航");
  assert.deepEqual(template.canvas, { width: 1440, height: 1080 });
  assert.deepEqual(template.chapters, ["书籍引入", "内容介绍", "解决问题", "价值倡导"]);
  assert.equal("keywords" in template, false);
  assert.deepEqual(template.layout.openBook, { scale: 0.8, transformX: 0, transformY: -155 });
  assert.deepEqual(template.layout.chapterXs, [-1108, -414, 287, 1052]);
  assert.equal(template.layout.chapterY, 1000);
  assert.deepEqual(template.motion, { startScale: 0.8, endScale: 0.85 });
  assert.deepEqual(template.navigation, { visibility: "full", progressBars: false });
  assert.deepEqual(
    { x: template.text.bookTitle.transformX, y: template.text.bookTitle.transformY },
    { x: -1045, y: -785 },
  );
  assert.deepEqual(
    {
      fontSize: template.text.openingBookTitle.fontSize,
      x: template.text.openingBookTitle.transformX,
      y: template.text.openingBookTitle.transformY,
    },
    { fontSize: 15, x: 0, y: 650 },
  );
  assert.deepEqual(
    { x: template.text.openingAuthor.transformX, y: template.text.openingAuthor.transformY },
    { x: 330, y: 400 },
  );
  assert.deepEqual(
    { x: template.text.author.transformX, y: template.text.author.transformY },
    { x: -1065, y: -940 },
  );
  assert.ok(Number.isInteger(template.text.chapter.fontSize));
  assert.equal("chapterActive" in template.text, false);
  assert.ok(Number.isInteger(template.text.bookTitle.fontSize));
  assert.ok(Number.isInteger(template.text.author.fontSize));
  assert.equal(template.templateVersion, 5);
});
