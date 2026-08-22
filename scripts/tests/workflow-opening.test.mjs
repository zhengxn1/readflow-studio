import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildOpeningVisualPlan,
  buildV3Timeline,
  collectFlashImages,
  resolveOptionalMaterial,
  validateBodyCues,
} from "../lib/opening-workflow.mjs";
import {
  buildV3AudioSegments,
  buildV3DraftPlan,
  compactPaths,
  normalizeDraftTimeline,
} from "../lib/draft-plan.mjs";

function createV3Workflow(fixedMaterials = {}) {
  return {
    schemaVersion: 3,
    projectName: "测试项目",
    aspect: "3:4",
    canvas: { width: 720, height: 960 },
    timeline: {
      introStartUs: 0,
      introEndUs: 2_000_000,
      titleStartUs: 2_000_000,
      titleEndUs: 3_000_000,
      bodyStartUs: 3_000_000,
      bodyEndUs: 11_000_000,
      totalDurationUs: 11_000_000,
    },
    inputs: {
      introVoice: "intro.mp3",
      titleVoice: "title.mp3",
      bodyVoice: "body.mp3",
    },
    fixedMaterials: {
      bgm: "",
      mechanicalSfx: "",
      waterDropSfx: "",
      textStartSfx: "",
      ...fixedMaterials,
    },
  };
}

test("草稿计划模块导出动态轨道和时间线工具", () => {
  assert.equal(typeof buildV3DraftPlan, "function");
  assert.equal(typeof compactPaths, "function");
  assert.equal(typeof normalizeDraftTimeline, "function");
});

test("schema v3 草稿计划只列出实际存在的轨道和去重素材", () => {
  const workflow = createV3Workflow({ mechanicalSfx: "mechanical.mp3" });
  const plan = buildV3DraftPlan({
    workflow,
    openingPlan: {
      mode: "flash",
      video: null,
      coverFill: null,
      flashSegments: [{ filePath: "flash.png", start: 0, end: 2_000_000 }],
    },
    sceneFiles: ["scene.png", "scene.png"],
    coverFiles: { full: "full-cover.png", cover: "cover.png" },
    hasEnglish: false,
    hasAuthor: true,
    hasNickname: false,
    hasSourceNote: false,
    introOnly: false,
  });

  assert.deepEqual(plan, {
    schemaVersion: 2,
    project: "测试项目",
    aspect: "3:4",
    canvas: { width: 720, height: 960 },
    tracks: {
      video: [
        "V1 快闪素材",
        "V2 全画幅书籍封面",
        "V3 正文分镜图片",
        "V4 缩小书籍封面",
      ],
      text: ["T1 书名", "T2 正文中文字幕", "T3 常驻书名", "T4 作者"],
      audio: ["A1 正文旁白", "A2 片头话术", "A3 书名配音", "A4 机械音效"],
    },
    sourceFiles: [
      "flash.png",
      "full-cover.png",
      "cover.png",
      "scene.png",
      "intro.mp3",
      "title.mp3",
      "body.mp3",
      "mechanical.mp3",
    ],
  });
  assert.equal(plan.sourceFiles.includes(""), false);
});

test("片头视频和封面回退只生成各自实际使用的开场画面轨", () => {
  const common = {
    workflow: createV3Workflow(),
    sceneFiles: [],
    coverFiles: { full: "full-cover.png", cover: "cover.png" },
    hasEnglish: false,
    hasAuthor: false,
    hasNickname: false,
    hasSourceNote: false,
    introOnly: false,
  };
  const videoPlan = buildV3DraftPlan({
    ...common,
    openingPlan: {
      mode: "video",
      video: { filePath: "intro.mov", start: 0, end: 2_000_000 },
      coverFill: null,
      flashSegments: [],
    },
  });
  const coverPlan = buildV3DraftPlan({
    ...common,
    openingPlan: {
      mode: "cover",
      video: null,
      coverFill: { start: 0, end: 2_000_000 },
      flashSegments: [],
    },
  });

  assert.equal(videoPlan.tracks.video[0], "V1 片头 MOV");
  assert.equal(videoPlan.sourceFiles.includes("intro.mov"), true);
  assert.deepEqual(coverPlan.tracks.video, [
    "V1 全画幅书籍封面",
    "V2 正文分镜图片",
    "V3 缩小书籍封面",
  ]);
  assert.equal(coverPlan.tracks.video.some((name) => /快闪|MOV/u.test(name)), false);
});

