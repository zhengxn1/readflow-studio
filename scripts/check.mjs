#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const scriptFiles = [
  "scripts/init.mjs",
  "scripts/check-public-release.mjs",
  "scripts/prepare-jianying-workflow.mjs",
  "scripts/create-jianying-draft.mjs",
  "scripts/templates/cassette-player.mjs",
  "scripts/templates/knowledge-card.mjs",
  "scripts/setup-capcut-mate.mjs",
  "scripts/start-capcut-mate.mjs",
  "scripts/lib/capcut-mate-client.mjs",
  "scripts/lib/media-server.mjs",
  "scripts/lib/knowledge-card.mjs",
  "scripts/lib/template-ai-assets.mjs",
  "scripts/lib/obsidian-books.mjs",
  "scripts/lib/srt.mjs",
  "scripts/lib/storyboard.mjs",
  "scripts/lib/visual-direction.mjs",
  "scripts/lib/workflow-config.mjs",
];

function run(command, args, options = {}) {
  return spawnSync(command, args, { cwd: ROOT, encoding: "utf8", shell: false, ...options });
}

for (const [command, args] of [["ffmpeg", ["-hide_banner", "-h"]], ["ffprobe", ["-version"]]]) {
  if (run(command, args, { stdio: "ignore" }).status !== 0) throw new Error(`缺少必需命令：${command}`);
}
for (const file of scriptFiles) {
  if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`缺少工作流文件：${file}`);
  const result = run(process.execPath, ["--check", file]);
  if (result.status !== 0) throw new Error(result.stderr || `语法检查失败：${file}`);
}

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "workflow.example.json"), "utf8"));
for (const key of ["bgm", "introVideo", "introVoice", "mechanicalSfx", "waterDropSfx", "textStartSfx", "flashDir"]) {
  if (!config.materials?.[key]) throw new Error(`示例配置缺少 materials.${key}`);
}
const layouts = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "jianying-draft", "layouts.json"), "utf8"));
for (const aspect of ["3:4", "9:16", "4:3", "16:9"]) {
  if (!layouts.aspects?.[aspect]) throw new Error(`画幅模板缺少：${aspect}`);
}
const templateCatalog = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "jianying-draft", "catalog.json"), "utf8"));
if (templateCatalog.templates?.length !== 3) throw new Error("模板目录必须包含三套公开模板");
if (templateCatalog.templates.map((item) => item.id).join("|") !== "classic|cassette-player|knowledge-card") {
  throw new Error("模板目录的公开顺序或内部 ID 不正确");
}
const cassetteTemplate = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "jianying-draft", "cassette-player.json"), "utf8"));
if (cassetteTemplate.id !== "cassette-player") throw new Error("唱片播放器模板 ID 不正确");
if (cassetteTemplate.aspect !== "16:9" || cassetteTemplate.canvas?.width !== 1920 || cassetteTemplate.canvas?.height !== 1080) {
  throw new Error("唱片播放器模板必须使用 1920×1080 的 16:9 画布");
}
const knowledgeCardTemplate = JSON.parse(fs.readFileSync(path.join(ROOT, "templates", "jianying-draft", "knowledge-card.json"), "utf8"));
if (knowledgeCardTemplate.id !== "knowledge-card") throw new Error("三分钟精读模板 ID 不正确");
if (knowledgeCardTemplate.aspect !== "4:3" || knowledgeCardTemplate.canvas?.width !== 1440 || knowledgeCardTemplate.canvas?.height !== 1080) {
  throw new Error("三分钟精读模板必须使用 1440×1080 的 4:3 画布");
}
if (knowledgeCardTemplate.chapters?.length !== 4) throw new Error("三分钟精读模板必须包含四个章节");
if (knowledgeCardTemplate.templateVersion < 5 || !knowledgeCardTemplate.layout?.openBook) {
  throw new Error("三分钟精读模板缺少开场打开书动效布局");
}
if (knowledgeCardTemplate.layout.chapterY !== 1000
  || knowledgeCardTemplate.layout.chapterXs.join("|") !== "-1108|-414|287|1052") {
  throw new Error("三分钟精读模板四段导航坐标不符合锁定值");
}
if (knowledgeCardTemplate.motion?.startScale !== 0.8 || knowledgeCardTemplate.motion?.endScale !== 0.85) {
  throw new Error("三分钟精读模板画面缩放必须为 80% 到 85%");
}
if (knowledgeCardTemplate.navigation?.visibility !== "full"
  || knowledgeCardTemplate.navigation?.progressBars !== false) {
  throw new Error("三分钟精读模板四分块必须全程显示且不含进度条");
}
if (knowledgeCardTemplate.chapters.join("|") !== "书籍引入|内容介绍|解决问题|价值倡导") {
  throw new Error("三分钟精读模板章节导航与参考模板不一致");
}
for (const styleName of ["chapter", "openingBookTitle", "openingAuthor", "bookTitle", "author", "nickname"]) {
  if (!Number.isInteger(knowledgeCardTemplate.text?.[styleName]?.fontSize)) {
    throw new Error(`三分钟精读模板 ${styleName} 字号必须是剪映接口接受的整数`);
  }
}

const workflowTests = fs.readdirSync(path.join(ROOT, "scripts", "tests"))
  .filter((name) => /^workflow-.*\.test\.mjs$/u.test(name))
  .map((name) => path.join("scripts", "tests", name));
const tests = run(process.execPath, ["--test", ...workflowTests], { stdio: "inherit" });
if (tests.status !== 0) process.exit(tests.status || 1);
console.log("ReadFlow Studio checks: ok");
