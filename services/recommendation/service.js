"use strict";

const { DATABASE } = require("../../config/Database");
const hr = require("../../hr/service");
const { gorseClient, GorseUnavailableError } = require("./gorseClient");
const {
  gorsePostId,
  gorseUserId,
  parseGorseId,
  scheduleFeedback,
  scheduleFollowSync,
  scheduleUserSync,
} = require("./sync");
const { loadRankingConfig, rankFeed } = require("./ranking");
const { recentPositivePostIds, rememberPositive } = require("./session");
const { recordDomainEvent } = require("../../moderation/domainEvents");

const FEEDBACK_TYPES = new Set([
  "like",
  "comment",
  "share",
  "save",
  "read",
  "hide",
  "report",
  "not_interested",
  "mute_author",
  "dwell_time",
  "video_completion",
  "replay",
  "open_comments",
  "author_profile",
  "dwell_quick",
]);

function pageOptions(query = {}) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, Number.parseInt(query.limit, 10) || 10));
  return { page, limit, offset: (page - 1) * limit };
}

function recommendationMeta(page, limit, count, hasMore) {
  const total = (page - 1) * limit + count + (hasMore ? limit : 0);
  return {
    page,
    limit,
    total,
    totalPages: hasMore ? page + 1 : page,
    hasMore,
  };
}

