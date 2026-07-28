# 模板2：唱片夜读·沉浸播放器

## 适用内容

适合睡前听书、情绪电台和横屏播客式书籍解读。固定画幅为1920×1080。

## 模板结构

1. 睡前听书固定片头；
2. 左侧IP形象和正方形书封快闪；
3. 旋转大唱片、方形圆角封面和彩色小播放器；
4. 右侧书名、作者和正文字幕；
5. 底部音波、时间、播放控件和移动进度点。

## 素材职责

用户提供：

- 书名、作者，以及使用男声「声控弟弟」生成的正文MP3；
- 中文字幕SRT，第一条为书名；
- 可选英文SRT；
- 播放器固定素材包；
- 片头音频、IP形象和正方形快闪素材。

文案生成完成后必须提示用户：

> 模板2正文配音请使用男声「声控弟弟」。请用最终配音稿生成MP3和逐句对齐的SRT，然后将两个文件上传。

AI必须根据本期正文生成：

1. `images/cassette-square-cover.png`
   - 1024×1024；
   - 从正文中提炼一个核心隐喻；
   - 适合左侧方形播放器窗口；
   - 准确显示书名；
   - 不复刻出版物封面。
2. `images/cassette-background.png`
   - 1920×1080；
   - 色彩、光线和材质与本期内容一致；
   - 为左侧播放器和右侧字幕预留空间；
   - 不出现文字、水印或复杂人物。

具体提示词会写入 `generated/ai-assets.json`。

## 播放器素材包

```text
第二个模板素材/
├── 播放器模板/
│   ├── 大唱片.png
│   └── 彩色小播放器.png
├── 播放素材.png
├── 进度条.png
├── 进度条小圆点.png
├── 黑底素材.png
├── 图形音符素材.mp4
├── 左右音波视频素材.mp4
├── 音频视频素材.mp4
├── 粒子视频素材.mov
├── 时间进度素材.mov
├── 背景音乐.mp3
├── 发条音.mp3
└── 啵音效.mp3
```

在 `.readflow.local.json` 配置：

```json
{
  "templates": {
    "cassettePlayer": {
      "materialsRoot": "/路径/第二个模板素材",
      "introAudio": "/路径/唱片夜读片头.mov",
      "ipCover": "/路径/片头IP形象.jpg",
      "flashDir": "/路径/正方形快闪素材"
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
  --cover "/路径/原始书封.jpg" \
  --template second \
  --no-english \
  --project "日期-书名-模板2"
```

模板2会自动使用16:9画幅。

## 生成草稿

```bash
npm run workflow:draft -- \
  --project "日期-书名-模板2" \
  --template second \
  --dry-run
```

确认后：

```bash
npm run workflow:draft -- \
  --project "日期-书名-模板2" \
  --template second \
  --install-to-jianying \
  --jianying-dir "/路径/剪映草稿库" \
  --draft-name "书名-唱片夜读"
```

所有默认素材也可以用 `--template-materials`、`--intro-audio`、`--ip-cover`、`--flash-dir`、`--square-cover` 和 `--background` 临时覆盖。

## 生成前检查

- AI方形主题书封为1024×1024；
- AI背景为1920×1080；
- 两张图均对应本期正文；
- 播放器固定素材完整；
- SRT第一条是书名；
- 草稿名不与已有草稿重复。
