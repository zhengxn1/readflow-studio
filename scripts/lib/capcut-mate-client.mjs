export class CapcutMateClient {
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl).replace(/\/$/, "");
  }

  async post(endpoint, body) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`无法连接 CapCut Mate：${this.baseUrl}\n请先启动本地服务。\n${error.message}`);
    }
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) {
      const detail = payload.detail ? JSON.stringify(payload.detail) : text;
      throw new Error(`CapCut Mate ${endpoint} 失败（HTTP ${response.status}）：${detail}`);
    }
    if (Number.isFinite(payload.code) && payload.code !== 0) {
      throw new Error(`CapCut Mate ${endpoint} 失败（code ${payload.code}）：${payload.message || text}`);
    }
    return payload;
  }

  createDraft(width, height) {
    return this.post("create_draft", { width, height });
  }

  addImages(draftUrl, imageInfos, style = {}) {
    return this.post("add_images", {
      draft_url: draftUrl,
      image_infos: JSON.stringify(imageInfos),
      alpha: style.alpha ?? 1,
      scale_x: style.scaleX ?? 1,
      scale_y: style.scaleY ?? 1,
      transform_x: style.transformX ?? 0,
      transform_y: style.transformY ?? 0,
    });
  }

  addVideos(draftUrl, videoInfos, style = {}) {
    return this.post("add_videos", {
      draft_url: draftUrl,
      video_infos: JSON.stringify(videoInfos),
      alpha: style.alpha ?? 1,
      scale_x: style.scaleX ?? 1,
      scale_y: style.scaleY ?? 1,
      transform_x: style.transformX ?? 0,
      transform_y: style.transformY ?? 0,
    });
  }

  addAudios(draftUrl, audioInfos) {
    return this.post("add_audios", { draft_url: draftUrl, audio_infos: JSON.stringify(audioInfos) });
  }

  addCaptions(draftUrl, captions, style = {}) {
    return this.post("add_captions", {
      draft_url: draftUrl,
      captions: JSON.stringify(captions),
      text_color: style.textColor || "#ffffff",
      border_color: style.borderColor || null,
      alignment: style.alignment ?? 1,
      alpha: style.alpha ?? 1,
      font: style.font || null,
      font_size: style.fontSize ?? 15,
      letter_spacing: style.letterSpacing ?? null,
      line_spacing: style.lineSpacing ?? null,
      scale_x: style.scaleX ?? 1,
      scale_y: style.scaleY ?? 1,
      transform_x: style.transformX ?? 0,
      transform_y: style.transformY ?? 0,
      bold: style.bold ?? false,
      has_shadow: style.hasShadow ?? false,
      shadow_info: style.hasShadow ? (style.shadowInfo || {
        shadow_alpha: 0.9,
        shadow_color: "#000000",
        shadow_diffuse: 15,
        shadow_distance: 5,
        shadow_angle: -45,
      }) : null,
    });
  }

  addKeyframes(draftUrl, keyframes) {
    return this.post("add_keyframes", { draft_url: draftUrl, keyframes: JSON.stringify(keyframes) });
  }

  addMasks(draftUrl, segmentIds, mask = {}) {
    return this.post("add_masks", {
      draft_url: draftUrl,
      segment_ids: segmentIds,
      name: mask.name || "圆形",
      X: mask.x ?? 0,
      Y: mask.y ?? 0,
      width: mask.width ?? 512,
      height: mask.height ?? 512,
      feather: mask.feather ?? 0,
      rotation: mask.rotation ?? 0,
      invert: mask.invert ?? false,
      roundCorner: mask.roundCorner ?? 0,
    });
  }

  addEffects(draftUrl, effectInfos) {
    return this.post("add_effects", { draft_url: draftUrl, effect_infos: JSON.stringify(effectInfos) });
  }

  saveDraft(draftUrl) {
    return this.post("save_draft", { draft_url: draftUrl });
  }

  getImageAnimations(type = "in") {
    return this.post("get_image_animations", { mode: 0, type });
  }
}