async function suppressedPostIds(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT DISTINCT ed_hr_rec_feedback_post_uid AS postId
       FROM eduall_hr_recommendation_feedback
      WHERE BINARY ed_hr_rec_feedback_institute_code = BINARY ?
        AND ed_hr_rec_feedback_user_id = ?
        AND ed_hr_rec_feedback_deleted = 0
        AND ed_hr_rec_feedback_type IN ('read', 'hide', 'report', 'not_interested')`,
    [ctx.instituteCode, ctx.userId]
  );
  return new Set(rows.map((row) => Number(row.postId)));
}

async function visibleFeedMap(ctx) {
  const response = await hr.listFeed(ctx, {
    page: 1,
    limit: 1000,
    sort: "newest",
  });
  return new Map((response?.data || []).map((post) => [Number(post.id), post]));
}

function scoreMapForRequest(ctx, entries) {
  const map = new Map();
  entries.forEach((entry) => {
    const parsed = parseGorseId(entry.id, "p");
    if (!parsed || parsed.instituteCode !== ctx.instituteCode) return;
    map.set(parsed.id, Math.max(map.get(parsed.id) || 0, Number(entry.score) || 0));
  });
  return map;
}

async function mutedAuthorIds(ctx) {
  try {
    const [rows] = await DATABASE.query(
      `SELECT ed_hr_rec_muted_author_id AS authorId
         FROM eduall_hr_recommendation_muted_authors
        WHERE BINARY ed_hr_rec_muted_institute_code = BINARY ?
          AND ed_hr_rec_muted_user_id = ?`,
      [ctx.instituteCode, ctx.userId]
    );
    return new Set(rows.map((row) => Number(row.authorId)));
  } catch {
    return new Set();
  }
}

async function userPreferences(ctx) {
  try {
    const [rows] = await DATABASE.query(
      `SELECT ed_hr_rec_pref_interests AS interests,
              ed_hr_rec_pref_updated_at AS updatedAt
         FROM eduall_hr_recommendation_preferences
        WHERE BINARY ed_hr_rec_pref_institute_code = BINARY ?
          AND ed_hr_rec_pref_user_id = ?
        LIMIT 1`,
      [ctx.instituteCode, ctx.userId]
    );
    const raw = rows[0]?.interests;
    const interests = Array.isArray(raw)
      ? raw
      : (() => {
          try { return JSON.parse(raw || "[]"); } catch { return []; }
        })();
    return {
      interests: interests.map((value) => String(value).trim()).filter(Boolean).slice(0, 20),
      updatedAt: rows[0]?.updatedAt || null,
    };
  } catch {
    return { interests: [], updatedAt: null };
  }
}

async function groupAuthorIds(ctx) {
  try {
    const [rows] = await DATABASE.query(
      `SELECT DISTINCT other.ed_hr_chat_participant_user_id AS authorId
         FROM eduall_hr_chat_participants mine
         JOIN eduall_hr_chat_conversations c
           ON c.ed_hr_chat_conversation_id = mine.ed_hr_chat_participant_conversation_id
          AND BINARY c.ed_hr_chat_conversation_institute_code = BINARY ?
          AND c.ed_hr_chat_conversation_type = 'group'
          AND c.ed_hr_chat_conversation_deleted = 0
         JOIN eduall_hr_chat_participants other
           ON other.ed_hr_chat_participant_conversation_id = mine.ed_hr_chat_participant_conversation_id
          AND other.ed_hr_chat_participant_user_id <> ?
          AND other.ed_hr_chat_participant_deleted = 0
        WHERE mine.ed_hr_chat_participant_user_id = ?
          AND mine.ed_hr_chat_participant_deleted = 0`,
      [ctx.instituteCode, ctx.userId, ctx.userId]
    );
    return new Set(rows.map((row) => Number(row.authorId)));
  } catch {
    return new Set();
  }
}

async function exposureMap(ctx) {
  try {
    const [rows] = await DATABASE.query(
      `SELECT ed_hr_rec_analytics_post_uid AS postId, COUNT(*) AS impressions
         FROM eduall_hr_recommendation_analytics
        WHERE BINARY ed_hr_rec_analytics_institute_code = BINARY ?
          AND ed_hr_rec_analytics_event_type = 'impression'
          AND ed_hr_rec_analytics_created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        GROUP BY ed_hr_rec_analytics_post_uid`,
      [ctx.instituteCode]
    );
    return new Map(rows.map((row) => [Number(row.postId), Number(row.impressions) || 0]));
  } catch {
    return new Map();
  }
}

function interestMatchScore(post, interests, department) {
  const terms = [...interests, department].map((value) => String(value || "").toLowerCase()).filter(Boolean);
  if (!terms.length) return 0;
  const content = `${post.content || ""} ${post.departmentName || ""} ${post.visibility || ""}`.toLowerCase();
  const matches = terms.filter((term) => content.includes(term)).length;
  return Math.min(1, matches / Math.min(3, terms.length));
}

function experimentFor(ctx, config) {
  if (!config.abTestEnabled) return { name: "disabled", variant: "default" };
  const bucket = [...String(ctx.userId)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 10_000, 7);
  return {
    name: "recommendation_ranking_v2",
    variant: bucket < config.abTestSplit * 10_000 ? "adaptive" : "control",
  };
}

async function writeAnalytics(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  const placeholders = rows.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(",");
  const params = rows.flatMap((row) => [
    row.instituteCode,
    row.userId,
    row.postId || null,
    row.type,
    Number(row.value ?? 1),
    row.sessionId || null,
    row.experiment || null,
    row.metadata ? JSON.stringify(row.metadata) : null,
  ]);
  try {
    await DATABASE.query(
      `INSERT INTO eduall_hr_recommendation_analytics (
         ed_hr_rec_analytics_institute_code,
         ed_hr_rec_analytics_user_id,
         ed_hr_rec_analytics_post_uid,
         ed_hr_rec_analytics_event_type,
         ed_hr_rec_analytics_value,
         ed_hr_rec_analytics_session_id,
         ed_hr_rec_analytics_experiment,
         ed_hr_rec_analytics_metadata
       ) VALUES ${placeholders}`,
      params
    );
  } catch (error) {
    console.warn("[recommendations:analytics]", error.message);
  }
}

async function fallbackFeed(ctx, page, limit, suppressed) {
  const response = await hr.listFeed(ctx, {
    page,
    limit: Math.min(1000, limit + suppressed.size + page * limit),
    sort: "popular",
  });
  const data = (response?.data || [])
    .filter((post) => !suppressed.has(Number(post.id)))
    .slice(0, limit);
  return {
    data,
    meta: {
      ...(response?.meta || recommendationMeta(page, limit, data.length, false)),
      page,
      limit,
    },
    source: "fallback",
    degraded: true,
  };
}

async function recommendedFeed(ctx, query = {}) {
  const { page, limit } = pageOptions(query);
  const config = loadRankingConfig();
  const experiment = experimentFor(ctx, config);
  const [suppressed, mutedAuthors, visible, preferences, followed, groupAuthors, exposure] = await Promise.all([
    suppressedPostIds(ctx),
    mutedAuthorIds(ctx),
    visibleFeedMap(ctx),
    userPreferences(ctx),
    followedUserIds(ctx),
    groupAuthorIds(ctx),
    exposureMap(ctx),
  ]);
  let personalized = [];
  let itemNeighbors = [];
  let degraded = false;
  let errorCode = "";

  try {
    personalized = await gorseClient.recommend(
      gorseUserId(ctx.instituteCode, ctx.userId),
      {
        limit: Math.min(config.candidateLimit, Math.max(100, limit * 8)),
        offset: 0,
      }
    );
  } catch (error) {
    degraded = true;
    errorCode = error.code || "GORSE_UNAVAILABLE";
    if (!(error instanceof GorseUnavailableError)) {
      console.warn("[recommendations:feed]", error.message);
    }
  }

  const recentPositive = await recentPositivePostIds(ctx, 3);
  if (recentPositive.length) {
    const itemResults = await Promise.allSettled(recentPositive.map((postId) => (
      gorseClient.itemNeighbors(gorsePostId(ctx.instituteCode, postId), {
        limit: Math.min(80, limit * 6),
        offset: 0,
      })
    )));
    itemResults.forEach((result) => {
      if (result.status === "fulfilled") itemNeighbors.push(...result.value);
      else {
        degraded = true;
        errorCode = errorCode || result.reason?.code || "GORSE_ITEM_TO_ITEM_UNAVAILABLE";
      }
    });
  }

  const personalizedScores = scoreMapForRequest(ctx, personalized);
  const itemScores = scoreMapForRequest(ctx, itemNeighbors);
  const candidates = [];
  visible.forEach((post) => {
    const postId = Number(post.id);
    if (suppressed.has(postId) || mutedAuthors.has(Number(post.userId))) return;
    const sources = ["recent"];
    if (Number(post.reactionCount || 0) + Number(post.commentCount || 0) > 0) sources.push("popular");
    if (followed.has(Number(post.userId))) sources.push("following");
    if (groupAuthors.has(Number(post.userId))) sources.push("group");
    if (ctx.departmentId && Number(post.departmentId) === Number(ctx.departmentId)) sources.push("department");
    if (personalizedScores.has(postId)) sources.push("gorse");
    if (itemScores.has(postId)) sources.push("item");
    const age = (Date.now() - new Date(post.createdAt || 0).getTime()) / 3_600_000;
    const impressions = exposure.get(postId) || 0;
    candidates.push({
      id: post.id,
      post,
      sources,
      authorId: post.employeeId || post.userId,
      authorName: post.authorName,
      format: post.media?.type || "text",
      gorseScore: personalizedScores.get(postId) || 0,
      itemScore: itemScores.get(postId) || 0,
      exposure: impressions,
      interestMatch: interestMatchScore(post, preferences.interests, ctx.departmentName || ctx.department),
      exploratory: age <= config.freshnessHours && impressions <= 2,
    });
  });

  if (candidates.length) {
    const effectiveConfig = experiment.variant === "control"
      ? {
          ...config,
          weights: {
            ...config.weights,
            personalized: config.weights.personalized * 0.85,
            popular: config.weights.popular * 1.15,
            recent: config.weights.recent * 1.15,
          },
        }
      : config;
    const ranked = rankFeed(candidates, {
      page,
      limit,
      config: effectiveConfig,
    });
    writeAnalytics(ranked.data.map((candidate) => ({
      instituteCode: ctx.instituteCode,
      userId: ctx.userId,
      postId: candidate.id,
      type: "impression",
      value: 1,
      experiment: experiment.name,
      metadata: {
        variant: experiment.variant,
        page,
        sources: candidate.sources,
        score: Math.round(candidate.score * 10_000) / 10_000,
      },
    }))).catch(() => {});
    return {
      data: ranked.data.map((candidate) => candidate.post),
      meta: {
        ...recommendationMeta(page, limit, ranked.data.length, ranked.hasMore),
        total: ranked.total,
        totalPages: Math.max(1, Math.ceil(ranked.total / limit)),
        experiment,
        coldStart: preferences.interests.length === 0,
        sources: ranked.data.reduce((accumulator, candidate) => {
          candidate.sources.forEach((source) => {
            accumulator[source] = (accumulator[source] || 0) + 1;
          });
          return accumulator;
        }, {}),
      },
      source: degraded && !personalizedScores.size && !itemScores.size ? "fallback" : "hybrid",
      degraded,
      errorCode: errorCode || undefined,
      personalized: personalizedScores.size,
      itemToItem: itemScores.size,
      exploration: ranked.data.filter((candidate) => candidate.exploratory).length,
    };
  }

  if (!visible.size) {
    const fallback = await fallbackFeed(ctx, page, limit, suppressed);
    if (fallback.data.length) {
      writeAnalytics(fallback.data.map((post) => ({
        instituteCode: ctx.instituteCode,
        userId: ctx.userId,
        postId: post.id,
        type: "impression",
        value: 1,
        experiment: experiment.name,
        metadata: { variant: experiment.variant, page, source: "fallback" },
      }))).catch(() => {});
    }
    return {
      ...fallback,
      meta: { ...fallback.meta, experiment, coldStart: preferences.interests.length === 0 },
      errorCode: errorCode || undefined,
    };
  }

  return {
    data: [],
    meta: {
      ...recommendationMeta(page, limit, 0, false),
      experiment,
      coldStart: preferences.interests.length === 0,
    },
    source: "hybrid",
    degraded,
    errorCode: errorCode || undefined,
  };
}

async function followedUserIds(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT ed_hr_user_follow_followed_id AS id
       FROM eduall_hr_user_follows
      WHERE BINARY ed_hr_user_follow_institute_code = BINARY ?
        AND ed_hr_user_follow_follower_id = ?
        AND ed_hr_user_follow_deleted = 0`,
    [ctx.instituteCode, ctx.userId]
  );
  return new Set(rows.map((row) => Number(row.id)));
}