test("封面回退不收集残留的片头视频和快闪源文件", () => {
  const plan = buildV3DraftPlan({
    workflow: createV3Workflow(),
    openingPlan: {
      mode: "cover",
      video: { filePath: "unused-intro.mov", start: 0, end: 1_000_000 },
      coverFill: { start: 0, end: 2_000_000 },
      flashSegments: [{ filePath: "unused-flash.png", start: 0, end: 2_000_000 }],
    },
    sceneFiles: [],
    coverFiles: { full: "full-cover.png", cover: "cover.png" },
  });

  assert.equal(plan.sourceFiles.includes("unused-intro.mov"), false);
  assert.equal(plan.sourceFiles.includes("unused-flash.png"), false);
});

test("快闪模式不收集残留的片头视频源文件", () => {
  const plan = buildV3DraftPlan({
    workflow: createV3Workflow(),
    openingPlan: {
      mode: "flash",
      video: { filePath: "unused-intro.mov", start: 0, end: 2_000_000 },
      coverFill: null,
      flashSegments: [{ filePath: "flash.png", start: 0, end: 2_000_000 }],
    },
    sceneFiles: [],
    coverFiles: { full: "full-cover.png", cover: "cover.png" },
  });

  assert.equal(plan.sourceFiles.includes("flash.png"), true);
  assert.equal(plan.sourceFiles.includes("unused-intro.mov"), false);
});

test("必需编辑轨不因源路径暂缺而从草稿计划消失", () => {
  const workflow = createV3Workflow();
  workflow.inputs = { introVoice: "", titleVoice: "", bodyVoice: "" };
  const plan = buildV3DraftPlan({
    workflow,
    openingPlan: {
      mode: "cover",
      video: null,
      coverFill: { start: 0, end: 2_000_000 },
      flashSegments: [],
    },
    sceneFiles: [],
    coverFiles: { full: "", cover: "" },
    introOnly: false,
  });

  assert.deepEqual(plan.tracks.video, [
    "V1 全画幅书籍封面",
    "V2 正文分镜图片",
    "V3 缩小书籍封面",
  ]);
  assert.deepEqual(plan.tracks.audio, [
    "A1 正文旁白",
    "A2 片头话术",
    "A3 书名配音",
  ]);
  assert.deepEqual(plan.sourceFiles, []);
});

test("intro-only 草稿排除正文素材并保留实际开头音画", () => {
  const plan = buildV3DraftPlan({
    workflow: createV3Workflow({
      bgm: "bgm.mp3",
      mechanicalSfx: "mechanical.mp3",
      waterDropSfx: "water.mp3",
      textStartSfx: "text-start.mp3",
    }),
    openingPlan: {
      mode: "cover",
      video: null,
      coverFill: { start: 0, end: 2_000_000 },
      flashSegments: [],
    },
    sceneFiles: ["scene.png"],
    coverFiles: { full: "full-cover.png", cover: "cover.png" },
    hasEnglish: true,
    hasAuthor: true,
    hasNickname: false,
    hasSourceNote: false,
    introOnly: true,
  });

  assert.deepEqual(plan.tracks.video, ["V1 全画幅书籍封面"]);
  assert.deepEqual(plan.tracks.text, ["T1 书名"]);
  assert.deepEqual(plan.tracks.audio, [
    "A1 背景音乐",
    "A2 片头话术",
    "A3 书名配音",
    "A4 机械音效",
    "A5 水滴音效",
  ]);
  for (const excluded of ["body.mp3", "scene.png", "cover.png", "text-start.mp3"]) {
    assert.equal(plan.sourceFiles.includes(excluded), false, `${excluded} should be excluded`);
  }
  assert.deepEqual(plan.sourceFiles, [
    "full-cover.png",
    "intro.mp3",
    "title.mp3",
    "bgm.mp3",
    "mechanical.mp3",
    "water.mp3",
  ]);
});

