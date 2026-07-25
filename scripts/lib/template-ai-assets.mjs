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
      generationPolicy: "背景使用用户上传的参考模板；正文由AI逐镜生成扁平手绘人物情境插画，检查人物肢体结构后抠图为透明RGBA素材。",
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
          prompt: `根据正文“${scene.text}”生成扁平手绘知识科普风人物情境插画。以一个主要人物或一组关系明确的人物为核心，用准确的动作、表情和与文案直接相关的书本、手机、日历、时钟、学习用品等道具表达内容；不要生成风景图、纯静物图或抽象氛围图。同一期人物造型、线条和配色保持一致。人物只能拥有正常数量的头、手臂、手掌和手指，手臂连接关系清楚，不得出现多余、重复、融合、悬空或错位的肢体，道具不得与手掌穿插。所有人物和道具组成一个紧凑的中央插画组，主体边缘完整，四周留出抠图安全空间。使用均匀纯绿色抠图背景，不添加地面、环境背景、文字、字幕、标志或水印；生成后移除绿色并导出透明RGBA PNG。`,
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
