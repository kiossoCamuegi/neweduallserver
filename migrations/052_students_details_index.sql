-- 052_students_details_index.sql
-- Índice em falta para o JOIN de eduall_students_details.
--
-- GetStudents (escolas não-normais/universidades) e GetStudentsByInstitute
-- fazem:
--   LEFT JOIN eduall_students_details sd
--          ON sd.ed_detail_student_code = s.ed_student_id
-- A tabela só tinha PRIMARY KEY, pelo que o JOIN fazia full scan por aluno.
--
-- NÃO foi aplicado em produção. Aplicar apenas quando autorizado, em
-- horário de pouca utilização:
--   ALTER TABLE ... ADD INDEX ... , ALGORITHM=INPLACE, LOCK=NONE;

CREATE INDEX IF NOT EXISTS idx_details_student_code
  ON eduall_students_details (ed_detail_student_code, ed_detail_deleted);
