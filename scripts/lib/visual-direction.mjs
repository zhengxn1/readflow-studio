const STYLES = [
  { tag: "情绪化电影写实风", direction: "蓝灰、米色或暖黄的自然光，环境主导情绪，人物只能是占画面不超过10%的远景背影或剪影" },
  { tag: "极简大气自然风", direction: "广角自然远景与大量留白，以道路、山坡、湖面、林海等表达安静的心理变化" },
  { tag: "超现实炭笔素描风", direction: "黑白或深褐炭笔纸张颗粒，用裂缝、镜像、门窗或手势克制地表现内心冲突" },
  { tag: "扁平治愈系插画风", direction: "大地色或温柔暖色，简洁色块与轻微手绘纹理，温暖但不幼稚" },
  { tag: "奇幻超现实主义", direction: "适度放大书本、阶梯、月亮或门等日常元素，简洁地表达心理成长，不做史诗奇观" },
  { tag: "艺术雕塑与光影风", direction: "冷色雕塑、浮雕或几何体配少量暖金光线，以体积光表现内省与压抑" },
];

function titleSeed(value) {
  return [...String(value)].reduce((sum, character) => sum + character.codePointAt(0), 0);
}

export function applyVisualDirections(scenes, projectName = "") {
  const offset = titleSeed(projectName) % STYLES.length;
  return scenes.map((scene, index) => {
    const style = STYLES[(offset + index) % STYLES.length];
    const personRule = index % 3 === 0
      ? "允许一个极小的远景背影或剪影，人物面积不超过画面10%，不描绘清晰五官"
      : "以纯景物、空间或象征物体为主，不出现真人近景";
    return {
      ...scene,
      visualStyle: style.tag,
      imagePrompt: `[${style.tag}] 围绕“${scene.text}”提炼一个单一情绪或象征场景，${style.direction}；${personRule}，画面不含文字、卡片、水印、机甲、战争、血腥或夸张史诗特效，保持目标画幅构图。`,
    };
  });
}

export function visualDirectionRules() {
  return {
    styles: STYLES,
    constraints: {
      cueCountPerScene: "5-10",
      oneImagePerScene: true,
      minimumDifferentStyles: 4,
      people: "仅远景、背影或剪影，面积不超过画面10%，禁止真人近景和清晰五官",
      pureSceneryMinimum: 2,
      peopleScenesMinimum: 2,
      noTextInImage: true,
      preserveAspectRatio: true,
    },
  };
}
