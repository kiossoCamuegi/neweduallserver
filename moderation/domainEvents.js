"use strict";

const { DATABASE } = require("../config/Database");
const notifications = require("../notifications/service");

async function recordDomainEvent(connection, instituteCode, name, payload) {
  await connection.query(
    `INSERT INTO domain_event_outbox (
       ed_domain_event_institute_code, ed_domain_event_name, ed_domain_event_payload
     ) VALUES (?, ?, ?)`,
    [instituteCode, name, JSON.stringify(payload || {})]
  );
}

async function dispatchOutbox(limit = 25) {
  const [rows] = await DATABASE.query(
    `SELECT ed_domain_event_id AS id,
            ed_domain_event_institute_code AS instituteCode,
            ed_domain_event_name AS name,
            ed_domain_event_payload AS payload,
            ed_domain_event_attempts AS attempts
       FROM domain_event_outbox
      WHERE ed_domain_event_status = 'pending'
        AND ed_domain_event_available_at <= NOW()
      ORDER BY ed_domain_event_id ASC
      LIMIT ?`,
    [Math.max(1, Math.min(100, Number(limit) || 25))]
  );
  for (const row of rows) {
    try {
      await notifications.handleDomainEvent({
        id: Number(row.id),
        instituteCode: row.instituteCode,
        name: row.name,
        payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload,
      });
      await DATABASE.query(
        `UPDATE domain_event_outbox
            SET ed_domain_event_status = 'processed',
                ed_domain_event_processed_at = NOW()
          WHERE ed_domain_event_id = ?`,
        [row.id]
      );
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      await DATABASE.query(
        `UPDATE domain_event_outbox
            SET ed_domain_event_attempts = ?,
                ed_domain_event_status = ?,
                ed_domain_event_available_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
          WHERE ed_domain_event_id = ?`,
        [
          attempts,
          attempts >= 8 ? "failed" : "pending",
          Math.min(900, 5 * 2 ** attempts),
          row.id,
        ]
      );
      console.error(`[domain-events] ${row.name}: ${error.message}`);
    }
  }
  return rows.length;
}

let timer = null;
function startOutboxDispatcher() {
  if (timer) return timer;
  const tick = () => dispatchOutbox().catch((error) => {
    console.error(`[domain-events] dispatcher: ${error.message}`);
  });
  timer = setInterval(tick, Math.max(1000, Number(process.env.DOMAIN_EVENTS_INTERVAL_MS) || 3000));
  timer.unref?.();
  setTimeout(tick, 1000).unref?.();
  return timer;
}

module.exports = {
  dispatchOutbox,
  recordDomainEvent,
  startOutboxDispatcher,
};
