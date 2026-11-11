# CACHE_REPORT_V4 — CACHE-OPT v4

Gerado por `apply_cache_optimizations_v4.py`. Nenhum SQL foi executado.

## 1. Estado por ficheiro

| Ficheiro | Estado | Detalhe |
|---|---|---|
| `LessonsSectionContent.js` | alterado | EnsureStructure (CREATE TABLE IF NOT EXISTS + 6x ALTER TABLE) passa a correr uma só vez por processo (antes: em todos os pedidos de GetFullLessonTree, Register/Delete/Move/Reorder/RegisterLessonFiles/MarkLessonContentDone) |
| `LessonReviews.js` | ignorado | legado (DATABASERUN): avaliações mudam a cada interação; não cacheado; só índice |
| `Lessonplancontroller.js` | ignorado | planos de aula: textos longos, editados com frequência e escritas só conhecem o ID (sem como invalidar chaves exatas): não cacheado; só índice |
| `LessonsSection.js` | ignorado | legado (DATABASERUN/SQLite, sem ExecuteQuery nem cache); sem alterações (ver TODOs — segurança) |
| `LibraryFines.js` | ignorado | multas de biblioteca (dados financeiros, motor/cron): não cacheado de propósito; só índices (ver TODOs) |
| `LibraryLoans.js` | ignorado | empréstimos (estado muda a cada operação): não cacheado; só índice |
| `LibraryReservations.js` | ignorado | reservas (estado muda a cada operação): não cacheado; só índice |
| `logger.js` | ignorado | utilitário de consola (sem BD, sem cache); sem alterações (ver TODOs) |

## 2. TODOs manuais

- [ ] LessonsSectionContent.js: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` só existe em MariaDB; em MySQL é erro de sintaxe, logo as colunas nunca são criadas e o erro era apenas ignorado em cada pedido. Mover estas migrações para um ficheiro SQL (e retirar EnsureStructure do código de pedidos).
- [ ] LessonsSectionContent.js: o flag é posto mesmo que algum ALTER tenha falhado (os erros já eram ignorados antes); reiniciar a aplicação não repete a migração se a coluna existir.
- [ ] LessonsSectionContent.js: GetFullLessonTree devolve TODAS as aulas (parent_type='section') da escola, não só as da árvore pedida (`CODE`); filtrar pelas secções do capítulo reduz muito os dados (não alterado: muda o resultado) e usa `SELECT *` três vezes.
- [ ] Neste lote não foi preciso Functions/CacheKeys.js nem CacheRoutes.js.
- [ ] As escritas destes controllers não têm cache para invalidar; se algum dia cachear listas de biblioteca, use chaves por escola e invalide em RegisterLoan/ReturnLoan/RegisterReservation/etc.
- [ ] ⚠ LibraryFines.js: initLibraryFineCron() agenda o motor de multas com node-cron DENTRO do processo. Com PM2 em modo cluster (N processos) o motor corre N vezes por dia e pode criar multas DUPLICADAS. Correr o cron num só processo (ex.: `if (process.env.NODE_APP_INSTANCE === '0')`) ou garantir idempotência com UNIQUE (empréstimo + regra) em eduall_library_fines.
- [ ] LibraryFines.js: nextFineNumber lê o último ed_fine_number e soma 1 (sem transação/UNIQUE): dois pedidos simultâneos geram o mesmo número (MLT-xxxx). Criar UNIQUE (ed_fine_institute_code, ed_fine_number) e repetir em caso de colisão.
- [ ] LibraryFines.js: a lista usa FIND_IN_SET/REPLACE sobre flr_member_types (não usa índice) e ~10 JOINs a eduall_user_accounts; as consultas devolvem `f.*` + nome/foto/tipo do utilizador. Ficheiro de ~900 linhas não analisado a fundo.
- [ ] LibraryLoans.js / LibraryReservations.js: RegisterLoan, ReturnLoan, ConfirmReservation e similares atualizam empréstimo, exemplar e livro em várias queries sem transação (um erro a meio deixa o estado inconsistente). Não alterado.
- [ ] Biblioteca: ao mudar o estado de um exemplar/livro estes controllers devem invalidar, quando existirem, as chaves da v1 (CacheKeys.exemplar.list, CacheKeys.borrowedBook.list, CacheKeys.book.list). Hoje não o fazem: BookCopies.js/Books.js/BorrowedBooks.js (v1, TTL 600s nas listas de exemplares e empréstimos) podem mostrar estados desatualizados até 10 minutos depois de um empréstimo/devolução feito por LibraryLoans.js. Se isso for visível, acrescentar `await CacheKeys.safeInvalidate(() => [CacheKeys.exemplar.list(code), CacheKeys.borrowedBook.list(code)])` no fim de RegisterLoan/ReturnLoan/RenewLoan/DeleteLoan e das reservas (requer o CacheKeys.js da v1). Não alterado.
- [ ] ⚠ LessonsSection.js: LessonSectionDelete, LessonSectionUpdate e GetSingleLessonSection filtram só por ID (sem instituto): uma escola pode ler/alterar/eliminar secções de outra; LessonSectionUpdatePosition passa 1 parâmetro para 2 `?` (a query falha); GetLessonsSectionByGroup usa a coluna `ed_lesson_content_groupCode` e Register/BuyGroupCode usam `ed_lesson_section_groupCode` (uma das duas está errada); GetSingerAlbums é código copiado de um tutorial (tabelas singers/albums) — apagar. Responde com status 300 em erro e, num catch, devolve `[error, ID de sessão, instituto]` ao cliente.
- [ ] LessonReviews.js / LessonsSection.js: `SELECT *` com LEFT JOIN a eduall_user_accounts devolve todas as colunas da conta de quem avalia (risco de expor dados) e não filtra por instituto.
- [ ] ⚠ LessonsSectionContent.js: GetLessonContentById e DeleteLessonContent/UpdateLessonContent filtram só por ed_lesson_content_id (sem instituto): uma escola pode ler/alterar aulas de outra pelo ID. Os uploads de vídeo usam multer.memoryStorage com limite de 250 MB (um upload ocupa 250 MB de RAM): preferir disco/stream para o Cloudinary.
- [ ] Lessonplancontroller.js: GetAllLessonPlansAdmin devolve todos os planos da escola (`lp.*` com campos de texto longos) sem paginação; UpdateLessonPlan/UpdateSchoolNotes não verificam se o utilizador é o autor/professor ou administração (qualquer utilizador da escola pode editar). Não alterado.
- [ ] logger.js: usa as funções `c(...)` e `b(...)` que não estão definidas nem importadas (ReferenceError ao chamar printInvoiceAndRegistry) e imprime dados de alunos/faturas na consola de produção: definir os helpers de cor ou apagar o ficheiro.

## 3. Riscos conhecidos

- Este lote não adiciona cache: planos de aula, biblioteca e multas mudam a cada ação ou são financeiros.
- Listas de exemplares/empréstimos (cache da v1, TTL 600s) podem ficar desatualizadas após operações de LibraryLoans.js (ver TODOs).
- Cada índice acelera leituras mas torna INSERT/UPDATE mais lentos: aplicar em staging, medir com EXPLAIN.

## 4. Como validar

1. Reiniciar a aplicação e abrir a árvore de uma aula duas vezes: o log de `ALTER ignorado` só deve aparecer uma vez.
2. Registar/mover/reordenar conteúdos e confirmar que continuam a funcionar.

## 5. Como reverter

Copiar os ficheiros de `.cache_backup/<timestamp>_v4/` de volta (mesma estrutura).

