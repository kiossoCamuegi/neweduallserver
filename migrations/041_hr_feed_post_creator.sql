-- Metadados completos do compositor de publicações do feed RH.
-- Migração aditiva e idempotente.

ALTER TABLE eduall_posts
  ADD COLUMN IF NOT EXISTS ed_post_background VARCHAR(500) NULL
    AFTER ed_post_attachments,
  ADD COLUMN IF NOT EXISTS ed_post_feeling VARCHAR(180) NULL
    AFTER ed_post_background,
  ADD COLUMN IF NOT EXISTS ed_post_location VARCHAR(255) NULL
    AFTER ed_post_feeling,
  ADD COLUMN IF NOT EXISTS ed_post_publish_at DATETIME NULL
    AFTER ed_post_registerdate,
  ADD COLUMN IF NOT EXISTS ed_post_schedule_notified TINYINT(1) NOT NULL DEFAULT 1
    AFTER ed_post_publish_at;

CREATE INDEX IF NOT EXISTS idx_hr_post_publish_at
  ON eduall_posts (
    ed_post_institute_code(100),
    ed_post_deleted,
    ed_post_publish_at,
    ed_post_schedule_notified
  );
