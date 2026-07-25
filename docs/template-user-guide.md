# ReadFlow Studio 模板入口

三套模板使用独立说明文件、独立项目目录和独立草稿名称，素材不得混用。

| 模板 | 独立说明 | AI负责生成 |
|---|---|---|
| 书封快闪·双语精读 | [模板1使用说明](templates/01-book-cover-flash-bilingual.md) | 根据每段正文文案生成对应分镜图片 |
| 唱片夜读·沉浸播放器 | [模板2使用说明](templates/02-cassette-night-reader.md) | 根据本期内容生成1024×1024主题书封和1920×1080背景 |
| 三分钟精读·知识导航 | [模板3使用说明](templates/03-three-minute-knowledge-navigation.md) | 沿用用户上传的背景模板，根据正文生成风景/象征画面并抠图 |

## 公共安装

需要 macOS、剪映专业版、Node.js 22+、FFmpeg/FFprobe、`uv` 和 Git。

```bash
git clone https://github.com/zhengxn1/readflow-studio.git
cd readflow-studio
npm run init
npm run capcut:setup
cp config/workflow.example.json .readflow.local.json
```

填写 `.readflow.local.json` 后启动本地草稿服务：

```bash
npm run capcut:start
```

每本书必须提供正文MP3和中文字幕SRT。SRT第一条必须只有本期书名。英文字幕可通过 `--srt-en` 提供；不需要英文字幕时使用 `--no-english`。

运行准备命令后，每期目录会生成：

```text
episodes/<项目名>/
├── workflow.json
├── storyboard.md
├── source-manifest.md
├── edit-plan.md
├── review-notes.md
├── generated/
│   ├── ai-assets.json
│   ├── image-prompts.json
│   └── storyboard.json
├── images/
└── input/
```

`generated/ai-assets.json` 是AI素材生成清单。不同模板的文件要求不同，必须进入对应模板说明操作。

项目媒体、本机配置、每期目录和剪映草稿均被 `.gitignore` 排除，不会上传到GitHub。
