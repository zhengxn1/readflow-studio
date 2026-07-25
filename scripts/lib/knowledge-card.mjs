const PUNCTUATION = /[\s，。！？；：、“”‘’（）()《》【】[\]…—-]+/gu;
const LEADING_PHRASES = [
  "你有没有过",
  "我们总以为",
  "但周岭在",
  "真正的问题可能",
  "而是我们还没有真正",
  "我们习惯",
  "这正是",
  "一方面我们",
  "另一方面",
  "我们有",
  "希望不用",
  "就能",
  "大脑就会越来越",
  "往往不是因为",
  "而是因为我们没有把",
  "当一件事在脑海里",
  "我们会本能的",
  "当目标步骤和困难",
  "行动反而会",
  "所以真正有",
  "并不是能在",
  "而是懂得",
  "把注意力放在当前",
  "不要想着",
  "而是先",
  "不要等待",
  "因为",
];

function cleanText(value) {
  return String(value || "").replace(PUNCTUATION, "");
}

export function selectCaptionKeyword(text, { bookTitle = "" } = {}) {
  const source = cleanText(text);
  const normalizedTitle = cleanText(bookTitle);
  if (!source) return "";
  if (normalizedTitle && source.includes(normalizedTitle)) return normalizedTitle;

  let candidate = source;
  for (const prefix of LEADING_PHRASES) {
    if (candidate.startsWith(prefix) && candidate.length > prefix.length + 1) {
      candidate = candidate.slice(prefix.length);
      break;
    }
  }

  const semanticPieces = candidate
    .split(/(?:却|但是|可能|因为|所以|而是|已经|一直|没有|不用|就会|变得|带来|的人|的一件事|的计划|的重要原因)/u)
    .map((part) => cleanText(part))
    .filter((part) => part.length >= 2);
  const preferred = semanticPieces
    .filter((part) => source.includes(part))
    .sort((a, b) => Math.min(b.length, 8) - Math.min(a.length, 8))[0] || candidate;
  if (preferred.length <= 8) return preferred;
  return preferred.slice(-8);
}

export function buildCaptionKeywords(cues, { bookTitle = "", overrides = [] } = {}) {
  const overrideMap = new Map(
    overrides.map((item) => [Number(item.cueIndex), String(item.keyword || "").trim()]),
  );
  return cues.map((cue, index) => {
    const cueIndex = index + 1;
    const text = String(cue.text || "");
    const override = overrideMap.get(cueIndex);
    const keyword = override || selectCaptionKeyword(text, { bookTitle });
    if (!keyword || !text.includes(keyword)) {
      throw new Error(`第 ${cueIndex} 条字幕的关键词“${keyword}”不是原句“${text}”中的连续文字`);
    }
    return { cueIndex, text, keyword };
  });
}
