-- Moderação de conteúdo, observadores de posts e notificações tipadas.
-- Migração aditiva: conteúdo legado continua visível e os novos posts começam pendentes no serviço.

ALTER TABLE eduall_posts
  ADD COLUMN IF NOT EXISTS ed_post_moderation_status VARCHAR(20) NOT NULL DEFAULT 'approved'
    AFTER ed_post_deleted,
  ADD COLUMN IF NOT EXISTS ed_post_moderation_reason VARCHAR(1000) NULL
    AFTER ed_post_moderation_status,
  ADD COLUMN IF NOT EXISTS ed_post_moderation_review_requested_at DATETIME NULL
    AFTER ed_post_moderation_reason;

ALTER TABLE eduall_post_comments
  ADD COLUMN IF NOT EXISTS ed_post_comment_moderation_status VARCHAR(20) NOT NULL DEFAULT 'approved'
    AFTER ed_post_comment_deleted,
  ADD COLUMN IF NOT EXISTS ed_post_comment_moderation_reason VARCHAR(1000) NULL
    AFTER ed_post_comment_moderation_status,
  ADD COLUMN IF NOT EXISTS ed_post_comment_moderation_review_requested_at DATETIME NULL
    AFTER ed_post_comment_moderation_reason;

CREATE INDEX IF NOT EXISTS idx_hr_post_moderation
  ON eduall_posts (
    ed_post_institute_code(100),
    ed_post_deleted,
    ed_post_moderation_status,
    ed_post_registerdate
  );

CREATE INDEX IF NOT EXISTS idx_hr_comment_moderation
  ON eduall_post_comments (
    ed_post_comment_institute_code(100),
    ed_post_comment_deleted,
    ed_post_comment_moderation_status,
    ed_post_comment_registerDate
  );