test("compactPaths 过滤非字符串和空串并稳定去重", () => {
  assert.deepEqual(compactPaths([
    "first.png",
    "",
    null,
    "second.png",
    "first.png",
    42,
    "   ",
    "second.png",
  ]), ["first.png", "second.png"]);
});

test("不可用的可选路径不生成轨道也不进入源文件", () => {
  const plan = buildV3DraftPlan({
    workflow: createV3Workflow({
      bgm: "   ",
      mechanicalSfx: null,
      waterDropSfx: 42,
      textStartSfx: "\t",
    }),
    openingPlan: {
      mode: "video",
      video: { filePath: "   ", start: 0, end: 2_000_000 },
      coverFill: null,
      flashSegments: [],
    },
    sceneFiles: ["scene.png"],
    coverFiles: { full: "full-cover.png", cover: "cover.png" },
  });

  assert.equal(plan.tracks.video.some((name) => name.includes("片头 MOV")), false);
  assert.deepEqual(plan.tracks.audio, ["A1 正文旁白", "A2 片头话术", "A3 书名配音"]);
  assert.equal(plan.sourceFiles.some((value) => typeof value !== "string" || !value.trim()), false);
});

test("混合快闪片段只收集有效路径且仍生成快闪轨", () => {
  const plan = buildV3DraftPlan({
    workflow: createV3Workflow(),
    openingPlan: {
      mode: "flash",
      video: null,
      coverFill: null,
      flashSegments: [
        { filePath: null, start: 0, end: 1 },
        { filePath: "   ", start: 1, end: 2 },
        { filePath: 42, start: 2, end: 3 },
        { filePath: "flash.png", start: 3, end: 4 },
      ],
    },
    sceneFiles: [],
    coverFiles: { full: "", cover: "" },
  });

  assert.equal(plan.tracks.video[0], "V1 快闪素材");
  assert.deepEqual(plan.sourceFiles.filter((value) => value.includes("flash")), ["flash.png"]);
});

test("空集合输入统一按空数组处理", () => {
  let emptyPaths;
  let nullPaths;
  assert.doesNotThrow(() => {
    emptyPaths = compactPaths();
    nullPaths = compactPaths(null);
  });
  assert.deepEqual(emptyPaths, []);
  assert.deepEqual(nullPaths, []);

  let plan;
  assert.doesNotThrow(() => {
    plan = buildV3DraftPlan({
      workflow: createV3Workflow(),
      openingPlan: { mode: "cover", video: null, coverFill: null, flashSegments: null },
      sceneFiles: null,
      coverFiles: null,
    });
  });
  assert.deepEqual(plan.tracks.video, [
    "V1 全画幅书籍封面",
    "V2 正文分镜图片",
    "V3 缩小书籍封面",
  ]);
});

test("所有可选音频启用时轨道编号保持连续", () => {
  const plan = buildV3DraftPlan({
    workflow: createV3Workflow({
      bgm: "bgm.mp3",
      mechanicalSfx: "mechanical.mp3",
      waterDropSfx: "water.mp3",
      textStartSfx: "text-start.mp3",
    }),
    openingPlan: { mode: "cover", video: null, coverFill: null, flashSegments: [] },
    sceneFiles: [],
    coverFiles: { full: "full-cover.png", cover: "cover.png" },
  });

  assert.deepEqual(plan.tracks.audio, [
    "A1 正文旁白",
    "A2 背景音乐",
    "A3 片头话术",
    "A4 书名配音",
    "A5 机械音效",
    "A6 水滴音效",
    "A7 正文开头音效",
  ]);
});

test("schema v3 时间线直接归一化三段语音边界", () => {
  assert.deepEqual(normalizeDraftTimeline(createV3Workflow(), []), {
    introEndUs: 2_000_000,
    titleStartUs: 2_000_000,
    titleEndUs: 3_000_000,
    bodyAudioStartUs: 3_000_000,
    firstBodySentenceStartUs: 3_000_000,
    totalEndUs: 11_000_000,
  });
});

