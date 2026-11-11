-- cache_indexes_v7.sql  (gerado por apply_cache_optimizations_v7.py — CACHE-OPT v7)
-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.
-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;
-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;
-- Nomes de colunas tirados do código dos controllers: se algum índice falhar com «Key column doesn't exist», a coluna tem outro nome.
-- Nos ficheiros com índices UNIQUE: se a criação falhar com «Duplicate entry», há linhas duplicadas a resolver primeiro.
-- SendEmail.js / SendEmailMessage.js / StudentEnrollmentConfirmation.js / StudentFeaturedNotes.js: índices já cobertos acima (notas) ou no v6 (emails); sem propostas novas.

-- ==========================================================================
-- Shelves.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_bookcases;
CREATE INDEX idx_bookcases_inst_del_order ON eduall_library_bookcases (ed_library_bookcase_institute_code, ed_library_bookcase_deleted, ed_library_bookcase_order);
-- verificar antes: SHOW INDEX FROM eduall_library_racks;
CREATE INDEX idx_racks_bookcase_inst ON eduall_library_racks (ed_library_rack_bookcase_id, ed_library_rack_institute_code);
-- O segundo índice serve o UPDATE de BookcaseDelete (soltar prateleiras por estante). Racks.js (v6) propõe outro índice composto na mesma tabela, com outra ordem de colunas: não colidem.
-- validar:
EXPLAIN SELECT * FROM eduall_library_bookcases WHERE ed_library_bookcase_deleted = 0 AND ed_library_bookcase_institute_code = 'XXX' ORDER BY ed_library_bookcase_order, ed_library_bookcase_id;

-- ==========================================================================
-- Services.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_services;
CREATE INDEX idx_services_inst_del_title ON eduall_services (ed_service_institute_code, ed_service_deleted, ed_service_title);
-- verificar antes: SHOW INDEX FROM eduall_coins;
CREATE INDEX idx_coins_inst ON eduall_coins (ed_coin_institute_code);
-- O índice em eduall_coins serve o `LEFT JOIN eduall_coins ON ed_coin_institute_code = ?` (sem índice faz leitura total da tabela por pedido).
-- validar:
EXPLAIN SELECT * FROM eduall_services WHERE ed_service_deleted = 0 AND ed_service_institute_code = 'XXX' ORDER BY ed_service_title;

-- ==========================================================================
-- StudentExamsCalendar.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_student_exams;
CREATE INDEX idx_exams_inst_del_date ON eduall_student_exams (ed_student_exam_institute_code, ed_student_exam_deleted, ed_student_exam_date);
-- verificar antes: SHOW INDEX FROM eduall_student_exams;
CREATE INDEX idx_exams_class_del ON eduall_student_exams (ed_student_exam_class, ed_student_exam_deleted);
-- O segundo índice serve GetExamsCalendarByClass (que hoje nem filtra por escola).
-- validar:
EXPLAIN SELECT * FROM eduall_student_exams WHERE ed_student_exam_deleted = 0 AND ed_student_exam_institute_code = 'XXX' ORDER BY ed_student_exam_date;

