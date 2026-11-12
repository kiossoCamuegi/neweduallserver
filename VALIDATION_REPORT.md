# Relatório de validação — performance e gravações

> Data: 12/11/2026
> Âmbito: validação local + leitura em produção. **Nenhum deploy foi feito.**

## 1. Infraestrutura

| Domínio | IP |
|---|---|
| `app.eduall.site` (frontend) | 185.12.116.154 |
| `eduall.site` (API) | 185.12.116.154 |
| `cpanel154.dnscpanel.com` (BD) | 185.12.116.154 |

**Conclusão:** app, API, frontend e BD estão no **mesmo servidor/IP**.
O `/health` de 0,65–1,55 s é compatível com o “hairpin” pelo hostname
público; com socket/`127.0.0.1` deverá cair para poucos ms.

## 2. Estado atual da produção (leitura)

| Teste | Resultado |
|---|---|
| `GET /health` (3x) | 1,55 s / 0,65 s / 0,64 s |
| `GET /eduallstudentsapi/get-lite` | **404** (não deployado) |
| `GET /eduallstudentsapi/class-gender` | **404** (não deployado) |
| Bundle frontend | `main.cc14106b.js` (não patchado) |
| Sessão/login | válida; `eduallclassapi/get` 1,0 s |

## 3. Testes locais com a BD de produção (leitura)

| Teste | Resultado |
|---|---|
| `GetStudents` (2.386 alunos) | 3,4–7,9 s frio; 88–140 ms em cache |
| `GetStudentsLite` | 1,72 MB raw / **135 KB gzip**; 24 campos |
| `GetStudentsClassGender` | 416 KB raw / **12,7 KB gzip**; 7 campos |
| Relatório de matrículas | 200; **180 matrículas / 168 confirmações / 93,3%** |
| Auditoria | 363 ms → **181 ms** com índice |
| `GetTransportPassengersByClass` | 173 ms; sem erro |
| Fallback da BD | local falhou → `cpanel154...` → `/health` 200 |

## 4. Validação de gravações

### 4.1 Auditoria estática dos `INSERT`
Comparei as colunas dos controllers com o schema real. Foram encontrados e
**corrigidos localmente** dois bugs:

1. `Controllers/Students.js` — `INSERT INTO eduall_student_enrollment`
   usava `ed_student_enrollment_service`, `ed_student_enrollment_class`,
   `ed_enrollment_institute_code` (não existem). Corrigido para
   `ed_enroll_payment_service`, `ed_enroll_class`, `ed_enroll_institute_code`.
2. `Controllers/Enrollments.js` — `INSERT INTO eduall_enrollment_docs`
   usava `ed_enrollment_docs_*` (não existem). Corrigido para `ed_enroll_doc_*`.

Restante auditoria:
- `eduall_students`, `eduall_enrollment`, `eduall_enrollment_confirmations`,
  `eduall_fees_payments`, `eduall_student_attendence` → **OK**.
- `eduall_sms_sent_messages` → **tabela não existe**. O erro é apanhado pelo
  helper (não bloqueia o SMS), mas o histórico não é gravado.
  Migração preparada: `migrations/053_sms_sent_messages.sql` (não aplicada).

### 4.2 Teste real com transação + ROLLBACK
Numa ligação **dedicada**, executei dentro de uma transação:

| Registo | Insert | Dentro da transação | Depois do ROLLBACK |
|---|---|---|---|
| Aluno | id 17161 | 1 | **0** |
| Matrícula | id 3784 | 1 | **0** |
| Confirmação | id 1585 | 1 | **0** |
| Pagamento | id 41433 | 1 | **0** |
| Presença | id 90 | 1 | **0** |
| Matrícula do aluno | id 5 | 1 | **0** |
| Documento de matrícula | id 1 | 1 | **0** |

**Nenhum registo ficou na BD.** Os contadores `AUTO_INCREMENT` avançaram
(comportamento normal do MySQL), mas não há dados de teste persistidos.

### 4.3 Fluxos completos no staging (Docker)

Ambiente local: `mariadb:10.6` em Docker (porta 3307), **schema completo**
(541 tabelas) copiado da produção, dados mínimos da escola de teste.
Nenhuma escrita foi feita na BD de produção.

