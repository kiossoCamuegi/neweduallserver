-- Reverte apenas a migração 050. Os dados únicos das novas colunas são
-- perdidos; faça uma cópia de segurança antes de executar.

DROP INDEX IF EXISTS idx_moderation_result_media ON moderation_results;
DROP TABLE IF EXISTS moderation_media;

ALTER TABLE content_reports
  DROP COLUMN IF EXISTS ed_content_report_updated_at;

ALTER TABLE eduall_hr_chat_conversations
  DROP COLUMN IF EXISTS ed_hr_chat_conversation_picture_review_requested_at,
  DROP COLUMN IF EXISTS ed_hr_chat_conversation_picture_moderation_reason,
  DROP COLUMN IF EXISTS ed_hr_chat_conversation_picture_moderation_status,
  DROP COLUMN IF EXISTS ed_hr_chat_conversation_pending_picture;

ALTER TABLE eduall_hr_story_media
  DROP COLUMN IF EXISTS ed_hr_story_media_moderation_status;

DROP INDEX IF EXISTS idx_hr_story_moderation ON eduall_hr_stories;
ALTER TABLE eduall_hr_stories
  DROP COLUMN IF EXISTS ed_hr_story_moderation_review_requested_at,
  DROP COLUMN IF EXISTS ed_hr_story_moderation_reason,
  DROP COLUMN IF EXISTS ed_hr_story_moderation_status;

ALTER TABLE moderation_reviews
  DROP COLUMN IF EXISTS ed_moderation_review_escalated;

ALTER TABLE moderation_results
  DROP COLUMN IF EXISTS ed_moderation_result_metadata,
  DROP COLUMN IF EXISTS ed_moderation_result_frame_timestamp,
  DROP COLUMN IF EXISTS ed_moderation_result_media_index;

