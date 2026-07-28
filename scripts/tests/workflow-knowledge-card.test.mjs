import test from "node:test";
import assert from "node:assert/strict";
import { buildCaptionKeywords, selectCaptionKeyword } from "../lib/knowledge-card.mjs";

test("第三模板为每句字幕选择原句中的关键词", () => {
  const cues = [
    { text: "认知觉醒" },
    { text: "你有没有过这样的经历" },
    { text: "而是懂得减少选择" },
  ];
  const result = buildCaptionKeywords(cues, {
    bookTitle: "认知觉醒",
    overrides: [{ cueIndex: 2, keyword: "这样的经历" }],
  });
  assert.deepEqual(result.map((item) => item.keyword), ["认知觉醒", "这样的经历", "减少选择"]);
  for (const item of result) assert.equal(item.text.includes(item.keyword), true);
});

test("第三模板拒绝脱离字幕原句的总结词", () => {
  assert.throws(
    () => buildCaptionKeywords([{ text: "先读十页" }], {
      overrides: [{ cueIndex: 1, keyword: "保持阅读习惯" }],
    }),
    /不是原句/u,
  );
});

test("第三模板自动关键词始终是连续原文", () => {
  const text = "因为行动本身就会带来清晰";
  const keyword = selectCaptionKeyword(text);
  assert.ok(keyword.length >= 2);
  assert.ok(text.includes(keyword));
});
