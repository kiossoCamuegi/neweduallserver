-- Stories persistentes do feed de RH.
-- Migração aditiva: não altera nem remove tabelas legacy.

CREATE TABLE IF NOT EXISTS eduall_hr_stories (
  ed_hr_story_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_story_institute_code VARCHAR(100) NOT NULL,
  ed_hr_story_user_id INT NOT NULL,
  ed_hr_story_employee_id INT NULL,
  ed_hr_story_slides JSON NOT NULL,
  ed_hr_story_music_url VARCHAR(2048) NULL,
  ed_hr_story_hidden_users JSON NULL,
  ed_hr_story_expires_at DATETIME NOT NULL,
  ed_hr_story_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_story_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_story_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_story_id),
  KEY idx_hr_story_tenant_feed (
    ed_hr_story_institute_code,
    ed_hr_story_deleted,
    ed_hr_story_expires_at,
    ed_hr_story_created_at
  ),
  KEY idx_hr_story_author (
    ed_hr_story_institute_code,
    ed_hr_story_user_id,
    ed_hr_story_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_story_media (
  ed_hr_story_media_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_story_media_institute_code VARCHAR(100) NOT NULL,
  ed_hr_story_media_story_id BIGINT NOT NULL,
  ed_hr_story_media_storage_key VARCHAR(180) NOT NULL,
  ed_hr_story_media_name VARCHAR(180) NOT NULL,
  ed_hr_story_media_mime VARCHAR(120) NOT NULL,
  ed_hr_story_media_kind VARCHAR(20) NOT NULL,
  ed_hr_story_media_size BIGINT NOT NULL DEFAULT 0,
  ed_hr_story_media_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_story_media_id),
  UNIQUE KEY uq_hr_story_media_key (ed_hr_story_media_storage_key),
  KEY idx_hr_story_media_story (
    ed_hr_story_media_institute_code,
    ed_hr_story_media_story_id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_story_views (
  ed_hr_story_view_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_story_view_institute_code VARCHAR(100) NOT NULL,
  ed_hr_story_view_story_id BIGINT NOT NULL,
  ed_hr_story_view_user_id INT NOT NULL,
  ed_hr_story_view_first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_story_view_last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_story_view_id),
  UNIQUE KEY uq_hr_story_view_user (
    ed_hr_story_view_institute_code,
    ed_hr_story_view_story_id,
    ed_hr_story_view_user_id
  ),
  KEY idx_hr_story_view_story (
    ed_hr_story_view_institute_code,
    ed_hr_story_view_story_id,
    ed_hr_story_view_last_seen_at
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
