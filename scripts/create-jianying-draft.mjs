#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadWorkflowConfig, loadLayout, parseCliArgs } from "./lib/workflow-config.mjs";
import { cuesToCapcut } from "./lib/srt.mjs";
import { startMediaServer } from "./lib/media-server.mjs";
import { CapcutMateClient } from "./lib/capcut-mate-client.mjs";
import { buildOpeningVisualPlan, collectFlashImages } from "./lib/opening-workflow.mjs";
import { buildV3AudioSegments, buildV3DraftPlan, normalizeDraftTimeline } from "./lib/draft-plan.mjs";

const ROOT = process.cwd();
const args = parseCliArgs(process.argv.slice(2));
if (!args.project) {
  console.error("用法：node scripts/create-jianying-draft.mjs --project \"项目名\" [--intro-only] [--install-to-jianying --jianying-dir \"草稿库目录\"] [--dry-run] [--cover-fallback]");
  process.exit(1);
}

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

function capAudio(url, start, sourceDurationUs, end, volume) {
  const timelineEnd = Math.max(start + 1, end);
  return { audio_url: url, start, end: timelineEnd, duration: sourceDurationUs, volume };
}

function rewriteInstalledDraftPaths(root, sourceDraftFolder, installedDraftFolder) {
  const source = path.resolve(sourceDraftFolder);
  const target = path.resolve(installedDraftFolder);
  const stack = [target];
  let rewritten = 0;
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const itemPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(itemPath);
        continue;
      }
      if (!entry.isFile() || !/\.(json|tmp|extra)$/i.test(entry.name)) continue;
      const content = fs.readFileSync(itemPath, "utf8");
      if (!content.includes(source)) continue;
      fs.writeFileSync(itemPath, content.replaceAll(source, target));
      rewritten += 1;
    }
  }
  return rewritten;
}

const { config } = loadWorkflowConfig(ROOT, args.config);
const episodeDir = path.join(ROOT, "episodes", args.project);
const workflowPath = path.join(episodeDir, "workflow.json");
if (!fs.existsSync(workflowPath)) throw new Error(`找不到工作流项目：${workflowPath}`);
const workflow = readJson(workflowPath);
const isV3 = Number(workflow.schemaVersion) >= 3;
const introOnly = args["intro-only"] === true;
const readBodyArtifacts = !isV3 || !introOnly;
const resolveEpisodeAsset = (value) => value && (path.isAbsolute(value) ? value : path.join(episodeDir, value));
const layout = loadLayout(ROOT, workflow.aspect);
const scenes = readBodyArtifacts ? readJson(resolveEpisodeAsset(workflow.generated.storyboard)) : [];
const shiftedCues = readBodyArtifacts ? readJson(resolveEpisodeAsset(workflow.generated.shiftedCaptions)) : [];
const shiftedEnglishPath = readBodyArtifacts
  ? resolveEpisodeAsset(workflow.generated.shiftedEnglishCaptions)
  : "";
const shiftedEnglishCues = shiftedEnglishPath && fs.existsSync(shiftedEnglishPath)
  ? readJson(shiftedEnglishPath)
  : [];
const configuredFixedMaterials = workflow.fixedMaterials || {};
const keepAvailableOptionalFile = (filePath) => {
  if (typeof filePath !== "string" || !filePath.trim()) return "";
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return filePath;
  } catch {
    // Missing and inaccessible optional files follow the same skip path.
  }
  console.warn(`可选素材已不存在或不是文件，已跳过：${filePath}`);
  return "";
};
const fixedMaterials = isV3
  ? {
      ...configuredFixedMaterials,
      bgm: keepAvailableOptionalFile(configuredFixedMaterials.bgm),
      introVideo: keepAvailableOptionalFile(configuredFixedMaterials.introVideo),
      mechanicalSfx: keepAvailableOptionalFile(configuredFixedMaterials.mechanicalSfx),
      waterDropSfx: keepAvailableOptionalFile(configuredFixedMaterials.waterDropSfx),
      textStartSfx: keepAvailableOptionalFile(configuredFixedMaterials.textStartSfx),
    }
  : configuredFixedMaterials;
const bodyVoicePath = resolveEpisodeAsset(workflow.inputs.voice || workflow.inputs.bodyVoice);
const introVoicePath = isV3
  ? resolveEpisodeAsset(workflow.inputs.introVoice)
  : fixedMaterials.introVoice;
