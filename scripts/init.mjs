#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const STATE_PATH = path.join(ROOT, ".readflow-state.json");
const LEGACY_STATE_PATH = path.join(ROOT, ".book-automation-state.json");
const CONFIG_PATH = path.join(ROOT, ".readflow.local.json");
const LEGACY_CONFIG_PATH = path.join(ROOT, ".book-video.local.json");
const EXAMPLE_CONFIG_PATH = path.join(ROOT, "config", "workflow.example.json");

function commandAvailable(command, args = ["--version"]) {
  return spawnSync(command, args, { stdio: "ignore", shell: false }).status === 0;
}

function migrateLocalFile(currentPath, legacyPath, examplePath = "") {
  if (fs.existsSync(currentPath)) return "ready";
  if (fs.existsSync(legacyPath)) {
    fs.copyFileSync(legacyPath, currentPath);
    return "migrated";
  }
  if (examplePath && fs.existsSync(examplePath)) {
    fs.copyFileSync(examplePath, currentPath);
    return "created_from_example";
  }
  return "missing";
}

const configStatus = migrateLocalFile(CONFIG_PATH, LEGACY_CONFIG_PATH, EXAMPLE_CONFIG_PATH);
const previousStatePath = fs.existsSync(STATE_PATH) ? STATE_PATH : LEGACY_STATE_PATH;
let previousState = {};
if (fs.existsSync(previousStatePath)) {
  try { previousState = JSON.parse(fs.readFileSync(previousStatePath, "utf8")); } catch { previousState = {}; }
}

const checks = {
  node: Number(process.versions.node.split(".")[0]) >= 22,
  ffmpeg: commandAvailable("ffmpeg", ["-hide_banner", "-h"]),
  ffprobe: commandAvailable("ffprobe", ["-version"]),
  git: commandAvailable("git"),
  uv: commandAvailable("uv"),
  config: fs.existsSync(CONFIG_PATH),
  capcutMate: fs.existsSync(path.join(ROOT, ".tools", "capcut-mate", "main.py")),
};
const state = {
  schemaVersion: 2,
  product: "ReadFlow Studio",
  workflow: "obsidian-srt-jianying-draft",
  initializedAt: previousState.initializedAt || new Date().toISOString(),
  lastCheckedAt: new Date().toISOString(),
  platform: `${process.platform}-${os.arch()}`,
  configStatus,
  checks,
};
fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);

console.log(JSON.stringify(state, null, 2));
if (!checks.node || !checks.ffmpeg || !checks.ffprobe) process.exitCode = 1;
if (!checks.uv || !checks.capcutMate) {
  console.warn("提示：生成剪映草稿前还需要 uv 和 CapCut Mate；运行 npm run capcut:setup 完成准备。");
}
if (configStatus === "created_from_example") {
  console.warn("已创建 .readflow.local.json，请填写 Obsidian、固定素材和剪映相关本机路径。");
}