test("schema v3 音频片段限制机械音效并对齐书名和正文边界", () => {
  const segments = buildV3AudioSegments({
    timeline: {
      introEndUs: 2_000_000,
      titleStartUs: 2_000_000,
      titleEndUs: 3_000_000,
      bodyAudioStartUs: 3_000_000,
      totalEndUs: 10_000_000,
    },
    durations: {
      introVoice: 2_000_000,
      titleVoice: 1_000_000,
      bodyVoice: 7_000_000,
      mechanicalSfx: 5_000_000,
      waterDropSfx: 2_000_000,
      textStartSfx: 500_000,
    },
    materials: {
      mechanicalSfx: "mechanical.mp3",
      waterDropSfx: "water.mp3",
      textStartSfx: "text-start.mp3",
    },
    introOnly: false,
  });

  assert.deepEqual(segments, [
    { key: "introVoice", start: 0, end: 2_000_000, sourceDurationUs: 2_000_000 },
    { key: "titleVoice", start: 2_000_000, end: 3_000_000, sourceDurationUs: 1_000_000 },
    { key: "bodyVoice", start: 3_000_000, end: 10_000_000, sourceDurationUs: 7_000_000 },
    { key: "mechanicalSfx", start: 0, end: 2_000_000, sourceDurationUs: 5_000_000 },
    { key: "waterDropSfx", start: 2_000_000, end: 4_000_000, sourceDurationUs: 2_000_000 },
    { key: "textStartSfx", start: 3_000_000, end: 3_500_000, sourceDurationUs: 500_000 },
  ]);
});

test("schema v3 intro-only 音频片段排除正文和正文开头音效", () => {
  const segments = buildV3AudioSegments({
    timeline: {
      introEndUs: 2_000_000,
      titleStartUs: 2_000_000,
      titleEndUs: 3_000_000,
      bodyAudioStartUs: 3_000_000,
      totalEndUs: 10_000_000,
    },
    durations: {
      introVoice: 2_000_000,
      titleVoice: 1_000_000,
      bodyVoice: 7_000_000,
      mechanicalSfx: 1_000_000,
      waterDropSfx: 500_000,
      textStartSfx: 500_000,
    },
    materials: {
      mechanicalSfx: "mechanical.mp3",
      waterDropSfx: "water.mp3",
      textStartSfx: "text-start.mp3",
    },
    introOnly: true,
  });

  assert.deepEqual(segments.map((segment) => segment.key), [
    "introVoice",
    "titleVoice",
    "mechanicalSfx",
    "waterDropSfx",
  ]);
});

test("schema v2 时间线从旧字幕恢复书名和正文切换点", () => {
  const workflow = {
    schemaVersion: 2,
    intro: { durationUs: 4_000_000, captionOffsetUs: 2_000_000 },
    totalDurationUs: 12_000_000,
  };
  const shiftedCues = [
    { startUs: 2_000_000, endUs: 3_000_000, text: "测试书" },
    { startUs: 3_200_000, endUs: 5_000_000, text: "第一句正文" },
  ];

  assert.deepEqual(normalizeDraftTimeline(workflow, shiftedCues), {
    introEndUs: 4_000_000,
    titleStartUs: 2_000_000,
    titleEndUs: 3_000_000,
    bodyAudioStartUs: 2_000_000,
    firstBodySentenceStartUs: 3_200_000,
    totalEndUs: 12_000_000,
  });
});

test("schema v2 无字幕时沿用旧草稿的片头时长回退", () => {
  const workflow = {
    schemaVersion: 2,
    intro: { durationUs: 4_000_000, captionOffsetUs: 2_000_000 },
    totalDurationUs: 12_000_000,
  };

  assert.deepEqual(normalizeDraftTimeline(workflow, []), {
    introEndUs: 4_000_000,
    titleStartUs: 2_000_000,
    titleEndUs: 4_000_000,
    bodyAudioStartUs: 2_000_000,
    firstBodySentenceStartUs: 4_000_000,
    totalEndUs: 12_000_000,
  });
});

