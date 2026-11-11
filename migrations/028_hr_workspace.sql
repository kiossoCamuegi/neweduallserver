-- Eduall RH: persistência real para o workspace de Recursos Humanos.
-- Migração aditiva e idempotente. Não remove nem renomeia estruturas legacy.
-- Rollback: remover apenas tabelas eduall_hr_* criadas nesta migração e as
-- colunas aditivas indicadas no fim do ficheiro, após backup e validação.

ALTER TABLE eduall_employees
  ADD COLUMN IF NOT EXISTS ed_employee_manager_id INT NULL,
  ADD COLUMN IF NOT EXISTS ed_employee_hire_date DATE NULL,
  ADD COLUMN IF NOT EXISTS ed_employee_contract_type VARCHAR(60) NULL,
  ADD COLUMN IF NOT EXISTS ed_employee_work_mode VARCHAR(30) NULL,
  ADD COLUMN IF NOT EXISTS ed_employee_location VARCHAR(180) NULL,
  ADD COLUMN IF NOT EXISTS ed_employee_notes TEXT NULL,
  ADD COLUMN IF NOT EXISTS ed_employee_vacation_balance DECIMAL(8,2) NOT NULL DEFAULT 22,
  ADD COLUMN IF NOT EXISTS ed_employee_updated_at DATETIME NULL;

ALTER TABLE eduall_department
  ADD COLUMN IF NOT EXISTS ed_department_institute_code VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS ed_department_updated_at DATETIME NULL;

ALTER TABLE eduall_job_titles
  ADD COLUMN IF NOT EXISTS ed_job_title_institute_code VARCHAR(100) NULL;

ALTER TABLE eduall_posts
  ADD COLUMN IF NOT EXISTS ed_post_institute_code VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS ed_post_author_employee INT NULL,
  ADD COLUMN IF NOT EXISTS ed_post_kind VARCHAR(30) NOT NULL DEFAULT 'community',
  ADD COLUMN IF NOT EXISTS ed_post_visibility VARCHAR(30) NOT NULL DEFAULT 'institute',
  ADD COLUMN IF NOT EXISTS ed_post_attachments LONGTEXT NULL;

ALTER TABLE eduall_post_comments
  ADD COLUMN IF NOT EXISTS ed_post_comment_institute_code VARCHAR(100) NULL;

ALTER TABLE eduall_chat_messages
  ADD COLUMN IF NOT EXISTS ed_chat_message_institute_code VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS ed_chat_message_deleted TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE eduall_calendar_events
  ADD COLUMN IF NOT EXISTS ed_calendar_event_employee_id INT NULL,
  ADD COLUMN IF NOT EXISTS ed_calendar_event_type VARCHAR(40) NOT NULL DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS ed_calendar_event_status VARCHAR(30) NOT NULL DEFAULT 'publicado';

ALTER TABLE eduall_task_and_projects
  ADD COLUMN IF NOT EXISTS ed_task_and_project_status VARCHAR(30) NOT NULL DEFAULT 'planeado',
  ADD COLUMN IF NOT EXISTS ed_task_and_project_priority VARCHAR(20) NOT NULL DEFAULT 'media',
  ADD COLUMN IF NOT EXISTS ed_task_and_project_visibility VARCHAR(30) NOT NULL DEFAULT 'equipa',
  ADD COLUMN IF NOT EXISTS ed_task_and_project_updated_at DATETIME NULL;

CREATE INDEX IF NOT EXISTS idx_hr_employee_manager
  ON eduall_employees (ed_employee_institute_code(100), ed_employee_manager_id, ed_employee_deleted);

CREATE INDEX IF NOT EXISTS idx_hr_department_institute
  ON eduall_department (ed_department_institute_code, ed_department_deleted);

CREATE INDEX IF NOT EXISTS idx_hr_post_tenant
  ON eduall_posts (ed_post_institute_code, ed_post_kind, ed_post_deleted, ed_post_registerdate);

CREATE INDEX IF NOT EXISTS idx_hr_chat_tenant
  ON eduall_chat_messages (ed_chat_message_institute_code, ed_chat_message_to, ed_chat_message_from);

CREATE INDEX IF NOT EXISTS idx_hr_calendar_tenant
  ON eduall_calendar_events (
    ed_calendar_event_institute_code(100),
    ed_calendar_event_start(32),
    ed_calendar_event_deleted
  );

