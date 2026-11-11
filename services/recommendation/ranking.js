"use strict";

function loadRankingConfig(env = process.env) {
  const read = (name, fallback, bounds) => {
    const value = Number(env[name]);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(bounds?.min ?? 0, Math.min(bounds?.max ?? Number.MAX_SAFE_INTEGER, value));
  };
  return {
    weights: {
      personalized: read("RECS_WEIGHT_PERSONALIZED", 1.0),
      popular: read("RECS_WEIGHT_POPULAR", 0.45),
      recent: read("RECS_WEIGHT_RECENT", 0.6),
      following: read("RECS_WEIGHT_FOLLOWING", 0.75),
      group: read("RECS_WEIGHT_GROUP", 0.35),
      department: read("RECS_WEIGHT_DEPARTMENT", 0.3),
      itemToItem: read("RECS_WEIGHT_ITEM_TO_ITEM", 0.5),
      interest: read("RECS_WEIGHT_INTEREST", 0.55),
      freshness: read("RECS_WEIGHT_FRESHNESS", 0.35),
      exploration: read("RECS_WEIGHT_EXPLORATION", 0.4),
    },
    explorationRatio: read("RECS_EXPLORATION_RATIO", 0.15, { min: 0, max: 0.5 }),
    freshnessHours: read("RECS_FRESHNESS_HOURS", 72, { min: 1 }),
    maxAuthorRun: Math.floor(read("RECS_MAX_SAME_AUTHOR_RUN", 2, { min: 1, max: 5 })),
    maxFormatRun: Math.floor(read("RECS_MAX_SAME_FORMAT_RUN", 3, { min: 1, max: 5 })),
    candidateLimit: Math.floor(read("RECS_CANDIDATE_LIMIT", 300, { min: 50, max: 1000 })),
    abTestEnabled: String(env.RECS_AB_TEST_ENABLED || "true") !== "false",
    abTestSplit: read("RECS_AB_TEST_SPLIT", 0.5, { min: 0, max: 1 }),
  };
}

function ageHours(value, now = Date.now()) {
  const time = new Date(value || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, (now - time) / 3_600_000);
}

function freshness(post, now, halfLifeHours = 72) {
  return Math.exp(-ageHours(post?.createdAt, now) / Math.max(1, halfLifeHours));
}

function popularity(post) {
  const reactions = Number(post?.reactionCount || post?.reactionsTotal || 0);
  const comments = Number(post?.commentCount || 0);
  const shares = Number(post?.shareCount || 0);
  return Math.log1p(Math.max(0, reactions) + comments * 2 + shares * 3) / Math.log(50);
}

function hasSource(candidate, source) {
  return Array.isArray(candidate.sources)
    ? candidate.sources.includes(source)
    : Boolean(candidate.sources?.[source]);
}

function scoreCandidate(candidate, context = {}) {
  const { weights, freshnessHours: halfLife = 72, now = Date.now() } = context;
  const post = candidate.post || candidate;
  const maxGorse = Math.max(1, Number(candidate.maxGorseScore) || 1);
  const maxItem = Math.max(1, Number(candidate.maxItemScore) || 1);
  const source = (name, weight) => (hasSource(candidate, name) ? weight : 0);
  return (
    source("gorse", weights.personalized) * Math.min(1, Math.max(0, Number(candidate.gorseScore) || 0) / maxGorse)
    + source("popular", weights.popular) * Math.min(1, popularity(post))
    + source("recent", weights.recent) * freshness(post, now, halfLife)
    + source("following", weights.following)
    + source("group", weights.group)
    + source("department", weights.department)
    + source("item", weights.itemToItem) * Math.min(1, Math.max(0, Number(candidate.itemScore) || 0) / maxItem)
    + weights.interest * Math.min(1, Math.max(0, Number(candidate.interestMatch) || 0))
    + weights.freshness * freshness(post, now, halfLife)
    + (candidate.exploratory ? weights.exploration : 0)
  );
}

function authorOf(candidate) {
  return String(candidate.authorId || candidate.authorName || "");
}

function formatOf(candidate) {
  return String(candidate.format || "text");
}