| Fluxo | Resultado | Verificação |
|---|---|---|
| Presença | **200**, 42 ms | attendance + auditoria |
| Registo de aluno | **201**, 146 ms | student + auditoria + cache clear |
| Matrícula | **200**, 51 ms | enrollment + documento + auditoria |
| Pagamento de propina | **200**, 41–63 ms | fee + auditoria |
| Confirmação financeira | **200**, 38 ms | aluno/turma + enrollment + auditoria |
| Importação de pagamento | **200**, 66 ms | fee |
| Notificação | Utilizador 1008 recebeu notificação | auditoria + notificação |

Bugs encontrados e corrigidos:
- `RegisterStudent`: faltava `ed_student_rfid_code`; `guardion_degree` ia null.
- `eduall_student_enrollment` e `eduall_enrollment_docs`: colunas erradas.
- `RegisterFeepayment`: faltavam `ed_fee_payment_value`/`total`; o operador
  (int) recebia o nome; descrição de auditoria maior que 111.
- Imports de pagamento: `value`/`total`/`observations`/`invoiceFile`/operador.
- `eduall_sms_sent_messages` em falta (migração 053 preparada).
- Relatório de matrículas (já corrigido antes).
- `RegisterEnrollmentConfirmation` (lote): as atualizações de turma corriam
  **fora da transação** e `ed_student_enrolled` não era marcado. Passou a
  fazer um `UPDATE` único **dentro da transação**, com `enrolled=2`, o que
  também impede confirmações duplicadas (2.ª tentativa devolve **409**).
- Socket: `GetSocketIo` criava um **segundo** servidor Socket.IO no mesmo
  HTTP server (`handleUpgrade() was called more than once`, crash do
  processo). Passou a reutilizar o `io` do `app.js`. A auditoria emitia a
  notificação duas vezes (`io.to` + `io.emitTo`); passou a emitir uma só.

### 4.4 Confirmação em lote (VENDUS/PDF simulados)
Teste no staging com 1 aluno, serviço ativo 22 (PROPINA 13*, 18.000 AOA),
método "Numerário" e stubs de `VENDUS_CreateInvoiceCodeAndDoc` e
`printInvoiceAndRegistry` (nenhuma chamada externa real):
- **200**, 94 ms; fatura `CONF-TEST-002`; serviço/preço corretos no `Items`.
- Confirmação gravada; aluno ficou `ed_student_enrolled=2`.
- 2.ª tentativa: **409** "já confirmado".
- Email/SMS **não são chamados** por este controller; são fluxos separados.
  As chamadas externas reais (VENDUS/PDF/email/SMS) continuam por testar com
  credenciais/sandbox, para não enviar comunicações reais.

### 4.5 Socket real
- Cliente `socket.io-client` (instalado só para o teste, `--no-save`) ligou
  ao servidor, entrou na room `inst:...` e recebeu `notification:new` com o
  `audit_id` correto.
- Depois da correção, recebeu **1 evento** (antes recebia 2).
- App completo (porta 7599, sessão autenticada com `refreshToken` válido):
  `APP SOCKET AUTENTICADO OK`, sem `handleUpgrade` nem erros. Cliente anónimo
  recebe `SOCKET_UNAUTHORIZED`, como esperado pela regra do realtime.
- O teste não valida o handshake real do browser com cookie de produção;
  valida o mesmo caminho de servidor (sessão + JWT + `validateSocketIdentity`)
  e a emissão real.

### 4.6 O que ainda não foi validado
- Chamadas externas reais de VENDUS/PDF/email/SMS (no teste foram stubs).
- Deploy no servidor, socket do cPanel e frontend em runtime.
- Transações através do pool: o teste sequencial reutilizou a mesma ligação,
  mas o pool **não fixa** uma ligação entre `START TRANSACTION` e as queries
  seguintes. Sob concorrência, pode falhar. Recomenda-se um wrapper de
  transação com ligação dedicada antes de confiar em rollbacks de produção.

## 5. Conclusões

1. A otimização de socket/`127.0.0.1` é viável: tudo está no mesmo IP.
2. O código local está pronto, mas **não está em produção** (endpoints 404).
3. Os fluxos principais de escrita passaram no staging; vários bugs reais
   foram encontrados e corrigidos.
4. Falta criar `eduall_sms_sent_messages` (migração 053) e aplicar a migração
   052 (`students_details`).
5. A confirmação em lote e a emissão de socket foram validadas localmente
   (serviços externos simulados). Antes de deploy: testar as chamadas
   externas reais (VENDUS/PDF/email/SMS) e as transações com ligação dedicada.
