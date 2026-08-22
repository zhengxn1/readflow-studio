import fs from "node:fs";
import path from "node:path";

function requirePositiveDuration(value, materialName) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${materialName}时长必须是有限且大于 0 的数值`);
  }
}

export function buildV3Timeline({
  introVoiceDurationUs,
  titleVoiceDurationUs,
  bodyDurationUs,
}) {
  requirePositiveDuration(introVoiceDurationUs, "片头语音");
  requirePositiveDuration(titleVoiceDurationUs, "书名语音");
  requirePositiveDuration(bodyDurationUs, "正文音频");

  const introStartUs = 0;
  const introEndUs = introVoiceDurationUs;
  const titleStartUs = introEndUs;
  const titleEndUs = titleStartUs + titleVoiceDurationUs;
  const bodyStartUs = titleEndUs;
  const bodyEndUs = bodyStartUs + bodyDurationUs;

  return {
    introStartUs,
    introEndUs,
    titleStartUs,
    titleEndUs,
    bodyStartUs,
    bodyEndUs,
    totalDurationUs: bodyEndUs,
  };
}

function normalizeBookTitle(value) {
  return String(value ?? "").replace(/[《》\s]/gu, "");
}

export function validateBodyCues(cues, bookTitle) {
  if (!Array.isArray(cues) || cues.length === 0) {
    throw new Error("正文字幕不能为空");
  }
  if (cues[0].startUs !== 0) {
    throw new Error("正文第一条字幕必须从 0 开始");
  }
  if (normalizeBookTitle(cues[0].text) === normalizeBookTitle(bookTitle)) {
    throw new Error("正文第一条字幕不能是书名");
  }
}

export function resolveOptionalMaterial(
  config,
  key,
  { kind = "file", onMissing = console.warn } = {},
) {
  if (kind !== "file" && kind !== "directory") {
    throw new Error(`不支持的可选素材类型：${kind}`);
  }

  const root = config?.materials?.root;
  const configuredPath = config?.materials?.[key];
  const notifyMissing = (message) => {
    if (typeof onMissing === "function") onMissing(message);
    return "";
  };
  if (!root || !configuredPath) {
    return notifyMissing(`可选素材 materials.${key} 未配置，已跳过`);
  }

  const materialPath = path.resolve(root, configuredPath);
  try {
    const stats = fs.statSync(materialPath);
    const hasExpectedType = kind === "directory" ? stats.isDirectory() : stats.isFile();
    if (!hasExpectedType) {
      return notifyMissing(`可选素材类型不匹配，已跳过：${materialPath}`);
    }
    return materialPath;
  } catch {
    return notifyMissing(`找不到可选素材，已跳过：${materialPath}`);
  }
}

export function collectFlashImages(flashDir) {
  if (!flashDir) return [];

  let entries;
  try {
    entries = fs.readdirSync(flashDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  return entries
    .filter((entry) => entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(flashDir, entry.name))
    .sort((left, right) => path.basename(left).localeCompare(path.basename(right), "zh-CN", {
      numeric: true,
      sensitivity: "base",
    }));
}

export function buildOpeningVisualPlan({
  introEndUs,
  flashImages = [],
  introVideo = "",
  introVideoDurationUs,
}) {
  requirePositiveDuration(introEndUs, "片头语音");

  if (flashImages.length > 0) {
    const segmentDurationUs = introEndUs / flashImages.length;
    return {
      mode: "flash",
      video: null,
      coverFill: null,
      flashSegments: flashImages.map((file, index) => ({
        file,
        startUs: index * segmentDurationUs,
        endUs: index === flashImages.length - 1 ? introEndUs : (index + 1) * segmentDurationUs,
      })),
    };
  }

  if (introVideo) {
    requirePositiveDuration(introVideoDurationUs, "片头视频");
    const videoEndUs = Math.min(introVideoDurationUs, introEndUs);
    return {
      mode: "video",
      video: { file: introVideo, startUs: 0, endUs: videoEndUs },
      coverFill: videoEndUs < introEndUs ? { startUs: videoEndUs, endUs: introEndUs } : null,
      flashSegments: [],
    };
  }

  return {
    mode: "cover",
    video: null,
    coverFill: { startUs: 0, endUs: introEndUs },
    flashSegments: [],
  };
}
