-- Índices para deduplicação e consulta de notificações já existentes.

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_dedupe
  ON eduall_notifications (institute_code, recipient_user_id, dedupe_key);

CREATE INDEX IF NOT EXISTS idx_notification_post
  ON eduall_notifications (institute_code, post_id, comment_id);
