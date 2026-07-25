import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadWorkflowConfig, loadDraftTemplate } from "../lib/workflow-config.mjs";
import { parseSrt, alignTranslatedCues, cuesToCapcut } from "../lib/srt.mjs";
import { startMediaServer } from "../lib/media-server.mjs";
import { CapcutMateClient } from "../lib/capcut-mate-client.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function probeDurationUs(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { encoding: "utf8", shell: false });
  const seconds = Number(result.stdout?.trim());
  if (result.status !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`无法读取素材时长：${filePath}`);
  return Math.round(seconds * 1_000_000);
}

function probeImageDimensions(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath,
  ], { encoding: "utf8", shell: false });
  const stream = result.status === 0 ? JSON.parse(result.stdout || "{}").streams?.[0] : null;
  if (!Number.isFinite(stream?.width) || !Number.isFinite(stream?.height)) throw new Error(`无法读取图片尺寸：${filePath}`);
  return { width: stream.width, height: stream.height };
}

function ensureFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`找不到${label}：${filePath || "未设置"}`);
  return filePath;
}

function resolveOptional(value) {
  return value ? path.resolve(value) : "";
}

function extractAudioForDraft(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const result = spawnSync("ffmpeg", [
    "-y", "-v", "error", "-i", sourcePath, "-vn", "-ac", "2", "-ar", "44100", "-b:a", "192k", targetPath,
  ], { encoding: "utf8", shell: false });
  if (result.status !== 0 || !fs.existsSync(targetPath)) throw new Error(`无法从片头 MOV 提取音频：${result.stderr || sourcePath}`);
  return targetPath;
}

function collectImages(directory) {
  if (!fs.existsSync(directory)) throw new Error(`找不到快闪素材目录：${directory}`);
  return fs.readdirSync(directory)
    .filter((name) => /\.(png|jpe?g|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))
    .map((name) => path.join(directory, name));
}