-- ==========================================================================
-- StudentBehavior.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_student_behavior;
CREATE INDEX idx_behavior_inst_del ON eduall_student_behavior (ed_student_behavior_instituteCode, ed_student_behavior_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_behavior;
CREATE INDEX idx_behavior_student_inst_del ON eduall_student_behavior (ed_student_behavior_Studentcode, ed_student_behavior_instituteCode, ed_student_behavior_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_student_behavior WHERE ed_student_behavior_deleted = 0 AND ed_student_behavior_Studentcode = '1' AND ed_student_behavior_instituteCode = 'XXX';

-- ==========================================================================
-- SiteManager.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_slides;
CREATE INDEX idx_slides_inst_del_order ON eduall_slides (ed_institute_code, ed_deleted, ed_order);
-- As restantes tabelas do site já têm os índices certos no DDL de ensureSiteTables (idx_inst_del em cursos/posts, UNIQUE (escola) em contactos/branding/escola do site, UNIQUE (escola, idx) em secções).
-- validar:
EXPLAIN SELECT ed_id FROM eduall_slides WHERE ed_deleted = 0 AND ed_institute_code = 'XXX' ORDER BY ed_order, ed_id DESC;

-- ==========================================================================
-- SendSms.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_sms_records;
CREATE INDEX idx_sms_inst_date ON eduall_sms_records (ed_sms_record_instituteCode, ed_sms_sent_date);
-- verificar antes: SHOW INDEX FROM eduall_sms_credits;
CREATE INDEX idx_smscred_inst ON eduall_sms_credits (ed_sms_credit_institute_code);
-- Se não houver linhas de créditos duplicadas por escola, `idx_smscred_inst` pode ser UNIQUE (impede duas linhas de saldo para a mesma escola).
-- validar:
EXPLAIN SELECT * FROM eduall_sms_records WHERE ed_sms_record_instituteCode = 'XXX' ORDER BY ed_sms_sent_date;

-- ==========================================================================
-- StudentAttendance.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_student_attendence;
CREATE INDEX idx_attd_inst_del ON eduall_student_attendence (ed_student_attd_institute_code, ed_student_attd_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_attendence;
CREATE INDEX idx_attd_stu_class_del ON eduall_student_attendence (ed_student_attd_student_code, ed_student_attd_class, ed_student_attd_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_attendence;
CREATE INDEX idx_attd_teachsubclass_del ON eduall_student_attendence (ed_student_attd_teacherSubClass, ed_student_attd_deleted);
-- A tabela chama-se `attendence` (sic) no código: manter a grafia.
-- validar:
EXPLAIN SELECT * FROM eduall_student_attendence WHERE ed_student_attd_deleted = 0 AND ed_student_attd_teacherSubClass = 1;

-- ==========================================================================
-- StudentEnrollment.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_student_enrollment;
CREATE INDEX idx_enroll_inst_del ON eduall_student_enrollment (ed_enrollment_institute_code, ed_student_enrollment_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_enrollment;
CREATE INDEX idx_enroll_stu_inst_del ON eduall_student_enrollment (ed_student_enrollment_studentcode, ed_enrollment_institute_code, ed_student_enrollment_deleted);
-- Tabela partilhada com ServicePayments.js e Recicle.js: confirmar com SHOW INDEX (pode já existir um índice equivalente).
-- validar:
EXPLAIN SELECT * FROM eduall_student_enrollment WHERE ed_student_enrollment_deleted = 0 AND ed_student_enrollment_studentcode = '1' AND ed_enrollment_institute_code = 'XXX';

-- ==========================================================================
-- StudentExams.js / StudentExamsAndFeaturesNotes.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_student_exam_notes;
CREATE INDEX idx_sen_inst_stu_cls_sub_del ON eduall_student_exam_notes (ed_student_exam_note_institute_code, ed_student_exam_note_studentCode, ed_student_exam_note_class, ed_student_exam_note_subject, ed_student_exam_note_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_exam_notes;
CREATE INDEX idx_sen_inst_cls_sub_del ON eduall_student_exam_notes (ed_student_exam_note_institute_code, ed_student_exam_note_class, ed_student_exam_note_subject, ed_student_exam_note_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_featured_notes;
CREATE INDEX idx_sfn_inst_stu_cls_sub_del ON eduall_student_featured_notes (ed_student_featured_note_institute_code, ed_student_featured_note_studentCode, ed_student_featured_note_class, ed_student_featured_note_subject, ed_student_featured_note_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_featured_notes;
CREATE INDEX idx_sfn_inst_cls_sub_del ON eduall_student_featured_notes (ed_student_featured_note_institute_code, ed_student_featured_note_class, ed_student_featured_note_subject, ed_student_featured_note_deleted);
-- Serve a verificação «já existe nota?» dos bulk upserts (a 1.ª de cada tabela) e as listas por turma+disciplina (a 2.ª). Os nomes de colunas são os de StudentExams.js; StudentExamsAndFeaturesNotes.js usa outros (ver TODO no relatório) — confirmar com SHOW COLUMNS antes de aplicar. Ideal: tornar a 1.ª UNIQUE para poder usar INSERT ... ON DUPLICATE KEY UPDATE (só se não existirem duplicados e depois de decidir como tratar as linhas eliminadas).
-- validar:
EXPLAIN SELECT ed_student_exam_note_id FROM eduall_student_exam_notes WHERE ed_student_exam_note_studentCode = '1' AND ed_student_exam_note_class = 1 AND ed_student_exam_note_subject = 1 AND ed_student_exam_note_institute_code = 'XXX' AND ed_student_exam_note_deleted = 0;

-- ==========================================================================
-- StudentGradeHistory.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_student_grade_history_records;
CREATE INDEX idx_ghr_hist_del ON eduall_student_grade_history_records (ed_ghr_history_id, ed_ghr_deleted);
-- verificar antes: SHOW INDEX FROM eduall_student_grade_history_subjects;
CREATE INDEX idx_ghs_rec_del ON eduall_student_grade_history_subjects (ed_ghs_record_id, ed_ghs_deleted);
-- As FOREIGN KEY já criam um índice no primeiro campo; o composto acrescenta `deleted` (opcional, ganho pequeno). O cabeçalho já tem UNIQUE (aluno, escola).
-- validar:
EXPLAIN SELECT * FROM eduall_student_grade_history_subjects WHERE ed_ghs_record_id IN (1,2,3) AND ed_ghs_deleted = 0;

-- ==========================================================================
-- StudenBalanceController.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_student_balance;
CREATE UNIQUE INDEX uq_sb_student_inst ON eduall_student_balance (sb_student_id, sb_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_student_balance_logs;
CREATE INDEX idx_sbl_student_inst_date ON eduall_student_balance_logs (sb_log_student_id, sb_log_institute, sb_log_date);
-- O UNIQUE em eduall_student_balance é o que faz `ON DUPLICATE KEY UPDATE` de ensureBalanceRow funcionar: confirmar com SHOW INDEX antes. Se já houver linhas duplicadas (aluno, escola), juntar/apagar as duplicadas ANTES, ou a criação falha.
-- validar:
EXPLAIN SELECT SUM(sb_log_amount) FROM eduall_student_balance_logs WHERE sb_log_student_id = 1 AND sb_log_institute = 'XXX';

-- ==========================================================================
-- ServicePayments.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_service_payments;
CREATE INDEX idx_sp_inst_del_date ON eduall_service_payments (ed_service_payment_institute_code, ed_service_payment_deleted, ed_service_payment_registerDate);
-- verificar antes: SHOW INDEX FROM eduall_service_payments;
CREATE INDEX idx_sp_student_inst ON eduall_service_payments (ed_service_payment_student_code, ed_service_payment_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_service_payments;
CREATE INDEX idx_sp_code ON eduall_service_payments (ed_service_payment_code);
-- Os índices de eduall_service_payment_items (junção por código do pagamento) e de eduall_fees_payments não foram propostos: as colunas de ligação não aparecem por inteiro no código analisado — ver EXPLAIN de FetchServicePayments com dados reais. `COALESCE(deleted, 0) = 0` impede o uso do 1.º índice (ver TODO).
-- validar:
EXPLAIN SELECT ed_service_payment_id FROM eduall_service_payments WHERE ed_service_payment_deleted = 0 AND ed_service_payment_institute_code = 'XXX';

-- ==========================================================================
-- SeedLibraryBooks.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_books;
CREATE UNIQUE INDEX uq_book_external_inst ON eduall_library_books (ed_library_book_external_id, ed_library_book_institute_code);
-- Segundo o comentário do ficheiro (add_external_id_column.sql) esta UNIQUE KEY já deve existir: verificar com SHOW INDEX antes de a criar. É ela que impede duplicados quando duas importações correm em paralelo.