function diversify(sequence, { maxAuthorRun = 2, maxFormatRun = 3 } = {}) {
  const remaining = [...sequence];
  const out = [];
  let authorRun = 0;
  let formatRun = 0;
  let lastAuthor = "";
  let lastFormat = "";

  while (remaining.length) {
    let chosenIndex = 0;
    const first = remaining[0];
    const nextAuthor = authorOf(first);
    const nextFormat = formatOf(first);
    const violatesAuthor = nextAuthor === lastAuthor && authorRun >= maxAuthorRun;
    const violatesFormat = nextFormat === lastFormat && formatRun >= maxFormatRun;
    if (violatesAuthor || violatesFormat) {
      const alternative = remaining.findIndex((candidate) => {
        const authorConflict = authorOf(candidate) === lastAuthor && authorRun >= maxAuthorRun;
        const formatConflict = formatOf(candidate) === lastFormat && formatRun >= maxFormatRun;
        return !authorConflict && !formatConflict;
      });
      if (alternative >= 0) chosenIndex = alternative;
    }
    const [candidate] = remaining.splice(chosenIndex, 1);
    const author = authorOf(candidate);
    const format = formatOf(candidate);
    authorRun = author && author === lastAuthor ? authorRun + 1 : 1;
    formatRun = format && format === lastFormat ? formatRun + 1 : 1;
    lastAuthor = author;
    lastFormat = format;
    out.push(candidate);
  }
  return out;
}

function reserveExploration(ranked, exploration, limit, ratio) {
  const slots = Math.min(limit, Math.max(0, Math.round(limit * Math.max(0, Math.min(0.5, ratio)))));
  if (!slots || !exploration.length) return ranked.slice(0, limit);
  const windowSize = Math.max(2, Math.round(limit / slots));
  const explorationIds = new Set(exploration.map((candidate) => String(candidate.id)));
  const main = ranked.filter((candidate) => !explorationIds.has(String(candidate.id)));
  const explore = [...exploration];
  const out = [];
  while (out.length < limit && (main.length || explore.length)) {
    for (let slot = 0; slot < windowSize && out.length < limit; slot += 1) {
      const exploreSlot = slot === windowSize - 1 && explore.length;
      const next = exploreSlot ? explore.shift() : (main.shift() || explore.shift());
      if (next) out.push(next);
    }
  }
  return out;
}

/**
 * Ranking de duas fases: pontua todas as fontes e depois aplica exploração,
 * diversidade e paginação de forma determinística.
 */
function rankFeed(candidates, {
  page = 1,
  limit = 10,
  config = loadRankingConfig(),
  now = Date.now(),
} = {}) {
  const unique = new Map();
  candidates.forEach((candidate) => {
    if (!candidate?.id) return;
    const previous = unique.get(String(candidate.id));
    if (!previous) {
      unique.set(String(candidate.id), {
        ...candidate,
        sources: [...new Set(candidate.sources || [])],
      });
      return;
    }
    previous.sources = [...new Set([...previous.sources, ...(candidate.sources || [])])];
    previous.gorseScore = Math.max(previous.gorseScore || 0, candidate.gorseScore || 0);
    previous.itemScore = Math.max(previous.itemScore || 0, candidate.itemScore || 0);
    previous.exposure = Math.min(previous.exposure ?? Infinity, candidate.exposure ?? Infinity);
    previous.interestMatch = Math.max(previous.interestMatch || 0, candidate.interestMatch || 0);
    previous.exploratory = previous.exploratory || candidate.exploratory;
  });

  const list = [...unique.values()];
  const maxGorseScore = Math.max(0, ...list.map((candidate) => Number(candidate.gorseScore) || 0));
  const maxItemScore = Math.max(0, ...list.map((candidate) => Number(candidate.itemScore) || 0));
  const scored = list.map((candidate) => ({
    ...candidate,
    maxGorseScore,
    maxItemScore,
    score: scoreCandidate({ ...candidate, maxGorseScore, maxItemScore }, {
      weights: config.weights,
      freshnessHours: config.freshnessHours,
      now,
    }),
  })).sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));

  const exploration = scored
    .filter((candidate) => candidate.exploratory)
    .sort((a, b) => freshness(b.post, now, 12) - freshness(a.post, now, 12) || b.score - a.score);
  const pageEnd = page * limit;
  const sequence = reserveExploration(
    scored,
    exploration,
    scored.length,
    config.explorationRatio
  );
  const diverse = diversify(sequence, {
    maxAuthorRun: config.maxAuthorRun,
    maxFormatRun: config.maxFormatRun,
  });
  const start = (page - 1) * limit;
  return {
    data: diverse.slice(start, start + limit),
    all: diverse,
    total: diverse.length,
    hasMore: diverse.length > pageEnd,
    weights: { ...config.weights },
  };
}

module.exports = {
  diversify,
  freshness,
  loadRankingConfig,
  popularity,
  rankFeed,
  scoreCandidate,
};