const titleVoicePath = isV3 ? resolveEpisodeAsset(workflow.inputs.titleVoice) : "";
const bookCoverPath = resolveEpisodeAsset(workflow.inputs.cover);
const fullBookCoverPath = resolveEpisodeAsset(workflow.inputs.fullCover) || bookCoverPath;
const draftTimeline = normalizeDraftTimeline(workflow, shiftedCues);
const timelineEndUs = isV3
  ? (introOnly ? workflow.timeline.bodyStartUs : workflow.totalDurationUs)
  : (introOnly ? workflow.intro.durationUs : workflow.totalDurationUs);
const flashImages = collectFlashImages(fixedMaterials.flashDir);
if (!isV3 && !flashImages.length) throw new Error(`快闪素材目录没有图片：${fixedMaterials.flashDir}`);

const sceneFiles = (introOnly ? [] : scenes).map((scene) => {
  const expected = path.join(episodeDir, "images", scene.imageFile);
  if (fs.existsSync(expected)) return expected;
  if (args["cover-fallback"]) return bookCoverPath;
  throw new Error(`缺少分镜图片：${expected}\n请先按 storyboard.md 生成图片；测试草稿可加 --cover-fallback。`);
});

const allFiles = [
  fixedMaterials.introVideo,
  ...flashImages,
  ...sceneFiles,
  fullBookCoverPath,
  bookCoverPath,
  bodyVoicePath,
  fixedMaterials.bgm,
  fixedMaterials.introVoice,
  fixedMaterials.mechanicalSfx,
  fixedMaterials.waterDropSfx,
  fixedMaterials.textStartSfx,
];

const hasFilePath = (filePath) => typeof filePath === "string" && Boolean(filePath.trim());
const optionalDurationUs = (filePath) => (hasFilePath(filePath) ? probeDurationUs(filePath) : 0);
const currentIntroVideoDurationUs = isV3 && !flashImages.length && hasFilePath(fixedMaterials.introVideo)
  ? probeDurationUs(fixedMaterials.introVideo)
  : 0;
const audioDurations = isV3
  ? {
      bodyVoice: introOnly ? 0 : probeDurationUs(bodyVoicePath),
      introVoice: probeDurationUs(introVoicePath),
      titleVoice: probeDurationUs(titleVoicePath),
      bgm: optionalDurationUs(fixedMaterials.bgm),
      mechanicalSfx: optionalDurationUs(fixedMaterials.mechanicalSfx),
      waterDropSfx: optionalDurationUs(fixedMaterials.waterDropSfx),
      textStartSfx: optionalDurationUs(fixedMaterials.textStartSfx),
    }
  : {
      bodyVoice: probeDurationUs(bodyVoicePath),
      bgm: probeDurationUs(fixedMaterials.bgm),
      introVoice: probeDurationUs(fixedMaterials.introVoice),
      mechanicalSfx: probeDurationUs(fixedMaterials.mechanicalSfx),
      waterDropSfx: probeDurationUs(fixedMaterials.waterDropSfx),
      textStartSfx: probeDurationUs(fixedMaterials.textStartSfx),
    };
const v3AudioSegments = isV3
  ? buildV3AudioSegments({
      timeline: draftTimeline,
      durations: audioDurations,
      materials: fixedMaterials,
      introOnly,
    })
  : [];

const intro = isV3 ? null : {
  videoDurationUs: Number(workflow.intro.videoDurationUs || audioDurations.introVoice),
  flashStartUs: Number(workflow.intro.flashStartUs || 0),
  flashEndUs: Number(workflow.intro.flashEndUs || workflow.intro.flashDurationUs || 1_080_000),
  coverStartUs: Number(workflow.intro.coverStartUs || workflow.intro.flashEndUs || 1_080_000),
  captionOffsetUs: Number(workflow.intro.captionOffsetUs || workflow.intro.coverStartUs || workflow.intro.durationUs),
};
const flashDurationUs = isV3
  ? 0
  : Math.floor((intro.flashEndUs - intro.flashStartUs) / flashImages.length);
const openingPlan = isV3
  ? buildOpeningVisualPlan({
      flashImages,
      introVideo: fixedMaterials.introVideo,
      introVideoDurationUs: currentIntroVideoDurationUs,
      introEndUs: draftTimeline.introEndUs,
    })
  : null;