CREATE TABLE IF NOT EXISTS moderation_results (
  ed_moderation_result_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_moderation_result_institute_code VARCHAR(100) NOT NULL,
  ed_moderation_result_content_type VARCHAR(20) NOT NULL,
  ed_moderation_result_content_id BIGINT NOT NULL,
  ed_moderation_result_analyzer VARCHAR(50) NOT NULL,
  ed_moderation_result_model VARCHAR(180) NULL,
  ed_moderation_result_scores JSON NOT NULL,
  ed_moderation_result_decision VARCHAR(20) NOT NULL,
  ed_moderation_result_reason VARCHAR(1000) NULL,
  ed_moderation_result_attempt INT NOT NULL DEFAULT 1,
  ed_moderation_result_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_moderation_result_id),
  KEY idx_moderation_result_content (
    ed_moderation_result_institute_code,
    ed_moderation_result_content_type,
    ed_moderation_result_content_id,
    ed_moderation_result_created_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS moderation_reviews (
  ed_moderation_review_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_moderation_review_institute_code VARCHAR(100) NOT NULL,
  ed_moderation_review_content_type VARCHAR(20) NOT NULL,
  ed_moderation_review_content_id BIGINT NOT NULL,
  ed_moderation_review_reviewer_id INT NOT NULL,
  ed_moderation_review_decision VARCHAR(20) NOT NULL,
  ed_moderation_review_notes VARCHAR(2000) NULL,
  ed_moderation_review_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_moderation_review_id),
  KEY idx_moderation_review_content (
    ed_moderation_review_institute_code,
    ed_moderation_review_content_type,
    ed_moderation_review_content_id,
    ed_moderation_review_created_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_reports (
  ed_content_report_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_content_report_institute_code VARCHAR(100) NOT NULL,
  ed_content_report_content_type VARCHAR(20) NOT NULL,
  ed_content_report_content_id BIGINT NOT NULL,
  ed_content_report_reporter_id INT NOT NULL,
  ed_content_report_reason VARCHAR(80) NOT NULL,
  ed_content_report_details VARCHAR(2000) NULL,
  ed_content_report_status VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  ed_content_report_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_content_report_id),
  UNIQUE KEY uq_content_report_user (
    ed_content_report_institute_code,
    ed_content_report_content_type,
    ed_content_report_content_id,
    ed_content_report_reporter_id
  ),
  KEY idx_content_reports_queue (
    ed_content_report_institute_code,
    ed_content_report_status,
    ed_content_report_created_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS moderation_terms (
  ed_moderation_term_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_moderation_term_institute_code VARCHAR(100) NOT NULL,
  ed_moderation_term_locale VARCHAR(16) NOT NULL DEFAULT 'pt',
  ed_moderation_term_value VARCHAR(255) NOT NULL,
  ed_moderation_term_normalized VARCHAR(255) NOT NULL,
  ed_moderation_term_severity VARCHAR(20) NOT NULL DEFAULT 'high',
  ed_moderation_term_active TINYINT(1) NOT NULL DEFAULT 1,
  ed_moderation_term_created_by INT NULL,
  ed_moderation_term_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_moderation_term_id),
  UNIQUE KEY uq_moderation_term (
    ed_moderation_term_institute_code,
    ed_moderation_term_locale,
    ed_moderation_term_normalized
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS post_watchers (
  ed_post_watcher_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_post_watcher_institute_code VARCHAR(100) NOT NULL,
  ed_post_watcher_post_uid BIGINT NOT NULL,
  ed_post_watcher_user_id INT NOT NULL,
  ed_post_watcher_source VARCHAR(20) NOT NULL,
  ed_post_watcher_muted TINYINT(1) NOT NULL DEFAULT 0,
  ed_post_watcher_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_post_watcher_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_post_watcher_id),
  UNIQUE KEY uq_post_watcher (
    ed_post_watcher_institute_code,
    ed_post_watcher_post_uid,
    ed_post_watcher_user_id
  ),
  KEY idx_post_watcher_user (
    ed_post_watcher_institute_code,
    ed_post_watcher_user_id,
    ed_post_watcher_muted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS domain_event_outbox (
  ed_domain_event_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_domain_event_institute_code VARCHAR(100) NOT NULL,
  ed_domain_event_name VARCHAR(80) NOT NULL,
  ed_domain_event_payload JSON NOT NULL,
  ed_domain_event_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  ed_domain_event_attempts INT NOT NULL DEFAULT 0,
  ed_domain_event_available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_domain_event_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_domain_event_processed_at DATETIME NULL,
  PRIMARY KEY (ed_domain_event_id),
  KEY idx_domain_event_outbox (
    ed_domain_event_status,
    ed_domain_event_available_at,
    ed_domain_event_id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  institute_code VARCHAR(100) NOT NULL,
  audit_id BIGINT UNSIGNED NULL,
  actor_user_id BIGINT UNSIGNED NULL,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(60) NOT NULL DEFAULT 'legacy',
  post_id BIGINT NULL,
  comment_id BIGINT NULL,
  title VARCHAR(200) NULL,
  body_html MEDIUMTEXT NULL,
  body_text TEXT NULL,
  data_json JSON NULL,
  group_key VARCHAR(255) NULL,
  dedupe_key VARCHAR(255) NULL,
  seen TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME NULL,
  deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_notification_user_unread (institute_code, recipient_user_id, seen, created_at),
  UNIQUE KEY uq_notification_dedupe (institute_code, recipient_user_id, dedupe_key),
  KEY idx_notification_post (institute_code, post_id, comment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE eduall_notifications
  ADD COLUMN IF NOT EXISTS type VARCHAR(60) NOT NULL DEFAULT 'legacy' AFTER recipient_user_id,
  ADD COLUMN IF NOT EXISTS post_id BIGINT NULL AFTER type,
  ADD COLUMN IF NOT EXISTS comment_id BIGINT NULL AFTER post_id,
  ADD COLUMN IF NOT EXISTS data_json JSON NULL AFTER body_text,
  ADD COLUMN IF NOT EXISTS group_key VARCHAR(255) NULL AFTER data_json,
  ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(255) NULL AFTER group_key,
  ADD COLUMN IF NOT EXISTS read_at DATETIME NULL AFTER seen,
  ADD COLUMN IF NOT EXISTS deleted TINYINT(1) NOT NULL DEFAULT 0 AFTER read_at,
  ADD COLUMN IF NOT EXISTS updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

CREATE INDEX IF NOT EXISTS idx_notification_user_unread
  ON eduall_notifications (institute_code, recipient_user_id, seen, created_at);
