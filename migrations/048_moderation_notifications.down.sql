-- Reversão estrutural do módulo de moderação introduzido na 048.
-- Cópia de segurança obrigatória: decisões, denúncias e outbox são removidos.

DROP TABLE IF EXISTS post_watchers;
DROP TABLE IF EXISTS domain_event_outbox;
DROP TABLE IF EXISTS content_reports;
DROP TABLE IF EXISTS moderation_reviews;
DROP TABLE IF EXISTS moderation_results;
DROP TABLE IF EXISTS moderation_terms;

DROP INDEX IF EXISTS idx_notification_user_unread ON eduall_notifications;
DROP INDEX IF EXISTS idx_notification_post ON eduall_notifications;
DROP INDEX IF EXISTS uq_notification_dedupe ON eduall_notifications;

ALTER TABLE eduall_notifications
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS deleted,
  DROP COLUMN IF EXISTS read_at,
  DROP COLUMN IF EXISTS dedupe_key,
  DROP COLUMN IF EXISTS group_key,
  DROP COLUMN IF EXISTS data_json,
  DROP COLUMN IF EXISTS comment_id,
  DROP COLUMN IF EXISTS post_id,
  DROP COLUMN IF EXISTS type;

DROP INDEX IF EXISTS idx_hr_comment_moderation ON eduall_post_comments;
DROP INDEX IF EXISTS idx_hr_post_moderation ON eduall_posts;

ALTER TABLE eduall_post_comments
  DROP COLUMN IF EXISTS ed_post_comment_moderation_review_requested_at,
  DROP COLUMN IF EXISTS ed_post_comment_moderation_reason,
  DROP COLUMN IF EXISTS ed_post_comment_moderation_status;

ALTER TABLE eduall_posts
  DROP COLUMN IF EXISTS ed_post_moderation_review_requested_at,
  DROP COLUMN IF EXISTS ed_post_moderation_reason,
  DROP COLUMN IF EXISTS ed_post_moderation_status;

