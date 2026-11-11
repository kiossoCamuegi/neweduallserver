-- Documentos persistidos das várias tabs do módulo de ponto.

CREATE TABLE IF NOT EXISTS eduall_hr_timeclock_documents (
  ed_hr_timeclock_document_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_timeclock_document_institute_code VARCHAR(100) NOT NULL,
  ed_hr_timeclock_document_resource VARCHAR(40) NOT NULL,
  ed_hr_timeclock_document_data JSON NOT NULL,
  ed_hr_timeclock_document_created_by INT NULL,
  ed_hr_timeclock_document_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_timeclock_document_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_timeclock_document_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_timeclock_document_id),
  KEY idx_hr_timeclock_resource (
    ed_hr_timeclock_document_institute_code,
    ed_hr_timeclock_document_resource,
    ed_hr_timeclock_document_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
