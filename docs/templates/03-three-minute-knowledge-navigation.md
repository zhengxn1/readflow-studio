# 模板3：三分钟精读·知识导航

## 适用内容

适合快速精读、知识点提炼和课程式卡片视频。固定画幅为1440×1080。

## 模板结构

1. 打开书透明图开场；
2. “3分钟精读一本书，今天我们读《书名》”完整字幕；
3. 书籍引入、内容介绍、解决问题、价值倡导四分块从头显示到尾；
4. 正文使用中央透明风景或象征画面；
5. 每句字幕从原句中选择关键词并高亮；
6. 所有前景画面从80%缓慢放大到85%。

## 素材职责

用户上传：

- 书名、作者和正文MP3；
- 中文字幕SRT，第一条为书名；
- 书籍封面；
- 模板3背景参考图；
- 打开书透明PNG，也可以使用配置中的固定素材。

背景规则：

- 背景直接使用用户上传的模板图；
- 保持原模板的4:3构图、纸张质感和整体视觉；
- AI不得擅自换成另一种背景风格。

AI根据正文逐镜生成：

- 风景、空间、静物或象征性画面；
- 每张画面必须对应当前分镜文案；
- 主体居中、边缘完整；
- 先生成纯绿色抠图背景版本；
- 再移除绿色并导出透明RGBA PNG；
- 最终保存到 `images/cutouts/scene-001.png`、`scene-002.png`……

中间文件保存到 `images/chroma/`。完整提示词和输出路径见 `generated/ai-assets.json`。

## 默认素材配置

```json
{
  "templates": {
    "knowledgeCard": {
      "introAudio": "/路径/三分钟精读片头.mov",
      "openBook": "/路径/打开书透明图.png",
      "background": "/路径/用户上传的4x3背景模板.jpg"
    }
  }
}
```

## 准备项目

```bash
npm run workflow:prepare -- \
  --book "书名" \
  --author "作者" \
  --voice "/路径/正文.mp3" \
  --srt "/路径/中文字幕.srt" \
  --cover "/路径/书封.jpg" \
  --template third \
  --no-english \
  --project "日期-书名-模板3"
```

模板3会自动使用4:3画幅。

## 字幕关键词

系统默认自动选择每句原文中的关键词。需要人工指定时，创建：

```text
episodes/<项目名>/generated/caption-keywords.json
```

```json
[
  { "cueIndex": 1, "keyword": "书名" },
  { "cueIndex": 2, "keyword": "这样的经历" }
]
```

关键词必须是对应字幕原句中的连续文字。

## 生成草稿

```bash
npm run workflow:draft -- \
  --project "日期-书名-模板3" \
  --template third \
  --background "/路径/用户上传的背景模板.jpg" \
  --dry-run
```

确认后：

```bash
npm run workflow:draft -- \
  --project "日期-书名-模板3" \
  --template third \
  --background "/路径/用户上传的背景模板.jpg" \
  --install-to-jianying \
  --jianying-dir "/路径/剪映草稿库" \
  --draft-name "书名-三分钟精读"
```

## 生成前检查

- 背景是用户上传的模板图；
- 每张AI风景图与对应正文一致；
- 所有正文画面均为透明RGBA PNG；
- 四个导航分块从头显示到尾；
- 没有章节进度条；
- 所有图片关键帧为80%→85%；
- 每句关键词属于字幕原句。
