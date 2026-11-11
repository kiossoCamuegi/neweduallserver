-- Reações persistentes e isoladas por instituição para o feed do RH.
-- Migração aditiva. A tabela legacy de reações não tem tenant e não é alterada.

CREATE TABLE IF NOT EXISTS eduall_hr_post_reactions (
  ed_hr_post_reaction_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_post_reaction_institute_code VARCHAR(100) NOT NULL,
  ed_hr_post_reaction_post_id INT NOT NULL,
  ed_hr_post_reaction_user_id INT NOT NULL,
  ed_hr_post_reaction_employee_id INT NULL,
  ed_hr_post_reaction_type VARCHAR(30) NOT NULL DEFAULT 'like',
  ed_hr_post_reaction_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_post_reaction_id),
  UNIQUE KEY uq_hr_post_reaction_user (
    ed_hr_post_reaction_institute_code,
    ed_hr_post_reaction_post_id,
    ed_hr_post_reaction_user_id
  ),
  KEY idx_hr_post_reaction_post (
    ed_hr_post_reaction_institute_code,
    ed_hr_post_reaction_post_id,
    ed_hr_post_reaction_type
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
