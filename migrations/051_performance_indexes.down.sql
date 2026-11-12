-- 051_performance_indexes.down.sql
-- Reverte apenas os índices criados em 051_performance_indexes.sql.
-- Não toca em dados nem em índices pré-existentes.

DROP INDEX IF EXISTS idx_students_inst_del_name ON eduall_students;
DROP INDEX IF EXISTS idx_students_class_del ON eduall_students;
DROP INDEX IF EXISTS idx_students_dup_lookup ON eduall_students;

DROP INDEX IF EXISTS idx_class_inst_del ON eduall_class;
DROP INDEX IF EXISTS idx_subject_inst_del ON eduall_subjects;

DROP INDEX IF EXISTS idx_timing_inst_del ON eduall_teacher_timings;
DROP INDEX IF EXISTS idx_timing_class_del ON eduall_teacher_timings;

DROP INDEX IF EXISTS idx_qn_class_quarter_del ON eduall_quarterly_notes;
DROP INDEX IF EXISTS idx_qn_student_subject ON eduall_quarterly_notes;

DROP INDEX IF EXISTS idx_semester_class ON eduall_semester_notes;
DROP INDEX IF EXISTS idx_exams_inst_class ON eduall_student_exams;

DROP INDEX IF EXISTS idx_aud_inst_id ON eduall_auditory;
DROP INDEX IF EXISTS idx_aud_user_id ON eduall_auditory;

DROP INDEX IF EXISTS idx_auto_log_inst_report_date ON eduall_automatic_reports_logs;
DROP INDEX IF EXISTS idx_sms_inst_date ON eduall_sms_records;

DROP INDEX IF EXISTS idx_user_inst_notify ON eduall_user_accounts;

DROP INDEX IF EXISTS idx_enrollment_inst_del_date ON eduall_enrollment;
DROP INDEX IF EXISTS idx_fee_inst_del_date ON eduall_fees_payments;

DROP INDEX IF EXISTS idx_rfid_inst_time ON eduall_rfid_logs;

DROP INDEX IF EXISTS idx_sessions_expires ON sessions;
