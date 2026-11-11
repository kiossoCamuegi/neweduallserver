-- cache_indexes_v4.sql  (gerado por apply_cache_optimizations.py — CACHE-OPT v4)
-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.
-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;
-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;

-- ==========================================================================
-- LessonsSectionContent.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_lessons_content;
CREATE INDEX idx_lessoncontent_tree ON eduall_lessons_content (ed_lesson_content_instituteCode, ed_lesson_parent_type, ed_lesson_parent_code, ed_lesson_content_deleted);
-- verificar antes: SHOW INDEX FROM eduall_lessons_content;
CREATE INDEX idx_lessoncontent_code ON eduall_lessons_content (ed_lesson_content_code);
-- verificar antes: SHOW INDEX FROM eduall_lessons_files;
CREATE INDEX idx_lessonfiles_code ON eduall_lessons_files (lesson_code);
-- A subquery de secções usa ed_lesson_content_code: idx_lessoncontent_code (pode já ser UNIQUE: verificar com SHOW INDEX).
-- validar:
EXPLAIN SELECT * FROM eduall_lessons_content WHERE ed_lesson_content_instituteCode = 'XXX' AND ed_lesson_parent_type = 'none' AND ed_lesson_parent_code = 'X' AND ed_lesson_content_deleted = 0 ORDER BY ed_lesson_content_position ASC;
EXPLAIN SELECT * FROM eduall_lessons_content WHERE ed_lesson_content_instituteCode = 'XXX' AND ed_lesson_parent_type = 'section' AND ed_lesson_content_deleted = 0 ORDER BY ed_lesson_content_position ASC;

-- ==========================================================================
-- Lessonplancontroller.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_lesson_plans;
CREATE INDEX idx_lessonplan_inst_cls_subj ON eduall_lesson_plans (ed_lesson_plan_institute_code, ed_lesson_plan_deleted, ed_lesson_plan_class, ed_lesson_plan_subject);
-- O ORDER BY (date, created_at) faz filesort sobre poucas linhas por turma/disciplina: aceitável.
-- validar:
EXPLAIN SELECT lp.* FROM eduall_lesson_plans lp WHERE lp.ed_lesson_plan_deleted = 0 AND lp.ed_lesson_plan_institute_code = 'XXX' AND lp.ed_lesson_plan_class = 1 AND lp.ed_lesson_plan_subject = 1 ORDER BY lp.ed_lesson_plan_date DESC, lp.ed_lesson_plan_created_at DESC;

-- ==========================================================================
-- LibraryLoans.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_loans;
CREATE INDEX idx_loans_inst_del ON eduall_library_loans (ed_loan_institute_code, ed_loan_deleted);
-- Se existirem filtros frequentes por utilizador/estado, enviar o EXPLAIN para índices exatos (colunas não confirmadas).
-- validar:
EXPLAIN SELECT * FROM eduall_library_loans l WHERE l.ed_loan_deleted = 0 AND l.ed_loan_institute_code = 'XXX';

-- ==========================================================================
-- LibraryReservations.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_reservations;
CREATE INDEX idx_resv_inst_del ON eduall_library_reservations (ed_reservation_institute_code, ed_reservation_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_library_reservations r WHERE r.ed_reservation_deleted = 0 AND r.ed_reservation_institute_code = 'XXX';

-- ==========================================================================
-- LibraryFines.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_fines;
CREATE INDEX idx_libfines_inst ON eduall_library_fines (ed_fine_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_library_fine_rules;
CREATE INDEX idx_flr_inst_del_active ON eduall_library_fine_rules (flr_institute_code, flr_deleted, flr_active);
-- verificar antes: SHOW INDEX FROM eduall_library_fine_exclusions;
CREATE INDEX idx_fle_rule_inst ON eduall_library_fine_exclusions (fle_rule_id, fle_institute_code, fle_deleted);
-- Para evitar números de multa repetidos: CREATE UNIQUE INDEX uq_libfine_number ON eduall_library_fines (ed_fine_institute_code, ed_fine_number); (só depois de confirmar que não há duplicados). Em InnoDB idx_libfines_inst já inclui a PK, por isso serve o ORDER BY ed_fine_id DESC.
-- validar:
EXPLAIN SELECT ed_fine_number FROM eduall_library_fines WHERE ed_fine_institute_code = 'XXX' ORDER BY ed_fine_id DESC LIMIT 1;
EXPLAIN SELECT flr.* FROM eduall_library_fine_rules flr WHERE flr.flr_institute_code = 'XXX' AND flr.flr_deleted = 0 AND flr.flr_active = 1;

-- ==========================================================================
-- LessonReviews.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_lesson_reviews;
CREATE INDEX idx_lessonrev_lesson ON eduall_lesson_reviews (ed_lesson_review_lessonId);
-- validar:
EXPLAIN SELECT * FROM eduall_lesson_reviews WHERE ed_lesson_review_lessonId = 1;

-- ==========================================================================
-- LessonsSection.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_lessons_sections;
CREATE INDEX idx_lessonsec_group_del ON eduall_lessons_sections (ed_lesson_section_groupCode, ed_lesson_section_deleted);
-- Confirmar o nome real da coluna do grupo (o controller usa `ed_lesson_content_groupCode` numa query e `ed_lesson_section_groupCode` noutras).
-- validar:
EXPLAIN SELECT * FROM eduall_lessons_sections WHERE ed_lesson_section_groupCode = 'X' AND ed_lesson_section_deleted = 0;

-- ==========================================================================
-- logger.js
-- ==========================================================================
-- Sem índices: não acede à BD.

