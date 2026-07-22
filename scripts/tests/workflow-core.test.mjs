import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseSrt, shiftCues, alignTranslatedCues } from "../lib/srt.mjs";
import { buildStoryboard } from "../lib/storyboard.mjs";
import { findObsidianBook } from "../lib/obsidian-books.mjs";
import { loadLayout } from "../lib/workflow-config.mjs";

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
