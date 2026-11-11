-- cache_indexes_v5.sql  (gerado por apply_cache_optimizations.py — CACHE-OPT v5)
-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.
-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;
-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;
-- Nomes de colunas tirados do código dos controllers: se algum índice falhar com «Key column doesn't exist», a coluna tem outro nome.

-- ==========================================================================
-- Provider.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_providers;
CREATE INDEX idx_providers_inst_del ON eduall_providers (ed_provider_institute_code, ed_provider_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_providers WHERE ed_provider_deleted = 0 AND ed_provider_institute_code = 'XXX';

-- ==========================================================================
-- ProductCategory.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_product_categories;
CREATE INDEX idx_prodcat_inst_del ON eduall_product_categories (ed_product_category_institute_code, ed_product_category_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_product_categories WHERE ed_product_category_deleted = 0 AND ed_product_category_institute_code = 'XXX';

-- ==========================================================================
-- Products.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_products;
CREATE INDEX idx_products_inst_del_name ON eduall_products (ed_product_institute_code, ed_product_deleted, ed_product_name);
-- validar:
EXPLAIN SELECT * FROM eduall_products WHERE ed_product_deleted = 0 AND ed_product_institute_code = 'XXX' ORDER BY ed_product_name ASC;

-- ==========================================================================
-- ProductSalles.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_product_sales;
CREATE INDEX idx_psales_inst_del_date ON eduall_product_sales (ed_product_sale_institute_code, ed_product_sale_deleted, ed_product_sale_date);
-- verificar antes: SHOW INDEX FROM eduall_product_sales;
CREATE INDEX idx_psales_reference ON eduall_product_sales (ed_product_sale_reference);
-- verificar antes: SHOW INDEX FROM eduall_sales_products;
CREATE INDEX idx_salesprod_reference ON eduall_sales_products (ed_sale_product_sale_reference);
-- verificar antes: SHOW INDEX FROM eduall_sales_products;
CREATE INDEX idx_salesprod_product ON eduall_sales_products (ed_sale_product_product_id);
-- A referência é usada como chave de ligação entre vendas e linhas de venda: se for única, preferir UNIQUE em eduall_product_sales (verificar com SHOW INDEX).
-- validar:
EXPLAIN SELECT * FROM eduall_product_sales WHERE ed_product_sale_institute_code = 'XXX' AND ed_product_sale_deleted = 0 ORDER BY ed_product_sale_date DESC;

-- ==========================================================================
-- OldPayments.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_school_old_payments;
CREATE INDEX idx_oldpay_inst_del_date ON eduall_school_old_payments (ed_sc_old_pay_institute_code, ed_sc_old_pay_deleted, ed_sc_old_pay_date);
-- validar:
EXPLAIN SELECT * FROM eduall_school_old_payments WHERE ed_sc_old_pay_deleted = 0 AND ed_sc_old_pay_institute_code = 'XXX' ORDER BY ed_sc_old_pay_date DESC;

-- ==========================================================================
-- Parents.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_parents;
CREATE INDEX idx_parents_inst_del_name ON eduall_parents (ed_parent_institute_code, ed_parent_deleted, ed_parent_name);
-- verificar antes: SHOW INDEX FROM eduall_parents_kids;
CREATE INDEX idx_pk_parent ON eduall_parents_kids (ed_parentkid_parent, ed_parentkid_deleted, ed_parentkid_student);
-- verificar antes: SHOW INDEX FROM eduall_parents_kids;
CREATE INDEX idx_pk_student ON eduall_parents_kids (ed_parentkid_student, ed_parentkid_deleted);
-- validar:
EXPLAIN SELECT * FROM eduall_parents WHERE ed_parent_deleted = 0 AND ed_parent_institute_code = 'XXX' ORDER BY ed_parent_name ASC;

-- ==========================================================================
-- ParentsChilds.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_parent_childrens;
CREATE INDEX idx_pc_user_del ON eduall_parent_childrens (ed_parent_children_UserCode, ed_parent_children_deleted);
-- verificar antes: SHOW INDEX FROM eduall_parent_childrens;
CREATE INDEX idx_pc_code_del ON eduall_parent_childrens (ed_parent_children_code, ed_parent_children_deleted);
-- verificar antes: SHOW INDEX FROM eduall_students;
CREATE INDEX idx_students_inst_del_name ON eduall_students (ed_student_institute_code, ed_student_deleted, ed_student_name);
-- verificar antes: SHOW INDEX FROM eduall_institutes_licences;
CREATE INDEX idx_lic_inst_end ON eduall_institutes_licences (ed_institute_licence_instituteCode, ed_institute_licence_endDate);
-- Confirmar com SHOW INDEX se eduall_students / eduall_institutes_licences já têm estes índices (são tabelas partilhadas com outros controllers).
-- validar:
EXPLAIN SELECT * FROM eduall_parent_childrens WHERE ed_parent_children_UserCode = 1 AND ed_parent_children_deleted = 0;

-- ==========================================================================
-- ParentsPickup.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_portaria_frequencia;
CREATE INDEX idx_portfreq_inst_student_date ON eduall_portaria_frequencia (ed_portaria_freq_institute_code, ed_portaria_freq_student, ed_portaria_freq_date);
-- verificar antes: SHOW INDEX FROM eduall_portaria_frequencia;
CREATE INDEX idx_portfreq_inst_date ON eduall_portaria_frequencia (ed_portaria_freq_institute_code, ed_portaria_freq_date);
-- verificar antes: SHOW INDEX FROM eduall_parents;
CREATE INDEX idx_parents_inst_idcard ON eduall_parents (ed_parent_institute_code, ed_parent_identityCard);
-- idx_parents_inst_idcard: a coluna ed_parent_identityCard é criada por RegisterResponsavelPortaria; só criar o índice depois de a coluna existir.
-- validar:
EXPLAIN SELECT * FROM eduall_portaria_frequencia WHERE ed_portaria_freq_institute_code = 'XXX' AND ed_portaria_freq_student = 1 ORDER BY ed_portaria_freq_date DESC LIMIT 100;

-- ==========================================================================
-- NotesRestrictions.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_system_accounts;
CREATE INDEX idx_sysacc_user_inst_del ON eduall_system_accounts (ed_system_account_userid, ed_system_account_institute_code, ed_system_account_deleted);
-- verificar antes: SHOW INDEX FROM eduall_employees;
CREATE INDEX idx_emp_inst_del ON eduall_employees (ed_employee_institute_code, ed_employee_deleted);
-- eduall_quarterly_note_restrictions já tem UNIQUE (institute_code, employee_id): não precisa de mais índices.
-- validar:
EXPLAIN SELECT ed_system_account_employee FROM eduall_system_accounts WHERE ed_system_account_userid = 1 AND ed_system_account_institute_code = 'XXX' AND ed_system_account_deleted = 0;

-- ==========================================================================
-- NotifyController.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_notifications;
CREATE INDEX idx_notif_inst_rcpt_id ON eduall_notifications (institute_code, recipient_user_id, id);
-- verificar antes: SHOW INDEX FROM eduall_user_accounts;
CREATE INDEX idx_useracc_inst_notif ON eduall_user_accounts (ed_user_account_institute_code, ed_user_account_allow_notification);
-- verificar antes: SHOW INDEX FROM eduall_auditory;
CREATE INDEX idx_audit_inst_date ON eduall_auditory (ed_auditory_institute_code, ed_auditory_registerDate);
-- verificar antes: SHOW INDEX FROM eduall_auditory;
CREATE INDEX idx_audit_inst_action_date ON eduall_auditory (ed_auditory_institute_code, ed_auditory_action, ed_auditory_registerDate);
-- A tabela de notificações já tem INDEX (institute_code, recipient_user_id, seen); o novo inclui `id` e serve o ORDER BY id DESC da listagem. Se o nome da BD de utilizadores for diferente, verificar eduall_user_accounts. eduall_auditory pode ser grande: criar com ALGORITHM=INPLACE, LOCK=NONE.
-- validar:
EXPLAIN SELECT n.id FROM eduall_notifications n WHERE n.institute_code = 'XXX' AND n.recipient_user_id = 1 ORDER BY n.id DESC LIMIT 26;

-- ==========================================================================
-- PedagogicalEvaluationControllers.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_pedagogical_evaluations;
CREATE INDEX idx_eval_inst_del_data ON eduall_pedagogical_evaluations (ed_eval_institute_code, ed_eval_deleted, ed_eval_data);
-- verificar antes: SHOW INDEX FROM eduall_pedagogical_evaluations;
CREATE INDEX idx_eval_inst_del_prof ON eduall_pedagogical_evaluations (ed_eval_institute_code, ed_eval_deleted, ed_eval_professor_code);
-- verificar antes: SHOW INDEX FROM eduall_pedagogical_evaluations;
CREATE INDEX idx_eval_inst_del_periodo ON eduall_pedagogical_evaluations (ed_eval_institute_code, ed_eval_deleted, ed_eval_periodo);
-- validar:
EXPLAIN SELECT ev.* FROM eduall_pedagogical_evaluations ev WHERE ev.ed_eval_deleted = 0 AND ev.ed_eval_institute_code = 'XXX' ORDER BY ev.ed_eval_data DESC;

-- ==========================================================================
-- PrincipalPortal.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_principal_goals;
CREATE INDEX idx_pgoals_inst_del_deadline ON eduall_principal_goals (ed_principal_goal_institute_code, ed_principal_goal_deleted, ed_principal_goal_deadline);
-- verificar antes: SHOW INDEX FROM eduall_principal_approvals;
CREATE INDEX idx_papprovals_inst_status_created ON eduall_principal_approvals (ed_principal_approval_institute_code, ed_principal_approval_status, ed_principal_approval_created_at);
-- verificar antes: SHOW INDEX FROM eduall_principal_announcements;
CREATE INDEX idx_pannounce_inst_created ON eduall_principal_announcements (ed_principal_announcement_institute_code, ed_principal_announcement_created_at);
-- verificar antes: SHOW INDEX FROM eduall_principal_agenda;
CREATE INDEX idx_pagenda_inst_date ON eduall_principal_agenda (ed_principal_agenda_institute_code, ed_principal_agenda_date);
-- verificar antes: SHOW INDEX FROM eduall_declarations;
CREATE INDEX idx_decl_inst_del ON eduall_declarations (ed_declaration_institute_code, ed_declaration_deleted);
-- As tabelas eduall_principal_* são criadas pelo próprio controller: aplicar estes índices só depois de a aplicação as ter criado.
-- validar:
EXPLAIN SELECT * FROM eduall_principal_approvals WHERE ed_principal_approval_institute_code = 'XXX' AND ed_principal_approval_status = 'Pendente' ORDER BY ed_principal_approval_created_at DESC;

-- ==========================================================================
-- Pages.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_pages;
CREATE INDEX idx_pages_code_del ON eduall_pages (ed_page_code, ed_page_deleted);
-- Se ed_page_code já for UNIQUE este índice é redundante (verificar com SHOW INDEX).
-- validar:
EXPLAIN SELECT * FROM eduall_pages WHERE ed_page_deleted = 0 AND ed_page_code = 'X';

-- ==========================================================================
-- Posts.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_posts;
CREATE INDEX idx_posts_user_del ON eduall_posts (ed_post_user, ed_post_deleted);
-- verificar antes: SHOW INDEX FROM eduall_posts;
CREATE INDEX idx_posts_code ON eduall_posts (ed_post_code);
-- verificar antes: SHOW INDEX FROM eduall_files;
CREATE INDEX idx_files_code ON eduall_files (ed_file_code);
-- verificar antes: SHOW INDEX FROM eduall_user_contacts;
CREATE INDEX idx_ucontacts_user ON eduall_user_contacts (ed_user_contact_userCode);
-- verificar antes: SHOW INDEX FROM eduall_posts_likes;
CREATE INDEX idx_plikes_post ON eduall_posts_likes (ed_post_like_postCode);
-- verificar antes: SHOW INDEX FROM eduall_post_comments;
CREATE INDEX idx_pcomments_post_del ON eduall_post_comments (ed_post_comment_postCode, ed_post_comment_deleted);
-- verificar antes: SHOW INDEX FROM eduall_posts_shares;
CREATE INDEX idx_pshares_post_del ON eduall_posts_shares (ed_post_share_postCode, ed_post_share_deleted);
-- Estes índices só ajudam depois de corrigir Posts.js (ver TODOs): hoje o código tem erros que impedem o uso normal.
-- validar:
EXPLAIN SELECT * FROM eduall_posts WHERE ed_post_user = 1 AND ed_post_deleted = 0;

-- ==========================================================================
-- ProfilePageViews.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_profile_page_views;
CREATE INDEX idx_ppviews_type_code ON eduall_profile_page_views (ed_pp_vw_type, ed_pp_vw_code);
-- Tabela só de escrita: o índice acelera contagens de visitas, mas custa em cada INSERT. Só criar se houver leituras por página.
-- validar:
EXPLAIN SELECT COUNT(*) FROM eduall_profile_page_views WHERE ed_pp_vw_type = 'X' AND ed_pp_vw_code = 1;