const d = config.defaults || {};
const plan = isV3
  ? {
      ...buildV3DraftPlan({
        workflow: {
          ...workflow,
          inputs: {
            ...workflow.inputs,
            introVoice: introVoicePath,
            titleVoice: titleVoicePath,
            voice: bodyVoicePath,
            bodyVoice: bodyVoicePath,
          },
          fixedMaterials: { ...fixedMaterials },
        },
        openingPlan,
        sceneFiles,
        coverFiles: { full: fullBookCoverPath, cover: bookCoverPath },
        hasEnglish: shiftedEnglishCues.length > 0,
        hasAuthor: Boolean(workflow.book.author),
        hasNickname: Boolean(d.nickname),
        hasSourceNote: Boolean(d.sourceNote),
        introOnly,
      }),
      timeline: {
        introEndUs: draftTimeline.introEndUs,
        titleStartUs: draftTimeline.titleStartUs,
        titleEndUs: draftTimeline.titleEndUs,
        bodyStartUs: draftTimeline.bodyAudioStartUs,
        totalEndUs: timelineEndUs,
      },
      styles: layout.style,
    }
  : {
      schemaVersion: 1,
      project: workflow.projectName,
      aspect: workflow.aspect,
      canvas: workflow.canvas,
      timeline: {
        introEndUs: workflow.intro.durationUs,
        bodyStartUs: intro.captionOffsetUs,
        totalEndUs: timelineEndUs,
      },
      tracks: {
        video: ["V1 片头 MOV", "V2 快闪素材", "V3 全画幅书籍封面", "V4 正文分镜图片", "V5 缩小书籍封面"],
        text: ["T1 正文中文字幕", "T2 英文字幕", "T3 书名", "T4 作者", "T5 昵称", "T6 来源说明"],
        audio: ["A1 正文旁白", "A2 背景音乐", "A3 片头语音", "A4 机械音效", "A5 水滴音效", "A6 正文开头音效"],
      },
      styles: layout.style,
      sourceFiles: allFiles,
    };
