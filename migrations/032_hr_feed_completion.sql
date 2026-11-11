-- Completa o feed social do RH sem criar tabelas paralelas às já usadas.
-- Migração aditiva e idempotente.

ALTER TABLE eduall_post_comments
  ADD COLUMN IF NOT EXISTS ed_post_comment_parent_id INT NULL,
  ADD COLUMN IF NOT EXISTS ed_post_comment_updatedate DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_hr_post_feed_filters
  ON eduall_posts (
    ed_post_institute_code(100),
    ed_post_kind,
    ed_post_visibility,
    ed_post_deleted,
    ed_post_registerdate
  );

CREATE INDEX IF NOT EXISTS idx_hr_comment_parent
  ON eduall_post_comments (
    ed_post_comment_institute_code(100),
    ed_post_comment_postCode,
    ed_post_comment_parent_id,
    ed_post_comment_deleted
  );
