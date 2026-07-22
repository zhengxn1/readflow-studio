#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const target = path.resolve(process.argv[2] || path.join(ROOT, ".tools", "capcut-mate"));

function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (!fs.existsSync(path.dirname(target))) fs.mkdirSync(path.dirname(target), { recursive: true });
if (!fs.existsSync(target)) {
  run("git", ["clone", "--depth", "1", "https://github.com/Hommy-master/capcut-mate.git", target]);
} else if (!fs.existsSync(path.join(target, ".git"))) {
  throw new Error(`目标目录已存在但不是 CapCut Mate Git 仓库：${target}`);
}

const uv = spawnSync("uv", ["--version"], { encoding: "utf8", shell: false });
if (uv.status !== 0) {
  console.error("缺少 uv。请先按 https://docs.astral.sh/uv/ 安装，然后重新运行 npm run capcut:setup。");
  process.exit(1);
}
run("uv", ["sync"], target);
console.log(`CapCut Mate 已准备完成：${target}`);
console.log("下一步：npm run capcut:start");