test("schema v3 时间线依次衔接片头、书名和正文", () => {
  assert.deepEqual(buildV3Timeline({
    introVoiceDurationUs: 2_000_000,
    titleVoiceDurationUs: 1_500_000,
    bodyDurationUs: 8_000_000,
  }), {
    introStartUs: 0,
    introEndUs: 2_000_000,
    titleStartUs: 2_000_000,
    titleEndUs: 3_500_000,
    bodyStartUs: 3_500_000,
    bodyEndUs: 11_500_000,
    totalDurationUs: 11_500_000,
  });
});

test("所有时间线素材时长必须有限且大于零", () => {
  assert.throws(() => buildV3Timeline({
    introVoiceDurationUs: Number.NaN,
    titleVoiceDurationUs: 1,
    bodyDurationUs: 1,
  }), /片头语音/u);
  assert.throws(() => buildV3Timeline({
    introVoiceDurationUs: 1,
    titleVoiceDurationUs: 0,
    bodyDurationUs: 1,
  }), /书名语音/u);
  assert.throws(() => buildV3Timeline({
    introVoiceDurationUs: 1,
    titleVoiceDurationUs: 1,
    bodyDurationUs: Number.POSITIVE_INFINITY,
  }), /正文音频/u);
});

test("正文字幕不能为空", () => {
  assert.throws(() => validateBodyCues([], "被讨厌的勇气"), /正文字幕不能为空/u);
});

test("正文第一条字幕必须从零开始", () => {
  assert.throws(() => validateBodyCues([
    { startUs: 1, endUs: 1_000_000, text: "真正的自由是什么" },
  ], "被讨厌的勇气"), /第一条.*0/u);
});

test("正文第一条去掉书名号和空白后不能仍是书名", () => {
  assert.throws(() => validateBodyCues([
    { startUs: 0, endUs: 1_000_000, text: " 《 被讨厌的勇气 》 " },
  ], "被讨厌的勇气"), /第一条.*书名/u);
});

test("正文第一条是正常内容时通过校验", () => {
  assert.doesNotThrow(() => validateBodyCues([
    { startUs: 0, endUs: 1_000_000, text: "真正的自由，是不再活在别人的期待里。" },
  ], "《被讨厌的勇气》"));
});

test("快闪图片优先于 MOV 并按顺序平均铺满片头", () => {
  const plan = buildOpeningVisualPlan({
    introEndUs: 6_000_000,
    flashImages: ["1.jpg", "2.jpg", "3.jpg"],
    introVideo: "intro.mov",
    introVideoDurationUs: 9_000_000,
  });

  assert.deepEqual(plan, {
    mode: "flash",
    video: null,
    coverFill: null,
    flashSegments: [
      { filePath: "1.jpg", start: 0, end: 2_000_000 },
      { filePath: "2.jpg", start: 2_000_000, end: 4_000_000 },
      { filePath: "3.jpg", start: 4_000_000, end: 6_000_000 },
    ],
  });
});

test("快闪图片按整数微秒连续铺满不可整除的片头", () => {
  const segments = buildOpeningVisualPlan({
    introEndUs: 10,
    flashImages: ["1.jpg", "2.jpg", "3.jpg"],
  }).flashSegments;

  assert.deepEqual(segments, [
    { filePath: "1.jpg", start: 0, end: 3 },
    { filePath: "2.jpg", start: 3, end: 6 },
    { filePath: "3.jpg", start: 6, end: 10 },
  ]);
  assert.ok(segments.every(({ start, end }) => Number.isInteger(start) && Number.isInteger(end)));
});

test("选择快闪时忽略无效的 MOV 时长", () => {
  assert.equal(buildOpeningVisualPlan({
    introEndUs: 2_000_000,
    flashImages: ["1.jpg"],
    introVideo: "intro.mov",
    introVideoDurationUs: 0,
  }).mode, "flash");
});

