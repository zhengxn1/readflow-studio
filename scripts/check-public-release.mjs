#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const requiredFiles = [
  ".gitignore",
  "AGENTS.md",
  "LICENSE",
  "README.md",
  "config/workflow.example.json",
  "docs/readflow-studio-playbook.md",
  "episodes/README.md",
  "package.json",
  "scripts/check.mjs",
  "scripts/check-public-release.mjs",
  "scripts/create-jianying-draft.mjs",
  "scripts/init.mjs",
  "scripts/prepare-jianying-workflow.mjs",
  "templates/jianying-draft/layouts.json",
];
const forbiddenPrefixes = [
  ".ai/",
  ".tools/",
  "assets/",
  "data/",
  "templates/shared-video-template/",
];
const forbiddenExact = new Set([
  ".env",
  ".readflow.local.json",
  ".readflow-state.json",
  ".book-video.local.json",
  ".book-automation-state.json",
]);
const forbiddenMedia = /\.(?:aac|avi|flac|gif|jpe?g|m4a|mkv|mov|mp3|mp4|png|srt|wav|webp|zip)$/iu;
const textExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".txt", ".yaml", ".yml"]);

function git(args) {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false });
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `git ${args.join(" ")} 执行失败`);
  return result.stdout;
}

const candidates = git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
  .split("\0")
  .filter(Boolean)
  .filter((file) => fs.existsSync(path.join(ROOT, file)));
const candidateSet = new Set(candidates);
const errors = [];
const warnings = [];

for (const file of requiredFiles) {
  if (!candidateSet.has(file)) errors.push(`缺少公开核心文件：${file}`);
}
for (const file of candidates) {
  if (forbiddenExact.has(file) || forbiddenPrefixes.some((prefix) => file.startsWith(prefix))) {
    errors.push(`不应发布的本地内容：${file}`);
  }
  if (file !== "episodes/README.md" && file.startsWith("episodes/")) errors.push(`不应发布的每期素材：${file}`);
  if (forbiddenMedia.test(file)) errors.push(`不应发布的媒体文件：${file}`);

  const extension = path.extname(file).toLowerCase();
  const absolute = path.join(ROOT, file);
  if (!textExtensions.has(extension) || fs.statSync(absolute).size > 2_000_000) continue;
  const content = fs.readFileSync(absolute, "utf8");
  if (/\/Users\/[A-Za-z0-9._-]+\//u.test(content)) errors.push(`发现本机绝对路径：${file}`);
  if (/wxid_[A-Za-z0-9_]+/u.test(content)) errors.push(`发现微信账号标识：${file}`);
  if (/(?:api[_-]?key|token|secret)\s*[:=]\s*["']?(?!YOUR_|<|\/path\/to|示例|example)[A-Za-z0-9_\-.]{16,}/iu.test(content)) {
    errors.push(`发现疑似密钥：${file}`);
  }
}

const remotes = git(["remote", "-v"]).trim();
if (!remotes) warnings.push("尚未配置用户自己的 GitHub 远端；完成下一本书测试后再添加。");
if (/^\S+\s+\S*Endless1936\/book-video\.git\s+\(push\)$/imu.test(remotes)) {
  errors.push("仍存在原始 book-video 推送地址，上传前必须改为用户自己的 GitHub 仓库。");
}

if (errors.length) {
  console.error(["公开发布检查失败：", ...errors.map((item) => `- ${item}`)].join("\n"));
  process.exit(1);
}
console.log(`公开发布文件检查通过：${candidates.length} 个文件。`);
for (const warning of warnings) console.warn(`提示：${warning}`);
