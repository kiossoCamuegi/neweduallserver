-- 052_students_details_index.down.sql
-- Reverte apenas o índice criado em 052_students_details_index.sql.

DROP INDEX IF EXISTS idx_details_student_code ON eduall_students_details;
