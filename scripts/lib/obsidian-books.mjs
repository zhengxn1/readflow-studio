import fs from "node:fs";
import path from "node:path";

function walkMarkdownFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(fullPath);
    }
  }
  return files;
}

function parseFrontmatter(text) {
  const match = String(text).match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) return {};
  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!item) continue;
    data[item[1]] = item[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return data;
}

function normalizeTitle(value) {
  return String(value || "").replace(/[《》\s·•:：()（）\[\]【】]/g, "").toLowerCase();
}

export function findObsidianBook({ vaultPath, wereadFolder, title }) {
  const root = path.resolve(vaultPath, wereadFolder);
  if (!fs.existsSync(root)) throw new Error(`找不到 Obsidian 微信读书目录：${root}`);
  const query = normalizeTitle(title);
  const candidates = [];
  for (const filePath of walkMarkdownFiles(root)) {
    const text = fs.readFileSync(filePath, "utf8");
    const frontmatter = parseFrontmatter(text);
    const noteTitle = frontmatter.title || path.basename(filePath, path.extname(filePath)).split("-")[0];
    const normalized = normalizeTitle(noteTitle);
    let score = 0;
    if (normalized === query) score = 100;
    else if (normalized.startsWith(query) || query.startsWith(normalized)) score = 80;
    else if (normalized.includes(query) || query.includes(normalized)) score = 60;
    if (!score) continue;
    const markdownCover = text.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/)?.[1];
    candidates.push({
      score,
      filePath,
      title: noteTitle,
      author: frontmatter.author || "",
      cover: frontmatter.cover || markdownCover || "",
      bookId: frontmatter.bookId || "",
      isbn: frontmatter.isbn || "",
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath, "zh-CN"));
  if (candidates.length === 0) throw new Error(`Obsidian 中没有找到《${title}》`);
  if (candidates.length > 1 && candidates[0].score === candidates[1].score && candidates[0].title !== candidates[1].title) {
    throw new Error(`找到多个同等匹配的书籍：${candidates.slice(0, 3).map((item) => item.title).join("、")}`);
  }
  if (!candidates[0].cover) throw new Error(`《${candidates[0].title}》的 Obsidian 笔记没有封面地址`);
  return candidates[0];
}

export async function downloadBookCover(url, destination) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 readflow-studio" } });
  if (!response.ok) throw new Error(`下载书籍封面失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1024) throw new Error("下载到的封面文件异常小");
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  return { bytes: bytes.length, contentType: response.headers.get("content-type") || "" };
}
