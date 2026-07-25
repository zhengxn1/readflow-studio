import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadWorkflowConfig, loadDraftTemplate } from "../lib/workflow-config.mjs";
import { parseSrt, shiftCues, cuesToCapcut } from "../lib/srt.mjs";
import { startMediaServer } from "../lib/media-server.mjs";
import { CapcutMateClient } from "../lib/capcut-mate-client.mjs";
import { buildCaptionKeywords } from "../lib/knowledge-card.mjs";

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`找不到${label}：${filePath || "未设置"}`);
  }
  return filePath;
}

function resolveOptional(value) {
  return value ? path.resolve(value) : "";
}

function probeDurationUs(filePath) {
  const result = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath,
  ], { encoding: "utf8", shell: false });
  const seconds = Number(result.stdout?.trim());
  if (result.status !== 0 || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`无法读取素材时长：${filePath}`);
  }
  return Math.round(seconds * 1_000_000);
}

function extractAudio(sourcePath, targetPath) {
  if (!/\.(mov|mp4|mkv|avi)$/i.test(sourcePath)) return sourcePath;
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const result = spawnSync("ffmpeg", [
    "-y", "-v", "error", "-i", sourcePath, "-vn", "-ac", "2", "-ar", "44100", "-b:a", "192k", targetPath,
  ], { encoding: "utf8", shell: false });
  if (result.status !== 0 || !fs.existsSync(targetPath)) {
    throw new Error(`无法从第三模板片头提取音频：${result.stderr || sourcePath}`);
  }
  return targetPath;
}

