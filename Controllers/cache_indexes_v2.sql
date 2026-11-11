-- cache_indexes_v2.sql  (gerado por apply_cache_optimizations_v2.py — CACHE-OPT v2)
-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.
-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;
-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;
-- Alguns índices (ex.: idx_class_inst_*) também constam de cache_indexes.sql (v1): não duplicar.

-- ==========================================================================
-- Faculties.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_faculty;
CREATE INDEX idx_faculty_inst_title ON eduall_faculty (ed_faculty_institute_code, ed_faculty_deleted, ed_faculty_title);
-- verificar antes: SHOW INDEX FROM eduall_class;
CREATE INDEX idx_class_inst_faculty ON eduall_class (ed_class_institute_code, ed_class_deleted, ed_class_faculty);
-- idx_class_inst_faculty acelera a verificação 'existem turmas nesta faculdade?' no FacultyDelete.
-- validar:
EXPLAIN SELECT * FROM eduall_faculty WHERE ed_faculty_deleted = 0 AND ed_faculty_institute_code = 'XXX' ORDER BY ed_faculty_title ASC;
EXPLAIN SELECT COUNT(*) FROM eduall_class WHERE ed_class_faculty = 1 AND ed_class_institute_code = 'XXX' AND ed_class_deleted = 0;

-- ==========================================================================
-- Enrollmenttemplates.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_enrollment_templates;
CREATE INDEX idx_enrtpl_inst_model ON eduall_enrollment_templates (ed_enroll_tpl_institute_code, ed_enroll_tpl_deleted, ed_enroll_tpl_model_key);
-- GetActiveTemplateByModel deixou de ser cacheada: este índice é a otimização principal.
-- validar:
EXPLAIN SELECT * FROM eduall_enrollment_templates WHERE ed_enroll_tpl_deleted = 0 AND ed_enroll_tpl_model_key = 'sol' AND ed_enroll_tpl_institute_code = 'XXX' AND ed_enroll_tpl_is_active = 1 ORDER BY ed_enroll_tpl_updated_at DESC LIMIT 1;

-- ==========================================================================
-- FeesPayments.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_fees_payments;
CREATE INDEX idx_feepay_inst_del ON eduall_fees_payments (ed_fee_payment_institute_code, ed_fee_payment_deleted);
-- verificar antes: SHOW INDEX FROM eduall_fees_payments;
CREATE INDEX idx_feepay_student_month ON eduall_fees_payments (ed_fee_payment_student, ed_fee_payment_month, ed_fee_payment_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_fees_payments;
CREATE INDEX idx_feepay_invoice ON eduall_fees_payments (ed_fee_payment_invoiceCode, ed_fee_payment_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_fee_additional_items;
CREATE INDEX idx_feeadd_invoice ON eduall_fee_additional_items (invoice_code, institute_code);
-- verificar antes: SHOW INDEX FROM eduall_bordereau_control;
CREATE INDEX idx_bord_inst_number ON eduall_bordereau_control (ed_bordereau_institute_code, ed_bordereau_number);
-- Sem cache (financeiro): os índices são a otimização principal. A subquery JSON_ARRAYAGG sobre eduall_fee_additional_items corre por linha: idx_feeadd_invoice é essencial. Verificar com SHOW INDEX se algum já existe.
-- validar:
EXPLAIN SELECT p.* FROM eduall_fees_payments p WHERE p.ed_fee_payment_deleted = 0 AND p.ed_fee_payment_month = 'X' AND p.ed_fee_payment_student = 1 AND p.ed_fee_payment_institute_code = 'XXX';
EXPLAIN SELECT * FROM eduall_fees_payments WHERE ed_fee_payment_invoiceCode = 'X' AND ed_fee_payment_institute_code = 'XXX' AND ed_fee_payment_deleted = 0;

-- ==========================================================================
-- Fines.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_fines;
CREATE INDEX idx_fines_inst_del ON eduall_fines (ed_fine_institute_code, ed_fine_deleted);
-- verificar antes: SHOW INDEX FROM eduall_fines;
CREATE INDEX idx_fines_service ON eduall_fines (ed_fine_service);
-- validar:
EXPLAIN SELECT * FROM eduall_fines LEFT JOIN eduall_services ON eduall_services.ed_service_id = eduall_fines.ed_fine_service LEFT JOIN eduall_coins ON eduall_coins.ed_coin_id = eduall_services.ed_service_coin WHERE eduall_services.ed_service_deleted = 0 AND ed_fine_deleted = 0 AND ed_fine_institute_code = 'XXX';

-- ==========================================================================
-- FinesRestrictions.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_fines_restrictions;
CREATE INDEX idx_finerestr_inst_del ON eduall_fines_restrictions (ed_fine_restriction_institute_code, ed_fine_restriction_deleted);
-- verificar antes: SHOW INDEX FROM eduall_fines_restrictions;
CREATE INDEX idx_finerestr_elcode ON eduall_fines_restrictions (ed_fine_restriction_for_elCode, ed_fine_restriction_institute_code);
-- validar:
EXPLAIN SELECT * FROM eduall_fines_restrictions WHERE ed_fine_restriction_deleted = 0 AND ed_fine_restriction_for_elCode = 'X' AND ed_fine_restriction_institute_code = 'XXX';

-- ==========================================================================
-- FinesStudents.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_fines_students;
CREATE INDEX idx_finestud_inst_del ON eduall_fines_students (ed_fine_student_institute_code, ed_fine_student_deleted);
-- verificar antes: SHOW INDEX FROM eduall_fines_students;
CREATE INDEX idx_finestud_finecode ON eduall_fines_students (ed_fine_student_fineCode);
-- verificar antes: SHOW INDEX FROM eduall_fines_students;
CREATE INDEX idx_finestud_student ON eduall_fines_students (ed_fine_student_id);
-- validar:
EXPLAIN SELECT * FROM eduall_fines_students WHERE ed_fine_student_deleted = 0 AND ed_fine_student_fineCode = 'X';

-- ==========================================================================
-- FilesStorage.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_files;
CREATE INDEX idx_files_code_del ON eduall_files (ed_file_code, ed_file_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_files WHERE ed_file_deleted = 0 AND ed_file_code = 'X';

