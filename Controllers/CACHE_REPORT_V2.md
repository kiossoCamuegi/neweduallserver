# CACHE_REPORT_V2 — CACHE-OPT v2

Gerado por `apply_cache_optimizations_v2.py`. Nenhum SQL foi executado.

## 1. Estado por ficheiro

| Ficheiro | Estado | Detalhe |
|---|---|---|
| `../Functions/CacheKeys.js` | alterado | ficheiro atualizado (acrescentadas secções faculty e enrollmentTemplate) |
| `Enrollmenttemplates.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); GetEnrollmentTemplates → eduallWithCache (TTL 3600s); GetSingleEnrollmentTemplate (validação de ID, 400) e GetActiveTemplateByModel: sempre à BD, sem cache por ID/modelo; Refresh eager removido (eduallClear('enrollmenttemplate:*') apagava a cache de TODAS as escolas); escritas só invalidam enrollmentTemplate.list (try/catch, após o sucesso); removidos console.log de timing nas leituras |
| `Faculties.js` | alterado | chaves migradas para Functions/CacheKeys.js (import em vez de objeto local); GetFaculties → eduallWithCache (TTL 3600s); GetSingleFaculty: sempre à BD + validação de ID (400); antes a chave `faculty:single:<id>` NÃO tinha instituteCode; Refresh eager removido (eduallClear('faculty:*') apagava a cache de TODAS as escolas); escritas invalidam faculty.list + class.list/exams (try/catch, após o sucesso); removidos console.log de timing nas leituras |
| `FeesPayments.js` | alterado | cache REMOVIDA (dados financeiros: pagamentos, borderôs e estado de propinas não devem ser cacheados); 12 GETs passam a ler diretamente da BD (mesmo formato de resposta); removidos require do CacheRoutes, CacheKeys local, TTL e RefreshFeesPaymentCache (7 chamadas nas escritas); corrige 2 bugs de cache: (1) GetSingleFeepayment e GetSinglePayment usavam a MESMA chave `feespayment:single:<id>` com queries/formatos diferentes; (2) GetSingleStudentPaymentStatus cacheava por aluno mas o resultado depende de `?ano=` |
| `GetStudentsFullOverview.js` | alterado | removida RefreshEnrollmentCaches e a sua chamada no fim do lote; corrige um erro latente: `Cache.eduallClear(...)` corria sem `Cache` estar importado (ReferenceError depois de matricular o lote) |
| `ERP_export.js` | ignorado | importação/exportação em lote (INSERTs em várias tabelas, sem leituras repetidas): não cacheado; sem alterações |
| `EnrollOperations.js` | ignorado | ficheiro incompleto/inoperante (ver TODOs); sem cache; sem alterações |
| `Feed.js` | ignorado | feed social (posts, reações, comentários, stories): muda a cada interação e depende do utilizador; não cacheado; sem alterações |
| `FeedBacks.js` | ignorado | controller legado (Sequelize/SQLite, não usa ExecuteQuery nem cache); sem alterações (ver TODOs) |
| `Filemanager.js` | ignorado | gestor de ficheiros por utilizador/pasta (muda a cada ação); não cacheado; sem alterações |
| `FilesStorage.js` | ignorado | registo/lista de ficheiros e upload (multer); sem leituras pesadas; não cacheado; sem alterações |
| `FinalPautasController.js` | ignorado | pautas finais (dados académicos sensíveis, poucas leituras): não cacheado; sem alterações |
| `Fines.js` | ignorado | multas (dados financeiros): não cacheado de propósito; só índices (ver cache_indexes_v2.sql) |
| `FinesController.js` | ignorado | regras/registos/exclusões de multas (dados financeiros, ~2000 linhas): não cacheado de propósito; só índices |
| `FinesRestrictions.js` | ignorado | restrições de multas (dados financeiros): não cacheado de propósito; só índices |
| `FinesStudents.js` | ignorado | multas por aluno (dados financeiros): não cacheado de propósito; só índices |
| `FormBuilderController.js` | ignorado | formulários/entradas/importações (escritas frequentes): não cacheado; sem alterações |
| `GeneralAttendance.js` | ignorado | presenças/suspensões/RFID em tempo real: não cacheado; sem alterações |
| `GetCurrentUserData.js` | ignorado | sessão/modo de rede (sem BD, sem cache); sem alterações (ver TODOs — segurança) |

## 2. TODOs manuais

- [ ] Enrollmenttemplates.js: GetActiveTemplateByModel (usada ao imprimir a ficha) deixou de ser cacheada; é uma consulta indexada (ver cache_indexes_v2.sql). Se for pesada, voltar a cachear com invalidação por modelo.
- [ ] Enrollmenttemplates.js: RegisterEnrollmentTemplate desativa os modelos anteriores e insere em duas queries sem transação: um erro entre as duas deixa o modelo sem nenhum ativo (não alterado).
- [ ] Enrollmenttemplates.js: `tpl_data` (JSON) é gravado sem validar tamanho/formato.
- [ ] ⚠ SEGURANÇA — Faculties.js: GetSingleFaculty (`WHERE ed_faculty_id = ?`) e FacultyDelete (`UPDATE ... WHERE ed_faculty_id = ?`) não filtram por ed_faculty_institute_code: um utilizador de uma escola pode ler/eliminar faculdades de outra pelo ID. Acrescentar `AND ed_faculty_institute_code = ?` (não alterado: muda o resultado).
- [ ] Faculties.js: as escritas também invalidam class.list/class.exams (as listas de turmas podem fazer JOIN com faculdades); se FetchAllClasses não o fizer, pode retirar essa invalidação.
- [ ] Faculties.js: `SELECT *` mantido (colunas usadas pelo frontend desconhecidas).
- [ ] ⚠ FeesPayments.js: GetSingleFeepayment e GetSinglePayment partilhavam a chave de cache (cada um podia devolver o resultado do outro). Resolvido por ter removido a cache; se voltar a cachear use chaves distintas.
- [ ] FeesPayments.js: o Refresh anterior usava eduallClear('feespayment:*'), que apagava a cache de TODAS as escolas.
- [ ] FeesPayments.js: RegisterFeepayment (~450 linhas) debita borderô, emite fatura (VENDUS) e grava pagamentos sem transação: um erro a meio deixa estado parcial. Não alterado.
- [ ] FeesPayments.js: restam console.log de depuração em produção ("cheking sttaus 1 ......", "here kiosso") e console.time/timeEnd em vários GETs; remover quando possível (não alterado).
- [ ] FeesPayments.js: `SELECT p.*` com JOIN a serviços/moedas e JSON_ARRAYAGG por linha (extras) pode ser pesado em listas grandes: aplicar os índices de cache_indexes_v2.sql e medir com EXPLAIN.
- [ ] FeesPayments.js: a importação em lote (ImportBatchPayments, ~250 linhas) e DeleteImportedPayments não foram analisadas a fundo.
- [ ] GetStudentsFullOverview.js: o `Cache.eduallClear("enrollment:*")` era inútil (Enrollments.js e EnrollmentConfirmation.js deixaram de usar cache na v1) e, se funcionasse, apagava a cache de TODAS as escolas.
- [ ] GetStudentsFullOverview.js (~2900 linhas, 67 queries): só se mexeu no mínimo; se for lento, enviar os EXPLAIN das queries do lote (matrícula/confirmação) para gerar índices exatos.
- [ ] GetStudentsFullOverview.js: confirmar se, ao matricular/confirmar alunos em lote, é preciso invalidar chaves de alunos/turmas (CacheKeys.schoolClass.list/exams, academicLevel.studentsSummary) — controllers de alunos não anexados.
- [ ] Confirmar em CacheRoutes.js a assinatura `eduallWithCache(chave, ttl, fn)` e que `eduallInvalidate(chave)` aceita uma chave exata (é o que Functions/CacheKeys.js::safeInvalidate usa).
- [ ] Os controllers chamam `ExecuteQuery(res, ...)`: se ExecuteQuery responder sozinho em caso de erro e o `catch` voltar a responder, há risco de "headers already sent" (herdado da v1).
- [ ] Com eduallWithCache em modo single-flight, a query corre com o `req`/`res` do primeiro pedido; os pedidos simultâneos partilham o resultado.
- [ ] As chaves antigas (`faculty:*`, `enrollmenttemplate:*`, `feespayment:*`) expiram por TTL; não é necessário limpá-las.
- [ ] ⚠ SEGURANÇA — GetCurrentUserData.js: UpdateCurrentUserInstitute grava na sessão o instituto recebido em /:CODE SEM verificar que o utilizador pertence a essa escola: qualquer utilizador autenticado pode passar a operar na escola de outro. Validar contra eduall_user_institutes (utilizador + instituto + não eliminado + licença) antes de gravar. Não alterado.
- [ ] GetCurrentUserData.js: usa node-localstorage (./scratch) PARTILHADO por todo o processo: GetCurrentUserData(e) e o modo de rede gravado em localStorage são globais, não por utilizador — com vários utilizadores/escolas isto mistura dados. Usar só a sessão.
- [ ] EnrollOperations.js: ficheiro inoperante — usa DATABASERUN (não definido nem importado), as queries apontam para eduall_academic_level (copiado de AcademicLevel), os PARAMS não coincidem com os `?` (Register/Delete/GetSingle) e o UPDATE tem SQL inválido (`SET ed_enroll_operation_user = ,`). Reescrever com ExecuteQuery e a tabela de operações de matrícula antes de o ligar às rotas.
- [ ] FeedBacks.js: usa FeedBacksModel (nunca importado), DATABASERUN (não usado), `institute_code` e `user_code = 26` FIXOS no código (todos os feedbacks ficam na mesma escola/utilizador) e, offline, consultas a eduall_academic_level copiadas de outro controller; GetSingleUserFeedback usa `ID` que não existe. Responde 300 em erro. Se as rotas ainda o usam, migrar para o padrão DebugFeedback.js (ExecuteQuery + sessão).
- [ ] FilesStorage.js: o upload (multer) não limita tamanho nem tipo de ficheiro e grava em ./assets (pasta pública?): adicionar `limits.fileSize` e fileFilter por extensão/mimetype. O nome usa `Math.random(1, N)` (ignora argumentos) — usar crypto.randomUUID().
- [ ] FilesStorage.js: GetSpecificFiles filtra só por ed_file_code (sem instituto) e FileDelete regista db: "eduall_fines" (etiqueta errada).
- [ ] ⚠ SEGURANÇA — FinesStudents.js: GetSingleFineStudent, GetAllFinesStudentByCode, FineStudentDelete e FineStudentsUpdate não filtram por ed_fine_student_institute_code: uma escola pode ler/alterar/eliminar multas de alunos de outra pelo ID/código. Não alterado.
- [ ] Fines.js: o LEFT JOIN a eduall_services fica efetivamente INNER JOIN por causa de `eduall_services.ed_service_deleted = 0` no WHERE (multas cujo serviço foi eliminado desaparecem) e não filtra o serviço/moeda por instituto. Confirmar (não alterado).
- [ ] Fines.js / FinesRestrictions.js / FinesStudents.js: nomes de coluna misturados (ed_fine_student_id = código do aluno vs ed_fine_students_id = PK): fácil de trocar nas queries — rever com atenção antes de refatorar.
- [ ] Faculties.js / Enrollmenttemplates.js: dependem de `Cache.eduallWithCache` e `Cache.eduallInvalidate` (Functions/CacheRoutes.js) — confirmar as assinaturas.
- [ ] Feed.js, ERP_export.js, Filemanager.js, FinalPautasController.js, FinesController.js, FormBuilderController.js, GeneralAttendance.js: sem alterações e sem índices propostos porque os nomes das colunas deleted/ordenação não foram confirmados; enviar os EXPLAIN das queries mais lentas para gerar índices exatos.

## 3. Riscos conhecidos

- **Race GET/escrita**: um GET que leu a BD antiga pode gravar o valor antigo depois de a escrita ter invalidado a chave; o TTL é a rede de segurança.
- **Dados financeiros** (pagamentos de propinas, multas) não são cacheados: só beneficiam dos índices.
- **Chaves partilhadas**: Faculties invalida também class.list/exams (v1). Entidades em controllers não anexados continuam por TTL.
- Cada índice acelera leituras mas torna INSERT/UPDATE mais lentos: aplicar em staging, medir com EXPLAIN.

## 4. Como validar

1. Reiniciar a aplicação.
2. Chamar GET de faculdades e de modelos de matrícula duas vezes: a segunda deve ser HIT (`CACHE_LOGGING=true`).
3. Criar/editar/eliminar e confirmar que o GET seguinte volta a ir à BD; repetir com duas escolas.
4. Pagamentos: confirmar que `GetSingleStudentPaymentStatus?ano=...` devolve o ano pedido.
5. Matricular um lote (GetStudentsFullOverview) e confirmar que já não há erro no fim.

## 5. Como reverter

Copiar os ficheiros de `.cache_backup/<timestamp>_v2/` de volta (mesma estrutura). `Functions/CacheKeys.js`: se foi criado agora pode ser apagado depois de reverter os controllers.