async function profileMap(ctx, userIds) {
  const ids = [...new Set(userIds.map(Number).filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const [rows] = await DATABASE.query(
    `SELECT ua.ed_user_account_id AS id,
            COALESCE(ua.ed_user_account_name, e.ed_employee_name, 'Utilizador') AS name,
            COALESCE(ua.ed_user_account_picture, e.ed_employee_picture, '') AS picture,
            e.ed_employee_charge AS role,
            e.ed_employee_department AS departmentId,
            d.ed_department_title AS department
       FROM eduall_user_accounts ua
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = ua.ed_user_account_id
        AND BINARY ui.ed_user_institute_code = BINARY ?
        AND ui.ed_user_institute_deleted = 0
       LEFT JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY ?
        AND e.ed_employee_deleted = 0
       LEFT JOIN eduall_department d
         ON d.ed_department_id = e.ed_employee_department
        AND d.ed_department_deleted = 0
      WHERE ua.ed_user_account_id IN (${ids.map(() => "?").join(",")})
        AND ua.ed_user_account_deleted = 0
        AND (
          ui.ed_user_institute_userCode IS NOT NULL
          OR BINARY ua.ed_user_account_institute_code = BINARY ?
        )`,
    [ctx.instituteCode, ctx.instituteCode, ...ids, ctx.instituteCode]
  );
  rows.forEach((row) => {
    map.set(Number(row.id), {
      id: Number(row.id),
      name: row.name,
      picture: row.picture || "",
      role: row.role || "",
      departmentId: row.departmentId ? Number(row.departmentId) : null,
      department: row.department || "",
    });
  });
  return map;
}

async function commonFollowScores(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT second.ed_hr_user_follow_followed_id AS userId,
            COUNT(DISTINCT first.ed_hr_user_follow_followed_id) AS count
       FROM eduall_hr_user_follows first
       JOIN eduall_hr_user_follows second
         ON second.ed_hr_user_follow_follower_id = first.ed_hr_user_follow_followed_id
        AND BINARY second.ed_hr_user_follow_institute_code = BINARY first.ed_hr_user_follow_institute_code
        AND second.ed_hr_user_follow_deleted = 0
      WHERE BINARY first.ed_hr_user_follow_institute_code = BINARY ?
        AND first.ed_hr_user_follow_follower_id = ?
        AND first.ed_hr_user_follow_deleted = 0
        AND second.ed_hr_user_follow_followed_id <> ?
      GROUP BY second.ed_hr_user_follow_followed_id`,
    [ctx.instituteCode, ctx.userId, ctx.userId]
  );
  return new Map(rows.map((row) => [Number(row.userId), Number(row.count)]));
}

async function sharedGroupScores(ctx) {
  const [rows] = await DATABASE.query(
    `SELECT other.ed_hr_chat_participant_user_id AS userId,
            COUNT(DISTINCT mine.ed_hr_chat_participant_conversation_id) AS count
       FROM eduall_hr_chat_participants mine
       JOIN eduall_hr_chat_conversations c
         ON c.ed_hr_chat_conversation_id = mine.ed_hr_chat_participant_conversation_id
        AND BINARY c.ed_hr_chat_conversation_institute_code = BINARY ?
        AND c.ed_hr_chat_conversation_type = 'group'
        AND c.ed_hr_chat_conversation_deleted = 0
       JOIN eduall_hr_chat_participants other
         ON other.ed_hr_chat_participant_conversation_id = mine.ed_hr_chat_participant_conversation_id
        AND other.ed_hr_chat_participant_user_id <> ?
        AND other.ed_hr_chat_participant_deleted = 0
      WHERE mine.ed_hr_chat_participant_user_id = ?
        AND mine.ed_hr_chat_participant_deleted = 0
      GROUP BY other.ed_hr_chat_participant_user_id`,
    [ctx.instituteCode, ctx.userId, ctx.userId]
  );
  return new Map(rows.map((row) => [Number(row.userId), Number(row.count)]));
}

async function sameDepartmentIds(ctx) {
  if (!ctx.departmentId) return [];
  const [rows] = await DATABASE.query(
    `SELECT ui.ed_user_institute_userCode AS userId
       FROM eduall_user_institutes ui
       JOIN eduall_employees e
         ON e.ed_employee_id = ui.ed_user_institute_employeeCode
        AND BINARY e.ed_employee_institute_code = BINARY ui.ed_user_institute_code
        AND e.ed_employee_deleted = 0
      WHERE BINARY ui.ed_user_institute_code = BINARY ?
        AND ui.ed_user_institute_deleted = 0
        AND e.ed_employee_department = ?
        AND ui.ed_user_institute_userCode <> ?`,
    [ctx.instituteCode, ctx.departmentId, ctx.userId]
  );
  return rows.map((row) => Number(row.userId));
}

async function recentTenantIds(ctx, excluded, limit) {
  const excludedIds = [...excluded].map(Number).filter(Boolean);
  excludedIds.push(Number(ctx.userId));
  const [rows] = await DATABASE.query(
    `SELECT DISTINCT ui.ed_user_institute_userCode AS userId
       FROM eduall_user_institutes ui
       JOIN eduall_user_accounts ua
         ON ua.ed_user_account_id = ui.ed_user_institute_userCode
        AND ua.ed_user_account_deleted = 0
      WHERE BINARY ui.ed_user_institute_code = BINARY ?
        AND ui.ed_user_institute_deleted = 0
        AND ui.ed_user_institute_userCode NOT IN (${excludedIds.map(() => "?").join(",")})
      ORDER BY ua.ed_userregisterdate DESC
      LIMIT ?`,
    [ctx.instituteCode, ...excludedIds, Math.max(1, Math.min(30, limit))]
  );
  return rows.map((row) => Number(row.userId));
}

async function gorsePeopleScores(ctx, limit) {
  try {
    const entries = await gorseClient.userNeighbors(
      gorseUserId(ctx.instituteCode, ctx.userId),
      { limit: Math.min(100, limit * 3), offset: 0 }
    );
    return new Map(entries.map((entry) => {
      const parsed = parseGorseId(entry.id, "u");
      return parsed && parsed.instituteCode === ctx.instituteCode
        ? [parsed.id, entry.score]
        : null;
    }).filter(Boolean));
  } catch {
    return new Map();
  }
}

async function suggestedPeople(ctx, query = {}) {
  const { limit } = pageOptions(query);
  const [followed, commonFollows, sharedGroups, sameDepartment, gorseScores, preferences] = await Promise.all([
    followedUserIds(ctx),
    commonFollowScores(ctx),
    sharedGroupScores(ctx),
    sameDepartmentIds(ctx),
    gorsePeopleScores(ctx, limit),
    userPreferences(ctx),
  ]);
  const ids = new Set([
    ...commonFollows.keys(),
    ...sharedGroups.keys(),
    ...sameDepartment,
    ...gorseScores.keys(),
  ]);
  ids.delete(Number(ctx.userId));
  [...followed].forEach((id) => ids.delete(id));
  const recent = await recentTenantIds(ctx, new Set([...followed, ...ids]), Math.max(limit, 10));
  recent.forEach((id) => ids.add(id));
  const profiles = await profileMap(ctx, [...ids]);
  const people = [...ids]
    .filter((id) => profiles.has(id))
    .map((id) => {
      const profile = profiles.get(id);
      const commonFriends = commonFollows.get(id) || 0;
      const groups = sharedGroups.get(id) || 0;
      const sameDept = sameDepartment.includes(id) ? 1 : 0;
      const sharedInterests = preferences.interests.filter((interest) => (
        `${profile.role} ${profile.department}`.toLowerCase().includes(interest.toLowerCase())
      ));
      const sharedInterestScore = Math.min(3, sharedInterests.length);
      const gorseScore = Math.max(0, Number(gorseScores.get(id) || 0));
      const isRecentFallback = recent.includes(id)
        && !commonFriends
        && !groups
        && !sameDept
        && !gorseScore;
      const score = commonFriends * 8 + groups * 5 + sameDept * 2
        + sharedInterestScore * 4 + Math.min(20, gorseScore)
        + (isRecentFallback ? 1 : 0);
      const reason = commonFriends
        ? `${commonFriends} contacto(s) em comum`
        : groups
          ? `${groups} grupo(s) em comum`
          : sameDept
            ? "Mesmo departamento"
            : sharedInterests.length
              ? `Interesses em comum: ${sharedInterests.slice(0, 2).join(", ")}`
            : isRecentFallback
              ? "Colega da instituição"
              : "Sugestão personalizada";
      return {
        ...profile,
        following: false,
        commonFriends,
        sharedGroups: groups,
        sameDepartment: Boolean(sameDept),
        sharedInterests,
        score: Math.round(score * 100) / 100,
        reason,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return {
    data: people,
    meta: {
      limit,
      total: people.length,
      gorseAvailable: gorseScores.size > 0,
    },
  };
}

async function assertPostVisible(ctx, postId) {
  const feed = await hr.listFeed(ctx, { page: 1, limit: 1000, sort: "newest" });
  const post = (feed?.data || []).find((item) => Number(item.id) === Number(postId));
  if (!post) {
    const error = new Error("Publicação não encontrada.");
    error.status = 404;
    error.code = "RECOMMENDATION_POST_NOT_FOUND";
    throw error;
  }
  return post;
}

async function recordFeedback(ctx, type, postId, options = {}) {
  const cleanType = String(type || "").toLowerCase();
  if (!FEEDBACK_TYPES.has(cleanType)) {
    const error = new Error("Tipo de feedback inválido.");
    error.status = 422;
    error.code = "RECOMMENDATION_FEEDBACK_INVALID";
    throw error;
  }
  const post = await assertPostVisible(ctx, postId);
  const parsedValue = Number(options.value ?? 1);
  const value = Number.isFinite(parsedValue)
    ? Math.max(0, Math.min(86_400, parsedValue))
    : 1;
  if (cleanType === "mute_author") {
    const authorId = Number(options.authorId || post.userId || post.employeeId);
    if (authorId) {
      await DATABASE.query(
        `INSERT INTO eduall_hr_recommendation_muted_authors (
           ed_hr_rec_muted_institute_code,
           ed_hr_rec_muted_user_id,
           ed_hr_rec_muted_author_id
         ) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE ed_hr_rec_muted_created_at = NOW()`,
        [ctx.instituteCode, ctx.userId, authorId]
      );
    }
  }
  await DATABASE.query(
    `INSERT INTO eduall_hr_recommendation_feedback (
       ed_hr_rec_feedback_institute_code,
       ed_hr_rec_feedback_user_id,
       ed_hr_rec_feedback_post_uid,
       ed_hr_rec_feedback_type,
       ed_hr_rec_feedback_value,
       ed_hr_rec_feedback_deleted
     ) VALUES (?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE
       ed_hr_rec_feedback_value = VALUES(ed_hr_rec_feedback_value),
       ed_hr_rec_feedback_deleted = 0,
       ed_hr_rec_feedback_updated_at = NOW()`,
    [ctx.instituteCode, ctx.userId, Number(postId), cleanType, value]
  );
  scheduleFeedback(ctx, cleanType, postId, {
    value,
    comment: options.comment,
    timestamp: options.timestamp,
  });
  rememberPositive(ctx, cleanType, postId).catch(() => {});
  writeAnalytics([{
    instituteCode: ctx.instituteCode,
    userId: ctx.userId,
    postId: Number(postId),
    type: cleanType,
    value,
    sessionId: options.sessionId,
    experiment: options.experiment,
    metadata: {
      authorId: options.authorId || post.userId || post.employeeId || null,
      completion: options.completion,
      duration: options.duration,
    },
  }]).catch(() => {});
  return {
    type: cleanType,
    postId: Number(postId),
    recorded: true,
  };
}

async function getRecommendationPreferences(ctx) {
  const preferences = await userPreferences(ctx);
  return {
    ...preferences,
    coldStart: preferences.interests.length === 0,
    suggestions: [
      "Tecnologia",
      "Educação",
      "Recursos Humanos",
      "Gestão",
      "Vendas",
      "Saúde e bem-estar",
      "Formação",
      "Inovação",
      "Sustentabilidade",
      "Cultura",
    ],
    department: ctx.departmentName || ctx.department || "",
  };
}

async function saveRecommendationPreferences(ctx, input = {}) {
  const interests = [...new Set((Array.isArray(input.interests) ? input.interests : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))]
    .slice(0, 20);
  await DATABASE.query(
    `INSERT INTO eduall_hr_recommendation_preferences (
       ed_hr_rec_pref_institute_code,
       ed_hr_rec_pref_user_id,
       ed_hr_rec_pref_interests
     ) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       ed_hr_rec_pref_interests = VALUES(ed_hr_rec_pref_interests),
       ed_hr_rec_pref_updated_at = NOW()`,
    [ctx.instituteCode, ctx.userId, JSON.stringify(interests)]
  );
  scheduleUserSync(ctx, ctx.userId, { force: true });
  return { interests, coldStart: false };
}

async function recordSessionMetric(ctx, input = {}) {
  const duration = Math.max(0, Math.min(86_400, Number(input.durationSeconds) || 0));
  if (duration <= 0) return { recorded: false };
  await writeAnalytics([{
    instituteCode: ctx.instituteCode,
    userId: ctx.userId,
    type: "session_time",
    value: duration,
    sessionId: input.sessionId,
    experiment: input.experiment,
    metadata: {
      interactions: Number(input.interactions) || 0,
      feedTab: String(input.feedTab || "").slice(0, 40),
    },
  }]);
  return { recorded: true, durationSeconds: duration };
}

async function assertTenantUser(ctx, userId) {
  const target = Number(userId);
  if (!target || target === Number(ctx.userId)) {
    const error = new Error("Utilizador inválido para seguir.");
    error.status = 422;
    error.code = "RECOMMENDATION_FOLLOW_INVALID";
    throw error;
  }
  const [rows] = await DATABASE.query(
    `SELECT ua.ed_user_account_id AS id
       FROM eduall_user_accounts ua
       LEFT JOIN eduall_user_institutes ui
         ON ui.ed_user_institute_userCode = ua.ed_user_account_id
        AND BINARY ui.ed_user_institute_code = BINARY ?
        AND ui.ed_user_institute_deleted = 0
      WHERE ua.ed_user_account_id = ?
        AND ua.ed_user_account_deleted = 0
        AND (
          ui.ed_user_institute_userCode IS NOT NULL
          OR BINARY ua.ed_user_account_institute_code = BINARY ?
        )
      LIMIT 1`,
    [ctx.instituteCode, target, ctx.instituteCode]
  );
  if (!rows.length) {
    const error = new Error("Utilizador não pertence a esta instituição.");
    error.status = 404;
    error.code = "RECOMMENDATION_USER_NOT_FOUND";
    throw error;
  }
}

async function followUser(ctx, userId) {
  await assertTenantUser(ctx, userId);
  const connection = await DATABASE.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO eduall_hr_user_follows (
         ed_hr_user_follow_institute_code,
         ed_hr_user_follow_follower_id,
         ed_hr_user_follow_followed_id,
         ed_hr_user_follow_deleted
       ) VALUES (?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE
         ed_hr_user_follow_deleted = 0`,
      [ctx.instituteCode, ctx.userId, Number(userId)]
    );
    await recordDomainEvent(connection, ctx.instituteCode, "user.followed", {
      actorId: ctx.userId,
      actorName: ctx.userName,
      actorAvatar: ctx.userPicture,
      followedId: Number(userId),
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  scheduleFollowSync(ctx, Number(userId));
  return { userId: Number(userId), following: true };
}

async function unfollowUser(ctx, userId) {
  await DATABASE.query(
    `UPDATE eduall_hr_user_follows
        SET ed_hr_user_follow_deleted = 1
      WHERE BINARY ed_hr_user_follow_institute_code = BINARY ?
        AND ed_hr_user_follow_follower_id = ?
        AND ed_hr_user_follow_followed_id = ?`,
    [ctx.instituteCode, ctx.userId, Number(userId)]
  );
  scheduleFollowSync(ctx, Number(userId));
  return { userId: Number(userId), following: false };
}

async function recommendationStatus(ctx) {
  const userFollowing = await followedUserIds(ctx);
  let online = false;
  let error = "";
  try {
    await gorseClient.health();
    online = true;
  } catch (healthError) {
    error = healthError.code || "GORSE_UNAVAILABLE";
  }
  return {
    enabled: gorseClient.enabled,
    online,
    error: error || undefined,
    following: userFollowing.size,
    userId: gorseUserId(ctx.instituteCode, ctx.userId),
  };
}

module.exports = {
  FEEDBACK_TYPES,
  followUser,
  getRecommendationPreferences,
  recommendedFeed,
  recordFeedback,
  recordSessionMetric,
  recommendationStatus,
  saveRecommendationPreferences,
  suggestedPeople,
  unfollowUser,
};
