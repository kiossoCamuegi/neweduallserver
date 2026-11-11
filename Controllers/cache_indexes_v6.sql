-- cache_indexes_v6.sql  (gerado por apply_cache_optimizations_v6.py — CACHE-OPT v6)
-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.
-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;
-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;
-- Nomes de colunas tirados do código dos controllers: se algum índice falhar com «Key column doesn't exist», a coluna tem outro nome.
-- QuarterlyNotes.js / SemesterNotes.js: sem índices propostos (as colunas das tabelas de notas não foram vistas por inteiro); usar EXPLAIN com dados reais.

-- ==========================================================================
-- Publishers.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_publishers;
CREATE INDEX idx_libpub_inst_del ON eduall_library_publishers (ed_library_publisher_institute_code, ed_library_publisher_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_library_publishers WHERE ed_library_publisher_deleted = 0 AND ed_library_publisher_institute_code = 'XXX';

-- ==========================================================================
-- SchoolsOfProvenance.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_schools_of_provenance;
CREATE INDEX idx_schprov_inst_del_name ON eduall_schools_of_provenance (ed_schools_of_provenance_institute_code, ed_schools_of_provenance_deleted, ed_schools_of_provenance_name);
-- validar:
EXPLAIN SELECT * FROM eduall_schools_of_provenance WHERE ed_schools_of_provenance_deleted = 0 AND ed_schools_of_provenance_institute_code = 'XXX' ORDER BY ed_schools_of_provenance_name;

-- ==========================================================================
-- Requests.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_requests;
CREATE INDEX idx_requests_inst_del ON eduall_requests (ed_request_institute_code, ed_request_deleted);
-- verificar antes: SHOW INDEX FROM eduall_requests;
CREATE INDEX idx_requests_madeby_inst ON eduall_requests (ed_request_made_by, ed_request_institute_code, ed_request_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_requests WHERE ed_request_deleted = 0 AND ed_request_institute_code = 'XXX';

-- ==========================================================================
-- ScientificPublications.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_scientific_publications;
CREATE INDEX idx_scipub_inst_del_title ON eduall_library_scientific_publications (ed_sci_pub_institute_code, ed_sci_pub_deleted, ed_sci_pub_title);
-- validar:
EXPLAIN SELECT * FROM eduall_library_scientific_publications WHERE ed_sci_pub_deleted = 0 AND ed_sci_pub_institute_code = 'XXX' ORDER BY ed_sci_pub_title;

-- ==========================================================================
-- SavedCertificates.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_certificates;
CREATE INDEX idx_cert_inst_del_upd ON eduall_certificates (ed_cert_institute_code, ed_cert_deleted, ed_cert_updated_at);
-- A tabela só tem índices de uma coluna (instituto, apagado, atualizado). O composto serve o WHERE + ORDER BY da lista de uma só vez.
-- validar:
EXPLAIN SELECT ed_cert_id FROM eduall_certificates WHERE ed_cert_deleted = 0 AND ed_cert_institute_code = 'XXX' ORDER BY ed_cert_updated_at DESC;

-- ==========================================================================
-- SavedDeclarations.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_qualifications_statements;
CREATE INDEX idx_qs_inst_del_upd ON eduall_qualifications_statements (ed_qs_institute_code, ed_qs_deleted, ed_qs_updated_at);
-- Colunas deduzidas do código; confirmar com SHOW INDEX se já existe um índice equivalente.
-- validar:
EXPLAIN SELECT ed_qs_id FROM eduall_qualifications_statements WHERE ed_qs_deleted = 0 AND ed_qs_institute_code = 'XXX' ORDER BY ed_qs_updated_at DESC;

-- ==========================================================================
-- SavedTransferGuide.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_transfer_guides;
CREATE INDEX idx_tg_inst_del_upd ON eduall_transfer_guides (ed_tg_institute_code, ed_tg_deleted, ed_tg_updated_at);
-- validar:
EXPLAIN SELECT ed_tg_id FROM eduall_transfer_guides WHERE ed_tg_deleted = 0 AND ed_tg_institute_code = 'XXX' ORDER BY ed_tg_updated_at DESC;

-- ==========================================================================
-- schoolExpenses.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_school_expenses;
CREATE INDEX idx_expenses_inst_del_date ON eduall_school_expenses (ed_expense_institute, ed_expense_deleted, ed_expense_date);
-- `YEAR(ed_expense_date) = ?` não usa o índice na coluna de data; a longo prazo trocar por `ed_expense_date >= '2026-01-01' AND ed_expense_date < '2027-01-01'`.
-- validar:
EXPLAIN SELECT ed_expense_category, COUNT(*), SUM(ed_expense_amount) FROM eduall_school_expenses WHERE ed_expense_deleted = 0 AND ed_expense_institute = 'XXX' AND YEAR(ed_expense_date) = 2026 GROUP BY ed_expense_category;

-- ==========================================================================
-- RFIDMovements.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_rfid_antennas;
CREATE INDEX idx_rfidant_inst_del ON eduall_library_rfid_antennas (ed_rfid_antenna_institute_code, ed_rfid_antenna_deleted);
-- Os índices de eduall_library_rfid_movements não foram analisados (a tabela cresce a cada evento): ver EXPLAIN de GetRFIDMovements com dados reais.
-- validar:
EXPLAIN SELECT * FROM eduall_library_rfid_antennas WHERE ed_rfid_antenna_deleted = 0 AND ed_rfid_antenna_institute_code = 'XXX';

-- ==========================================================================
-- SavedMaps.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_performance_maps;
CREATE INDEX idx_pm_inst_del_upd ON eduall_performance_maps (ed_pm_institute_code, ed_pm_deleted, ed_pm_updated_at);
-- validar:
EXPLAIN SELECT ed_pm_id FROM eduall_performance_maps WHERE ed_pm_deleted = 0 AND ed_pm_institute_code = 'XXX' ORDER BY ed_pm_updated_at DESC;

-- ==========================================================================
-- Referralcontroller.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_referrals;
CREATE INDEX idx_referrals_created ON eduall_referrals (ed_referral_created_at);
-- verificar antes: SHOW INDEX FROM eduall_referrals;
CREATE INDEX idx_referrals_phone_inst ON eduall_referrals (ed_referral_referrer_phone, ed_referral_institution_name);
-- O segundo índice serve a verificação de duplicados de RegisterReferral. `ed_referral_institution_name` pode ser longa: se der «key too long», indexar um prefixo (ex.: (100)).
-- validar:
EXPLAIN SELECT ed_referral_id FROM eduall_referrals WHERE ed_referral_referrer_phone = '9' AND ed_referral_institution_name = 'X' AND ed_referral_status NOT IN ('rejected','cancelled') LIMIT 1;

-- ==========================================================================
-- SendEmail.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_sent_emails;
CREATE INDEX idx_sentemails_inst_date ON eduall_sent_emails (ed_sent_email_institutecode, ed_sent_email_sentdate);
-- verificar antes: SHOW INDEX FROM eduall_sent_emails;
CREATE INDEX idx_sentemails_code ON eduall_sent_emails (ed_sent_email_code);
-- verificar antes: SHOW INDEX FROM eduall_sent_emails_contacts;
CREATE INDEX idx_sentemails_ct_code ON eduall_sent_emails_contacts (ed_sent_email_ct_code);
-- O código do email é uma string de 700 caracteres: se a coluna for VARCHAR(700), o índice em `ed_sent_email_code` pode falhar (limite de bytes do índice). Encurtar o código primeiro (ver TODOs).
-- validar:
EXPLAIN SELECT se.ed_sent_email_code FROM eduall_sent_emails se LEFT JOIN eduall_sent_emails_contacts sec ON se.ed_sent_email_code = sec.ed_sent_email_ct_code WHERE se.ed_sent_email_institutecode = 'XXX' GROUP BY se.ed_sent_email_code;

-- ==========================================================================
-- RefreshToken.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_system_accounts;
CREATE INDEX idx_sysacc_name_del ON eduall_system_accounts (ed_system_account_name, ed_system_account_deleted);
-- verificar antes: SHOW INDEX FROM eduall_user_accounts;
CREATE INDEX idx_useracc_usertoken ON eduall_user_accounts (ed_usertoken);
-- verificar antes: SHOW INDEX FROM eduall_user_access;
CREATE INDEX idx_useraccess_usercode ON eduall_user_access (ed_user_access_usercode);
-- São tabelas partilhadas com Login/Users: confirmar com SHOW INDEX (provavelmente já existem). Se `ed_usertoken` for TEXT, indexar um prefixo.
-- validar:
EXPLAIN SELECT * FROM eduall_user_accounts WHERE ed_user_account_deleted = 0 AND ed_usertoken = 'X' LIMIT 1;

-- ==========================================================================
-- Racks.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_racks;
CREATE INDEX idx_racks_inst_del_case_order ON eduall_library_racks (ed_library_rack_institute_code, ed_library_rack_deleted, ed_library_rack_bookcase_id, ed_library_rack_order);
-- A coluna ed_library_book_rack já está indexada (segundo o comentário do código): não é preciso mais nada em eduall_library_books.
-- validar:
EXPLAIN SELECT * FROM eduall_library_racks WHERE ed_library_rack_deleted = 0 AND ed_library_rack_institute_code = 'XXX' ORDER BY ed_library_rack_bookcase_id, ed_library_rack_order;

-- ==========================================================================
-- Saidasdecaixa.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_cash_outflow;
CREATE INDEX idx_co_inst_del_date ON eduall_cash_outflow (co_institute_code, co_deleted, co_date);
-- Substitui, na prática, idx_co_institute / idx_co_deleted / idx_co_date nas consultas de listagem; não é preciso apagar os antigos.
-- validar:
EXPLAIN SELECT * FROM eduall_cash_outflow WHERE co_institute_code = 'XXX' AND co_deleted = 0 ORDER BY co_date DESC;

