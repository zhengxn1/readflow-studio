import test from "node:test";
import assert from "node:assert/strict";
import { buildTemplateAiAssetPlan } from "../lib/template-ai-assets.mjs";

const book = { title: "认知觉醒", author: "周岭" };
const cues = [{ text: "真正的问题不是懒惰，而是没有看清自己" }];
const scenes = [{ id: "S001", imageFile: "scene-001.png", imagePrompt: "安静的山路与晨光" }];

test("模板1要求AI按分镜文案生成图片", () => {
  const plan = buildTemplateAiAssetPlan({ templateId: "classic", book, cues, scenes });
  assert.equal(plan.assets[0].source, "ai");
  assert.equal(plan.assets[0].output, "images/scene-001.png");
  assert.match(plan.generationPolicy, /对应分镜文案/u);
});

test("模板2要求AI生成方形主题书封和16比9背景", () => {
  const plan = buildTemplateAiAssetPlan({ templateId: "cassette-player", book, cues, scenes });
  assert.deepEqual(plan.assets.map((item) => [item.output, item.width, item.height]), [
    ["images/cassette-square-cover.png", 1024, 1024],
    ["images/cassette-background.png", 1920, 1080],
  ]);
  assert.ok(plan.assets.every((item) => item.source === "ai"));
});

test("模板3保留用户背景模板并要求AI生成透明正文画面", () => {
  const plan = buildTemplateAiAssetPlan({ templateId: "knowledge-card", book, cues, scenes });
  assert.equal(plan.assets[0].source, "user-reference");
  assert.equal(plan.assets[1].source, "ai");
  assert.equal(plan.assets[1].output, "images/cutouts/scene-001.png");
  assert.match(plan.assets[1].prompt, /纯绿色抠图背景/u);
});
