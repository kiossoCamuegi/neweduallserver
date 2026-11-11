-- Estado persistente dos módulos RH que mantêm UI local.
-- Os dados ficam isolados por instituição e recurso, com uma única versão por chave.

CREATE TABLE IF NOT EXISTS eduall_hr_module_state (
  ed_hr_module_state_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_module_state_institute_code VARCHAR(100) NOT NULL,
  ed_hr_module_state_module VARCHAR(40) NOT NULL,
  ed_hr_module_state_key VARCHAR(80) NOT NULL,
  ed_hr_module_state_data LONGTEXT NOT NULL,
  ed_hr_module_state_created_by INT NULL,
  ed_hr_module_state_updated_by INT NULL,
  ed_hr_module_state_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_module_state_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_module_state_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_module_state_id),
  UNIQUE KEY uq_hr_module_state (
    ed_hr_module_state_institute_code,
    ed_hr_module_state_module,
    ed_hr_module_state_key
  ),
  KEY idx_hr_module_state_lookup (
    ed_hr_module_state_institute_code,
    ed_hr_module_state_module,
    ed_hr_module_state_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
