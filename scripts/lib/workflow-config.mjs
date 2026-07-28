import fs from "node:fs";
import path from "node:path";

export function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`读取 JSON 失败：${filePath}\n${error.message}`);
  }
}

export function loadWorkflowConfig(root, explicitPath) {
  const preferredPath = path.resolve(root, explicitPath || ".readflow.local.json");
  const legacyPath = path.resolve(root, ".book-video.local.json");
  const configPath = !explicitPath && !fs.existsSync(preferredPath) && fs.existsSync(legacyPath)
    ? legacyPath
    : preferredPath;
  if (!fs.existsSync(configPath)) {
    throw new Error(`找不到本地配置：${configPath}\n请复制 config/workflow.example.json 为 .readflow.local.json 后填写本机路径。`);
  }
  const config = readJson(configPath);
  const required = [
    ["obsidian.vaultPath", config.obsidian?.vaultPath],
    ["materials.root", config.materials?.root],
    ["capcutMate.baseUrl", config.capcutMate?.baseUrl],
  ];
  const missing = required.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`本地配置缺少：${missing.join("、")}`);
  return { config, configPath };
}

export function loadLayout(root, aspect) {
  const layoutPath = path.join(root, "templates", "jianying-draft", "layouts.json");
  const layout = readJson(layoutPath);
  const canvas = layout.aspects?.[aspect];
  if (!canvas) throw new Error(`不支持画幅 ${aspect}；可选：${Object.keys(layout.aspects || {}).join("、")}`);
  const scaleX = canvas.width / layout.baseCanvas.width;
  const scaleY = canvas.height / layout.baseCanvas.height;
  const scaledStyle = Object.fromEntries(Object.entries(layout.cozeStyle).map(([key, value]) => [
    key,
    {
      ...value,
      transformX: Math.round((value.transformX || 0) * scaleX),
      transformY: value.transformYRatio == null
        ? Math.round((value.transformY || 0) * scaleY)
        : Math.round(value.transformYRatio * canvas.height),
    },
  ]));
  return { aspect, canvas, style: scaledStyle, baseCanvas: layout.baseCanvas };
}

export function loadDraftTemplate(root, templateId) {
  const templatePath = path.join(root, "templates", "jianying-draft", `${templateId}.json`);
  if (!fs.existsSync(templatePath)) throw new Error(`找不到剪映模板：${templateId}`);
  const template = readJson(templatePath);
  if (!template.canvas?.width || !template.canvas?.height) throw new Error(`剪映模板缺少画布尺寸：${templatePath}`);
  return { ...template, templatePath };
}

export function parseCliArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    if (key.startsWith("no-")) {
      args[key.slice(3)] = false;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export function resolveMaterialPath(config, key) {
  const relative = config.materials?.[key];
  if (!relative) throw new Error(`本地配置未设置 materials.${key}`);
  const filePath = path.resolve(config.materials.root, relative);
  if (!fs.existsSync(filePath)) throw new Error(`找不到固定素材：${filePath}`);
  return filePath;
}

export function slugifyTitle(title) {
  return String(title).trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-");
}
