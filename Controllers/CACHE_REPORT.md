# CACHE_REPORT — CACHE-OPT v1

Gerado por `apply_cache_optimizations.py`. Nenhum SQL foi executado.

## 1. Estado por ficheiro

| Ficheiro | Estado | Detalhe |
|---|---|---|
| `../Functions/CacheKeys.js` | alterado | ficheiro atualizado (versão anterior, sem as novas chaves): chaves de cache centralizadas + parseId + safeInvalidate (REV 3: + contact, point, course, feedback, declaration, declarationRequest, employee, employeeAttendance, lesson) |
| `Contacts.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetContacts) → eduallWithCache (TTL 3600s); GET individual/por-chave (GetSingleContact): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.contact.list (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras |
| `ContinuousAvaliation.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetPoints) → eduallWithCache (TTL 300s); GET individual/por-chave (GetPointsBySubClass, GetSinglePoint): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.point.list (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras; TTL da lista de avaliações reduzido de 3600s para 300s; GetPointsBySubClass deixa de ser cacheado (PointUpdate/PointDelete não conhecem a subClass para invalidar a chave exata) |
| `Courses.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetCourse) → eduallWithCache (TTL 3600s); GET individual/por-chave (GetsingleCourse): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.course.list, CacheKeys.schoolClass.list, CacheKeys.schoolClass.exams (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras |
| `CurriculomPlan.js` | alterado | cache REMOVIDA: as escritas (capítulos/subcapítulos/aulas) só conhecem o ID do registo e não a turma/disciplina, por isso não há como calcular as chaves exatas a invalidar; o `eduallClear('curriculum:*')` anterior apagava a cache de TODAS as escolas; GETs (GetChapters, GetClassAndSubjectCurricularPlan) passam a ler diretamente da BD (mesmo formato de resposta); removidos require do CacheRoutes, CacheKeys local, TTL e RefreshCurriculumCache (9 chamadas nas escritas) |
| `DebugFeedback.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetFeedbacks) → eduallWithCache (TTL 600s); GET individual/por-chave (GetSingleFeedback): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.feedback.list (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras; TTL da lista de feedbacks reduzido de 3600s para 600s |
| `Declaration.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetDeclarations) → eduallWithCache (TTL 600s); GET individual/por-chave (GetSingleDeclaration): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.declaration.list (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras; TTL da lista de declarações reduzido de 3600s para 600s (JOIN com alunos) |
| `DeclarationRequests.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetDeclarationRequests) → eduallWithCache (TTL 600s); GET individual/por-chave (GetSingleDeclarationRequest): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.declarationRequest.list (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras; TTL da lista de solicitações reduzido de 3600s para 600s (JOIN com alunos) |
| `EduallLatestNews.js` | alterado | EnsureNewsTables passa a correr uma só vez por processo (antes: 2x CREATE TABLE IF NOT EXISTS em todos os pedidos às 4 rotas); GetNewsVideos / GetLatestUnseenNews NÃO são cacheados de propósito (estado «visto» por utilizador) |
| `EduallLessons.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetLessons_ED) → eduallWithCache (TTL 3600s); GET individual/por-chave (GetSingleLesson_ED): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.lesson.list() (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras; EnsureLessonsTable (CREATE TABLE + INFORMATION_SCHEMA) passa a correr uma só vez por processo (antes: em todos os pedidos GET); chave global `lesson:list:global` mantida (aulas-tutorial iguais para todas as escolas) |
| `EmployeeAttendence.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (GetEmployeesAttendance) → eduallWithCache (TTL 300s); GET individual/por-chave (GetEmployeeAttendanceBycode, GetSingleEmployeeAttendance): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.employeeAttendance.list (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras; TTL da lista de presenças reduzido de 3600s para 300s; GetEmployeeAttendanceBycode deixa de ser cacheado (uma chave por funcionário; escritas não a invalidavam por código) |
| `Employees.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); listas (Getemployees) → eduallWithCache (TTL 600s); GET individual/por-chave (GetSingleEmployee, GetEmployeeByJobTitle, GetEmployeeDataByUser): sempre à BD + validação de ID (400) onde há ID numérico; sem cache por ID; Refresh eager removido; escritas só invalidam CacheKeys.employee.list, CacheKeys.employeeAttendance.list (try/catch, após o sucesso); removidos console.log/logs de timing nas leituras; TTL da lista de funcionários reduzido de 3600s para 600s; GetEmployeeByJobTitle e GetEmployeeDataByUser deixam de ser cacheados (ver TODOs) |
| `EnrollmentConfirmation.js` | alterado | cache REMOVIDA: dados de confirmação de matrícula/pagamentos (financeiros) com JOIN a várias tabelas; as chaves colidiam com as de Enrollments.js e `eduallClear('enrollment:*')` apagava a cache de todas as escolas; GETs (GetEnrollmentConfirmations, GetSingleEnrollmentConfirmation, GetSingleEnrolledConfirmation, GetSingleEnrolledConfirmationByCode, GetConfirmationDocs) passam a ler diretamente da BD (mesmo formato de resposta); removidos require do CacheRoutes, CacheKeys local, TTL e RefreshEnrollmentCache (6 chamadas nas escritas) |
| `Enrollments.js` | alterado | cache REMOVIDA: dados de matrículas/serviços/moeda (financeiros) com JOIN a 9 tabelas; as chaves `enrollment:list|single|docs:<escola>` eram IGUAIS às de EnrollmentConfirmation.js (cada controller podia devolver os dados do outro); e `eduallClear('enrollment:*')` apagava a cache de todas as escolas; GETs (GetEnrolledStudents, GetSingleEnrolledStudent, GetSingleEnrolledStudentByCode, GetEnrollmentDocs) passam a ler diretamente da BD (mesmo formato de resposta); removidos require do CacheRoutes, CacheKeys local, TTL e RefreshEnrollmentCache (6 chamadas nas escritas) |
| `AcademicLevel.js` | ignorado | já aplicado, ignorado |
| `AcademicYear.js` | ignorado | já aplicado, ignorado |
| `Accounts_payable_and_receivable.js` | ignorado | já aplicado, ignorado |
| `Ads.js` | ignorado | não usa o módulo de cache nem ExecuteQuery (usa DATABASE diretamente); sem alterações |
| `AppManager.js` | ignorado | já invalida por chave exata (eduallDel por utilizador/instituto) e usa TTL de 30 min para o acesso à biblioteca; sem alterações |
| `Auditory.js` | ignorado | já usa chaves por utilizador e invalidação pontual (eduallDel / padrão com instituteCode+userId) e TTL curto de propósito; sem alterações |
| `Authors.js` | ignorado | já aplicado, ignorado |
| `BookCopies.js` | ignorado | já aplicado, ignorado |
| `Books.js` | ignorado | já aplicado, ignorado |
| `BooksCategory.js` | ignorado | já aplicado, ignorado |
| `BooksCollection.js` | ignorado | já aplicado, ignorado |
| `BooksDigitalContent.js` | ignorado | já aplicado, ignorado |
| `BootServer.js` | ignorado | usa cache em memória própria (previewCache) e não o módulo de cache; sem alterações |
| `BorrowedBooks.js` | ignorado | já aplicado, ignorado |
| `BulletinHistoryController.js` | ignorado | já aplicado, ignorado |
| `CalendarEvents.js` | ignorado | já aplicado, ignorado |
| `Cards_server.js` | ignorado | já aplicado, ignorado |
| `ChatMessages.js` | ignorado | chat em tempo real: não deve ser cacheado; só índices (ver cache_indexes.sql) |
| `Cicles.js` | ignorado | já aplicado, ignorado |
| `Class.js` | ignorado | já aplicado, ignorado |
| `ClassRoom.js` | ignorado | já aplicado, ignorado |
| `Coins.js` | ignorado | já aplicado, ignorado |
| `Comments.js` | ignorado | comentários/reações: não cacheados (mudam a cada interação); só índices (ver cache_indexes.sql) |
| `ContactMessages.js` | ignorado | mensagens de contacto: não cacheadas; só índices (ver cache_indexes.sql) |
| `CountriesAndStates.js` | ignorado | dados estáticos (estados por país) mas usa DATABASERUN próprio que responde diretamente ao cliente: não há âncora segura para cachear; só índice (ver cache_indexes.sql) |
| `DeviceRegister.js` | ignorado | utilitário sem acesso à BD (só deteta dispositivo e escreve na consola); sem alterações |
| `DocumentCenterGenerate.js` | ignorado | geração de documentos/relatórios HTML por pedido (muito dinâmica, sem módulo de cache; os loaders já agrupam por turma); sem alterações |
| `DocumentsCenter.js` | ignorado | o acesso depende do utilizador, de janelas de datas (NOW()) e de bloqueios por documento: não cacheado de propósito; só índices (ver cache_indexes.sql) |
| `0AutomaticReports.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `0IA.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Admission.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `Automation/PaymentsReports.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `ERP_export.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Enrollmenttemplates.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `Faculties.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `Feed.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `FeesPayments.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `Filemanager.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `FilesStorage.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `FinalPautasController.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Fines.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `FinesController.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `FinesRestrictions.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `FinesStudents.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `FormBuilderController.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `GeneralAttendance.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `GetStudentsFullOverview.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `InstituteAccounts.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Institutes.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Invoices.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `JobTitles.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Lessonplancontroller.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `LessonsSectionContent.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `LibraryFines.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `LibraryLoans.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `LibraryReservations.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Manager/MN_ServicelicencePayments.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Manager/MN_customerscomplains.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Manager/MN_salesman_customers.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Manager/MN_salesperson.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Manager/MN_tasks.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `NotesRestrictions.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `NotifyController.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `OldPayments.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Parents.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `ParentsChilds.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `ParentsPickup.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `PedagogicalEvaluationControllers.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `PrincipalPortal.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `ProductCategory.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `ProductSalles.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Products.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Provider.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Publishers.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `QuarterlyNotes.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `RFIDMovements.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Racks.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Recicle.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `Referralcontroller.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `RefreshToken.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Requests.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Saidasdecaixa.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SavedCertificates.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SavedDeclarations.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SavedMaps.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SavedTransferGuide.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SchoolsOfProvenance.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `ScientificPublications.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SeedLibraryBooks.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SemesterNotes.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SendEmail.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SendSms.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `ServicePayments.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Services.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `Shelves.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `SiteManager.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudenBalanceController.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentAttendance.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentBehavior.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentEnrollment.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentExams.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentExamsAndFeaturesNotes.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentExamsCalendar.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentFeaturedNotes.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentGradeHistory.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentOldClasses.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `StudentTransference.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Students.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `Subjects.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TCCD_SubjectContent.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TeacherSubject.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TeacherTimings.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Terminals/Biometricterminalsystem.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Timing.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TitlesAndHeaders.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TransportDriver.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TransportMaintenence.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TransportPassengers.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TransportPayments.js` | ignorado | ignorado: sem receita nesta versão (usa cache + ExecuteQuery) |
| `TransportRoutes.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TransportStops.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TransportVehicles.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `TypeOfBooks.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `UserInstitutes.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `UserStudentAccounts.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Users.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `schoolExpenses.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `syncEngine.js` | ignorado | ignorado: sem receita nesta versão (usa ExecuteQuery) |
| `Functions/CacheRoutes.js` | não aplicado | não aplicado: ficheiro não encontrado em /Users/kiosso/Desktop/Meus Projetos/Eduall software/colegio_universidades/server/Controllers |

## 2. TODOs manuais

- [ ] Contacts.js: `SELECT *` mantido (colunas usadas pelo frontend desconhecidas).
- [ ] Contacts.js: a verificação de email duplicado usa LOWER(TRIM(coluna)), que não usa índice; o prefixo (instituto, deleted) do índice proposto já limita as linhas lidas.
- [ ] Contacts.js: `contact_avatar` do body é gravado sem validação (string livre).
- [ ] ContinuousAvaliation.js: A lista faz JOIN com alunos (nome/foto/código): editar um aluno só é refletido ao fim do TTL — invalidar a chave `CacheKeys.point.list` nos controllers de alunos (não anexados). (só a lista geral é cacheada; a por subClass vai à BD).
- [ ] ContinuousAvaliation.js: RegisterPoint não verifica se a subClass pertence ao instituto (só o aluno).
- [ ] ContinuousAvaliation.js: `SELECT *` com JOIN a eduall_students devolve todas as colunas do aluno em GetPointsBySubClass.
- [ ] Courses.js: as escritas também invalidam as listas de turmas (class:list / class:exams) por precaução; se FetchAllClasses não fizer JOIN com cursos, pode retirar essa invalidação.
- [ ] Courses.js: Listas que fazem JOIN com esta entidade (ex.: GetStudents / GetStudentsByClass, TTL 3600s) ficam desatualizadas até ao TTL depois de editar/eliminar: invalidar essas chaves nos controllers respetivos ou reduzir o TTL.
- [ ] CurriculomPlan.js: consultas servem-se agora dos índices (ver cache_indexes.sql). Se quiser voltar a cachear o plano, faça-o depois da Parte A (CacheRoutes.js com eduallInvalidate por padrão `curriculum:*:<instituteCode>`).
- [ ] CurriculomPlan.js: GetClassAndSubjectCurricularPlan não filtra subcapítulos/aulas por instituto (só os capítulos): confirmar que os IDs de capítulo são sempre da escola (não alterado).
- [ ] DebugFeedback.js: com LEFT JOIN a ficheiros + JSON_ARRAYAGG, um feedback sem anexos devolve `files: [{file_id:null,...}]` (um objeto com campos null) — o frontend deve ignorar entradas com file_id null (não alterado).
- [ ] DebugFeedback.js: RegisterFeedback inventa um instituteCode aleatório (`INST-...`) quando a sessão não tem escola: isto grava lixo e nunca será invalidado/lido; melhor devolver 400/401 (não alterado).
- [ ] DebugFeedback.js: a lista inclui os URLs de todos os ficheiros de todos os feedbacks da escola — considerar paginação se crescer.
- [ ] Declaration.js: A lista faz JOIN com alunos (nome/foto/código): editar um aluno só é refletido ao fim do TTL — invalidar a chave `CacheKeys.declaration.list` nos controllers de alunos (não anexados).
- [ ] Declaration.js: DeclarationUpdate valida com `declaration_student: "dummy"` e não permite mudar o aluno — confirmar que é intencional.
- [ ] DeclarationRequests.js: A lista faz JOIN com alunos (nome/foto/código): editar um aluno só é refletido ao fim do TTL — invalidar a chave `CacheKeys.declarationRequest.list` nos controllers de alunos (não anexados).
- [ ] DeclarationRequests.js: DeclarationRequestUpdate grava `ed_declaration_request_status = NULL` quando o body não traz `declaration_request_status` (apaga o estado ao editar outros campos) e não verifica o aluno (não alterado).
- [ ] EduallLatestNews.js: mover os CREATE TABLE para uma migração SQL e retirar o EnsureNewsTables do código de pedidos.
- [ ] EduallLatestNews.js: RegisterNewsVideo não valida title/video_link (colunas NOT NULL) nem restringe quem pode registar novidades.
- [ ] EduallLessons.js: as aulas-tutorial são globais (sem instituteCode): qualquer utilizador autenticado com acesso às rotas de escrita altera as aulas de TODAS as escolas — confirmar que as rotas de escrita são só para o super-admin da plataforma.
- [ ] EduallLessons.js: `ALTER TABLE ... ADD COLUMN deleted` em runtime — mover para uma migração SQL.
- [ ] EmployeeAttendence.js: a lista faz JOIN com turmas, disciplinas, horários e funcionários: editar essas entidades só se reflete ao fim do TTL (300s) — invalidar CacheKeys.employeeAttendance.list em Class/Subjects/Timing (Employees.js já o faz).
- [ ] EmployeeAttendence.js: relatório de efetividade (BuildEffectivenessReport) e Departamentos não foram alterados nem cacheados.
- [ ] ⚠ SEGURANÇA — Employees.js: GetEmployeeByJobTitle consulta `eduall_employees WHERE ed_employee_charge = ?` SEM filtrar por ed_employee_institute_code e (antes) cacheava com chave sem instituto: devolve funcionários de TODAS as escolas. Acrescentar `AND ed_employee_institute_code = ?` com o instituto da sessão (não alterado: muda o resultado).
- [ ] Employees.js: GetEmployeeDataByUser deixou de ser cacheado (depende da data de fim da licença e do utilizador).
- [ ] Employees.js: as escritas também invalidam attendance:list (a lista de presenças faz JOIN com o nome do funcionário).
- [ ] Employees.js: a subquery de FetchEmployees (user_accounts por email) corre por funcionário: indexar eduall_user_accounts.ed_user_account_email (ver cache_indexes.sql).
- [ ] EnrollmentConfirmation.js: RegisterEnrollmentConfirmation (~500 linhas) faz débito de borderô, fatura (VENDUS) e SMS no mesmo pedido, sem transação: um erro a meio deixa estado parcial. Não alterado.
- [ ] ⚠ Enrollments.js / EnrollmentConfirmation.js: as chaves de cache colidiam (mesmo prefixo `enrollment:`). Se voltar a cachear, use prefixos distintos (ex.: enrollment: / enrollmentConfirmation:) em CacheKeys.js.
- [ ] Enrollments.js: `SELECT e.*, s.*, c.*, ...` (10 tabelas) devolve colunas homónimas sobrepostas (a última ganha) e dados desnecessários; indicar as colunas que o frontend usa para otimizar (não alterado).
- [ ] Enrollments.js: GetSingleEnrolledStudent liga eduall_academic_level por `ed_class_year` em vez de `ed_class_academic_level` (compare com GetEnrolledStudents) — confirmar (não alterado).
- [ ] Parte A (15 melhorias no CacheRoutes.js): pendente — CacheRoutes.js não foi encontrado/fornecido.
- [ ] Admission.js:51 — `Cache.eduallClear(StudentCacheKeys.all())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Admission.js:201 — `Cache.eduallClear(ExamCacheKeys.all())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Admission.js:336 — `Cache.eduallClear(ExamSubjectCacheKeys.all())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Admission.js:503 — `Cache.eduallClear(ResultCacheKeys.all())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Admission.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] Automation/PaymentsReports.js:852 — `Cache.eduallClear(lockKey).catch(() => {})` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Automation/PaymentsReports.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] Enrollmenttemplates.js:30 — `Cache.eduallClear(CacheKeys.allGlobal())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Enrollmenttemplates.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] Faculties.js:29 — `Cache.eduallClear(CacheKeys.allGlobal())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Faculties.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] FeesPayments.js:36 — `Cache.eduallClear(CacheKeys.allGlobal())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] FeesPayments.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] GetStudentsFullOverview.js:175 — `Cache.eduallClear("enrollment:*")` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] PedagogicalEvaluationControllers.js:181 — `Cache.eduallClear(CacheKeys.all())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] PedagogicalEvaluationControllers.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] Recicle.js:37 — `Cache.eduallClear(CacheKeys.allGlobal())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Recicle.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] Services.js:53 — `Cache.eduallClear(CacheKeys.allByInstitute(instituteCode, userId))` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Services.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] Students.js:139 — `Cache.eduallClear(CacheKeys.allGlobal())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] Students.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] TransportPayments.js:23 — `Cache.eduallClear(CacheKeys.all())` apaga a cache de TODAS as escolas (padrão sem instituteCode); trocar por invalidação de chaves exatas com o instituteCode.
- [ ] TransportPayments.js — ainda usa eduallGet/eduallSet manuais (migrar para eduallWithCache).
- [ ] Confirmar em CacheRoutes.js a assinatura `eduallWithCache(chave, ttl, fn)` e que `eduallInvalidate(chave)` aceita uma chave exata (é o que Functions/CacheKeys.js::safeInvalidate usa).
- [ ] Os controllers chamam `ExecuteQuery(res, ...)` passando `res`: se ExecuteQuery responder sozinho em caso de erro e depois o `catch` do controller voltar a responder, há risco de "headers already sent". Confirmar o comportamento de ExecuteQuery.
- [ ] Com eduallWithCache em modo single-flight, a query corre com o `req`/`res` do primeiro pedido; os restantes pedidos simultâneos partilham o resultado. Aceitável, mas relevante para a auditoria que ExecuteQuery faça via `req`.
- [ ] As chaves antigas (com instituteCode sem normalizar) expiram por TTL; não é necessário limpá-las.
- [ ] Os GET individuais / por-chave (Books, BookCopies, BooksDigitalContent, BorrowedBooks, BulletinHistory, Class, Authors, Contacts, Courses, ContinuousAvaliation, DebugFeedback, Declaration, DeclarationRequests, Employees, EmployeeAttendence, EduallLessons) deixaram de ter cache por ID (consulta indexada, barata): se o frontend os chamar em ciclo para muitos IDs, preferir um endpoint que devolva a lista (já em cache).
- [ ] Enrollments.js, EnrollmentConfirmation.js e CurriculomPlan.js ficaram SEM cache (ver tabela acima). Se notar lentidão nas respetivas páginas, o primeiro passo é aplicar os índices de cache_indexes.sql e medir com EXPLAIN.
- [ ] ChatMessages.js: `MessageDelete` usa as colunas `ed_cicle_deleted` / `ed_cicle_id` em `eduall_chat_messages` (copiado de Cicles) e nem sequer é exportado — corrigir para as colunas ed_chat_message_* antes de o usar.
- [ ] ChatMessages.js / Comments.js / ContactMessages.js / CountriesAndStates.js: respondem com status 300 em caso de erro (deveria ser 500) e `SELECT *` com LEFT JOIN a eduall_user_accounts devolve todas as colunas da conta (risco de expor dados). Não alterado.
- [ ] BootServer.js: previewCache em memória não é limpo entre processos PM2 — confirmar TTL/limite de tamanho.
- [ ] ⚠ SEGURANÇA — DocumentsCenter.js: UpdateDocument e DeleteDocument usam `WHERE ed_doc_id = ?` sem instituto: um utilizador de qualquer escola pode editar/eliminar documentos de outra pelo ID. GrantDocumentAccess também não confirma que o documento pertence à escola (ou é global) antes de conceder acesso, e GetDocuments devolve `d.*` de qualquer documento com linha de acesso. Não alterado (muda comportamento; documentos com externalCode parecem ser globais — confirmar o modelo).
- [ ] DocumentsCenter.js: RegisterDocumentsFromArray lê TODOS os códigos externos (todas as escolas) em cada chamada e insere sem linha de acesso: confirmar quem a chama e se corre em cada arranque.
- [ ] DocumentCenterGenerate.js (~2000 linhas): sem alterações; se a geração for lenta, enviar os EXPLAIN das queries dos loaders (loadStudents, loadQuarterly, loadExams, loadAbsences) para gerar índices exatos.
- [ ] DeviceRegister.js: user agent fixo no código (não usa o parâmetro `e`) e escreve informação do dispositivo na consola: ligar ao pedido real (`req.headers['user-agent']`) ou remover.

