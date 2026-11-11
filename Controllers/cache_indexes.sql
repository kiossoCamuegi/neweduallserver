-- cache_indexes.sql  (gerado por apply_cache_optimizations.py — CACHE-OPT v1)
-- NÃO é executado pelo script. Rever, testar em staging e só depois aplicar em produção.
-- Em tabelas grandes usar:  ALTER TABLE <t> ADD INDEX ..., ALGORITHM=INPLACE, LOCK=NONE;
-- MySQL não tem CREATE INDEX IF NOT EXISTS: verificar antes com SHOW INDEX FROM <tabela>;

-- ==========================================================================
-- AcademicLevel.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_academic_level;
CREATE INDEX idx_level_inst ON eduall_academic_level (ed_academic_level_institute_code, ed_academic_level_deleted);
-- verificar antes: SHOW INDEX FROM eduall_class;
CREATE INDEX idx_class_inst_level ON eduall_class (ed_class_institute_code, ed_class_deleted, ed_class_academic_level);
-- verificar antes: SHOW INDEX FROM eduall_students;
CREATE INDEX idx_students_inst_class ON eduall_students (ed_student_institute_code, ed_student_deleted, ed_student_class);
-- Nota: as verificações de nome duplicado usam LOWER(REPLACE(...)) sobre a coluna, que não usa índice; o prefixo (instituto, deleted) já reduz as linhas lidas.
-- validar:
EXPLAIN SELECT * FROM eduall_academic_level WHERE ed_academic_level_deleted = 0 AND ed_academic_level_institute_code = 'XXX';
EXPLAIN SELECT COUNT(*) FROM eduall_class WHERE ed_class_academic_level = 1 AND ed_class_institute_code = 'XXX' AND ed_class_deleted = 0;
EXPLAIN SELECT c.ed_class_academic_level, s.ed_student_gender, COUNT(*) FROM eduall_students s JOIN eduall_class c ON s.ed_student_class = c.ed_class_id WHERE s.ed_student_deleted = 0 AND c.ed_class_deleted = 0 AND s.ed_student_institute_code = 'XXX' GROUP BY c.ed_class_academic_level, s.ed_student_gender;

-- ==========================================================================
-- AcademicYear.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_academic_year;
CREATE INDEX idx_year_inst_title ON eduall_academic_year (ed_academic_year_institute_code, ed_academic_year_deleted, ed_academic_year_title);
-- verificar antes: SHOW INDEX FROM eduall_class;
CREATE INDEX idx_class_inst_year ON eduall_class (ed_class_institute_code, ed_class_deleted, ed_class_year);
-- validar:
EXPLAIN SELECT * FROM eduall_academic_year WHERE ed_academic_year_deleted = 0 AND ed_academic_year_institute_code = 'XXX' ORDER BY ed_academic_year_title ASC;
EXPLAIN SELECT COUNT(*) FROM eduall_class WHERE ed_class_year = 1 AND ed_class_institute_code = 'XXX' AND ed_class_deleted = 0;

-- ==========================================================================
-- Accounts_payable_and_receivable.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_accounts_payable_and_receivable;
CREATE INDEX idx_apr_inst ON eduall_accounts_payable_and_receivable (ed_accounts_payable_and_receivable_institute_code, ed_accounts_payable_and_receivable_deleted);
-- verificar antes: SHOW INDEX FROM eduall_coins;
CREATE INDEX idx_coins_inst_del ON eduall_coins (ed_coin_institute_code, ed_coin_deleted);
-- Sem cache (dados financeiros): o índice é a otimização principal.
-- validar:
EXPLAIN SELECT * FROM eduall_accounts_payable_and_receivable LEFT JOIN eduall_coins ON eduall_coins.ed_coin_institute_code = ed_accounts_payable_and_receivable_institute_code WHERE ed_accounts_payable_and_receivable_deleted = 0 AND ed_accounts_payable_and_receivable_institute_code = 'XXX';