function repeatAudio(filePath, mediaServer, totalDurationUs, sourceDurationUs, volume) {
  const infos = [];
  for (let start = 0; start < totalDurationUs; start += sourceDurationUs) {
    infos.push({
      audio_url: mediaServer.urlFor(filePath),
      start,
      end: Math.min(totalDurationUs, start + sourceDurationUs),
      duration: sourceDurationUs,
      volume,
    });
  }
  return infos;
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

async function availableAnimations(client) {
  try {
    const animations = await client.getImageAnimations("in");
    return new Set((animations.effects || []).map((item) => item.name));
  } catch {
    return new Set();
  }
}

export async function createKnowledgeCardDraft({ root, args }) {
  const { config } = loadWorkflowConfig(root, args.config);
  const template = loadDraftTemplate(root, "knowledge-card");
  const episodeDir = path.join(root, "episodes", args.project);
  const workflowPath = path.join(episodeDir, "workflow.json");
  if (!fs.existsSync(workflowPath)) throw new Error(`找不到工作流项目：${workflowPath}`);
  const workflow = readJson(workflowPath);
  const episodeAsset = (value) => value && (path.isAbsolute(value) ? value : path.join(episodeDir, value));

  const voicePath = ensureFile(episodeAsset(workflow.inputs.voice), "正文音频");
  const srtPath = ensureFile(episodeAsset(workflow.inputs.srt), "中文字幕");
  const backgroundPath = ensureFile(path.resolve(
    args.background
      || workflow.templateAssets?.knowledgeCard?.background
      || config.templates?.knowledgeCard?.background
      || workflow.inputs.cover,
  ), "第三模板背景图");
  const introAudioSource = ensureFile(resolveOptional(
    args["intro-audio"]
      || workflow.templateAssets?.knowledgeCard?.introAudio
      || config.templates?.knowledgeCard?.introAudio,
  ), "第三模板片头音频");
  const introAudioPath = extractAudio(introAudioSource, path.join(episodeDir, "generated", "knowledge-card-intro.mp3"));
  const storyboard = readJson(episodeAsset(workflow.generated.storyboard));
  const openBookPath = ensureFile(resolveOptional(
    args["open-book"]
      || workflow.templateAssets?.knowledgeCard?.openBook
      || config.templates?.knowledgeCard?.openBook
      || path.join(episodeDir, "images", "cutouts", "open-book.png"),
  ),
    "第三模板开场打开书抠图",
  );
  const cues = parseSrt(fs.readFileSync(srtPath, "utf8"));
  const captionKeywordPath = path.join(episodeDir, "generated", "caption-keywords.json");
  const captionKeywordOverrides = fs.existsSync(captionKeywordPath) ? readJson(captionKeywordPath) : [];
  const captionKeywords = buildCaptionKeywords(cues, {
    bookTitle: workflow.book.title,
    overrides: captionKeywordOverrides,
  });
  fs.writeFileSync(captionKeywordPath, `${JSON.stringify(captionKeywords, null, 2)}\n`);
  const normalizedBookTitle = String(workflow.book.title || "").replace(/[《》\s]/g, "");
  const normalizedFirstCue = String(cues[0]?.text || "").replace(/[《》\s]/g, "");
  if (normalizedFirstCue !== normalizedBookTitle) {
    throw new Error(`第三模板内部SRT第一条必须是书名《${workflow.book.title}》。当前第一条为“${cues[0]?.text || "空白"}”。`);
  }

  const sceneFiles = storyboard.map((scene) => ensureFile(
    path.join(episodeDir, "images", "cutouts", scene.imageFile),
    `第三模板分镜 ${scene.imageFile}`,
  ));
  const introDurationUs = probeDurationUs(introAudioPath);
  const voiceDurationUs = probeDurationUs(voicePath);
  const totalDurationUs = introDurationUs + Math.max(voiceDurationUs, cues.at(-1)?.endUs || 0);
  const bgmPath = ensureFile(workflow.fixedMaterials.bgm, "背景音乐");
  const bgmDurationUs = probeDurationUs(bgmPath);
  const shiftedCues = shiftCues(cues, introDurationUs);
  const firstBodyStartUs = shiftedCues[1]?.startUs || introDurationUs;

  const sceneInfos = storyboard.map((scene, index) => ({
    image_url: "",
    start: Math.max(firstBodyStartUs, introDurationUs + scene.bodyStartUs),
    end: index === storyboard.length - 1
      ? totalDurationUs
      : introDurationUs + storyboard[index + 1].bodyStartUs,
  }));
  const sourceFiles = [backgroundPath, openBookPath, introAudioPath, voicePath, bgmPath, ...sceneFiles];
  const plan = {
    schemaVersion: 1,
    template: template.id,
    project: workflow.projectName,
    canvas: template.canvas,
    totalDurationUs,
    introDurationUs,
    sceneCount: storyboard.length,
    chapters: template.chapters,
    tracks: {
      video: ["V1 纸张背景", "V2 开场打开书动效", "V3 八组中央透明插画"],
      text: ["T1 全程四章节分层", "T2 开场书名作者", "T3 正文书名作者", "T4 逐句关键词富文本字幕", "T5 右下昵称"],
      audio: ["A1 三分钟精读固定开头", "A2 正文旁白", "A3 背景音乐"],
    },
    sourceFiles,
  };
  fs.writeFileSync(path.join(episodeDir, "knowledge-card-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  if (args["dry-run"]) {
    console.log(JSON.stringify({ ok: true, dryRun: true, template: template.id, plan: path.join(episodeDir, "knowledge-card-plan.json") }, null, 2));
    return;
  }

  const mediaServer = await startMediaServer(sourceFiles, {
    host: config.capcutMate.mediaHost,
    port: config.capcutMate.mediaPort,
  });
  const client = new CapcutMateClient(config.capcutMate.baseUrl);

  try {
    const created = await client.createDraft(template.canvas.width, template.canvas.height);
    const draftUrl = created.draft_url;
    if (!draftUrl) throw new Error("CapCut Mate 创建草稿后没有返回 draft_url");

    await client.addImages(draftUrl, [{
      image_url: mediaServer.urlFor(backgroundPath),
      start: 0,
      end: totalDurationUs,
    }], { scaleX: 1, scaleY: 1 });

    const animations = await availableAnimations(client);
    const openBook = await client.addImages(draftUrl, [{
      image_url: mediaServer.urlFor(openBookPath),
      start: 0,
      end: firstBodyStartUs,
      ...(animations.has("渐显") ? { in_animation: "渐显", in_animation_duration: 280_000 } : {}),
    }], {
      scaleX: template.layout.openBook.scale,
      scaleY: template.layout.openBook.scale,
      transformX: template.layout.openBook.transformX,
      transformY: template.layout.openBook.transformY,
    });
    const openBookSegmentId = openBook.segment_ids?.[0] || openBook.segment_infos?.[0]?.id;
    if (openBookSegmentId) {
      const settleAt = Math.min(900_000, Math.round(firstBodyStartUs * 0.28));
      const breatheAt = Math.min(firstBodyStartUs - 1, Math.max(settleAt + 1, Math.round(firstBodyStartUs * 0.72)));
      await client.addKeyframes(draftUrl, [
        { segment_id: openBookSegmentId, property: "UNIFORM_SCALE", offset: 0, value: template.motion.startScale },
        { segment_id: openBookSegmentId, property: "UNIFORM_SCALE", offset: settleAt, value: 0.83 },
        { segment_id: openBookSegmentId, property: "UNIFORM_SCALE", offset: breatheAt, value: 0.81 },
        { segment_id: openBookSegmentId, property: "UNIFORM_SCALE", offset: firstBodyStartUs - 1, value: template.motion.endScale },
        { segment_id: openBookSegmentId, property: "KFTypeRotation", offset: 0, value: -1.8 },
        { segment_id: openBookSegmentId, property: "KFTypeRotation", offset: settleAt, value: 1.2 },
        { segment_id: openBookSegmentId, property: "KFTypeRotation", offset: breatheAt, value: -0.7 },
        { segment_id: openBookSegmentId, property: "KFTypeRotation", offset: firstBodyStartUs - 1, value: 0 },
      ]);
    }

    const candidates = ["向上滑动", "放大", "渐显"];
    for (let index = 0; index < sceneInfos.length; index += 1) {
      const preferred = (index + 1) % 3 === 0 ? "翻页" : candidates[index % candidates.length];
      const animation = animations.has(preferred)
        ? preferred
        : candidates.find((name) => animations.has(name));
      const info = {
        ...sceneInfos[index],
        image_url: mediaServer.urlFor(sceneFiles[index]),
        ...(animation ? { in_animation: animation, in_animation_duration: preferred === "翻页" ? 2_000_000 : 450_000 } : {}),
      };
      const added = await client.addImages(draftUrl, [info], {
        scaleX: template.layout.scene.scale,
        scaleY: template.layout.scene.scale,
        transformX: template.layout.scene.transformX,
        transformY: template.layout.scene.transformY,
      });
      const segmentId = added.segment_ids?.[0] || added.segment_infos?.[0]?.id;
      if (segmentId) {
        const duration = info.end - info.start;
        await client.addKeyframes(draftUrl, [
          { segment_id: segmentId, property: "UNIFORM_SCALE", offset: 0, value: template.motion.startScale },
          { segment_id: segmentId, property: "UNIFORM_SCALE", offset: duration, value: template.motion.endScale },
        ]);
      }
    }

    await client.addAudios(draftUrl, [{
      audio_url: mediaServer.urlFor(introAudioPath),
      start: 0,
      end: introDurationUs,
      duration: introDurationUs,
      volume: 1,
    }]);
    await client.addAudios(draftUrl, [{
      audio_url: mediaServer.urlFor(voicePath),
      start: introDurationUs,
      end: introDurationUs + voiceDurationUs,
      duration: voiceDurationUs,
      volume: template.audio.voiceVolume,
    }]);
    await client.addAudios(draftUrl, repeatAudio(bgmPath, mediaServer, totalDurationUs, bgmDurationUs, template.audio.bgmVolume));

    for (let index = 0; index < template.chapters.length; index += 1) {
      const chapterStyle = {
        ...template.text.chapter,
        transformX: template.layout.chapterXs[index],
        transformY: template.layout.chapterY,
      };
      await client.addCaptions(draftUrl, [{
        start: 0,
        end: template.navigation.visibility === "full" ? totalDurationUs : firstBodyStartUs,
        text: template.chapters[index],
      }], chapterStyle);
    }
    for (const separatorX of template.layout.chapterSeparatorXs) {
      await client.addCaptions(draftUrl, [{
        start: 0,
        end: template.navigation.visibility === "full" ? totalDurationUs : firstBodyStartUs,
        text: "│",
      }], {
        ...template.text.chapterSeparator,
        transformX: separatorX,
        transformY: template.layout.chapterY,
      });
    }

    await client.addCaptions(draftUrl, [{
      start: 0,
      end: firstBodyStartUs,
      text: `3分钟精读一本书，今天我们读《${workflow.book.title}》`,
      keyword: workflow.book.title,
      keyword_color: template.captionKeyword.color,
      keyword_border_color: template.captionKeyword.borderColor,
      keyword_font_size: template.captionKeyword.fontSize,
      font_size: template.text.openingCaption.fontSize,
      in_animation: "渐显",
      in_animation_duration: 300_000,
    }], template.text.openingCaption);
    await client.addCaptions(draftUrl, [{
      start: 0,
      end: firstBodyStartUs,
      text: `《${workflow.book.title}》`,
      in_animation: "渐显",
      in_animation_duration: 300_000,
    }], template.text.openingBookTitle);
    if (workflow.book.author) {
      await client.addCaptions(draftUrl, [{
        start: 0,
        end: firstBodyStartUs,
        text: `${workflow.book.author} / 著`,
        in_animation: "渐显",
        in_animation_duration: 350_000,
      }], template.text.openingAuthor);
    }

    await client.addCaptions(
      draftUrl,
      cuesToCapcut(shiftedCues.slice(1)).map((caption, index) => ({
        ...caption,
        keyword: captionKeywords[index + 1].keyword,
        keyword_color: template.captionKeyword.color,
        keyword_border_color: template.captionKeyword.borderColor,
        keyword_font_size: template.captionKeyword.fontSize,
        font_size: template.text.caption.fontSize,
        in_animation: "渐显",
        in_animation_duration: 140_000,
      })),
      template.text.caption,
    );
    await client.addCaptions(draftUrl, [{
      start: firstBodyStartUs,
      end: totalDurationUs,
      text: `《${workflow.book.title}》`,
    }], template.text.bookTitle);
    if (workflow.book.author) {
      await client.addCaptions(draftUrl, [{
        start: firstBodyStartUs,
        end: totalDurationUs,
        text: `${workflow.book.author} / 著`,
      }], template.text.author);
    }
    const nickname = args.nickname || config.defaults?.nickname;
    if (nickname) {
      await client.addCaptions(draftUrl, [{
        start: firstBodyStartUs,
        end: totalDurationUs,
        text: nickname,
      }], template.text.nickname);
    }

    const saved = await client.saveDraft(draftUrl);
    const draftId = new URL(saved.draft_url || draftUrl).searchParams.get("draft_id") || "";
    const capcutMateDir = path.resolve(root, config.capcutMate.localDir || path.join(".tools", "capcut-mate"));
    const draftFolder = draftId ? path.join(capcutMateDir, "output", "draft", draftId) : "";
    let jianyingDraftFolder = "";
    if (args["install-to-jianying"]) {
      const jianyingRoot = args["jianying-dir"] ? path.resolve(args["jianying-dir"]) : "";
      if (!jianyingRoot || !fs.existsSync(jianyingRoot)) {
        throw new Error("未提供可用的剪映草稿库目录，请使用 --jianying-dir 指定。");
      }
      const draftName = args["draft-name"] || `${workflow.projectName}-第三模板`;
      const target = path.join(jianyingRoot, draftName);
      if (fs.existsSync(target)) throw new Error(`剪映草稿库中已存在同名草稿：${target}`);
      fs.cpSync(draftFolder, target, { recursive: true, errorOnExist: true });
      rewriteInstalledDraftPaths(draftFolder, target);
      jianyingDraftFolder = target;
    }

    const result = {
      ok: true,
      template: template.id,
      project: workflow.projectName,
      draftId,
      draftUrl: saved.draft_url || draftUrl,
      draftFolder,
      jianyingDraftFolder,
      canvas: template.canvas,
      totalDurationUs,
      introDurationUs,
      sceneCount: storyboard.length,
      tracks: plan.tracks,
      warning: "请在剪映中检查打开书动效、顶部四章节、中央透明插画、字幕安全区和本机字体替换情况。",
    };
    fs.writeFileSync(path.join(episodeDir, "knowledge-card-result.json"), `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mediaServer.close();
  }
}
