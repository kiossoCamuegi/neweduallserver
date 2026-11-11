-- Reações persistentes aos comentários e respostas do feed do RH.
CREATE TABLE IF NOT EXISTS eduall_hr_comment_reactions (
  ed_hr_comment_reaction_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_comment_reaction_institute_code VARCHAR(100) NOT NULL,
  ed_hr_comment_reaction_comment_uid BIGINT NOT NULL,
  ed_hr_comment_reaction_user_id INT NOT NULL,
  ed_hr_comment_reaction_type VARCHAR(30) NOT NULL DEFAULT 'like',
  ed_hr_comment_reaction_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_comment_reaction_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_comment_reaction_id),
  UNIQUE KEY uq_hr_comment_reaction_user (
    ed_hr_comment_reaction_institute_code,
    ed_hr_comment_reaction_comment_uid,
    ed_hr_comment_reaction_user_id,
    ed_hr_comment_reaction_deleted
  ),
  KEY idx_hr_comment_reaction_comment (
    ed_hr_comment_reaction_institute_code,
    ed_hr_comment_reaction_comment_uid,
    ed_hr_comment_reaction_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