-- ==========================================================================
-- BooksCategory.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_categories;
CREATE INDEX idx_libcat_inst_title ON eduall_library_categories (ed_library_category_institute_code, ed_library_category_deleted, ed_library_category_title);
-- validar:
EXPLAIN SELECT * FROM eduall_library_categories WHERE ed_library_category_deleted = 0 AND ed_library_category_institute_code = 'XXX' ORDER BY ed_library_category_title ASC;

-- ==========================================================================
-- BooksCollection.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_collections;
CREATE INDEX idx_libcol_inst_title ON eduall_library_collections (ed_library_collection_institute_code, ed_library_collection_deleted, ed_library_collection_title);
-- validar:
EXPLAIN SELECT * FROM eduall_library_collections WHERE ed_library_collection_deleted = 0 AND ed_library_collection_institute_code = 'XXX' ORDER BY ed_library_collection_title ASC;

-- ==========================================================================
-- CalendarEvents.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_calendar_events;
CREATE INDEX idx_calev_inst_title ON eduall_calendar_events (ed_calendar_event_institute_code, ed_calendar_event_deleted, ed_calendar_event_title);
-- validar:
EXPLAIN SELECT * FROM eduall_calendar_events WHERE ed_calendar_event_deleted = 0 AND ed_calendar_event_institute_code = 'XXX' ORDER BY ed_calendar_event_title ASC;

-- ==========================================================================
-- Cicles.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_cicles;
CREATE INDEX idx_cicle_inst_title ON eduall_cicles (ed_cicle_institute_code, ed_cicle_deleted, ed_cicle_title);
-- verificar antes: SHOW INDEX FROM eduall_class;
CREATE INDEX idx_class_inst_cicle ON eduall_class (ed_class_institute_code, ed_class_deleted, ed_class_cicle);
-- idx_class_inst_cicle acelera a verificação 'existem turmas neste ciclo?' no CicleDelete.
-- validar:
EXPLAIN SELECT * FROM eduall_cicles WHERE ed_cicle_deleted = 0 AND ed_cicle_institute_code = 'XXX' ORDER BY ed_cicle_title ASC;
EXPLAIN SELECT COUNT(*) FROM eduall_class WHERE ed_class_cicle = 1 AND ed_class_institute_code = 'XXX' AND ed_class_deleted = 0;

-- ==========================================================================
-- Coins.js
-- ==========================================================================
-- (já definido acima: idx_coins_inst_del em eduall_coins)
-- validar:
EXPLAIN SELECT * FROM eduall_coins WHERE ed_coin_deleted = 0 AND ed_coin_institute_code = 'XXX';

-- ==========================================================================
-- ClassRoom.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_classrooms;
CREATE INDEX idx_classroom_inst_title ON eduall_classrooms (ed_classroom_institute_code, ed_classroom_deleted, ed_classroom_title);
-- validar:
EXPLAIN SELECT * FROM eduall_classrooms WHERE ed_classroom_deleted = 0 AND ed_classroom_institute_code = 'XXX' ORDER BY ed_classroom_title ASC;

-- ==========================================================================
-- Class.js
-- ==========================================================================
-- Sem índices novos: o prefixo (ed_class_institute_code, ed_class_deleted, ...) dos índices de eduall_class acima já cobre estas queries, e ed_class_id é chave primária. Se o EXPLAIN mostrar type=ALL, rever as colunas de ORDER BY de FetchAllClasses (linha ~130 de Class.js).
-- validar:
EXPLAIN SELECT * FROM eduall_class WHERE ed_class_deleted = 0 AND ed_class_institute_code = 'XXX';
EXPLAIN SELECT * FROM eduall_class WHERE ed_class_deleted = 0 AND ed_class_id = 1 AND ed_class_institute_code = 'XXX';