fs.writeFileSync(path.join(episodeDir, "draft-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);

if (args["dry-run"]) {
  console.log(JSON.stringify({ ok: true, dryRun: true, plan: path.join(episodeDir, "draft-plan.json"), tracks: plan.tracks }, null, 2));
  process.exit(0);
}

const mediaFiles = isV3 ? plan.sourceFiles : allFiles;
const mediaServer = await startMediaServer(mediaFiles, {
  host: config.capcutMate.mediaHost,
  port: config.capcutMate.mediaPort,
});
const client = new CapcutMateClient(config.capcutMate.baseUrl);

try {
  const created = await client.createDraft(workflow.canvas.width, workflow.canvas.height);
  const draftUrl = created.draft_url;
  if (!draftUrl) throw new Error("CapCut Mate 创建草稿后没有返回 draft_url");

  if (isV3) {
    if (openingPlan.video) {
      await client.addVideos(draftUrl, [{
        video_url: mediaServer.urlFor(openingPlan.video.filePath),
        start: openingPlan.video.start,
        end: openingPlan.video.end,
        duration: currentIntroVideoDurationUs,
        volume: 0,
      }]);
    }
    if (openingPlan.flashSegments.length) {
      await client.addImages(draftUrl, openingPlan.flashSegments.map((segment) => ({
        image_url: mediaServer.urlFor(segment.filePath),
        start: segment.start,
        end: segment.end,
      })), { scaleX: 1, scaleY: 1 });
    }
  } else {
    await client.addVideos(draftUrl, [{
      video_url: mediaServer.urlFor(fixedMaterials.introVideo),
      start: 0,
      end: intro.videoDurationUs,
      duration: intro.videoDurationUs,
      volume: 0,
    }]);

    const flashInfos = flashImages.map((filePath, index) => ({
      image_url: mediaServer.urlFor(filePath),
      start: intro.flashStartUs + index * flashDurationUs,
      end: index === flashImages.length - 1 ? intro.flashEndUs : intro.flashStartUs + (index + 1) * flashDurationUs,
    }));
    await client.addImages(draftUrl, flashInfos, { scaleX: 1, scaleY: 1 });
  }

  let coverAnimation = d.coverAnimation || "水滴遮罩";
  let smallCoverAnimation = d.smallCoverAnimation || "点开";
  try {
    const animations = await client.getImageAnimations("in");
    const animationNames = new Set((animations.effects || []).map((item) => item.name));
    if (!animationNames.has(coverAnimation)) {
      console.warn(`CapCut Mate 当前没有“${coverAnimation}”入场动画，封面将无动画导入。`);
      coverAnimation = null;
    }
    if (!animationNames.has(smallCoverAnimation)) {
      console.warn(`CapCut Mate 当前没有“${smallCoverAnimation}”入场动画，缩小封面将无动画导入。`);
      smallCoverAnimation = null;
    }
  } catch (error) {
    console.warn(`无法读取图片动画列表，封面将无动画导入：${error.message}`);
    coverAnimation = null;
    smallCoverAnimation = null;
  }

  const bookNameEndUs = isV3
    ? draftTimeline.titleEndUs
    : shiftedCues[0]?.endUs || workflow.intro.durationUs;
  const firstBodySentenceStartUs = isV3
    ? draftTimeline.firstBodySentenceStartUs
    : shiftedCues[1]?.startUs || workflow.intro.durationUs;
  if (isV3) {
    const fullCoverInfos = [];
    if (openingPlan.coverFill) {
      fullCoverInfos.push({
        image_url: mediaServer.urlFor(fullBookCoverPath),
        start: openingPlan.coverFill.start,
        end: draftTimeline.introEndUs,
      });
    }
    fullCoverInfos.push({
      image_url: mediaServer.urlFor(fullBookCoverPath),
      start: draftTimeline.titleStartUs,
      end: draftTimeline.bodyAudioStartUs,
      ...(coverAnimation ? {
        in_animation: coverAnimation,
        in_animation_duration: Number(d.coverAnimationDurationUs || 500_000),
      } : {}),
    });
    await client.addImages(draftUrl, fullCoverInfos, {
      scaleX: 1,
      scaleY: 1,
      transformX: 0,
      transformY: 0,
    });
  } else {
    const coverEndUs = introOnly
      ? workflow.intro.durationUs
      : firstBodySentenceStartUs;
    await client.addImages(draftUrl, [{
      image_url: mediaServer.urlFor(fullBookCoverPath),
      start: intro.coverStartUs,
      end: coverEndUs,
      ...(coverAnimation ? {
        in_animation: coverAnimation,
        in_animation_duration: Number(d.coverAnimationDurationUs || 500_000),
      } : {}),
    }], {
      scaleX: 1,
      scaleY: 1,
      transformX: 0,
      transformY: 0,
    });
  }

  const bodyImageInfos = (introOnly ? [] : scenes).map((scene, index) => ({
    image_url: mediaServer.urlFor(sceneFiles[index]),
    start: scene.draftStartUs,
    end: index === scenes.length - 1 ? timelineEndUs : scenes[index + 1].draftStartUs,
  }));
  const bodyImages = bodyImageInfos.length
    ? await client.addImages(draftUrl, bodyImageInfos, { scaleX: 1, scaleY: 1 })
    : null;
  if (bodyImages?.segment_infos?.length) {
    const keyframes = bodyImages.segment_infos.flatMap((segment) => [
      { segment_id: segment.id, property: "UNIFORM_SCALE", offset: 0, value: 1 },
      { segment_id: segment.id, property: "UNIFORM_SCALE", offset: segment.end - segment.start, value: 1.1 },
    ]);
    await client.addKeyframes(draftUrl, keyframes);
  }

  if (!introOnly) {
    await client.addImages(draftUrl, [{
      image_url: mediaServer.urlFor(bookCoverPath),
      start: isV3 ? draftTimeline.bodyAudioStartUs : firstBodySentenceStartUs,
      end: timelineEndUs,
      ...(smallCoverAnimation ? {
        in_animation: smallCoverAnimation,
        in_animation_duration: Number(d.smallCoverAnimationDurationUs || 500_000),
      } : {}),
    }], {
      scaleX: layout.style.cover.scale,
      scaleY: layout.style.cover.scale,
      transformX: layout.style.cover.transformX,
      transformY: layout.style.cover.transformY,
    });
  }

  if (isV3) {
    const audioPaths = {
      introVoice: introVoicePath,
      titleVoice: titleVoicePath,
      bodyVoice: bodyVoicePath,
      mechanicalSfx: fixedMaterials.mechanicalSfx,
      waterDropSfx: fixedMaterials.waterDropSfx,
      textStartSfx: fixedMaterials.textStartSfx,
    };
    const audioVolumes = {
      introVoice: Number(d.introVoiceVolume ?? 1),
      titleVoice: Number(d.titleVoiceVolume ?? d.bodyVoiceVolume ?? 1),
      bodyVoice: Number(d.bodyVoiceVolume ?? 1),
      mechanicalSfx: Number(d.sfxVolume ?? 1),
      waterDropSfx: Number(d.sfxVolume ?? 1),
      textStartSfx: Number(d.sfxVolume ?? 1),
    };
    const addV3AudioSegment = async (segment) => client.addAudios(draftUrl, [capAudio(
      mediaServer.urlFor(audioPaths[segment.key]),
      segment.start,
      segment.sourceDurationUs,
      segment.end,
      audioVolumes[segment.key],
    )]);
    const bodySegment = v3AudioSegments.find((segment) => segment.key === "bodyVoice");
    if (bodySegment) await addV3AudioSegment(bodySegment);
    if (hasFilePath(fixedMaterials.bgm)) {
      const bgmInfos = [];
      for (let start = 0; start < timelineEndUs; start += audioDurations.bgm) {
        bgmInfos.push(capAudio(
          mediaServer.urlFor(fixedMaterials.bgm),
          start,
          audioDurations.bgm,
          Math.min(timelineEndUs, start + audioDurations.bgm),
          Number(d.bgmVolume ?? 0.25),
        ));
      }
      await client.addAudios(draftUrl, bgmInfos);
    }
    for (const segment of v3AudioSegments) {
      if (segment.key !== "bodyVoice") await addV3AudioSegment(segment);
    }
  } else {
    await client.addAudios(draftUrl, [capAudio(
      mediaServer.urlFor(bodyVoicePath),
      intro.captionOffsetUs,
      audioDurations.bodyVoice,
      introOnly ? Math.min(timelineEndUs, intro.captionOffsetUs + audioDurations.bodyVoice) : intro.captionOffsetUs + audioDurations.bodyVoice,
      Number(d.bodyVoiceVolume ?? 1),
    )]);
    const bgmInfos = [];
    for (let start = 0; start < timelineEndUs; start += audioDurations.bgm) {
      bgmInfos.push(capAudio(
        mediaServer.urlFor(fixedMaterials.bgm),
        start,
        audioDurations.bgm,
        Math.min(timelineEndUs, start + audioDurations.bgm),
        Number(d.bgmVolume ?? 0.25),
      ));
    }
    await client.addAudios(draftUrl, bgmInfos);
    await client.addAudios(draftUrl, [capAudio(
      mediaServer.urlFor(fixedMaterials.introVoice), 0, audioDurations.introVoice,
      Math.min(workflow.intro.durationUs, audioDurations.introVoice), Number(d.introVoiceVolume ?? 1),
    )]);
    await client.addAudios(draftUrl, [capAudio(
      mediaServer.urlFor(fixedMaterials.mechanicalSfx), intro.flashStartUs, audioDurations.mechanicalSfx,
      Math.min(workflow.intro.durationUs, intro.flashStartUs + audioDurations.mechanicalSfx), Number(d.sfxVolume ?? 1),
    )]);
    await client.addAudios(draftUrl, [capAudio(
      mediaServer.urlFor(fixedMaterials.waterDropSfx), intro.coverStartUs, audioDurations.waterDropSfx,
      Math.min(timelineEndUs, intro.coverStartUs + audioDurations.waterDropSfx), Number(d.sfxVolume ?? 1),
    )]);
    if (!introOnly) {
      await client.addAudios(draftUrl, [capAudio(
        mediaServer.urlFor(fixedMaterials.textStartSfx), firstBodySentenceStartUs, audioDurations.textStartSfx,
        Math.min(timelineEndUs, firstBodySentenceStartUs + audioDurations.textStartSfx), Number(d.sfxVolume ?? 1),
      )]);
    }
  }

  if (isV3) {
    await client.addCaptions(draftUrl, [{
      start: draftTimeline.titleStartUs,
      end: draftTimeline.titleEndUs,
      text: `《${workflow.book.title}》`,
    }], layout.style.bodyCaption);
    if (!introOnly) {
      await client.addCaptions(draftUrl, cuesToCapcut(shiftedCues), layout.style.bodyCaption);
      if (shiftedEnglishCues.length) {
        await client.addCaptions(draftUrl, cuesToCapcut(shiftedEnglishCues), layout.style.englishCaption);
      }
      if (draftTimeline.bodyAudioStartUs < timelineEndUs) {
        await client.addCaptions(draftUrl, [{
          start: draftTimeline.bodyAudioStartUs,
          end: timelineEndUs,
          text: `《${workflow.book.title}》`,
        }], layout.style.bookTitle);
      }
      if (workflow.book.author && draftTimeline.bodyAudioStartUs < timelineEndUs) {
        await client.addCaptions(draftUrl, [{
          start: draftTimeline.bodyAudioStartUs,
          end: timelineEndUs,
          text: `${workflow.book.author}/著`,
        }], layout.style.author);
      }
      if (d.nickname) {
        await client.addCaptions(draftUrl, [{ start: 0, end: timelineEndUs, text: d.nickname }], layout.style.nickname);
      }
      if (d.sourceNote) {
        await client.addCaptions(draftUrl, [{ start: 0, end: timelineEndUs, text: d.sourceNote }], layout.style.sourceNote);
      }
    }
  } else {
    if (!introOnly) await client.addCaptions(draftUrl, cuesToCapcut(shiftedCues), layout.style.bodyCaption);
    if (!introOnly && shiftedEnglishCues.length) {
      await client.addCaptions(draftUrl, cuesToCapcut(shiftedEnglishCues), layout.style.englishCaption);
    }
    if (bookNameEndUs < timelineEndUs) {
      await client.addCaptions(draftUrl, [{
        start: bookNameEndUs,
        end: timelineEndUs,
        text: `《${workflow.book.title}》`,
      }], layout.style.bookTitle);
    }
    if (workflow.book.author && bookNameEndUs < timelineEndUs) {
      await client.addCaptions(draftUrl, [{ start: bookNameEndUs, end: timelineEndUs, text: `${workflow.book.author}/著` }], layout.style.author);
    }
    if (d.nickname) {
      await client.addCaptions(draftUrl, [{ start: 0, end: timelineEndUs, text: d.nickname }], layout.style.nickname);
    }
    if (d.sourceNote) {
      await client.addCaptions(draftUrl, [{ start: 0, end: timelineEndUs, text: d.sourceNote }], layout.style.sourceNote);
    }
  }

  const saved = await client.saveDraft(draftUrl);
  const draftId = new URL(saved.draft_url || draftUrl).searchParams.get("draft_id") || "";
  const capcutMateDir = path.resolve(ROOT, config.capcutMate.localDir || path.join(".tools", "capcut-mate"));
  const draftFolder = draftId ? path.join(capcutMateDir, "output", "draft", draftId) : "";
  let jianyingDraftFolder = "";
  if (args["install-to-jianying"]) {
    const jianyingRoot = args["jianying-dir"] ? path.resolve(args["jianying-dir"]) : "";
    if (!jianyingRoot || !fs.existsSync(jianyingRoot)) {
      throw new Error("未提供可用的剪映草稿库目录。请主动向用户索要剪映草稿位置，再使用 --jianying-dir 指定该目录。");
    }
    const draftName = args["draft-name"] || `${workflow.projectName}-${introOnly ? "片头测试" : "剪映草稿"}`;
    const target = path.join(jianyingRoot, draftName);
    if (fs.existsSync(target)) throw new Error(`剪映草稿库中已存在同名草稿：${target}`);
    fs.cpSync(draftFolder, target, { recursive: true, errorOnExist: true });
    const rewrittenFiles = rewriteInstalledDraftPaths(draftFolder, draftFolder, target);
    jianyingDraftFolder = target;
    console.log(`已重写 ${rewrittenFiles} 个草稿文件中的素材路径。`);
  }
  const result = {
    ok: true,
    project: workflow.projectName,
    draftId,
    draftUrl: saved.draft_url || draftUrl,
    localDraftUrl: draftId ? `${config.capcutMate.baseUrl}/get_draft?draft_id=${draftId}` : "",
    draftFolder: draftFolder && fs.existsSync(draftFolder) ? draftFolder : "",
    jianyingDraftFolder,
    canvas: workflow.canvas,
    tracks: plan.tracks,
    warning: "首次打开后请检查本机字体替换、全画幅封面的水滴动画和缩小封面的点开动画。",
  };
  fs.writeFileSync(path.join(episodeDir, "draft-result.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await mediaServer.close();
}
