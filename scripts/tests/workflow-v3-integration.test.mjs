import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    ...options,
  });
  assert.equal(result.status, 0, [
    `${command} ${args.join(" ")} failed`,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join("\n"));
}

function createSilentMp3(filePath, durationSeconds) {
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(durationSeconds), "-q:a", "9", filePath,
  ]);
}

test("prepare creates a schema v3 project with three independent voice inputs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "readflow-v3-"));
  const projectName = `workflow-v3-${process.pid}-${Date.now()}`;
  const episodeDir = path.join(ROOT, "episodes", projectName);

  try {
    const introVoice = path.join(tempDir, "intro.mp3");
    const titleVoice = path.join(tempDir, "title.mp3");
    const bodyVoice = path.join(tempDir, "body.mp3");
    const cover = path.join(tempDir, "cover.jpg");
    const bodySrt = path.join(tempDir, "body.srt");
    const configPath = path.join(tempDir, "config.json");

    createSilentMp3(introVoice, 2);
    createSilentMp3(titleVoice, 1.5);
    createSilentMp3(bodyVoice, 4);
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=300x400",
      "-frames:v", "1", cover,
    ]);

    fs.writeFileSync(bodySrt, [
      "1",
      "00:00:00,000 --> 00:00:01,800",
      "第一句正文",
      "",
      "2",
      "00:00:01,800 --> 00:00:04,000",
      "第二句正文",
      "",
    ].join("\n"));
    fs.writeFileSync(configPath, `${JSON.stringify({
      obsidian: { vaultPath: path.join(tempDir, "missing-vault"), wereadFolder: "missing-notes" },
      defaults: { aspect: "3:4", requireEnglishSubtitles: false },
      materials: {
        root: path.join(tempDir, "missing-materials"),
        bgm: "missing-bgm.mp3",
        introVideo: "missing-intro.mov",
        introVoice: "missing-config-intro.mp3",
        mechanicalSfx: "missing-mechanical.mp3",
        waterDropSfx: "missing-water-drop.mp3",
        textStartSfx: "missing-text-start.mp3",
        flashDir: "missing-flash-directory",
      },
      capcutMate: { baseUrl: "http://127.0.0.1:9001" },
    }, null, 2)}\n`);

    const result = spawnSync(process.execPath, [
      "scripts/prepare-jianying-workflow.mjs",
      "--book", "测试书",
      "--author", "测试作者",
      "--cover", cover,
      "--intro-voice", introVoice,
      "--title-voice", titleVoice,
      "--voice", bodyVoice,
      "--srt", bodySrt,
      "--no-english",
      "--project", projectName,
      "--config", configPath,
    ], {
      cwd: ROOT,
      encoding: "utf8",
      shell: false,
    });

    assert.equal(result.status, 0, [result.stdout, result.stderr].filter(Boolean).join("\n"));

    const workflow = JSON.parse(fs.readFileSync(path.join(episodeDir, "workflow.json"), "utf8"));
    assert.equal(workflow.schemaVersion, 3);
    assert.deepEqual({
      introVoice: workflow.inputs.introVoice,
      titleVoice: workflow.inputs.titleVoice,
      voice: workflow.inputs.voice,
    }, {
      introVoice: "input/intro-voice.mp3",
      titleVoice: "input/title-voice.mp3",
      voice: "input/body-voiceover.mp3",
    });
    for (const inputPath of [workflow.inputs.introVoice, workflow.inputs.titleVoice, workflow.inputs.voice]) {
      assert.equal(fs.existsSync(path.join(episodeDir, inputPath)), true, `${inputPath} should exist`);
    }

    assert.equal(workflow.timeline.titleStartUs, workflow.opening.introVoiceDurationUs);
    assert.equal(
      workflow.timeline.bodyStartUs,
      workflow.opening.introVoiceDurationUs + workflow.opening.titleVoiceDurationUs,
    );
    assert.equal(workflow.fixedMaterials.bgm, "");

    const shiftedCaptions = JSON.parse(fs.readFileSync(
      path.join(episodeDir, workflow.generated.shiftedCaptions),
      "utf8",
    ));
    assert.equal(shiftedCaptions[0].startUs, workflow.timeline.bodyStartUs);
    assert.equal(shiftedCaptions[0].text, "第一句正文");

    const storyboard = JSON.parse(fs.readFileSync(
      path.join(episodeDir, workflow.generated.storyboard),
      "utf8",
    ));
    assert.equal(storyboard.some((scene) => scene.text.includes("第一句正文")), true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(episodeDir, { recursive: true, force: true });
  }
});
