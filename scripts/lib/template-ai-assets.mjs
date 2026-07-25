function contentExcerpt(cues, limit = 1200) {
  return cues
    .map((cue) => String(cue.text || "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, limit);
}

export function buildTemplateAiAssetPlan({ templateId, book, cues, scenes }) {
  const title = String(book.title || "").trim();
  const author = String(book.author || "").trim();
  const context = contentExcerpt(cues);

  if (templateId === "cassette-player") {
    return {
      schemaVersion: 1,
      template: templateId,
      generationPolicy: "这两张主题图必须由AI依据本期书籍正文生成，不使用与内容无关的通用占位图。",
      assets: [
        {
          id: "cassette-square-cover",
          source: "ai",
          output: "images/cassette-square-cover.png",
          width: 1024,
          height: 1024,
          prompt: `为《${title}》${author ? `（${author}）` : ""}设计1024×1024主题书封。根据正文内容提炼一个核心隐喻，构图简洁、主体明确、适合唱片播放器方形窗口；准确呈现书名，不使用出版物封面复刻、水印或无关装饰。正文参考：${context}`,
        },
        {
          id: "cassette-background",
          source: "ai",
          output: "images/cassette-background.png",
          width: 1920,
          height: 1080,
          prompt: `为《${title}》生成1920×1080横屏氛围背景。色彩、光线和材质应呼应正文主题，为左侧唱片播放器和右侧字幕保留清晰留白；背景不出现文字、人物近景、水印或复杂视觉噪声。正文参考：${context}`,
        },
      ],
    };
  }

  if (templateId === "knowledge-card") {
    return {
      schemaVersion: 1,
      template: templateId,
      generationPolicy: "背景使用用户上传的参考模板；正文风景或象征画面由AI逐镜生成，再抠图为透明RGBA素材。",
      assets: [
        {
          id: "knowledge-background",
          source: "user-reference",
          output: "由 --background 或 templates.knowledgeCard.background 指定",
          instructions: "保持用户上传背景模板的画幅、纸张质感和整体风格，不擅自替换。",
        },
        ...scenes.map((scene) => ({
          id: scene.id,
          source: "ai",
          output: `images/cutouts/${scene.imageFile}`,
          intermediate: `images/chroma/${scene.imageFile}`,
          prompt: `${scene.imagePrompt} 主体或风景元素居中、边缘完整，使用纯绿色抠图背景，不添加文字或水印；生成后移除绿色背景并导出透明RGBA PNG。`,
        })),
      ],
    };
  }

  return {
    schemaVersion: 1,
    template: "classic",
    generationPolicy: "每张分镜图片必须由AI根据对应分镜文案生成，不使用与当前旁白无关的装饰图。",
    assets: scenes.map((scene) => ({
      id: scene.id,
      source: "ai",
      output: `images/${scene.imageFile}`,
      prompt: scene.imagePrompt,
    })),
  };
}
