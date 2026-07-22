#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const target = path.resolve(process.env.CAPCUT_MATE_DIR || process.argv[2] || path.join(ROOT, ".tools", "capcut-mate"));
if (!fs.existsSync(path.join(target, "main.py"))) {
  console.error(`找不到 CapCut Mate：${target}\n请先运行 npm run capcut:setup。`);
  process.exit(1);
}
const result = spawnSync("uv", ["run", "main.py"], { cwd: target, stdio: "inherit", shell: false });
process.exit(result.status ?? 1);