test("MOV 比片头长时从零播放并截断", () => {
  assert.deepEqual(buildOpeningVisualPlan({
    introEndUs: 2_000_000,
    introVideo: "intro.mov",
    introVideoDurationUs: 3_000_000,
  }), {
    mode: "video",
    video: { filePath: "intro.mov", start: 0, end: 2_000_000 },
    coverFill: null,
    flashSegments: [],
  });
});

test("MOV 比片头短时余下时段由封面补齐", () => {
  assert.deepEqual(buildOpeningVisualPlan({
    introEndUs: 2_000_000,
    introVideo: "intro.mov",
    introVideoDurationUs: 750_000,
  }), {
    mode: "video",
    video: { filePath: "intro.mov", start: 0, end: 750_000 },
    coverFill: { start: 750_000, end: 2_000_000 },
    flashSegments: [],
  });
});

test("没有快闪和 MOV 时封面铺满整个片头", () => {
  assert.deepEqual(buildOpeningVisualPlan({ introEndUs: 2_000_000 }), {
    mode: "cover",
    video: null,
    coverFill: { start: 0, end: 2_000_000 },
    flashSegments: [],
  });
});

test("选择封面回退时忽略无效的 MOV 时长", () => {
  assert.equal(buildOpeningVisualPlan({
    introEndUs: 2_000_000,
    flashImages: [],
    introVideo: "",
    introVideoDurationUs: Number.NaN,
  }).mode, "cover");
});

test("开场画面素材时长必须有限且大于零", () => {
  assert.throws(() => buildOpeningVisualPlan({ introEndUs: 0 }), /片头语音/u);
  assert.throws(() => buildOpeningVisualPlan({
    introEndUs: 2_000_000,
    introVideo: "intro.mov",
    introVideoDurationUs: Number.NaN,
  }), /片头视频/u);
});

test("可选文件或目录缺失时仅提示一次并返回空字符串", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-opening-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = {
    materials: {
      root,
      introVideo: "missing.mov",
      flashDir: "missing-flash",
    },
  };

  for (const [key, kind] of [["introVideo", "file"], ["flashDir", "directory"]]) {
    const messages = [];
    assert.doesNotThrow(() => {
      assert.equal(resolveOptionalMaterial(config, key, {
        kind,
        onMissing: (message) => messages.push(message),
      }), "");
    });
    assert.equal(messages.length, 1);
  }
});

test("可选素材必须匹配指定的文件或目录类型", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-opening-types-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "intro.mov"), "");
  fs.mkdirSync(path.join(root, "flash"));
  const config = {
    materials: {
      root,
      introVideo: "intro.mov",
      flashDir: "flash",
    },
  };

  assert.equal(resolveOptionalMaterial(config, "introVideo"), path.join(root, "intro.mov"));
  assert.equal(resolveOptionalMaterial(config, "flashDir", { kind: "directory" }), path.join(root, "flash"));

  const messages = [];
  assert.equal(resolveOptionalMaterial(config, "flashDir", {
    onMissing: (message) => messages.push(message),
  }), "");
  assert.equal(messages.length, 1);
});

test("快闪目录为空配置时返回空数组", () => {
  assert.deepEqual(collectFlashImages(""), []);
});

test("不存在的绝对快闪目录返回空数组且不抛错", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-flash-missing-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingDir = path.join(root, "不存在的快闪目录");

  assert.doesNotThrow(() => {
    assert.deepEqual(collectFlashImages(missingDir), []);
  });
});

test("快闪图片只收支持格式并按中文数字语义排序", (t) => {
  const flashDir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-flash-"));
  t.after(() => fs.rmSync(flashDir, { recursive: true, force: true }));
  for (const name of ["镜头10.webp", "镜头2.JPG", "镜头1.png", "说明.txt", "视频.mp4"]) {
    fs.writeFileSync(path.join(flashDir, name), "");
  }
  fs.mkdirSync(path.join(flashDir, "镜头3.jpeg"));

  assert.deepEqual(collectFlashImages(flashDir), [
    path.join(flashDir, "镜头1.png"),
    path.join(flashDir, "镜头2.JPG"),
    path.join(flashDir, "镜头10.webp"),
  ]);
});