-- ==========================================================================
-- Authors.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_authors;
CREATE INDEX idx_libauthor_inst_name ON eduall_library_authors (ed_library_author_institute_code, ed_library_author_deleted, ed_library_author_name);
-- validar:
EXPLAIN SELECT * FROM eduall_library_authors WHERE ed_library_author_deleted = 0 AND ed_library_author_institute_code = 'XXX' ORDER BY ed_library_author_name ASC;

-- ==========================================================================
-- Books.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_books;
CREATE INDEX idx_libbook_inst ON eduall_library_books (ed_library_book_institute_code, ed_library_book_deleted);
-- A ordenação (rack, order, title) faz filesort; um índice com title pode exceder o limite de tamanho de chave — só adicionar se o EXPLAIN mostrar custo real.
-- validar:
EXPLAIN SELECT * FROM eduall_library_books WHERE ed_library_book_deleted = 0 AND ed_library_book_institute_code = 'XXX' ORDER BY ed_library_book_rack ASC, ed_library_book_order ASC, ed_library_book_title ASC;

-- ==========================================================================
-- BookCopies.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_exemplares;
CREATE INDEX idx_exemplar_inst_code ON eduall_library_exemplares (ed_exemplar_institute_code, ed_exemplar_deleted, ed_exemplar_code);
-- verificar antes: SHOW INDEX FROM eduall_library_exemplares;
CREATE INDEX idx_exemplar_book ON eduall_library_exemplares (ed_exemplar_book_id, ed_exemplar_deleted);
-- A leitura por código de barras/QR/RFID (GetExemplarByScan) não foi analisada: se filtrar por outra coluna de código, indexá-la também (idealmente UNIQUE por instituto).
-- validar:
EXPLAIN SELECT * FROM eduall_library_exemplares ex LEFT JOIN eduall_library_books b ON b.ed_library_book_id = ex.ed_exemplar_book_id WHERE ex.ed_exemplar_deleted = 0 AND ex.ed_exemplar_institute_code = 'XXX' ORDER BY ex.ed_exemplar_code ASC;
EXPLAIN SELECT * FROM eduall_library_exemplares ex WHERE ex.ed_exemplar_deleted = 0 AND ex.ed_exemplar_book_id = 1 AND ex.ed_exemplar_institute_code = 'XXX';

-- ==========================================================================
-- BooksDigitalContent.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_digital_contents;
CREATE INDEX idx_digcontent_inst_title ON eduall_library_digital_contents (ed_digital_content_institute_code, ed_digital_content_deleted, ed_digital_content_title);
-- verificar antes: SHOW INDEX FROM eduall_library_digital_contents;
CREATE INDEX idx_digcontent_author ON eduall_library_digital_contents (ed_digital_content_author);
-- validar:
EXPLAIN SELECT dc.*, a.ed_library_author_name FROM eduall_library_digital_contents dc LEFT JOIN eduall_library_authors a ON a.ed_library_author_id = dc.ed_digital_content_author WHERE dc.ed_digital_content_deleted = 0 AND dc.ed_digital_content_institute_code = 'XXX' ORDER BY dc.ed_digital_content_title ASC;

-- ==========================================================================
-- BorrowedBooks.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_library_borrowed_books;
CREATE INDEX idx_borrowed_inst ON eduall_library_borrowed_books (ed_library_borrowed_book_institute_code, ed_library_borrowed_book_deleted);
-- verificar antes: SHOW INDEX FROM eduall_library_borrowed_books;
CREATE INDEX idx_borrowed_user ON eduall_library_borrowed_books (ed_library_borrowed_book_usercode);
-- O código dos livros emprestados está numa coluna CSV (ed_library_borrowed_book_code): não é indexável nem consultável por livro — considerar uma tabela de itens.
-- validar:
EXPLAIN SELECT * FROM eduall_library_borrowed_books LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_library_borrowed_books.ed_library_borrowed_book_usercode WHERE ed_library_borrowed_book_deleted = 0 AND ed_library_borrowed_book_institute_code = 'XXX';

