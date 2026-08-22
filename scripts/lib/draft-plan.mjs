function numberedTracks(prefix, labels) {
  return labels.map((label, index) => `${prefix}${index + 1} ${label}`);
}

function isUsablePath(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function normalizeCoverFiles(coverFiles) {
  if (Array.isArray(coverFiles)) {
    return { full: coverFiles[0], cover: coverFiles[1] };
  }
  return {
    full: coverFiles?.full ?? coverFiles?.fullCover ?? coverFiles?.fullCoverPath,
    cover: coverFiles?.cover ?? coverFiles?.bookCover ?? coverFiles?.bookCoverPath,
  };
}

export function compactPaths(paths = []) {
  const values = Array.isArray(paths) ? paths : [];
  return [...new Set(values.filter(isUsablePath))];
}

export function normalizeDraftTimeline(workflow, shiftedCues = []) {
  if (Number(workflow?.schemaVersion) >= 3) {
    const timeline = workflow.timeline || {};
    return {
      introEndUs: timeline.introEndUs,
      titleStartUs: timeline.titleStartUs,
      titleEndUs: timeline.titleEndUs,
      bodyAudioStartUs: timeline.bodyStartUs,
      firstBodySentenceStartUs: timeline.bodyStartUs,
      totalEndUs: timeline.totalDurationUs,
    };
  }

  const introEndUs = workflow?.intro?.durationUs;
  const titleStartUs = workflow?.intro?.captionOffsetUs;
  const cues = Array.isArray(shiftedCues) ? shiftedCues : [];
  return {
    introEndUs,
    titleStartUs,
    titleEndUs: cues[0]?.endUs || introEndUs,
    bodyAudioStartUs: titleStartUs,
    firstBodySentenceStartUs: cues[1]?.startUs || introEndUs,
    totalEndUs: workflow?.totalDurationUs,
  };
}

export function buildV3AudioSegments({
  timeline,
  durations,
  materials = {},
  introOnly = false,
}) {
  const timelineEndUs = introOnly ? timeline.bodyAudioStartUs : timeline.totalEndUs;
  const segments = [
    {
      key: "introVoice",
      start: 0,
      end: timeline.introEndUs,
      sourceDurationUs: durations.introVoice,
    },
    {
      key: "titleVoice",
      start: timeline.titleStartUs,
      end: timeline.titleEndUs,
      sourceDurationUs: durations.titleVoice,
    },
  ];

  if (!introOnly) {
    segments.push({
      key: "bodyVoice",
      start: timeline.bodyAudioStartUs,
      end: Math.min(timelineEndUs, timeline.bodyAudioStartUs + durations.bodyVoice),
      sourceDurationUs: durations.bodyVoice,
    });
  }
  if (isUsablePath(materials.mechanicalSfx)) {
    segments.push({
      key: "mechanicalSfx",
      start: 0,
      end: Math.min(timeline.introEndUs, durations.mechanicalSfx),
      sourceDurationUs: durations.mechanicalSfx,
    });
  }
  if (isUsablePath(materials.waterDropSfx)) {
    segments.push({
      key: "waterDropSfx",
      start: timeline.titleStartUs,
      end: Math.min(timelineEndUs, timeline.titleStartUs + durations.waterDropSfx),
      sourceDurationUs: durations.waterDropSfx,
    });
  }
  if (!introOnly && isUsablePath(materials.textStartSfx)) {
    segments.push({
      key: "textStartSfx",
      start: timeline.bodyAudioStartUs,
      end: Math.min(timelineEndUs, timeline.bodyAudioStartUs + durations.textStartSfx),
      sourceDurationUs: durations.textStartSfx,
    });
  }

  return segments;
}

export function buildV3DraftPlan({
  workflow,
  openingPlan,
  sceneFiles = [],
  coverFiles = {},
  hasEnglish = false,
  hasAuthor = false,
  hasNickname = false,
  hasSourceNote = false,
  introOnly = false,
}) {
  const fixedMaterials = workflow.fixedMaterials || {};
  const inputs = workflow.inputs || {};
  const bodyVoice = inputs.bodyVoice ?? inputs.voice;
  const covers = normalizeCoverFiles(coverFiles);
  const scenes = Array.isArray(sceneFiles) ? sceneFiles : [];
  const flashSegments = Array.isArray(openingPlan?.flashSegments) ? openingPlan.flashSegments : [];
  const flashFiles = flashSegments.map((segment) => segment?.filePath);
  const selectedOpeningVideo = openingPlan?.mode === "video" ? openingPlan?.video?.filePath : undefined;
  const selectedFlashFiles = openingPlan?.mode === "flash" ? flashFiles : [];
  const hasOpeningVideo = isUsablePath(selectedOpeningVideo);
  const hasFlashImages = selectedFlashFiles.some(isUsablePath);

  const videoLabels = [];
  if (openingPlan?.mode === "video" && hasOpeningVideo) videoLabels.push("片头 MOV");
  if (openingPlan?.mode === "flash" && hasFlashImages) videoLabels.push("快闪素材");
  videoLabels.push("全画幅书籍封面");
  if (!introOnly) videoLabels.push("正文分镜图片", "缩小书籍封面");

  const textLabels = ["书名"];
  if (!introOnly) {
    textLabels.push("正文中文字幕");
    if (hasEnglish) textLabels.push("英文字幕");
    textLabels.push("常驻书名");
    if (hasAuthor) textLabels.push("作者");
    if (hasNickname) textLabels.push("昵称");
    if (hasSourceNote) textLabels.push("来源说明");
  }

  const audioLabels = [];
  if (!introOnly) audioLabels.push("正文旁白");
  if (isUsablePath(fixedMaterials.bgm)) audioLabels.push("背景音乐");
  audioLabels.push("片头话术", "书名配音");
  if (isUsablePath(fixedMaterials.mechanicalSfx)) audioLabels.push("机械音效");
  if (isUsablePath(fixedMaterials.waterDropSfx)) audioLabels.push("水滴音效");
  if (!introOnly && isUsablePath(fixedMaterials.textStartSfx)) audioLabels.push("正文开头音效");

  return {
    schemaVersion: 2,
    project: workflow.projectName ?? workflow.project,
    aspect: workflow.aspect,
    canvas: workflow.canvas,
    tracks: {
      video: numberedTracks("V", videoLabels),
      text: numberedTracks("T", textLabels),
      audio: numberedTracks("A", audioLabels),
    },
    sourceFiles: compactPaths([
      selectedOpeningVideo,
      ...selectedFlashFiles,
      covers.full,
      ...(!introOnly ? [covers.cover] : []),
      ...(!introOnly ? scenes : []),
      inputs.introVoice,
      inputs.titleVoice,
      ...(!introOnly ? [bodyVoice] : []),
      fixedMaterials.bgm,
      fixedMaterials.mechanicalSfx,
      fixedMaterials.waterDropSfx,
      ...(!introOnly ? [fixedMaterials.textStartSfx] : []),
    ]),
  };
}
