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
      { file: "1.jpg", startUs: 0, endUs: 2_000_000 },
      { file: "2.jpg", startUs: 2_000_000, endUs: 4_000_000 },
      { file: "3.jpg", startUs: 4_000_000, endUs: 6_000_000 },
    ],
  });
});

test("MOV 比片头长时从零播放并截断", () => {
  assert.deepEqual(buildOpeningVisualPlan({
    introEndUs: 2_000_000,
    introVideo: "intro.mov",
    introVideoDurationUs: 3_000_000,
  }), {
    mode: "video",
    video: { file: "intro.mov", startUs: 0, endUs: 2_000_000 },
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
    video: { file: "intro.mov", startUs: 0, endUs: 750_000 },
    coverFill: { startUs: 750_000, endUs: 2_000_000 },
    flashSegments: [],
  });
});

test("没有快闪和 MOV 时封面铺满整个片头", () => {
  assert.deepEqual(buildOpeningVisualPlan({ introEndUs: 2_000_000 }), {
    mode: "coverFill",
    video: null,
    coverFill: { startUs: 0, endUs: 2_000_000 },
    flashSegments: [],
  });
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
