# CACHE_REPORT_V3 — CACHE-OPT v3

Gerado por `apply_cache_optimizations_v3.py`. Nenhum SQL foi executado.

## 1. Estado por ficheiro

| Ficheiro | Estado | Detalhe |
|---|---|---|
| `../Functions/CacheKeys.js` | alterado | ficheiro atualizado (acrescentada a secção jobTitle) |
| `JobTitles.js` | alterado | GetJobTitles → eduallWithCache com chave GLOBAL `jobTitle:list:global` (TTL 3600s; a tabela não tem instituto); GetSingleJobTitle: sempre à BD + validação de ID (400); Register/Update/Delete invalidam jobTitle.list logo após o sucesso da escrita (try/catch) |
| `InstituteAccounts.js` | ignorado | contas de utilizador, acessos e apps (dados de segurança, muitas escritas): não cacheado de propósito; só índices |
| `InstituteFollowers.js` | ignorado | legado (DATABASERUN/SQLite, sem ExecuteQuery): seguidores mudam a cada ação; não cacheado; sem alterações |
| `InstituteLicenceAndServicePayment.js` | ignorado | legado inoperante (erros de carga/SQL, ver TODOs); sem cache; sem alterações |
| `Institutes.js` | ignorado | dados globais/partilhados com licenças (validade por data) e logos: não cacheado de propósito; sem alterações (ver TODOs — segurança) |
| `InstitutesAccountsPayments.js` | ignorado | cópia inoperante de AcademicLevel.js (sem exports, ver TODOs); sem cache; sem alterações |
| `Invoices.js` | ignorado | faturas (dados financeiros): não cacheado de propósito; só índices |
| `LessonContentComments.js` | ignorado | legado (DATABASERUN): comentários mudam a cada interação; não cacheado; só índice |

## 2. TODOs manuais

