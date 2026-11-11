-- cache_indexes_v3.sql  (gerado por apply_cache_optimizations_v3.py — CACHE-OPT v3)
-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.
-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;
-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;

-- ==========================================================================
-- JobTitles.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_job_titles;
CREATE INDEX idx_jobtitle_del_title ON eduall_job_titles (ed_job_title_deleted, ed_job_title);
-- Tabela pequena: índice opcional.
-- validar:
EXPLAIN SELECT * FROM eduall_job_titles ORDER BY ed_job_title ASC;

-- ==========================================================================
-- Invoices.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_invoices;
CREATE INDEX idx_inv_inst_date ON eduall_invoices (ed_invoice_institute_code, ed_invoice_registerDate);
-- O controller já cria idx_code/idx_institute/idx_deleted. Este composto evita o filesort da listagem. COALESCE(ed_invoice_deleted,0) impede o uso do índice por `deleted`; se a coluna for NOT NULL DEFAULT 0, usar `= 0` simples.
-- validar:
EXPLAIN SELECT inv.ed_invoice_id FROM eduall_invoices inv WHERE COALESCE(inv.ed_invoice_deleted, 0) = 0 AND inv.ed_invoice_institute_code = 'XXX' ORDER BY inv.ed_invoice_registerDate DESC;
SHOW CREATE TABLE eduall_invoices;  -- confirmar collation de ed_invoice_code (o JOIN usa COLLATE utf8mb4_general_ci)
SHOW CREATE TABLE eduall_invoice_items;

-- ==========================================================================
-- InstituteAccounts.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_system_accounts;
CREATE INDEX idx_sysacc_inst_emp ON eduall_system_accounts (ed_system_account_institute_code, ed_system_account_employee);
-- O filtro por ed_employee_deleted torna o LEFT JOIN num INNER JOIN. idx_emp_inst_name (v1) já cobre o lado dos funcionários.
-- validar:
EXPLAIN SELECT * FROM eduall_system_accounts LEFT JOIN eduall_employees ON eduall_system_accounts.ed_system_account_employee = eduall_employees.ed_employee_id WHERE eduall_employees.ed_employee_deleted = 0 AND eduall_system_accounts.ed_system_account_institute_code = 'XXX' ORDER BY eduall_employees.ed_employee_name ASC;

-- ==========================================================================
-- InstituteFollowers.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_institute_followers;
CREATE INDEX idx_follow_code ON eduall_institute_followers (ed_institute_follower_code);
-- verificar antes: SHOW INDEX FROM eduall_institute_followers;
CREATE INDEX idx_follow_user_code ON eduall_institute_followers (ed_institute_follower_user, ed_institute_follower_code);
-- Para impedir duplicados, trocar idx_follow_user_code por UNIQUE (só depois de limpar duplicados existentes).
-- validar:
EXPLAIN SELECT * FROM eduall_institute_followers WHERE ed_institute_follower_user = 1 AND ed_institute_follower_code = 'XXX';

-- ==========================================================================
-- Institutes.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_institutes_licences;
CREATE INDEX idx_lic_inst ON eduall_institutes_licences (ed_institute_licence_instituteCode);
-- Já proposto na v1 (Employees.js): não duplicar. `eduall_institutes.ed_institute_code` deve ser UNIQUE: verificar com SHOW INDEX.
-- validar:
EXPLAIN SELECT * FROM eduall_institutes_licences WHERE ed_institute_licence_instituteCode = 'XXX';

-- ==========================================================================
-- LessonContentComments.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_lesson_comments;
CREATE INDEX idx_lessoncomm_lesson ON eduall_lesson_comments (ed_lesson_comment_lessonid);
-- validar:
EXPLAIN SELECT * FROM eduall_lesson_comments LEFT JOIN eduall_user_accounts ON ed_lesson_review_user = eduall_user_accounts.ed_user_account_id WHERE ed_lesson_comment_lessonid = 1;

-- ==========================================================================
-- InstituteLicenceAndServicePayment.js
-- ==========================================================================
-- Sem índices: ficheiro inoperante.

-- ==========================================================================
-- InstitutesAccountsPayments.js
-- ==========================================================================
-- Sem índices: ficheiro inoperante.