## 3. Riscos conhecidos

- **Race GET/escrita**: um GET que leu a BD antiga pode gravar o valor antigo depois de a escrita ter invalidado a chave. A invalidação simples não elimina isto; o **TTL é a rede de segurança** (por isso as agregações e listas com estado têm TTL curto).
- **Invalidação cruzada**: Books invalida exemplar/borrowedBook; Authors invalida digitalContent; Cicles/ClassRoom/Courses invalidam as listas de turmas; Class invalida o resumo por nível; Employees invalida as presenças. Entidades relacionadas em controllers não anexados (alunos, racks, ...) continuam por TTL até lá serem adicionadas.
- **Chaves colidentes (corrigido)**: Enrollments.js e EnrollmentConfirmation.js usavam as mesmas chaves `enrollment:list|single|docs:<escola>`; como ficaram sem cache, o problema desaparece. Qualquer controller novo deve usar um prefixo próprio em Functions/CacheKeys.js.
- **SQLite partilhado entre processos PM2 em cluster**: funciona graças ao `busy_timeout` (Parte A, ainda pendente se o CacheRoutes.js não foi alterado).
- Dados financeiros (contas a pagar/receber, matrículas e confirmações) deixaram de ser cacheados; só beneficiam dos índices.
- `cache_indexes.sql`: cada índice acelera leituras mas torna INSERT/UPDATE mais lentos; começar pelos de `eduall_students` e `eduall_class`, medir com EXPLAIN e só depois adicionar os restantes.

## 4. Como validar

1. Reiniciar a aplicação.
2. Chamar um GET (ex.: lista de níveis académicos) duas vezes: a segunda deve ser HIT (ver `eduallStats()` ou ativar `CACHE_LOGGING=true`).
3. Fazer uma escrita (criar/editar) e confirmar que o GET seguinte volta a ir à BD.
4. Repetir com duas escolas diferentes e confirmar que a invalidação de uma não afeta a cache da outra.
5. Rever `cache_indexes.sql`, aplicar em staging e comparar os `EXPLAIN` antes/depois.

## 5. Como reverter

Copiar os ficheiros de `.cache_backup/<timestamp>/` de volta para as pastas originais (mesma estrutura). `Functions/CacheKeys.js` é gerado: se foi criado agora pode ser apagado depois de reverter os controllers; se foi atualizado, o backup tem a versão anterior.

