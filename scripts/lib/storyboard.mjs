import { formatUs } from "./srt.mjs";

function compactText(text) {
  return String(text).replace(/\s+/g, "").trim();
}

export function buildStoryboard(cues, introOffsetUs, options = {}) {
  if (!cues.length) return [];
  const minimum = options.minCueCount ?? 5;
  const maximum = options.maxCueCount ?? 10;
  let cueCounts = options.cueCounts?.map(Number) || null;
  if (cueCounts) {
    if (cueCounts.some((count) => !Number.isInteger(count) || count <= 0)) {
      throw new Error("分镜字幕数量必须是正整数");
    }
    if (cueCounts.reduce((sum, count) => sum + count, 0) !== cues.length) {
      throw new Error(`分镜字幕数量合计必须等于 ${cues.length}`);
    }
    if (cues.length >= minimum && cueCounts.some((count) => count < minimum || count > maximum)) {
      throw new Error(`每个分镜必须包含 ${minimum}～${maximum} 条字幕`);
    }
  } else if (cues.length <= maximum) {
    cueCounts = [cues.length];
  } else {
    const sceneCount = Math.ceil(cues.length / 8);
    const base = Math.floor(cues.length / sceneCount);
    const remainder = cues.length % sceneCount;
    cueCounts = Array.from({ length: sceneCount }, (_, index) => base + (index < remainder ? 1 : 0));
  }

  let cursor = 0;
  return cueCounts.map((count, index) => {
    const group = cues.slice(cursor, cursor + count);
    cursor += count;
    const first = group[0];
    const last = group.at(-1);
    return {
      id: `S${String(index + 1).padStart(3, "0")}`,
      bodyStartUs: first.startUs,
      bodyEndUs: last.endUs,
      draftStartUs: first.startUs + introOffsetUs,
      draftEndUs: last.endUs + introOffsetUs,
      text: group.map((cue) => compactText(cue.text)).join(" "),
      subtitleIndexes: group.map((cue) => cue.index),
      imageFile: `scene-${String(index + 1).padStart(3, "0")}.png`,
      materialStatus: "generate",
    };
  });
}

export function storyboardMarkdown(scenes) {
  const header = [
    "# 分镜表",
    "",
    "> 这是剪辑和配图的时间真源。一个分镜对应一张图，每镜原则上覆盖 5～10 条字幕，字幕仍按 SRT 逐条显示。",
    "",
    "| 镜号 | 成片时间 | 旁白/文案 | 视觉风格 | 画面设计 | B-roll | 模板/动画 | 字幕/屏幕文字 | 生成确认 | 修改意见 | 备注 |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  const rows = scenes.map((scene) => {
    const confirmed = scene.materialStatus === "confirmed";
    return [
      scene.id,
      `${formatUs(scene.draftStartUs)} - ${formatUs(scene.draftEndUs)}`,
      scene.text.replace(/\|/g, "\\|"),
      scene.visualStyle || "待指定",
      confirmed ? "已生成无文字的情绪与象征配图" : scene.imagePrompt.replace(/\|/g, "\\|"),
      `images/${scene.imageFile}（${scene.materialStatus}）`,
      "慢推近 1.0 → 1.1",
      `SRT 第 ${scene.subtitleIndexes.join("、")} 条`,
      confirmed ? "已并入 B-roll" : "待确认",
      "",
      "保持画面比例，不拉伸",
    ].join(" | ");
  });
  return `${header.join("\n")}\n| ${rows.join(" |\n| ")} |\n`;
}