function formatClock(durationUs) {
  const totalSeconds = Math.max(0, Math.ceil(durationUs / 1_000_000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function repeatVideo(filePath, mediaServer, totalDurationUs, sourceDurationUs) {
  const infos = [];
  for (let start = 0; start < totalDurationUs; start += sourceDurationUs) {
    infos.push({
      video_url: mediaServer.urlFor(filePath), start, end: Math.min(totalDurationUs, start + sourceDurationUs),
      duration: sourceDurationUs, volume: 0,
    });
  }
  return infos;
}

function repeatAudio(filePath, mediaServer, totalDurationUs, sourceDurationUs, volume) {
  const infos = [];
  for (let start = 0; start < totalDurationUs; start += sourceDurationUs) {
    infos.push({
      audio_url: mediaServer.urlFor(filePath), start, end: Math.min(totalDurationUs, start + sourceDurationUs),
      duration: sourceDurationUs, volume,
    });
  }
  return infos;
}

function rotationKeyframes(segmentId, totalDurationUs, revolutionUs = 5_000_000) {
  const frames = [];
  for (let start = 0; start < totalDurationUs && frames.length < 96; start += revolutionUs + 1) {
    const end = Math.min(totalDurationUs, start + revolutionUs);
    frames.push({ segment_id: segmentId, property: "KFTypeRotation", offset: start, value: 0 });
    frames.push({ segment_id: segmentId, property: "KFTypeRotation", offset: end, value: 360 });
  }
  return frames;
}

function shiftCues(cues, offsetUs) {
  return cues.map((cue) => ({ ...cue, startUs: cue.startUs + offsetUs, endUs: cue.endUs + offsetUs }));
}

function rewriteInstalledDraftPaths(sourceDraftFolder, installedDraftFolder) {
  const source = path.resolve(sourceDraftFolder);
  const target = path.resolve(installedDraftFolder);
  const stack = [target];
  let rewritten = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const itemPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(itemPath);
      else if (entry.isFile() && /\.(json|tmp|extra)$/i.test(entry.name)) {
        const content = fs.readFileSync(itemPath, "utf8");
        if (content.includes(source)) {
          fs.writeFileSync(itemPath, content.replaceAll(source, target));
          rewritten += 1;
        }
      }
    }
  }
  return rewritten;
}

async function pickImageAnimation(client, preferred) {
  try {
    const animations = await client.getImageAnimations("in");
    const names = new Set((animations.effects || []).map((item) => item.name));
    return preferred.find((name) => names.has(name)) || null;
  } catch {
    return null;
  }
}

export async function createCassettePlayerDraft({ root, args }) {
  const { config } = loadWorkflowConfig(root, args.config);
  const template = loadDraftTemplate(root, "cassette-player");
  const episodeDir = path.join(root, "episodes", args.project);
  const workflowPath = path.join(episodeDir, "workflow.json");
  if (!fs.existsSync(workflowPath)) throw new Error(`找不到工作流项目：${workflowPath}`);
  const workflow = readJson(workflowPath);
  const episodeAsset = (value) => value && (path.isAbsolute(value) ? value : path.join(episodeDir, value));

  const voicePath = ensureFile(episodeAsset(workflow.inputs.voice), "正文音频");
  const srtPath = ensureFile(episodeAsset(workflow.inputs.srt), "中文字幕");
  const englishSrtPath = episodeAsset(workflow.inputs.englishSrt);
  const coverPath = ensureFile(episodeAsset(workflow.inputs.cover), "书籍封面");
  const squareCoverPath = ensureFile(path.resolve(
    args["square-cover"]
      || workflow.templateAssets?.cassettePlayer?.squareCover
      || path.join(episodeDir, "images", "cassette-square-cover.png")
      || coverPath,
  ), "唱片播放器正方形主题封面");
  const ipCoverPath = ensureFile(resolveOptional(
    args["ip-cover"]
      || workflow.templateAssets?.cassettePlayer?.ipCover
      || config.templates?.cassettePlayer?.ipCover,
  ), "片头IP形象图");
  const ipCoverDimensions = probeImageDimensions(ipCoverPath);
  const cues = parseSrt(fs.readFileSync(srtPath, "utf8"));
  const normalizedBookTitle = String(workflow.book.title || "").replace(/[《》\s]/g, "");
  const normalizedFirstCue = String(cues[0]?.text || "").replace(/[《》\s]/g, "");
  if (!normalizedFirstCue || normalizedFirstCue !== normalizedBookTitle) {
    throw new Error(`中文字幕SRT第一条必须是书名《${workflow.book.title}》。当前第一条为“${cues[0]?.text || "空白"}”，请在剪映字幕中补上书名并重新导出SRT后再上传。`);
  }
  const englishCues = englishSrtPath && fs.existsSync(englishSrtPath)
    ? alignTranslatedCues(cues, parseSrt(fs.readFileSync(englishSrtPath, "utf8")))
    : [];
  const voiceDurationUs = probeDurationUs(voicePath);
  const timing = template.timeline;
  const totalDurationUs = timing.bodyStartUs + Math.max(voiceDurationUs, cues.at(-1)?.endUs || 0);

  const materialsRoot = path.resolve(args["template-materials"] || config.templates?.cassettePlayer?.materialsRoot || path.join(config.materials.root, "第二个模板素材"));
  const materials = Object.fromEntries(Object.entries(template.materials).map(([key, relative]) => [
    key, ensureFile(path.join(materialsRoot, relative), `模板素材 ${relative}`),
  ]));
  const backgroundPath = ensureFile(path.resolve(args.background || workflow.templateAssets?.cassettePlayer?.background || path.join(episodeDir, "images", "cassette-background.png")), "唱片播放器背景图");
  const introAudioSourcePath = ensureFile(resolveOptional(
    args["intro-audio"]
      || workflow.templateAssets?.cassettePlayer?.introAudio
      || config.templates?.cassettePlayer?.introAudio,
  ), "片头音频");
  const introAudioPath = /\.(mov|mp4|mkv|avi)$/i.test(introAudioSourcePath)
    ? extractAudioForDraft(introAudioSourcePath, path.join(episodeDir, "generated", "cassette-intro-audio.mp3"))
    : introAudioSourcePath;
  const flashDir = resolveOptional(
    args["flash-dir"]
      || workflow.templateAssets?.cassettePlayer?.flashDir
      || config.templates?.cassettePlayer?.flashDir,
  );
  const flashImages = collectImages(flashDir);
  if (!flashImages.length) throw new Error(`快闪素材目录没有图片：${flashDir}`);

  const sourceFiles = [...new Set([backgroundPath, introAudioPath, voicePath, ipCoverPath, squareCoverPath, ...flashImages, ...Object.values(materials)])];
  const plan = {
    schemaVersion: 2, template: template.id, project: workflow.projectName, canvas: template.canvas, totalDurationUs,
    inputTimeline: `片头 0–${(probeDurationUs(introAudioPath) / 1_000_000).toFixed(2)}s；快闪 2.90–5.75s；正文从 6.20s 开始`,
    tracks: {
      video: ["V1 红色布光背景", "V2 粒子", "V3 封面等宽持续旋转大唱片", "V4 草稿圆角20的IP/快闪/书籍封面", "V5 32%持续旋转彩色小播放器", "V6 圆形音符播放动画", "V7 中央与左右波形", "V8 进度条、时间与播放控件"],
      text: ["T1 REC", "T2 睡前听完一本书", "T3 今天我们读", "T4 书名与作者", "T5 正文字幕", "T6 时间"],
      audio: ["A1 片头音频", "A2 正文旁白（6.20s 起）", "A3 背景音乐", "A4 快闪发条音", "A5 书名入场啵音效"],
    },
    sourceFiles,
  };
  fs.writeFileSync(path.join(episodeDir, "cassette-player-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  if (args["dry-run"]) {
    console.log(JSON.stringify({ ok: true, dryRun: true, plan: path.join(episodeDir, "cassette-player-plan.json"), template: template.id }, null, 2));
    return;
  }

  const videoDurations = Object.fromEntries(["musicNotes", "sideWave", "centerWave", "particles", "timeDisplay"].map((key) => [key, probeDurationUs(materials[key])]));
  const audioDurations = Object.fromEntries(["bgm", "springSfx", "popSfx"].map((key) => [key, probeDurationUs(materials[key])]));
  const introAudioDurationUs = probeDurationUs(introAudioPath);
  const mediaServer = await startMediaServer(sourceFiles, { host: config.capcutMate.mediaHost, port: config.capcutMate.mediaPort });
  const client = new CapcutMateClient(config.capcutMate.baseUrl);
  const layout = template.layout;

  try {
    const created = await client.createDraft(template.canvas.width, template.canvas.height);
    const draftUrl = created.draft_url;
    if (!draftUrl) throw new Error("CapCut Mate 创建草稿后没有返回 draft_url");

    const background = await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(backgroundPath), start: 0, end: totalDurationUs }]);
    if (background.segment_infos?.[0]) await client.addKeyframes(draftUrl, [
      { segment_id: background.segment_infos[0].id, property: "UNIFORM_SCALE", offset: 0, value: 1 },
      { segment_id: background.segment_infos[0].id, property: "UNIFORM_SCALE", offset: totalDurationUs, value: 1.04 },
    ]);
    await client.addVideos(draftUrl, repeatVideo(materials.particles, mediaServer, totalDurationUs, videoDurations.particles), {
      alpha: layout.particles.alpha, scaleX: layout.particles.scale, scaleY: layout.particles.scale,
      transformX: layout.particles.transformX, transformY: layout.particles.transformY,
    });

    const bigRecord = await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(materials.bigRecord), start: 0, end: totalDurationUs }], {
      scaleX: layout.bigRecord.scale, scaleY: layout.bigRecord.scale,
      transformX: layout.bigRecord.transformX, transformY: layout.bigRecord.transformY,
    });
    if (bigRecord.segment_ids?.[0]) await client.addKeyframes(draftUrl, rotationKeyframes(bigRecord.segment_ids[0], totalDurationUs));

    const coverStyle = {
      scaleX: layout.coverWindow.scale, scaleY: layout.coverWindow.scale,
      transformX: layout.coverWindow.transformX, transformY: layout.coverWindow.transformY,
    };
    const initialCover = await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(ipCoverPath), start: 0, end: timing.flashStartUs }], coverStyle);
    if (initialCover.segment_ids?.length) await client.addMasks(draftUrl, initialCover.segment_ids, {
      name: "矩形", width: ipCoverDimensions.width, height: ipCoverDimensions.height, roundCorner: layout.coverWindow.roundCorner,
    });
    const flashDurationUs = Math.floor((timing.flashEndUs - timing.flashStartUs) / flashImages.length);
    const flashResult = await client.addImages(draftUrl, flashImages.map((filePath, index) => ({
      image_url: mediaServer.urlFor(filePath), start: timing.flashStartUs + index * flashDurationUs,
      end: index === flashImages.length - 1 ? timing.flashEndUs : timing.flashStartUs + (index + 1) * flashDurationUs,
    })), coverStyle);
    if (flashResult.segment_ids?.length) await client.addMasks(draftUrl, flashResult.segment_ids, {
      name: "矩形", width: layout.coverWindow.maskWidth, height: layout.coverWindow.maskHeight, roundCorner: layout.coverWindow.roundCorner,
    });
    const targetAnimation = await pickImageAnimation(client, ["向右下甩入", "向右甩入", "放大", "渐显"]);
    const targetCover = await client.addImages(draftUrl, [{
      image_url: mediaServer.urlFor(squareCoverPath), start: timing.targetStartUs, end: totalDurationUs,
      ...(targetAnimation ? { in_animation: targetAnimation, in_animation_duration: 350_000 } : {}),
    }], coverStyle);
    if (targetCover.segment_ids?.length) await client.addMasks(draftUrl, targetCover.segment_ids, {
      name: "矩形", width: layout.coverWindow.maskWidth, height: layout.coverWindow.maskHeight, roundCorner: layout.coverWindow.roundCorner,
    });
    const smallPlayer = await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(materials.smallPlayer), start: 0, end: totalDurationUs }], {
      scaleX: layout.smallPlayer.scale, scaleY: layout.smallPlayer.scale,
      transformX: layout.smallPlayer.transformX, transformY: layout.smallPlayer.transformY,
    });
    if (smallPlayer.segment_ids?.[0]) await client.addKeyframes(draftUrl, rotationKeyframes(smallPlayer.segment_ids[0], totalDurationUs));

    await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(materials.blackPanel), start: 0, end: totalDurationUs }], {
      alpha: layout.blackPanel.alpha, scaleX: layout.blackPanel.scale, scaleY: layout.blackPanel.scale,
      transformX: layout.blackPanel.transformX, transformY: layout.blackPanel.transformY,
    });
    await client.addVideos(draftUrl, repeatVideo(materials.musicNotes, mediaServer, totalDurationUs, videoDurations.musicNotes), {
      alpha: layout.musicNotes.alpha, scaleX: layout.musicNotes.scale, scaleY: layout.musicNotes.scale,
      transformX: layout.musicNotes.transformX, transformY: layout.musicNotes.transformY,
    });
    await client.addVideos(draftUrl, repeatVideo(materials.centerWave, mediaServer, totalDurationUs, videoDurations.centerWave), {
      scaleX: layout.centerWave.scale, scaleY: layout.centerWave.scale, transformX: layout.centerWave.transformX, transformY: layout.centerWave.transformY,
    });
    for (const side of [layout.sideWaveLeft, layout.sideWaveRight]) await client.addVideos(draftUrl, repeatVideo(materials.sideWave, mediaServer, totalDurationUs, videoDurations.sideWave), {
      scaleX: side.scale, scaleY: side.scale, transformX: side.transformX, transformY: side.transformY,
    });
    await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(materials.playbackControls), start: 0, end: totalDurationUs }], {
      scaleX: layout.playbackControls.scale, scaleY: layout.playbackControls.scale,
      transformX: layout.playbackControls.transformX, transformY: layout.playbackControls.transformY,
    });
    await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(materials.progressBar), start: 0, end: totalDurationUs }], {
      scaleX: layout.progressBar.scale, scaleY: layout.progressBar.scale,
      transformX: layout.progressBar.transformX, transformY: layout.progressBar.transformY,
    });
    const progressDot = await client.addImages(draftUrl, [{ image_url: mediaServer.urlFor(materials.progressDot), start: 0, end: totalDurationUs }], {
      scaleX: layout.progressDot.scale, scaleY: layout.progressDot.scale,
      transformX: layout.progressDot.startX, transformY: layout.progressDot.transformY,
    });
    if (progressDot.segment_ids?.[0]) await client.addKeyframes(draftUrl, [
      { segment_id: progressDot.segment_ids[0], property: "KFTypePositionX", offset: 0, value: layout.progressDot.startX / template.canvas.width },
      { segment_id: progressDot.segment_ids[0], property: "KFTypePositionX", offset: totalDurationUs, value: layout.progressDot.endX / template.canvas.width },
    ]);
    await client.addVideos(draftUrl, repeatVideo(materials.timeDisplay, mediaServer, totalDurationUs, videoDurations.timeDisplay), {
      scaleX: layout.timeDisplay.scale, scaleY: layout.timeDisplay.scale,
      transformX: layout.timeDisplay.transformX, transformY: layout.timeDisplay.transformY,
    });

    await client.addAudios(draftUrl, [{ audio_url: mediaServer.urlFor(introAudioPath), start: 0, end: introAudioDurationUs, duration: introAudioDurationUs, volume: 1 }]);
    await client.addAudios(draftUrl, [{ audio_url: mediaServer.urlFor(voicePath), start: timing.bodyStartUs, end: timing.bodyStartUs + voiceDurationUs, duration: voiceDurationUs, volume: template.audio.voiceVolume }]);
    await client.addAudios(draftUrl, repeatAudio(materials.bgm, mediaServer, totalDurationUs, audioDurations.bgm, template.audio.bgmVolume));
    await client.addAudios(draftUrl, [{ audio_url: mediaServer.urlFor(materials.springSfx), start: timing.flashStartUs, end: Math.min(totalDurationUs, timing.flashStartUs + audioDurations.springSfx), duration: audioDurations.springSfx, volume: template.audio.sfxVolume }]);
    await client.addAudios(draftUrl, [{ audio_url: mediaServer.urlFor(materials.popSfx), start: timing.targetStartUs, end: Math.min(totalDurationUs, timing.targetStartUs + audioDurations.popSfx), duration: audioDurations.popSfx, volume: template.audio.sfxVolume }]);

    await client.addCaptions(draftUrl, [{ start: 0, end: totalDurationUs, text: "REC  •" }], template.text.rec);
    await client.addCaptions(draftUrl, [{ start: timing.openingPrimaryStartUs, end: timing.openingPrimaryEndUs, text: "睡前听完一本书", in_animation: "甩出", in_animation_duration: 350_000, out_animation: "渐隐", out_animation_duration: 180_000 }], template.text.openingPrimary);
    await client.addCaptions(draftUrl, [{ start: timing.openingSecondaryStartUs, end: timing.openingSecondaryEndUs, text: "今天我们读", in_animation: "渐显", in_animation_duration: 250_000, out_animation: "渐隐", out_animation_duration: 350_000 }], template.text.openingSecondary);
    const shiftedCues = shiftCues(cues, timing.bodyStartUs).slice(workflow.intro?.firstCueIsBookTitle === false ? 0 : 1);
    await client.addCaptions(draftUrl, cuesToCapcut(shiftedCues).map((caption) => ({ ...caption, in_animation: "渐显", in_animation_duration: 180_000 })), template.text.caption);
    if (englishCues.length) {
      const shiftedEnglish = shiftCues(englishCues, timing.bodyStartUs).slice(workflow.intro?.firstCueIsBookTitle === false ? 0 : 1);
      await client.addCaptions(draftUrl, cuesToCapcut(shiftedEnglish), template.text.englishCaption);
    }
    await client.addCaptions(draftUrl, [{ start: timing.targetStartUs, end: totalDurationUs, text: `《${workflow.book.title}》`, in_animation: "甩出", in_animation_duration: 350_000 }], template.text.bookTitle);
    if (workflow.book.author) await client.addCaptions(draftUrl, [{ start: timing.targetStartUs, end: totalDurationUs, text: `${workflow.book.author} / 著`, in_animation: "渐显", in_animation_duration: 350_000 }], template.text.author);
    await client.addCaptions(draftUrl, [{ start: 0, end: totalDurationUs, text: formatClock(totalDurationUs) }], template.text.duration);
    const nickname = args.nickname || config.defaults?.nickname;
    if (nickname) await client.addCaptions(draftUrl, [{ start: 0, end: totalDurationUs, text: nickname }], template.text.nickname);

    const saved = await client.saveDraft(draftUrl);
    const draftId = new URL(saved.draft_url || draftUrl).searchParams.get("draft_id") || "";
    const capcutMateDir = path.resolve(root, config.capcutMate.localDir || path.join(".tools", "capcut-mate"));
    const draftFolder = draftId ? path.join(capcutMateDir, "output", "draft", draftId) : "";
    let jianyingDraftFolder = "";
    if (args["install-to-jianying"]) {
      const jianyingRoot = args["jianying-dir"] ? path.resolve(args["jianying-dir"]) : "";
      if (!jianyingRoot || !fs.existsSync(jianyingRoot)) throw new Error("未提供可用的剪映草稿库目录，请使用 --jianying-dir 指定。");
      const draftName = args["draft-name"] || `${workflow.projectName}-参考片还原-16x9`;
      const target = path.join(jianyingRoot, draftName);
      if (fs.existsSync(target)) throw new Error(`剪映草稿库中已存在同名草稿：${target}`);
      fs.cpSync(draftFolder, target, { recursive: true, errorOnExist: true });
      rewriteInstalledDraftPaths(draftFolder, target);
      jianyingDraftFolder = target;
    }
    const result = {
      ok: true, template: template.id, project: workflow.projectName, draftId,
      draftUrl: saved.draft_url || draftUrl, draftFolder, jianyingDraftFolder,
      canvas: template.canvas, totalDurationUs, tracks: plan.tracks,
      warning: "请在剪映中检查片头IP、左侧正方形素材的草稿圆角20、封面下方等宽旋转大唱片、32%旋转彩色小播放器、15%左右波形及6%计时卡。",
    };
    fs.writeFileSync(path.join(episodeDir, "cassette-player-result.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mediaServer.close();
  }
}