- [ ] ⚠ JobTitles.js: a tabela eduall_job_titles NÃO tem ed_job_title_institute_code: Update/Delete de uma escola alteram os cargos de TODAS as escolas, e a verificação de nome duplicado é global. Confirmar que é o modelo pretendido (cargos da plataforma) e que as rotas de escrita são só para o super-admin; caso contrário acrescentar a coluna e filtrar por instituto.
- [ ] JobTitles.js: GetSingleJobTitle e DeleteJobTitle/UpdateJobTitle não filtram `ed_job_title_deleted` de forma consistente (o GET individual devolve cargos eliminados; o Delete não exige deleted = 0). Não alterado.
- [ ] JobTitles.js: Employees.js (v1) pode fazer JOIN/lookup do cargo (ed_employee_charge): renomear um cargo só se reflete na lista de funcionários de cada escola ao fim do TTL (600s). Não há como invalidar as chaves de todas as escolas a partir daqui.
- [ ] JobTitles.js: `LOWER(ed_job_title) = ?` não usa índice (tabela pequena: irrelevante).
- [ ] Confirmar em CacheRoutes.js a assinatura `eduallWithCache(chave, ttl, fn)` e que `eduallInvalidate(chave)` aceita uma chave exata.
- [ ] Os controllers chamam `ExecuteQuery(res, ...)`: se ExecuteQuery responder sozinho em caso de erro e o `catch` responder outra vez, há risco de "headers already sent" (herdado da v1/v2).
- [ ] A chave `jobTitle:list:global` é partilhada por todas as escolas de propósito (mesmos dados para todas).
- [ ] ⚠ SEGURANÇA CRÍTICA — Institutes.js (linhas ~25-29): `cloudinary.config({ cloud_name, api_key, api_secret })` com as credenciais ESCRITAS NO CÓDIGO. Considere-as comprometidas: gerar novas chaves no Cloudinary, guardá-las em variáveis de ambiente (process.env.CLOUDINARY_*) e retirá-las do histórico do repositório. Não alterado.
- [ ] Institutes.js: GetInstitutes, GetAllRegisteredInstitutes, GetSingleInstitute, GetSingleInstituteByCode e EduallSearchInstitutes não filtram por escola do utilizador e devolvem `SELECT *` (inclui NIF, contas bancárias, emails): confirmar que as rotas são só para o super-admin/portal público e limitar as colunas.
- [ ] Institutes.js: RegisterInstitute (insere em eduall_manager_customers) não valida campos nem permissões; InstituteUpdate corre INFORMATION_SCHEMA + ALTER TABLE em CADA atualização (mover para migração SQL) e exige IVA === 14 fixo no código.
- [ ] Institutes.js: GetCurrentInstituteByCode faz LEFT JOIN com licenças com `ed_institute_deleted`/`ed_institute_code` sem prefixo de tabela (risco de coluna ambígua) — não cacheado: a validade da licença muda por data.
- [ ] ⚠ InstituteLicenceAndServicePayment.js: `module.exports` referencia GetSingleInstituteByCode, que NÃO está definida neste ficheiro (ReferenceError ao carregar o módulo); GetAllInstituteServicePaymentsByInstituteCode usa `CODE` não definido; EduallSearchInstitutes concatena `req.params.TEXT` no SQL (INJEÇÃO SQL) e tem o OR sem parênteses (devolve institutos eliminados); RegisterInstitute tem SQL inválido. Parece superado por Institutes.js: confirmar se alguma rota ainda o importa e, se não, apagar.
- [ ] InstitutesAccountsPayments.js: é uma cópia de AcademicLevel.js sem `module.exports` (nada é exportado), sem filtro de instituto em GetSingle/Delete/Update e AcademicLevelUpdate usa `AND` em vez de vírgulas no SET (SQL errado). Provável ficheiro morto: apagar ou reescrever.
- [ ] ⚠ InstituteFollowers.js: GetSingleInstituteFollowers devolve `SELECT *` com LEFT JOIN a eduall_user_accounts (todas as colunas da conta, possivelmente hash de palavra-passe) e não exige sessão do instituto; FollowInstitute faz verificar-depois-inserir sem UNIQUE (corrida: seguidores duplicados). Usar colunas explícitas e UNIQUE (utilizador, instituto).
- [ ] LessonContentComments.js: `SELECT *` com LEFT JOIN a eduall_user_accounts devolve todas as colunas da conta de quem comentou (risco de expor dados) e não filtra por instituto; legado com DATABASERUN (status 300 em erro).
- [ ] InstituteAccounts.js: `SELECT *` de eduall_system_accounts + eduall_employees: confirmar que não devolve hashes/tokens ao frontend; ficheiro com ~690 linhas (criação de contas, acessos e apps) não analisado a fundo.
- [ ] Invoices.js: usa `ExecuteQuery(null, ...)` (res nulo) e a tabela já cria os seus índices; a subquery JSON_ARRAYAGG com `COLLATE utf8mb4_general_ci` nos dois lados do JOIN só usa o índice se a coluna tiver essa collation (ver cache_indexes_v3.sql). InitializeInvoiceTables (CREATE TABLE em runtime) deve passar para migração.
- [ ] Invoices.js (~1100 linhas): RegisterInvoice (~440 linhas) emite fatura (VENDUS) e grava cabeçalho + itens sem transação.

## 3. Riscos conhecidos

- **Race GET/escrita**: o TTL é a rede de segurança.
- **Chave global**: `jobTitle:list:global` é partilhada por todas as escolas (a tabela não tem instituto).
- Faturas, contas de utilizador e licenças não são cacheadas: só beneficiam dos índices.

## 4. Como validar

1. Reiniciar a aplicação.
2. Chamar o GET de cargos duas vezes (a segunda deve ser HIT) e confirmar que criar/editar/eliminar um cargo volta a ir à BD.

## 5. Como reverter

Copiar os ficheiros de `.cache_backup/<timestamp>_v3/` de volta (mesma estrutura).

