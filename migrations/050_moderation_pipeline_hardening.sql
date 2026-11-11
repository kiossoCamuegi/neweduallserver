-- Estado por media, metadados forenses e escalamento legal.
-- Migração aditiva: não altera o estado de moderação de conteúdo legado.

ALTER TABLE moderation_results
  ADD COLUMN IF NOT EXISTS ed_moderation_result_media_index INT NULL
    AFTER ed_moderation_result_content_id,
  ADD COLUMN IF NOT EXISTS ed_moderation_result_frame_timestamp DECIMAL(12,3) NULL
    AFTER ed_moderation_result_media_index,
  ADD COLUMN IF NOT EXISTS ed_moderation_result_metadata JSON NULL
    AFTER ed_moderation_result_scores;

ALTER TABLE moderation_reviews
  ADD COLUMN IF NOT EXISTS ed_moderation_review_escalated TINYINT(1) NOT NULL DEFAULT 0
    AFTER ed_moderation_review_decision;

ALTER TABLE content_reports
  ADD COLUMN IF NOT EXISTS ed_content_report_updated_at DATETIME NOT NULL
    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    AFTER ed_content_report_created_at;

ALTER TABLE eduall_hr_stories
  ADD COLUMN IF NOT EXISTS ed_hr_story_moderation_status VARCHAR(20) NOT NULL
    DEFAULT 'approved' AFTER ed_hr_story_deleted,
  ADD COLUMN IF NOT EXISTS ed_hr_story_moderation_reason VARCHAR(1000) NULL
    AFTER ed_hr_story_moderation_status,
  ADD COLUMN IF NOT EXISTS ed_hr_story_moderation_review_requested_at DATETIME NULL
    AFTER ed_hr_story_moderation_reason;

ALTER TABLE eduall_hr_story_media
  ADD COLUMN IF NOT EXISTS ed_hr_story_media_moderation_status VARCHAR(20) NOT NULL
    DEFAULT 'approved' AFTER ed_hr_story_media_size;

ALTER TABLE eduall_hr_chat_conversations
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_pending_picture VARCHAR(500) NULL
    AFTER ed_hr_chat_conversation_picture,
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_picture_moderation_status VARCHAR(20)
    NOT NULL DEFAULT 'approved'
    AFTER ed_hr_chat_conversation_pending_picture,
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_picture_moderation_reason VARCHAR(1000) NULL
    AFTER ed_hr_chat_conversation_picture_moderation_status,
  ADD COLUMN IF NOT EXISTS ed_hr_chat_conversation_picture_review_requested_at DATETIME NULL
    AFTER ed_hr_chat_conversation_picture_moderation_reason;

CREATE INDEX IF NOT EXISTS idx_hr_story_moderation
  ON eduall_hr_stories (
    ed_hr_story_institute_code,
    ed_hr_story_deleted,
    ed_hr_story_moderation_status,
    ed_hr_story_created_at
  );

CREATE TABLE IF NOT EXISTS moderation_media (
  ed_moderation_media_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_moderation_media_institute_code VARCHAR(100) NOT NULL,
  ed_moderation_media_content_type VARCHAR(20) NOT NULL,
  ed_moderation_media_content_id BIGINT NOT NULL,
  ed_moderation_media_attachment_index INT NOT NULL DEFAULT 0,
  ed_moderation_media_storage_key VARCHAR(512) NOT NULL,
  ed_moderation_media_original_key VARCHAR(512) NOT NULL,
  ed_moderation_media_mime VARCHAR(160) NULL,
  ed_moderation_media_sha256 CHAR(64) NULL,
  ed_moderation_media_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ed_moderation_media_reason VARCHAR(1000) NULL,
  ed_moderation_media_worst_timestamp DECIMAL(12,3) NULL,
  ed_moderation_media_preview_key VARCHAR(512) NULL,
  ed_moderation_media_quarantine_key VARCHAR(512) NULL,
  ed_moderation_media_quarantine_until DATETIME NULL,
  ed_moderation_media_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_moderation_media_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_moderation_media_id),
  UNIQUE KEY uq_moderation_media_content (
    ed_moderation_media_institute_code,
    ed_moderation_media_content_type,
    ed_moderation_media_content_id,
    ed_moderation_media_attachment_index
  ),
  KEY idx_moderation_media_status (
    ed_moderation_media_institute_code,
    ed_moderation_media_status,
    ed_moderation_media_created_at
  ),
  KEY idx_moderation_media_quarantine (
    ed_moderation_media_status,
    ed_moderation_media_quarantine_until
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_moderation_result_media
  ON moderation_results (
    ed_moderation_result_content_type,
    ed_moderation_result_content_id,
    ed_moderation_result_media_index
  );

