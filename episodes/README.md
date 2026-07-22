# ReadFlow Studio Episodes

每期视频建立一个隔离目录，只保存本期不同的书籍封面、正文音频、字幕、分镜和配图。核心代码、固定片头和样式模板不会复制到每期目录。

```text
episodes/<日期-书名>/
  workflow.json
  source-manifest.md
  storyboard.md
  edit-plan.md
  review-notes.md
  input/
  generated/
  images/
```

这样做是为了避免不同书籍出现同名的 `body-voiceover.mp3`、`body-subtitles.srt` 和 `scene-001.png` 时互相覆盖，并让每一期都能单独重建剪映草稿。

维护原则：

- `storyboard.md` 是画面与剪辑的唯一时间真源。
- 中文 SRT 是字幕与正文时间真源，不运行 Whisper。
- 每镜原则上覆盖5～10条正文字幕，一镜一图。
- 图片、音频和字幕全部保持当期隔离。
- 新草稿使用新名称，不覆盖剪映中的旧草稿。
- 当期目录被 Git 忽略，不向公开仓库提交私人素材和绝对路径。
