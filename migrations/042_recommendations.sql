-- Estado local para recomendações, follows entre utilizadores e sinais de feedback.
-- Tabelas aditivas; o Gorse mantém as suas próprias tabelas numa base separada.

CREATE TABLE IF NOT EXISTS eduall_hr_user_follows (
  ed_hr_user_follow_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_user_follow_institute_code VARCHAR(100) NOT NULL,
  ed_hr_user_follow_follower_id INT NOT NULL,
  ed_hr_user_follow_followed_id INT NOT NULL,
  ed_hr_user_follow_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_user_follow_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_user_follow_id),
  UNIQUE KEY uq_hr_user_follow (
    ed_hr_user_follow_institute_code,
    ed_hr_user_follow_follower_id,
    ed_hr_user_follow_followed_id
  ),
  KEY idx_hr_user_follow_followed (
    ed_hr_user_follow_institute_code,
    ed_hr_user_follow_followed_id,
    ed_hr_user_follow_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_recommendation_feedback (
  ed_hr_rec_feedback_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_rec_feedback_institute_code VARCHAR(100) NOT NULL,
  ed_hr_rec_feedback_user_id INT NOT NULL,
  ed_hr_rec_feedback_post_uid BIGINT NOT NULL,
  ed_hr_rec_feedback_type VARCHAR(30) NOT NULL,
  ed_hr_rec_feedback_value DECIMAL(10,4) NOT NULL DEFAULT 1,
  ed_hr_rec_feedback_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_rec_feedback_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_rec_feedback_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_rec_feedback_id),
  UNIQUE KEY uq_hr_rec_feedback (
    ed_hr_rec_feedback_institute_code,
    ed_hr_rec_feedback_user_id,
    ed_hr_rec_feedback_post_uid,
    ed_hr_rec_feedback_type
  ),
  KEY idx_hr_rec_feedback_user_type (
    ed_hr_rec_feedback_institute_code,
    ed_hr_rec_feedback_user_id,
    ed_hr_rec_feedback_type,
    ed_hr_rec_feedback_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
