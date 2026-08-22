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
  "scripts/setup-capcut-mate.mjs",
  "scripts/start-capcut-mate.mjs",
  "scripts/lib/capcut-mate-client.mjs",
  "scripts/lib/media-server.mjs",
  "scripts/lib/obsidian-books.mjs",
  "scripts/lib/opening-workflow.mjs",
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
for (const aspect of ["3:4", "9:16", "4:3"]) {
  if (!layouts.aspects?.[aspect]) throw new Error(`画幅模板缺少：${aspect}`);
}

const workflowTests = fs.readdirSync(path.join(ROOT, "scripts", "tests"))
  .filter((name) => /^workflow-.*\.test\.mjs$/u.test(name))
  .map((name) => path.join("scripts", "tests", name));
const tests = run(process.execPath, ["--test", ...workflowTests], { stdio: "inherit" });
if (tests.status !== 0) process.exit(tests.status || 1);
console.log("ReadFlow Studio checks: ok");