-- ==========================================================================
-- BulletinHistoryController.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_bulletin_history;
CREATE INDEX idx_bh_inst_updated ON eduall_bulletin_history (ed_bh_institute_code, ed_bh_deleted, ed_bh_updated_at);
-- validar:
EXPLAIN SELECT ed_bh_id FROM eduall_bulletin_history WHERE ed_bh_deleted = 0 AND ed_bh_institute_code = 'XXX' ORDER BY ed_bh_updated_at DESC;

-- ==========================================================================
-- Cards_server.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_card_templates;
CREATE INDEX idx_cardtpl_inst ON eduall_card_templates (institute_code, deleted);
-- O código também tenta criar idx_cardtpl_inst (sintaxe MariaDB). Se o índice já existir, ignorar este. A listagem de alunos (/api/students-for-cards) usa o prefixo de idx_students_inst_class.
-- validar:
EXPLAIN SELECT id, title FROM eduall_card_templates WHERE deleted = 0 AND institute_code = 'XXX' ORDER BY updated_at DESC;

-- ==========================================================================
-- Auditory.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_auditory;
CREATE INDEX idx_auditory_inst ON eduall_auditory (ed_auditory_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_auditory;
CREATE INDEX idx_auditory_user ON eduall_auditory (ed_auditory_user_code);
-- Em InnoDB o índice secundário já inclui a chave primária, por isso (institute_code) serve o ORDER BY ed_auditory_id DESC. eduall_notifications (institute_code, recipient_user_id, seen) — verificar com SHOW INDEX se o Auditory.js já a indexa.
-- validar:
EXPLAIN SELECT * FROM eduall_auditory a WHERE a.ed_auditory_institute_code = 'XXX' ORDER BY a.ed_auditory_id DESC LIMIT 50;

-- ==========================================================================
-- ChatMessages.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_chat_messages;
CREATE INDEX idx_chat_from_to ON eduall_chat_messages (ed_chat_message_from, ed_chat_message_to);
-- verificar antes: SHOW INDEX FROM eduall_chat_messages;
CREATE INDEX idx_chat_to_from ON eduall_chat_messages (ed_chat_message_to, ed_chat_message_from);
-- A query usa OR entre dois pares: o MySQL combina os dois índices (index_merge).
-- validar:
EXPLAIN SELECT * FROM eduall_chat_messages WHERE (ed_chat_message_from = 1 AND ed_chat_message_to = 2) OR (ed_chat_message_from = 2 AND ed_chat_message_to = 1);

-- ==========================================================================
-- Comments.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_comments;
CREATE INDEX idx_comments_content ON eduall_comments (ed_comment_contentID, ed_comment_contentType);
-- verificar antes: SHOW INDEX FROM eduall_comments_replies;
CREATE INDEX idx_replies_comment ON eduall_comments_replies (ed_comment_replie_commentID);
-- verificar antes: SHOW INDEX FROM eduall_comments_subreplies;
CREATE INDEX idx_subreplies_replie ON eduall_comments_subreplies (ed_comment_subreplie_replieID);
-- verificar antes: SHOW INDEX FROM eduall_comment_reactions;
CREATE INDEX idx_reactions_content ON eduall_comment_reactions (ed_comment_reaction_contentID, ed_comment_reaction_contentType);
-- validar:
EXPLAIN SELECT * FROM eduall_comments WHERE ed_comment_contentID = 1 AND ed_comment_contentType = 'x';

-- ==========================================================================
-- ContactMessages.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_contacts_messages;
CREATE INDEX idx_contactmsg_for_inst ON eduall_contacts_messages (ed_contact_message_for, ed_contact_message_instituteCode);
-- validar:
EXPLAIN SELECT * FROM eduall_contacts_messages WHERE ed_contact_message_for = 'x@y.z' AND ed_contact_message_instituteCode = 'XXX';

-- ==========================================================================
-- AppManager.js
-- ==========================================================================
-- Sem índices propostos: as tabelas (eduall_library_access, eduall_user_access, eduall_institute_apps) têm colunas que não foram analisadas — enviar o schema ou os EXPLAIN para gerar índices exatos.

-- ==========================================================================
-- BootServer.js
-- ==========================================================================
-- Sem índices propostos: sem queries SQL próprias relevantes nesta análise.

-- ==========================================================================
-- Contacts.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_contacts;
CREATE INDEX idx_contacts_inst_name ON eduall_contacts (ed_contact_instituteCode, ed_contact_deleted, ed_contact_name);
-- validar:
EXPLAIN SELECT * FROM eduall_contacts WHERE ed_contact_deleted = 0 AND ed_contact_instituteCode = 'XXX' ORDER BY ed_contact_name ASC;

-- ==========================================================================
-- Courses.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_courses;
CREATE INDEX idx_course_inst_title ON eduall_courses (ed_course_institute_code, ed_course_deleted, ed_course_title);
-- verificar antes: SHOW INDEX FROM eduall_class;
CREATE INDEX idx_class_inst_course ON eduall_class (ed_class_institute_code, ed_class_deleted, ed_class_course);
-- idx_class_inst_course acelera a verificação 'existem turmas neste curso?' no CourseDelete.
-- validar:
EXPLAIN SELECT * FROM eduall_courses WHERE ed_course_deleted = 0 AND ed_course_institute_code = 'XXX' ORDER BY ed_course_title ASC;
EXPLAIN SELECT COUNT(*) FROM eduall_class WHERE ed_class_course = 1 AND ed_class_institute_code = 'XXX' AND ed_class_deleted = 0;

-- ==========================================================================
-- ContinuousAvaliation.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_continuous_avaliations;
CREATE INDEX idx_cnavl_inst ON eduall_continuous_avaliations (ed_cn_avl_instituteCode, ed_cn_avl_deleted);
-- verificar antes: SHOW INDEX FROM eduall_continuous_avaliations;
CREATE INDEX idx_cnavl_subclass ON eduall_continuous_avaliations (ed_cn_avl_subClass, ed_cn_avl_deleted, ed_cn_avl_instituteCode);
-- verificar antes: SHOW INDEX FROM eduall_continuous_avaliations;
CREATE INDEX idx_cnavl_student ON eduall_continuous_avaliations (ed_cn_avl_studentCode);
-- GetPointsBySubClass deixou de ser cacheado: idx_cnavl_subclass é a otimização principal.
-- validar:
EXPLAIN SELECT * FROM eduall_continuous_avaliations LEFT JOIN eduall_students ON ed_student_id = ed_cn_avl_studentCode WHERE ed_cn_avl_deleted = 0 AND ed_cn_avl_subClass = 1 AND ed_cn_avl_instituteCode = 'XXX' AND ed_student_deleted = 0;

-- ==========================================================================
-- DebugFeedback.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_debug_feedbacks;
CREATE INDEX idx_dbgfb_inst_created ON eduall_debug_feedbacks (ed_debug_feedback_institute_code, ed_debug_feedback_deleted, ed_debug_feedback_created_at);
-- verificar antes: SHOW INDEX FROM eduall_debug_feedback_files;
CREATE INDEX idx_dbgfbfile_feedback ON eduall_debug_feedback_files (ed_debug_feedback_file_feedback_id);
-- validar:
EXPLAIN SELECT f.ed_debug_feedback_id FROM eduall_debug_feedbacks f LEFT JOIN eduall_debug_feedback_files ff ON f.ed_debug_feedback_id = ff.ed_debug_feedback_file_feedback_id WHERE f.ed_debug_feedback_deleted = 0 AND f.ed_debug_feedback_institute_code = 'XXX' GROUP BY f.ed_debug_feedback_id ORDER BY f.ed_debug_feedback_created_at DESC;

-- ==========================================================================
-- Declaration.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_declarations;
CREATE INDEX idx_decl_inst ON eduall_declarations (ed_declaration_institute_code, ed_declaration_deleted);
-- verificar antes: SHOW INDEX FROM eduall_declarations;
CREATE INDEX idx_decl_student ON eduall_declarations (ed_declaration_student_code);
-- validar:
EXPLAIN SELECT d.*, s.ed_student_name FROM eduall_declarations d LEFT JOIN eduall_students s ON s.ed_student_id = d.ed_declaration_student_code WHERE d.ed_declaration_deleted = 0 AND d.ed_declaration_institute_code = 'XXX' ORDER BY s.ed_student_name ASC;

-- ==========================================================================
-- DeclarationRequests.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_declaration_requests;
CREATE INDEX idx_declreq_inst ON eduall_declaration_requests (ed_declaration_request_institute_code, ed_declaration_request_deleted);
-- verificar antes: SHOW INDEX FROM eduall_declaration_requests;
CREATE INDEX idx_declreq_student ON eduall_declaration_requests (ed_declaration_request_student_code);
-- validar:
EXPLAIN SELECT dr.*, s.ed_student_name FROM eduall_declaration_requests dr LEFT JOIN eduall_students s ON s.ed_student_id = dr.ed_declaration_request_student_code WHERE dr.ed_declaration_request_deleted = 0 AND dr.ed_declaration_request_institute_code = 'XXX' ORDER BY s.ed_student_name ASC;

-- ==========================================================================
-- Employees.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_employees;
CREATE INDEX idx_emp_inst_name ON eduall_employees (ed_employee_institute_code, ed_employee_deleted, ed_employee_name);
-- verificar antes: SHOW INDEX FROM eduall_employees;
CREATE INDEX idx_emp_inst_code ON eduall_employees (ed_employee_institute_code, ed_employee_code);
-- verificar antes: SHOW INDEX FROM eduall_employees;
CREATE INDEX idx_emp_charge ON eduall_employees (ed_employee_charge, ed_employee_deleted);
-- verificar antes: SHOW INDEX FROM eduall_user_accounts;
CREATE INDEX idx_useracc_email ON eduall_user_accounts (ed_user_account_email);
-- verificar antes: SHOW INDEX FROM eduall_user_institutes;
CREATE INDEX idx_userinst_user_inst ON eduall_user_institutes (ed_user_institute_userCode, ed_user_institute_code, ed_user_institute_deleted);
-- verificar antes: SHOW INDEX FROM eduall_institutes_licences;
CREATE INDEX idx_lic_inst ON eduall_institutes_licences (ed_institute_licence_instituteCode);
-- eduall_user_accounts / eduall_user_institutes / eduall_institutes_licences são tabelas partilhadas e provavelmente já têm estes índices (ex.: UNIQUE no email): verificar com SHOW INDEX antes de criar.
-- validar:
EXPLAIN SELECT e.*, (SELECT u.ed_user_account_email FROM eduall_user_accounts u WHERE u.ed_user_account_email = e.ed_employee_email LIMIT 1) AS ed_user_account_email FROM eduall_employees e WHERE e.ed_employee_deleted = 0 AND e.ed_employee_institute_code = 'XXX' ORDER BY e.ed_employee_name ASC;

-- ==========================================================================
-- EmployeeAttendence.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_employee_attendence;
CREATE INDEX idx_empattd_inst_date ON eduall_employee_attendence (ed_employee_attd_institute_code, ed_employee_attd_deleted, ed_employee_attd_date);
-- verificar antes: SHOW INDEX FROM eduall_employee_attendence;
CREATE INDEX idx_empattd_code ON eduall_employee_attendence (ed_employee_attd_code, ed_employee_attd_institute_code);
-- O relatório de efetividade e os departamentos não foram analisados: enviar os EXPLAIN para índices exatos.
-- validar:
EXPLAIN SELECT ea.*, emp.ed_employee_name FROM eduall_employee_attendence ea LEFT JOIN eduall_employees emp ON ea.ed_employee_attd_code = emp.ed_employee_id AND emp.ed_employee_deleted = 0 WHERE ea.ed_employee_attd_deleted = 0 AND ea.ed_employee_attd_institute_code = 'XXX' ORDER BY ea.ed_employee_attd_date DESC;

-- ==========================================================================
-- CurriculomPlan.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_curriculum_chapters;
CREATE INDEX idx_currchap_inst_class_subj ON eduall_curriculum_chapters (institute_code, class_id, subject_id, deleted);
-- verificar antes: SHOW INDEX FROM eduall_curriculum_subchapters;
CREATE INDEX idx_currsub_chapter ON eduall_curriculum_subchapters (chapter_id, deleted);
-- verificar antes: SHOW INDEX FROM eduall_curriculum_lessons;
CREATE INDEX idx_currlesson_chapter ON eduall_curriculum_lessons (chapter_id, subchapter_id, deleted);
-- Sem cache (ver CACHE_REPORT): o plano completo faz 2 LEFT JOIN com OR; os índices acima são a otimização principal. Para o OR do JOIN com lições, se o EXPLAIN mostrar type=ALL, considerar índice em eduall_curriculum_lessons(subchapter_id, deleted).
-- validar:
EXPLAIN SELECT * FROM eduall_curriculum_chapters WHERE deleted = 0 AND class_id = 1 AND subject_id = 1 AND institute_code = 'XXX' ORDER BY order_index ASC;
EXPLAIN SELECT c.id, s.id, l.id FROM eduall_curriculum_chapters c LEFT JOIN eduall_curriculum_subchapters s ON s.chapter_id = c.id AND s.deleted = 0 LEFT JOIN eduall_curriculum_lessons l ON l.deleted = 0 AND ((l.chapter_id = c.id AND l.subchapter_id IS NULL) OR (l.subchapter_id = s.id)) WHERE c.class_id = 1 AND c.subject_id = 1 AND c.deleted = 0 AND c.institute_code = 'XXX';

-- ==========================================================================
-- EduallLessons.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_tutorial_lessons;
CREATE INDEX idx_tutlesson_del_date ON eduall_tutorial_lessons (deleted, ed_video_added_date);
-- Tabela pequena e global: o índice é opcional.
-- validar:
EXPLAIN SELECT * FROM eduall_tutorial_lessons WHERE deleted = 0 ORDER BY ed_video_added_date DESC;

-- ==========================================================================
-- Enrollments.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_enrollment;
CREATE INDEX idx_enroll_inst_del ON eduall_enrollment (ed_enrollment_institute_code, ed_enrollment_deleted);
-- verificar antes: SHOW INDEX FROM eduall_enrollment;
CREATE INDEX idx_enroll_student ON eduall_enrollment (ed_enrollment_student, ed_enrollment_institute_code);
-- Sem cache: os JOIN a eduall_students/eduall_class/... usam chaves primárias; o índice por instituto é o que mais importa.
-- validar:
EXPLAIN SELECT e.ed_enrollment_id FROM eduall_enrollment e LEFT JOIN eduall_students s ON e.ed_enrollment_student = s.ed_student_id AND s.ed_student_deleted = 0 WHERE e.ed_enrollment_deleted = 0 AND e.ed_enrollment_institute_code = 'XXX' ORDER BY s.ed_student_name ASC;

-- ==========================================================================
-- EnrollmentConfirmation.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_enrollment_confirmations;
CREATE INDEX idx_enrconf_inst_del ON eduall_enrollment_confirmations (ed_enrollment_confirmation_institute_code, ed_enrollment_confirmation_deleted);
-- verificar antes: SHOW INDEX FROM eduall_enrollment_confirmations;
CREATE INDEX idx_enrconf_code ON eduall_enrollment_confirmations (ed_enrollment_confirmation_code, ed_enrollment_confirmation_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_enrollment_confirmations;
CREATE INDEX idx_enrconf_student ON eduall_enrollment_confirmations (ed_enrollment_confirmation_student);
-- Sem cache (financeiro). Se existir uma tabela de documentos de confirmação, indexar a coluna do ID da confirmação.
-- validar:
EXPLAIN SELECT * FROM eduall_enrollment_confirmations WHERE ed_enrollment_confirmation_code = 'X' AND ed_enrollment_confirmation_institute_code = 'XXX' AND ed_enrollment_confirmation_deleted = 0;

-- ==========================================================================
-- DocumentsCenter.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_document_access;
CREATE INDEX idx_docaccess_doc_inst ON eduall_document_access (ed_doc_access_document, ed_doc_access_institute_code);
-- verificar antes: SHOW INDEX FROM eduall_document_access;
CREATE INDEX idx_docaccess_user ON eduall_document_access (ed_doc_access_user);
-- verificar antes: SHOW INDEX FROM eduall_document_center;
CREATE INDEX idx_doc_del_date ON eduall_document_center (ed_doc_deleted, ed_doc_recordDate);
-- verificar antes: SHOW INDEX FROM eduall_document_center;
CREATE INDEX idx_doc_externalcode ON eduall_document_center (ed_doc_externalCode);
-- A coluna ed_doc_htmlCode/htmlText guarda HTML inteiro (até 2 MB): `SELECT DISTINCT d.*` obriga a comparar/duplicar esses blobs — listar só as colunas necessárias (sem htmlCode/htmlText) e DISTINCT sobre o ID é a maior otimização aqui (não alterado).
-- validar:
EXPLAIN SELECT DISTINCT d.* FROM eduall_document_center d LEFT JOIN eduall_document_access a ON a.ed_doc_access_document = d.ed_doc_id AND a.ed_doc_access_institute_code = 'XXX' WHERE d.ed_doc_deleted = 0 AND (a.ed_doc_access_public = 1 OR a.ed_doc_access_user = 1) ORDER BY d.ed_doc_recordDate DESC;

-- ==========================================================================
-- DocumentCenterGenerate.js
-- ==========================================================================
-- Sem índices propostos: enviar os EXPLAIN dos loaders (loadStudents, loadQuarterly, loadExams, loadAbsences).

-- ==========================================================================
-- CountriesAndStates.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_country_states;
CREATE INDEX idx_states_country ON eduall_country_states (ed_country_state_countryCode);
-- Dados estáticos: candidato ideal a cache global (chave por país, TTL longo) assim que o controller usar ExecuteQuery + eduallWithCache.
-- validar:
EXPLAIN SELECT * FROM eduall_country_states WHERE ed_country_state_countryCode = 'AO';

-- ==========================================================================
-- DeviceRegister.js
-- ==========================================================================
-- Sem índices: não acede à BD.

-- ==========================================================================
-- EduallLatestNews.js
-- ==========================================================================
-- verificar antes: SHOW INDEX FROM eduall_news_videos;
CREATE INDEX idx_news_del_created ON eduall_news_videos (ed_news_deleted, ed_news_created_at);
-- O JOIN a eduall_news_views já é coberto pelo UNIQUE KEY (ed_view_user_id, ed_view_news_id) criado pelo próprio controller.
-- validar:
EXPLAIN SELECT nv.*, COALESCE(v.ed_view_seen, 0) AS seen FROM eduall_news_videos nv LEFT JOIN eduall_news_views v ON v.ed_view_news_id = nv.ed_news_id AND v.ed_view_user_id = 1 WHERE nv.ed_news_deleted = 0 ORDER BY nv.ed_news_created_at DESC;

