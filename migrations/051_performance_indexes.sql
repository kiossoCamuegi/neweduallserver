-- 051_performance_indexes.sql
-- Índices aditivos para as consultas mais pesadas (aplicados em produção).
-- Todos são seguros de re-executar (IF NOT EXISTS). Não alteram dados.
--
-- Contexto: institute_code está definido como varchar(1000)/text em várias
-- tabelas, pelo que os índices usam prefixo (100 no máximo real; 64 nas
-- restantes). Prefixos não impedem a igualdade (WHERE code = ?).

-- Alunos: listagem por escola + ordenação por nome; alunos por turma;
-- lookup do filtro de duplicados (EXISTS correlacionado).
CREATE INDEX IF NOT EXISTS idx_students_inst_del_name
  ON eduall_students (ed_student_institute_code(100), ed_student_deleted, ed_student_name(160));
CREATE INDEX IF NOT EXISTS idx_students_class_del
  ON eduall_students (ed_student_class, ed_student_deleted);
CREATE INDEX IF NOT EXISTS idx_students_dup_lookup
  ON eduall_students (ed_student_name(160), ed_student_institute_code(100), ed_student_deleted, ed_student_id);

-- Turmas e disciplinas por escola.
CREATE INDEX IF NOT EXISTS idx_class_inst_del
  ON eduall_class (ed_class_institute_code(100), ed_class_deleted);
CREATE INDEX IF NOT EXISTS idx_subject_inst_del
  ON eduall_subjects (ed_subject_institute_code(100), ed_subject_deleted);

-- Horários.
CREATE INDEX IF NOT EXISTS idx_timing_inst_del
  ON eduall_teacher_timings (ed_tch_timing_institute_code(100), ed_tch_timing_deleted);
CREATE INDEX IF NOT EXISTS idx_timing_class_del
  ON eduall_teacher_timings (ed_tch_timing_class, ed_tch_timing_deleted);

-- Notas: consultas por turma/trimestre e por aluno/disciplina/trimestre.
CREATE INDEX IF NOT EXISTS idx_qn_class_quarter_del
  ON eduall_quarterly_notes (ed_quarter_note_class, ed_quarter_note_quarter, ed_quarter_note_deleted);
CREATE INDEX IF NOT EXISTS idx_qn_student_subject
  ON eduall_quarterly_notes (ed_quarter_note_studentcode, ed_quarter_note_subject, ed_quarter_note_quarter, ed_quarter_note_deleted);

CREATE INDEX IF NOT EXISTS idx_semester_class
  ON eduall_semester_notes (ed_semester_note_institute_code(64), ed_semester_note_class, ed_semester_note_semester, ed_semester_note_deleted);

CREATE INDEX IF NOT EXISTS idx_exams_inst_class
  ON eduall_student_exams (ed_student_exam_institute_code(100), ed_student_exam_class, ed_student_exam_deleted);

-- Auditoria (lista por escola/utilizador, sempre ORDER BY id DESC).
CREATE INDEX IF NOT EXISTS idx_aud_inst_id
  ON eduall_auditory (ed_auditory_institute_code(100), ed_auditory_id);
CREATE INDEX IF NOT EXISTS idx_aud_user_id
  ON eduall_auditory (ed_auditory_user_code, ed_auditory_id);

-- Logs de relatórios automáticos e SMS.
CREATE INDEX IF NOT EXISTS idx_auto_log_inst_report_date
  ON eduall_automatic_reports_logs (ed_auto_log_institute_code(64), ed_auto_log_report_code, ed_auto_log_sent_at);
CREATE INDEX IF NOT EXISTS idx_sms_inst_date
  ON eduall_sms_records (ed_sms_record_instituteCode(64), ed_sms_sent_date);

-- Destinatários de notificações de auditoria.
CREATE INDEX IF NOT EXISTS idx_user_inst_notify
  ON eduall_user_accounts (ed_user_account_institute_code(64), ed_user_account_allow_notification);

-- Matrículas por escola/data e pagamentos por escola/data.
CREATE INDEX IF NOT EXISTS idx_enrollment_inst_del_date
  ON eduall_enrollment (ed_enrollment_institute_code(64), ed_enrollment_deleted, ed_enrollment_registerDate);
CREATE INDEX IF NOT EXISTS idx_fee_inst_del_date
  ON eduall_fees_payments (ed_fee_payment_institute_code(100), ed_fee_payment_deleted, ed_fee_payment_registerDate);

-- RFID por escola/data.
CREATE INDEX IF NOT EXISTS idx_rfid_inst_time
  ON eduall_rfid_logs (ed_rfidlog_institute_code(100), ed_rfidlog_timestamp);

-- Limpeza de sessões expiradas (express-mysql-session).
CREATE INDEX IF NOT EXISTS idx_sessions_expires
  ON sessions (expires);
