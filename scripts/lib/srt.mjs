function timestampToUs(value) {
  const match = String(value).trim().match(/^(\d{1,3}):(\d{2}):(\d{2})[,.](\d{3})$/);
  if (!match) throw new Error(`无法识别 SRT 时间：${value}`);
  const [, hours, minutes, seconds, milliseconds] = match;
  return (((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(milliseconds)) * 1000;
}

export function parseSrt(input) {
  const text = String(input).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error("SRT 文件为空");

  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/^(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/);
    if (!timing) throw new Error(`无法识别 SRT 时间行：${lines[timingIndex]}`);
    const startUs = timestampToUs(timing[1]);
    const endUs = timestampToUs(timing[2]);
    const cueText = lines.slice(timingIndex + 1).join("\n").trim();
    if (!cueText) continue;
    if (endUs <= startUs) throw new Error(`SRT 结束时间必须晚于开始时间：${lines[timingIndex]}`);
    cues.push({ index: cues.length + 1, startUs, endUs, text: cueText });
  }

  if (cues.length === 0) throw new Error("SRT 中没有有效字幕");
  for (let index = 1; index < cues.length; index += 1) {
    if (cues[index].startUs < cues[index - 1].startUs) {
      throw new Error(`SRT 时间未按顺序排列，第 ${index + 1} 条早于上一条`);
    }
  }
  return cues;
}

export function shiftCues(cues, offsetUs) {
  return cues.map((cue) => ({
    ...cue,
    startUs: cue.startUs + offsetUs,
    endUs: cue.endUs + offsetUs,
  }));
}

export function alignTranslatedCues(sourceCues, translatedCues) {
  if (translatedCues.length !== sourceCues.length) {
    throw new Error(`中英文字幕条数不一致：中文 ${sourceCues.length} 条，英文 ${translatedCues.length} 条`);
  }
  return translatedCues.map((cue, index) => ({
    ...cue,
    index: sourceCues[index].index,
    startUs: sourceCues[index].startUs,
    endUs: sourceCues[index].endUs,
  }));
}

export function cuesToCapcut(cues) {
  return cues.map((cue) => ({ start: cue.startUs, end: cue.endUs, text: cue.text }));
}

export function formatUs(us) {
  const totalMs = Math.max(0, Math.round(us / 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}`;
}
