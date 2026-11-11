-- Sinais avançados, silenciamento de autores, onboarding e analytics de feed.

CREATE TABLE IF NOT EXISTS eduall_hr_recommendation_muted_authors (
  ed_hr_rec_muted_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_rec_muted_institute_code VARCHAR(100) NOT NULL,
  ed_hr_rec_muted_user_id INT NOT NULL,
  ed_hr_rec_muted_author_id INT NOT NULL,
  ed_hr_rec_muted_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_rec_muted_id),
  UNIQUE KEY uq_hr_rec_muted_author (
    ed_hr_rec_muted_institute_code,
    ed_hr_rec_muted_user_id,
    ed_hr_rec_muted_author_id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_recommendation_preferences (
  ed_hr_rec_pref_institute_code VARCHAR(100) NOT NULL,
  ed_hr_rec_pref_user_id INT NOT NULL,
  ed_hr_rec_pref_interests JSON NOT NULL,
  ed_hr_rec_pref_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_rec_pref_institute_code, ed_hr_rec_pref_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_recommendation_analytics (
  ed_hr_rec_analytics_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_rec_analytics_institute_code VARCHAR(100) NOT NULL,
  ed_hr_rec_analytics_user_id INT NOT NULL,
  ed_hr_rec_analytics_post_uid BIGINT NULL,
  ed_hr_rec_analytics_event_type VARCHAR(40) NOT NULL,
  ed_hr_rec_analytics_value DECIMAL(14,4) NOT NULL DEFAULT 1,
  ed_hr_rec_analytics_session_id VARCHAR(100) NULL,
  ed_hr_rec_analytics_experiment VARCHAR(40) NULL,
  ed_hr_rec_analytics_metadata JSON NULL,
  ed_hr_rec_analytics_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_rec_analytics_id),
  KEY idx_hr_rec_analytics_user_event (
    ed_hr_rec_analytics_institute_code,
    ed_hr_rec_analytics_user_id,
    ed_hr_rec_analytics_event_type,
    ed_hr_rec_analytics_created_at
  ),
  KEY idx_hr_rec_analytics_post (
    ed_hr_rec_analytics_institute_code,
    ed_hr_rec_analytics_post_uid,
    ed_hr_rec_analytics_event_type
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