CREATE INDEX IF NOT EXISTS idx_hr_project_tenant
  ON eduall_task_and_projects (
    ed_task_and_project_institute_code(100),
    ed_task_and_project_status,
    ed_task_and_project_deleted
  );

CREATE TABLE IF NOT EXISTS eduall_hr_vacation_requests (
  ed_hr_vacation_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_vacation_institute_code VARCHAR(100) NOT NULL,
  ed_hr_vacation_employee_id INT NOT NULL,
  ed_hr_vacation_requester_user_id INT NOT NULL,
  ed_hr_vacation_type VARCHAR(40) NOT NULL DEFAULT 'ferias',
  ed_hr_vacation_start_date DATE NOT NULL,
  ed_hr_vacation_end_date DATE NOT NULL,
  ed_hr_vacation_days DECIMAL(8,2) NOT NULL,
  ed_hr_vacation_status VARCHAR(30) NOT NULL DEFAULT 'pendente',
  ed_hr_vacation_reason TEXT NULL,
  ed_hr_vacation_decision_note TEXT NULL,
  ed_hr_vacation_decided_by INT NULL,
  ed_hr_vacation_decided_at DATETIME NULL,
  ed_hr_vacation_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_vacation_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_vacation_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_vacation_id),
  KEY idx_hr_vacation_tenant_employee (
    ed_hr_vacation_institute_code, ed_hr_vacation_employee_id, ed_hr_vacation_deleted
  ),
  KEY idx_hr_vacation_status (
    ed_hr_vacation_institute_code, ed_hr_vacation_status, ed_hr_vacation_start_date
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_goals (
  ed_hr_goal_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_goal_institute_code VARCHAR(100) NOT NULL,
  ed_hr_goal_employee_id INT NOT NULL,
  ed_hr_goal_title VARCHAR(255) NOT NULL,
  ed_hr_goal_description TEXT NULL,
  ed_hr_goal_period VARCHAR(60) NOT NULL,
  ed_hr_goal_progress DECIMAL(5,2) NOT NULL DEFAULT 0,
  ed_hr_goal_status VARCHAR(30) NOT NULL DEFAULT 'em_curso',
  ed_hr_goal_due_date DATE NULL,
  ed_hr_goal_created_by INT NULL,
  ed_hr_goal_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_goal_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_goal_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_goal_id),
  KEY idx_hr_goal_tenant_employee (
    ed_hr_goal_institute_code, ed_hr_goal_employee_id, ed_hr_goal_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_feedback (
  ed_hr_feedback_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_feedback_institute_code VARCHAR(100) NOT NULL,
  ed_hr_feedback_from_employee INT NOT NULL,
  ed_hr_feedback_to_employee INT NOT NULL,
  ed_hr_feedback_type VARCHAR(30) NOT NULL DEFAULT 'reconhecimento',
  ed_hr_feedback_visibility VARCHAR(30) NOT NULL DEFAULT 'equipa',
  ed_hr_feedback_text TEXT NOT NULL,
  ed_hr_feedback_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_feedback_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_feedback_id),
  KEY idx_hr_feedback_tenant (
    ed_hr_feedback_institute_code, ed_hr_feedback_to_employee, ed_hr_feedback_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_reviews (
  ed_hr_review_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_review_institute_code VARCHAR(100) NOT NULL,
  ed_hr_review_employee_id INT NOT NULL,
  ed_hr_review_reviewer_employee INT NULL,
  ed_hr_review_period VARCHAR(60) NOT NULL,
  ed_hr_review_self_score DECIMAL(5,2) NULL,
  ed_hr_review_manager_score DECIMAL(5,2) NULL,
  ed_hr_review_final_score DECIMAL(5,2) NULL,
  ed_hr_review_status VARCHAR(30) NOT NULL DEFAULT 'autoavaliacao',
  ed_hr_review_summary TEXT NULL,
  ed_hr_review_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_review_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_review_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_review_id),
  UNIQUE KEY uq_hr_review_employee_period (
    ed_hr_review_institute_code, ed_hr_review_employee_id, ed_hr_review_period, ed_hr_review_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_recruitment_vacancies (
  ed_hr_vacancy_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_vacancy_institute_code VARCHAR(100) NOT NULL,
  ed_hr_vacancy_reference VARCHAR(50) NOT NULL,
  ed_hr_vacancy_title VARCHAR(255) NOT NULL,
  ed_hr_vacancy_department INT NULL,
  ed_hr_vacancy_location VARCHAR(180) NULL,
  ed_hr_vacancy_contract_type VARCHAR(60) NULL,
  ed_hr_vacancy_openings INT NOT NULL DEFAULT 1,
  ed_hr_vacancy_status VARCHAR(30) NOT NULL DEFAULT 'rascunho',
  ed_hr_vacancy_description TEXT NULL,
  ed_hr_vacancy_hiring_manager INT NULL,
  ed_hr_vacancy_created_by INT NULL,
  ed_hr_vacancy_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_vacancy_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_vacancy_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_vacancy_id),
  UNIQUE KEY uq_hr_vacancy_reference (
    ed_hr_vacancy_institute_code, ed_hr_vacancy_reference, ed_hr_vacancy_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_recruitment_candidates (
  ed_hr_candidate_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_candidate_institute_code VARCHAR(100) NOT NULL,
  ed_hr_candidate_vacancy_id BIGINT NOT NULL,
  ed_hr_candidate_name VARCHAR(255) NOT NULL,
  ed_hr_candidate_email VARCHAR(180) NULL,
  ed_hr_candidate_phone VARCHAR(80) NULL,
  ed_hr_candidate_source VARCHAR(80) NULL,
  ed_hr_candidate_stage VARCHAR(40) NOT NULL DEFAULT 'triagem',
  ed_hr_candidate_score DECIMAL(5,2) NULL,
  ed_hr_candidate_notes TEXT NULL,
  ed_hr_candidate_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_candidate_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_candidate_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_candidate_id),
  KEY idx_hr_candidate_vacancy (
    ed_hr_candidate_institute_code, ed_hr_candidate_vacancy_id, ed_hr_candidate_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_expenses (
  ed_hr_expense_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_expense_institute_code VARCHAR(100) NOT NULL,
  ed_hr_expense_employee_id INT NULL,
  ed_hr_expense_category VARCHAR(60) NOT NULL,
  ed_hr_expense_description VARCHAR(500) NOT NULL,
  ed_hr_expense_amount DECIMAL(14,2) NOT NULL,
  ed_hr_expense_currency VARCHAR(3) NOT NULL DEFAULT 'AOA',
  ed_hr_expense_date DATE NOT NULL,
  ed_hr_expense_status VARCHAR(30) NOT NULL DEFAULT 'pendente',
  ed_hr_expense_receipt_url VARCHAR(1000) NULL,
  ed_hr_expense_submitted_by INT NOT NULL,
  ed_hr_expense_decided_by INT NULL,
  ed_hr_expense_decided_at DATETIME NULL,
  ed_hr_expense_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_expense_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_expense_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_expense_id),
  KEY idx_hr_expense_tenant_status (
    ed_hr_expense_institute_code, ed_hr_expense_status, ed_hr_expense_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_training_courses (
  ed_hr_course_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_course_institute_code VARCHAR(100) NOT NULL,
  ed_hr_course_title VARCHAR(255) NOT NULL,
  ed_hr_course_description TEXT NULL,
  ed_hr_course_category VARCHAR(80) NULL,
  ed_hr_course_provider VARCHAR(120) NULL,
  ed_hr_course_start_date DATE NULL,
  ed_hr_course_end_date DATE NULL,
  ed_hr_course_capacity INT NOT NULL DEFAULT 20,
  ed_hr_course_status VARCHAR(30) NOT NULL DEFAULT 'aberto',
  ed_hr_course_created_by INT NULL,
  ed_hr_course_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_course_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_course_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_course_id),
  KEY idx_hr_course_tenant (
    ed_hr_course_institute_code, ed_hr_course_status, ed_hr_course_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_training_enrollments (
  ed_hr_training_enrollment_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_training_enrollment_institute_code VARCHAR(100) NOT NULL,
  ed_hr_training_course_id BIGINT NOT NULL,
  ed_hr_training_employee_id INT NOT NULL,
  ed_hr_training_status VARCHAR(30) NOT NULL DEFAULT 'inscrito',
  ed_hr_training_score DECIMAL(5,2) NULL,
  ed_hr_training_completed_at DATETIME NULL,
  ed_hr_training_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_training_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_training_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_training_enrollment_id),
  UNIQUE KEY uq_hr_training_enrollment (
    ed_hr_training_enrollment_institute_code, ed_hr_training_course_id,
    ed_hr_training_employee_id, ed_hr_training_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_documents (
  ed_hr_document_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_document_institute_code VARCHAR(100) NOT NULL,
  ed_hr_document_employee_id INT NULL,
  ed_hr_document_type VARCHAR(80) NOT NULL,
  ed_hr_document_title VARCHAR(255) NOT NULL,
  ed_hr_document_file_url VARCHAR(1000) NULL,
  ed_hr_document_file_name VARCHAR(255) NULL,
  ed_hr_document_status VARCHAR(30) NOT NULL DEFAULT 'pendente',
  ed_hr_document_valid_until DATE NULL,
  ed_hr_document_notes TEXT NULL,
  ed_hr_document_created_by INT NOT NULL,
  ed_hr_document_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_document_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_document_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_document_id),
  KEY idx_hr_document_tenant_employee (
    ed_hr_document_institute_code, ed_hr_document_employee_id, ed_hr_document_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_time_entries (
  ed_hr_time_entry_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_time_entry_institute_code VARCHAR(100) NOT NULL,
  ed_hr_time_entry_employee_id INT NOT NULL,
  ed_hr_time_entry_work_date DATE NOT NULL,
  ed_hr_time_entry_clock_in DATETIME NOT NULL,
  ed_hr_time_entry_clock_out DATETIME NULL,
  ed_hr_time_entry_minutes INT NULL,
  ed_hr_time_entry_status VARCHAR(30) NOT NULL DEFAULT 'aberto',
  ed_hr_time_entry_note VARCHAR(500) NULL,
  ed_hr_time_entry_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_time_entry_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_time_entry_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_time_entry_id),
  KEY idx_hr_time_tenant_employee_date (
    ed_hr_time_entry_institute_code, ed_hr_time_entry_employee_id,
    ed_hr_time_entry_work_date, ed_hr_time_entry_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_shifts (
  ed_hr_shift_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_shift_institute_code VARCHAR(100) NOT NULL,
  ed_hr_shift_employee_id INT NULL,
  ed_hr_shift_work_date DATE NOT NULL,
  ed_hr_shift_start_time TIME NOT NULL,
  ed_hr_shift_end_time TIME NOT NULL,
  ed_hr_shift_location VARCHAR(180) NULL,
  ed_hr_shift_department INT NULL,
  ed_hr_shift_notes TEXT NULL,
  ed_hr_shift_status VARCHAR(30) NOT NULL DEFAULT 'planeado',
  ed_hr_shift_created_by INT NULL,
  ed_hr_shift_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_shift_updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ed_hr_shift_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_shift_id),
  KEY idx_hr_shift_tenant_date (
    ed_hr_shift_institute_code, ed_hr_shift_work_date, ed_hr_shift_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_task_members (
  ed_hr_task_member_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_task_member_institute_code VARCHAR(100) NOT NULL,
  ed_hr_task_member_project_id INT NOT NULL,
  ed_hr_task_member_employee_id INT NOT NULL,
  ed_hr_task_member_role VARCHAR(60) NOT NULL DEFAULT 'membro',
  ed_hr_task_member_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_hr_task_member_deleted TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (ed_hr_task_member_id),
  UNIQUE KEY uq_hr_task_member (
    ed_hr_task_member_institute_code, ed_hr_task_member_project_id,
    ed_hr_task_member_employee_id, ed_hr_task_member_deleted
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS eduall_hr_audit_logs (
  ed_hr_audit_id BIGINT NOT NULL AUTO_INCREMENT,
  ed_hr_audit_institute_code VARCHAR(100) NOT NULL,
  ed_hr_audit_user_id INT NOT NULL,
  ed_hr_audit_action VARCHAR(80) NOT NULL,
  ed_hr_audit_entity_type VARCHAR(80) NOT NULL,
  ed_hr_audit_entity_id VARCHAR(80) NOT NULL,
  ed_hr_audit_old_value LONGTEXT NULL,
  ed_hr_audit_new_value LONGTEXT NULL,
  ed_hr_audit_reason TEXT NULL,
  ed_hr_audit_ip VARCHAR(100) NULL,
  ed_hr_audit_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ed_hr_audit_id),
  KEY idx_hr_audit_tenant_date (
    ed_hr_audit_institute_code, ed_hr_audit_created_at
  ),
  KEY idx_hr_audit_entity (
    ed_hr_audit_institute_code, ed_hr_audit_entity_type, ed_hr_audit_entity_id
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
