# 模板1：书封快闪·双语精读

## 适用内容

适合完整书籍解读、双语读书视频和需要品牌片头的内容。支持3:4、9:16和4:3。

## 模板结构

1. 品牌片头视频和片头语音；
2. 多张书封快闪与机械音效；
3. 本期全画幅书封以水滴动画揭示；
4. 正文一分镜一张AI图片；
5. 小书封、书名和作者常驻；
6. 中文和可选英文字幕独立显示。

## 素材职责

用户提供：

- 书名、作者和书籍封面；
- 使用男声「声控弟弟」生成的正文MP3；
- 中文字幕SRT，第一条为书名；
- 可选英文SRT；
- 自有片头、BGM、快闪和音效。

AI生成：

- 根据 `storyboard.md` 中每个分镜的对应文案生成一张图片；
- 图片必须支持正在播放的旁白，不得使用与文案无关的装饰图；
- 每镜覆盖5～10条字幕，一镜一图；
- 图片不得含文字、水印、真人近景或清晰五官；
- 输出到 `images/scene-001.png`、`scene-002.png`……

准备后查看 `generated/ai-assets.json`，其中包含每张图的输出路径和提示词。

文案生成完成后必须提示用户：

> 模板1正文配音请使用男声「声控弟弟」。请用最终配音稿生成MP3和逐句对齐的SRT，然后将两个文件上传。

## 准备项目

```bash
npm run workflow:prepare -- \
  --book "书名" \
  --author "作者" \
  --voice "/路径/正文.mp3" \
  --srt "/路径/中文字幕.srt" \
  --srt-en "/路径/英文字幕.srt" \
  --cover "/路径/书封.jpg" \
  --aspect "3:4" \
  --template classic \
  --project "日期-书名-模板1"
```

不需要英文字幕时将 `--srt-en` 替换为 `--no-english`。

## 生成草稿

```bash
npm run workflow:draft -- \
  --project "日期-书名-模板1" \
  --template classic \
  --dry-run
```

确认后：

```bash
npm run workflow:draft -- \
  --project "日期-书名-模板1" \
  --template classic \
  --install-to-jianying \
  --jianying-dir "/路径/剪映草稿库" \
  --draft-name "书名-书封快闪双语精读"
```

## 生成前检查

- 每张分镜图与对应文案一致；
- 所有图片保持目标画幅，没有拉伸；
- SRT第一条是书名；
- 双语字幕条数一致；
- 固定片头和音效路径已写入 `.readflow.local.json`。
