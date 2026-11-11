"use strict";

require("../config/env");
const { DATABASE, closeDatabase } = require("../config/Database");
const { recordDomainEvent } = require("./domainEvents");
const recommendationSync = require("../services/recommendation/sync");
const realtime = require("../realtime/realtime");

async function publishDuePosts(limit = 25) {
  const connection = await DATABASE.getConnection();
  const due = [];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT p.ed_hr_post_uid AS id,
              p.ed_post_institute_code AS instituteCode,
              p.ed_post_user AS authorId
         FROM eduall_posts p
        WHERE p.ed_post_deleted = 0
          AND p.ed_post_moderation_status = 'approved'
          AND p.ed_post_schedule_notified = 0
          AND p.ed_post_publish_at IS NOT NULL
          AND p.ed_post_publish_at <= NOW()
        ORDER BY p.ed_post_publish_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED`,
      [Math.max(1, Math.min(100, Number(limit) || 25))]
    );
    for (const row of rows) {
      await connection.query(
        `UPDATE eduall_posts
            SET ed_post_schedule_notified = 1
          WHERE ed_hr_post_uid = ?`,
        [row.id]
      );
      await recordDomainEvent(connection, row.instituteCode, "post.approved", {
        actorId: null,
        actorName: "Publicação agendada",
        actorAvatar: "",
        authorId: Number(row.authorId),
        postId: Number(row.id),
      });
      due.push(row);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  for (const row of due) {
    realtime.emitDataChanged({ instituteCode: row.instituteCode }, "hr", {
      operation: "SCHEDULED_POST_PUBLISHED",
      postIds: [Number(row.id)],
    });
    await recommendationSync
      .syncPostNow({ instituteCode: row.instituteCode }, row.id)
      .catch((error) => {
        console.error(`[moderation:scheduler] Gorse post ${row.id}: ${error.message}`);
      });
  }
  return due.length;
}

function startScheduledPublisher(intervalMs = 30_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const total = await publishDuePosts();
      if (total) console.log(`[moderation:scheduler] publicados ${total} posts agendados`);
    } catch (error) {
      console.error(`[moderation:scheduler] ${error.message}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(
    tick,
    Math.max(5_000, Number(intervalMs) || 30_000)
  );
  timer.unref?.();
  setTimeout(tick, 2500).unref?.();
  return timer;
}

module.exports = { publishDuePosts, startScheduledPublisher };

if (require.main === module) {
  startScheduledPublisher(process.env.MODERATION_SCHEDULER_INTERVAL_MS);
  const shutdown = async () => {
    await closeDatabase().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
