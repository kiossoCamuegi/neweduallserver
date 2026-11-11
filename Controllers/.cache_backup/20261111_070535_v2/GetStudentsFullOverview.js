const ExecuteQuery = require("../Functions/ExecuteQuery");

const { RegisterAuditAction } = require("./Auditory"); 
const {
  VENDUS_CreateInvoiceCodeAndDoc,
  getPaymentMethods,
  resolvePaymentMethod,
} = require("../Functions/VENDUS");

// ── NOVO: Modelo de Processo de Matrícula configurável por escola ─────────
// Ver PATCH_modelo_matricula_configuravel.md
const {
  getInstituteEnrollmentModel,
  usesFinancialConfirmation,
} = require("../Functions/EnrollmentModel");

// ══════════════════════════════════════════════════════════════════════════
// RESUMO DAS CORREÇÕES APLICADAS NESTE FICHEIRO (procura "FIX:" no código)
// ══════════════════════════════════════════════════════════════════════════
// 1) BUG PRINCIPAL — "aluno aparece como não matriculado mas dá ALREADY_ENROLLED":
//    Havia DUAS fontes de verdade diferentes e dessincronizadas:
//      a) GetStudentsFullOverview decidia "matriculado" pela flag solta
//         ed_student_enrolled (que pode ficar desactualizada — ex: reset de
//         ano lectivo, alteração manual, migração antiga, etc).
//      b) processMatricula/findActiveEnrollmentConflict decidia "já
//         matriculado" pela existência de uma linha activa em
//         eduall_enrollment.
//
//    CORREÇÃO (pedido do utilizador): a validação de MATRÍCULA (processMatricula)
//    passa a ser GLOBAL — um aluno só pode ter UM registo de matrícula na
//    escola, independentemente do ano lectivo. Se já existir uma linha
//    activa em eduall_enrollment (qualquer ano), o aluno NÃO pode voltar a
//    ser matriculado; só pode ser "confirmado" (processConfirmacao) para
//    uma nova turma. AMBOS os lados — o ecrã (GetStudentsFullOverview) e o
//    bloqueio no backend (findActiveEnrollmentConflict) — usam agora
//    exactamente a MESMA fonte de verdade: existe ou não existe uma linha
//    não apagada em eduall_enrollment para este aluno neste instituto.
//    A flag ed_student_enrolled deixa de ser autoridade sobre "matriculado
//    ou não"; passa a ser só um indicador auxiliar/legado.
//
// 2) BUG SECUNDÁRIO (do log) — "Unknown column 'ed_enrollment_invoice_code'":
//    a tabela eduall_enrollment não tem as colunas de fatura. O ficheiro
//    .sql anexo (EnrollmentTables.ESPERADO.sql) cria/adiciona essas
//    colunas. Mantive o try/catch de segurança, mas agora já não deveria
//    disparar depois de correres o ALTER TABLE.
//
// 3) GetStudentsFullOverview escolhia, por aluno, APENAS UMA linha de
//    eduall_enrollment (a primeira encontrada nos chunks, ordem não
//    garantida) — o que podia devolver a matrícula errada quando o aluno
//    tinha mais do que uma linha. Agora guarda-se TODAS as linhas por
//    aluno, ordenadas pela mais recente (ORDER BY ed_enrollment_id DESC),
//    e escolhe-se sempre a mais recente — já que agora só deve existir UM
//    registo activo por aluno (a validação global impede criar um segundo).
//
// 4) FIX — CONFIRMAÇÃO EXIGIA SERVIÇO + PAGAMENTO OBRIGATÓRIOS:
//    processConfirmacao rejeitava sempre a confirmação se não viesse
//    serviceId e um objeto payment completo, mesmo quando a confirmação
//    não deveria implicar cobrança nenhuma. Agora, à semelhança de
//    processMatricula, o pagamento é OPCIONAL: só é validado/processado
//    (serviço, método de pagamento, fatura Vendus, borderô, saldo) se o
//    payload trouxer `payment.enabled === true`. A turma (classId)
//    continua obrigatória, pois é o próprio objectivo da confirmação.
//
// 5) FIX (pedido do utilizador) — CONFIRMAÇÃO SEM BLOQUEIO DE MATRÍCULA:
//    a confirmação de matrícula deixou de exigir qualquer matrícula
//    activa prévia do aluno (removida a verificação
//    findActiveEnrollmentConflict / código NO_ACTIVE_ENROLLMENT que aqui
//    existia). Um aluno pode ser confirmado tantas vezes quantas forem
//    necessárias — não há limite de confirmações nem depende de já ter
//    sido matriculado antes. A ÚNICA restrição que se mantém em
//    processConfirmacao é não permitir confirmar o aluno para a MESMA
//    turma em que ele já se encontra actualmente (ed_student_class) —
//    nesse caso devolve-se o código SAME_CLASS.
//
// 6) FIX (pedido do utilizador) — "alunos sem turma desaparecem da
//    listagem geral": GetStudentsFullOverview construía a listagem
//    SEMPRE a partir das turmas (loadClasses → loadStudentsOfClasses com
//    `ed_student_class IN (classIds)`), pelo que um aluno com
//    ed_student_class vazio/nulo/0 nunca entrava na query e, portanto,
//    nunca aparecia em lado nenhum — mesmo que a listagem fosse "todos os
//    alunos". Agora, quando não se filtra por uma turma específica
//    (classId não indicado), a rota também vai buscar os alunos sem turma
//    atribuída (loadStudentsWithoutClass) e agrupa-os num grupo virtual
//    "Sem Turma" (class_id: 0) que aparece juntamente com as restantes
//    turmas na resposta, com os mesmos campos (grades vazias, sem plano
//    curricular, sem limite de vagas).
//
// 7) NOVO (Modelo de Processo de Matrícula configurável por escola) —
//    Ver PATCH_modelo_matricula_configuravel.md. Duas peças novas:
//      a) processMatricula passa a consultar getInstituteEnrollmentModel()
//         e, quando a escola usa 'matricula_confirmacao_financeira',
//         ignora classId/payment vindos do payload — a matrícula nasce
//         sempre sem turma e sem pagamento, e o aluno fica com
//         ed_student_awaiting_payment = 1 (ver Students.js).
//      b) processPaymentConfirmation (nova acção "confirmacao_pagamento"
//         no endpoint unificado) reaproveita processConfirmacao já
//         existente para atribuir turma + processar pagamento opcional,
//         e só acrescenta a transição ed_student_awaiting_payment: 1 → 0.
//      GetStudentsFullOverview passa a expor awaiting_payment dentro de
//      school_situation para a Lista Geral poder assinalar o estado.
// ══════════════════════════════════════════════════════════════════════════

// ──────────────────────────────────────────────────────────────
// CORES DE CONSOLE (ANSI)
// ──────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgRed: "\x1b[41m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
};

function logEntryResult(result, entry) {
  if (!result) return;

  if (result.success) {
    console.log(
      `${C.bgGreen}${C.white}${C.bold} SUCESSO ${C.reset} ` +
      `${C.green}${C.bold}Aluno ${result.studentId}${C.reset} ` +
      `${C.dim}(${result.action})${C.reset} - ${C.green}${result.msg}${C.reset}`
    );
    if (result.invoice?.number) {
      console.log(`${C.dim}  Fatura: ${result.invoice.number} (id ${result.invoice.id})${C.reset}`);
    }
    return;
  }

  console.log("");
  console.log(`${C.bgRed}${C.white}${C.bold}                              ERRO NO REGISTO                              ${C.reset}`);
  console.log(`${C.red}${C.bold}  Aluno:${C.reset}   ${C.yellow}${result.studentId ?? "desconhecido"}${C.reset}`);
  console.log(`${C.red}${C.bold}  Acao:${C.reset}    ${C.yellow}${result.action ?? "desconhecida"}${C.reset}`);
  console.log(`${C.red}${C.bold}  Codigo:${C.reset}  ${C.magenta}${result.code ?? "SEM_CODIGO"}${C.reset}`);
  console.log(`${C.red}${C.bold}  Mensagem:${C.reset} ${C.white}${result.msg ?? "Sem detalhes."}${C.reset}`);

  if (result.capacity) {
    console.log(`${C.red}  Capacidade da turma:${C.reset} ${JSON.stringify(result.capacity)}`);
  }

  if (entry) {
    console.log(`${C.cyan}  Payload enviado:${C.reset}`);
    console.log(`${C.cyan}${JSON.stringify(entry, null, 2)}${C.reset}`);
  }

  console.log(`${C.red}${"-".repeat(78)}${C.reset}`);
  console.log("");
}

function logBatchSummary({ total, succeeded, failed, matriculas, confirmacoes, durationMs }) {
  const barColor = failed > 0 ? C.bgYellow : C.bgGreen;
  console.log("");
  console.log(`${barColor}${C.bold} RESUMO DO LOTE ${C.reset}`);
  console.log(`${C.bold}  Total de alunos:${C.reset}      ${total}`);
  console.log(`${C.green}${C.bold}  Sucessos:${C.reset}          ${C.green}${succeeded}${C.reset}`);
  console.log(`${failed > 0 ? C.red : C.dim}${C.bold}  Falhas:${C.reset}            ${failed > 0 ? C.red : C.dim}${failed}${C.reset}`);
  console.log(`${C.dim}  Matrículas concluídas:${C.reset} ${matriculas}`);
  console.log(`${C.dim}  Confirmações concluídas:${C.reset} ${confirmacoes}`);
  console.log(`${C.dim}  Duração total:${C.reset}     ${durationMs}ms`);
  console.log("");
}

// ──────────────────────────────────────────────────────────────
// CACHE
// ──────────────────────────────────────────────────────────────
const RefreshEnrollmentCaches = async (instituteCode) => {
  const startTime = Date.now();
  await Cache.eduallClear("enrollment:*");
  console.log(`${C.dim}[CACHE] limpa para institute ${instituteCode} (EnrollmentUnified) em ${Date.now() - startTime}ms${C.reset}`);
};

// ──────────────────────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────────────────────
function requiresBordereau(methodName) {
  const name = String(methodName || "").toLowerCase().trim();
  const requiresIt = [
    "transfer", "transferência", "deposito", "deposit",
    "tpa", "referência", "reference", "bordereau", "cheque", "mbway",
  ];
  return requiresIt.some((req) => name.includes(req));
}

async function getOperatorData(userId) {
  if (!userId) return { id: null, name: "Desconhecido" };
  try {
    const [operator] = await ExecuteQuery(
      null,
      `SELECT ed_user_account_id, ed_user_account_name
       FROM eduall_user_accounts
       WHERE ed_user_account_id = ? AND ed_user_account_deleted = 0
       LIMIT 1`,
      [userId],
      true
    );
    return operator
      ? { id: operator.ed_user_account_id, name: operator.ed_user_account_name || "Desconhecido" }
      : { id: userId, name: "Desconhecido" };
  } catch (err) {
    console.warn(`${C.yellow}[getOperatorData] Erro: ${err.message}${C.reset}`);
    return { id: userId, name: "Desconhecido" };
  }
}

async function loadClassDetails(classId, instituteCode) {
  if (!classId) return null;
  const [row] = await ExecuteQuery(
    null,
    `SELECT
        c.ed_class_id, c.ed_class_title, c.ed_class_student_limit,
        cr.ed_classroom_title,
        al.ed_academic_level_title,
        ci.ed_cicle_title,
        ay.ed_academic_year_id, ay.ed_academic_year_title,
        co.ed_course_title
     FROM eduall_class c
     LEFT JOIN eduall_classrooms     cr  ON cr.ed_classroom_id      = c.ed_class_room
     LEFT JOIN eduall_academic_level al  ON al.ed_academic_level_id = c.ed_class_academic_level
     LEFT JOIN eduall_cicles         ci  ON ci.ed_cicle_id          = c.ed_class_cicle
     LEFT JOIN eduall_academic_year  ay  ON ay.ed_academic_year_id  = c.ed_class_year
     LEFT JOIN eduall_courses        co  ON co.ed_course_id         = c.ed_class_course
     WHERE c.ed_class_id = ?
       AND c.ed_class_institute_code = ?
       AND COALESCE(c.ed_class_deleted, 0) = 0
     LIMIT 1`,
    [classId, instituteCode],
    true
  );
  return row || null;
}

function buildClassObsBlock(cls) {
  if (!cls) return "";
  const lines = [];
  if (cls.ed_class_title)          lines.push(`Turma: ${cls.ed_class_title}`);
  if (cls.ed_cicle_title)          lines.push(`Ciclo: ${cls.ed_cicle_title}`);
  if (cls.ed_academic_level_title) lines.push(`Classe: ${cls.ed_academic_level_title}`);
  if (cls.ed_course_title)         lines.push(`Curso: ${cls.ed_course_title}`);
  if (cls.ed_classroom_title)      lines.push(`Sala: ${cls.ed_classroom_title}`);
  if (cls.ed_academic_year_title)  lines.push(`Ano Letivo: ${cls.ed_academic_year_title}`);
  return lines.length ? lines.join("\n") : "";
}

// FIX: helper mantido — continua a ser usado para resolver o ano lectivo
// "actual" do instituto quando a matrícula é feita SEM turma (classId
// null), apenas para efeitos de REGISTO (gravar em que ano a matrícula
// aconteceu). Já NÃO é usado para decidir se o aluno pode ou não
// matricular-se de novo — essa decisão passou a ser global (ver
// findActiveEnrollmentConflict).
async function getCurrentAcademicYear(res, instituteCode) {
  const [byDate] = await ExecuteQuery(
    res,
    `SELECT ed_academic_year_id, ed_academic_year_title,
            ed_academic_year_startDate, ed_academic_year_endDate
     FROM eduall_academic_year
     WHERE ed_academic_year_institute_code = ?
       AND COALESCE(ed_academic_year_deleted, 0) = 0
       AND CURDATE() BETWEEN ed_academic_year_startDate AND ed_academic_year_endDate
     ORDER BY ed_academic_year_startDate DESC
     LIMIT 1`,
    [instituteCode],
    true
  ).catch(() => [null]);

  if (byDate) return byDate;

  // Fallback: nenhum ano "em curso" pela data — usa o mais recente cadastrado
  const [latest] = await ExecuteQuery(
    res,
    `SELECT ed_academic_year_id, ed_academic_year_title,
            ed_academic_year_startDate, ed_academic_year_endDate
     FROM eduall_academic_year
     WHERE ed_academic_year_institute_code = ?
       AND COALESCE(ed_academic_year_deleted, 0) = 0
     ORDER BY ed_academic_year_startDate DESC
     LIMIT 1`,
    [instituteCode],
    true
  ).catch(() => [null]);

  return latest || null;
}

async function countActiveStudentsInClass(res, classId, instituteCode) {
  const [row] = await ExecuteQuery(
    res,
    `SELECT COUNT(*) AS total FROM eduall_students
     WHERE ed_student_deleted = 0
       AND ed_student_class = ?
       AND ed_student_institute_code = ?`,
    [classId, instituteCode],
    true
  );
  return Number(row?.total) || 0;
}

async function checkClassCapacity(res, classDetails, instituteCode, excludeStudentId = null) {
  const limitRaw = classDetails?.ed_class_student_limit;
  const limit =
    limitRaw === null || limitRaw === undefined || limitRaw === "" || Number(limitRaw) <= 0
      ? null
      : Number(limitRaw);

  let current = await countActiveStudentsInClass(res, classDetails.ed_class_id, instituteCode);

  if (excludeStudentId) {
    const [already] = await ExecuteQuery(
      res,
      `SELECT ed_student_id FROM eduall_students
       WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_class = ?
       LIMIT 1`,
      [excludeStudentId, classDetails.ed_class_id],
      true
    );
    if (already) current = Math.max(0, current - 1);
  }

  if (limit === null) return { isFull: false, limit: null, current, available: null };

  return { isFull: current >= limit, limit, current, available: Math.max(limit - current, 0) };
}

// FIX (pedido do utilizador): validação de matrícula (processMatricula) é
// GLOBAL. Um aluno só pode ter UM registo de matrícula na escola — não
// importa em que ano lectivo foi feito. Se já existir qualquer linha
// activa (não apagada) em eduall_enrollment para este aluno neste
// instituto, a matrícula é bloqueada (ALREADY_ENROLLED) e o aluno só pode
// passar por "confirmação" (processConfirmacao) para mudar de turma/ano.
//
// IMPORTANTE: esta função continua a ser usada em processMatricula, mas
// DEIXOU de ser usada em processConfirmacao — a confirmação já não exige
// nenhuma matrícula activa prévia (ver FIX 5 no cabeçalho do ficheiro).
async function findActiveEnrollmentConflict(res, studentId, instituteCode) {
  const [row] = await ExecuteQuery(
    res,
    `SELECT ed_enrollment_id FROM eduall_enrollment
     WHERE ed_enrollment_deleted = 0
       AND ed_enrollment_institute_code = ?
       AND ed_enrollment_student = ?
     LIMIT 1`,
    [instituteCode, studentId],
    true
  );
  return row || null;
}

async function loadServiceInfo(serviceId, instituteCode) {
  if (!serviceId) return null;
  const [row] = await ExecuteQuery(
    null,
    `SELECT ed_service_id, ed_service_title, ed_service_type, ed_service_price
     FROM eduall_services
     WHERE ed_service_id = ?
       AND ed_service_institute_code = ?
       AND COALESCE(ed_service_deleted, 0) = 0
     LIMIT 1`,
    [serviceId, instituteCode],
    true
  );
  return row || null;
}

async function getStudentBalancePreview(studentId, instituteCode) {
  const [row] = await ExecuteQuery(
    null,
    `SELECT sb_balance, sb_currency FROM eduall_student_balance
     WHERE sb_student_id = ? AND sb_institute_code = ? LIMIT 1`,
    [studentId, instituteCode],
    true
  );
  return {
    balance: parseFloat(row?.sb_balance ?? 0),
    currency: row?.sb_currency || "AOA",
  };
}

async function getBordereauAvailablePreview(bordereauNumber, instituteCode) {
  const [row] = await ExecuteQuery(
    null,
    `SELECT ed_bordereau_original_value, ed_bordereau_used_value
     FROM eduall_bordereau_control
     WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ? AND COALESCE(ed_bordereau_deleted,0) = 0
     LIMIT 1`,
    [bordereauNumber, instituteCode],
    true
  );
  if (!row) return null;
  return Math.max(0, parseFloat(row.ed_bordereau_original_value) - parseFloat(row.ed_bordereau_used_value));
}

async function debitStudentBalance(res, { studentId, instituteCode, amountToDebit, description, reference, operatorId }) {
  if (!amountToDebit || amountToDebit <= 0) return { balanceBefore: null, balanceAfter: null };

  await ExecuteQuery(
    res,
    `INSERT IGNORE INTO eduall_student_balance (sb_student_id, sb_institute_code, sb_balance, sb_currency)
     VALUES (?, ?, 0, 'AOA')`,
    [studentId, instituteCode], false
  );

  const [current] = await ExecuteQuery(
    res,
    `SELECT sb_balance, sb_currency FROM eduall_student_balance
     WHERE sb_student_id = ? AND sb_institute_code = ? FOR UPDATE`,
    [studentId, instituteCode], true
  );

  const balanceBefore = parseFloat(current?.sb_balance ?? 0);
  const currency = current?.sb_currency || "AOA";

  if (amountToDebit > balanceBefore + 0.001) {
    const err = new Error(`Saldo insuficiente. Saldo atual: ${balanceBefore.toFixed(2)} ${currency}. Tentou usar: ${amountToDebit.toFixed(2)} ${currency}.`);
    err.code = "INSUFFICIENT_BALANCE";
    throw err;
  }

  const balanceAfter = Number((balanceBefore - amountToDebit).toFixed(2));

  await ExecuteQuery(
    res,
    `UPDATE eduall_student_balance SET sb_balance = ?
     WHERE sb_student_id = ? AND sb_institute_code = ?`,
    [balanceAfter, studentId, instituteCode], false
  );

  await ExecuteQuery(
    res,
    `INSERT INTO eduall_student_balance_logs
       (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
        sb_log_amount, sb_log_balance_before, sb_log_balance_after,
        sb_log_description, sb_log_reference, sb_log_user_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [studentId, instituteCode, "deduct", "matriculas_confirmacoes", amountToDebit, balanceBefore, balanceAfter, description, reference || null, operatorId || null],
    false
  );

  return { balanceBefore, balanceAfter, currency };
}

async function debitBordereau(res, { bordereauNumber, instituteCode, amountToDebit, studentId, invoiceCode, operatorName, operatorId }) {
  if (!bordereauNumber || !amountToDebit || amountToDebit <= 0) return null;

  await ExecuteQuery(
    res,
    `INSERT IGNORE INTO eduall_bordereau_control
       (ed_bordereau_number, ed_bordereau_original_value, ed_bordereau_used_value, ed_bordereau_institute_code)
     VALUES (?, 0, 0, ?)`,
    [bordereauNumber, instituteCode], false
  );

  await ExecuteQuery(res, "START TRANSACTION", [], false);
  try {
    const [row] = await ExecuteQuery(
      res,
      `SELECT ed_bordereau_original_value, ed_bordereau_used_value
       FROM eduall_bordereau_control
       WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ? FOR UPDATE`,
      [bordereauNumber, instituteCode], true
    );

    const available = Math.max(0, parseFloat(row?.ed_bordereau_original_value ?? 0) - parseFloat(row?.ed_bordereau_used_value ?? 0));

    if (amountToDebit > available + 0.001) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      throw new Error(`Saldo insuficiente no borderô ${bordereauNumber}: ${available.toFixed(2)}`);
    }

    const usedAfter = Number((parseFloat(row?.ed_bordereau_used_value ?? 0) + amountToDebit).toFixed(2));

    await ExecuteQuery(
      res,
      `UPDATE eduall_bordereau_control
       SET ed_bordereau_used_value = ?
       WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ?`,
      [usedAfter, bordereauNumber, instituteCode], false
    );

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_bordereau_usage_logs
         (ed_bl_bordereau_number, ed_bl_institute_code, ed_bl_student_id, ed_bl_invoice_code, ed_bl_amount_used, ed_bl_balance_before, ed_bl_balance_after, ed_bl_operator, ed_bl_operator_id)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [bordereauNumber, instituteCode, studentId || null, invoiceCode || null, amountToDebit, available, Math.max(0, available - amountToDebit), operatorName || null, operatorId || null],
      false
    );

    await ExecuteQuery(res, "COMMIT", [], false);
    return { balanceBefore: available, balanceAfter: Math.max(0, available - amountToDebit) };
  } catch (err) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    throw err;
  }
}

function buildInvoiceLines({ baseService, basePrice, baseTitle, extraServices = [] }) {
  const lines = [];

  const roundedBasePrice = Number((parseFloat(basePrice) || 0).toFixed(2));
  lines.push({
    code: baseService.ed_service_id,
    reference: String(baseService.ed_service_id),
    title: baseTitle,
    description: baseTitle,
    price: roundedBasePrice, unit_price: roundedBasePrice, gross_price: roundedBasePrice, value: roundedBasePrice,
    quantity: 1, qty: 1, amount: 1,
    discount_percent: 0, discount: 0, discount_amount: 0,
    line_total: roundedBasePrice, total: roundedBasePrice, gross_amount: roundedBasePrice,
  });

  for (const s of extraServices) {
    const price = Number((parseFloat(s.unit_price ?? s.price) || 0).toFixed(2));
    const qty = Math.max(1, parseFloat(s.amount ?? s.quantity) || 1);
    const discountPct = Math.max(0, parseFloat(s.discount) || 0);
    const subtotal = price * qty;
    const discountAmount = Number(((subtotal * discountPct) / 100).toFixed(2));
    const lineTotal = Number((subtotal - discountAmount).toFixed(2));

    if (!price || price <= 0 || !lineTotal || lineTotal <= 0) continue;

    lines.push({
      code: s.code,
      reference: String(s.code),
      title: s.service_name || s.title || `Serviço ${s.code}`,
      description: s.service_name || s.title || `Serviço ${s.code}`,
      price, unit_price: price, gross_price: price, value: price,
      quantity: qty, qty, amount: qty,
      discount_percent: discountPct, discount: discountPct, discount_amount: discountAmount,
      line_total: lineTotal, total: lineTotal, gross_amount: lineTotal,
    });
  }

  return lines;
}

// ──────────────────────────────────────────────────────────────
// PROCESSAMENTO DE UM ALUNO — MATRÍCULA
// ──────────────────────────────────────────────────────────────
async function processMatricula(req, res, entry, ctx) {
  const { instituteCode, operator, instituteName } = ctx;
  const { studentId, classId = null, serviceId = null, docs = [], payment } = entry;

  const [student] = await ExecuteQuery(
    res,
    `SELECT ed_student_id, ed_student_code, ed_student_name, ed_student_class,
            ed_student_identityCard, ed_student_address, ed_student_email, ed_student_enrolled
     FROM eduall_students
     WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_id = ?
     LIMIT 1`,
    [instituteCode, studentId], true
  );
  if (!student) return { studentId, action: "matricula", success: false, code: "STUDENT_NOT_FOUND", msg: "Aluno não encontrado." };

  // FIX: verificação de conflito agora é GLOBAL — não depende de turma nem
  // de ano lectivo. Basta existir UMA linha activa em eduall_enrollment
  // para este aluno, em qualquer ano, para bloquear uma nova matrícula.
  const conflict = await findActiveEnrollmentConflict(res, studentId, instituteCode);
  if (conflict) {
    return {
      studentId, action: "matricula", success: false, code: "ALREADY_ENROLLED",
      msg: `${student.ed_student_name} já possui uma matrícula ativa na escola. Utilize a opção de confirmação de matrícula para o mudar de turma/ano.`,
    };
  }

  // ── NOVO: Modelo de Processo de Matrícula da escola ─────────────────
  // Ver PATCH_modelo_matricula_configuravel.md, secção 5.
  // No modelo "matricula_confirmacao_financeira" a matrícula inicial
  // NUNCA atribui turma nem processa pagamento — isso só acontece na
  // confirmação de pagamento (processPaymentConfirmation). Ignoramos
  // silenciosamente classId/payment vindos do payload para este modelo.
  const enrollmentModel = await getInstituteEnrollmentModel(res, instituteCode);
  const financialConfirmationMode = usesFinancialConfirmation(enrollmentModel);

  const effectiveClassId = financialConfirmationMode ? null : classId;
  const effectivePayment = financialConfirmationMode ? null : payment;

  let serviceInfo = null;
  if (serviceId) {
    serviceInfo = await loadServiceInfo(serviceId, instituteCode);
    if (!serviceInfo) return { studentId, action: "matricula", success: false, code: "INVALID_SERVICE", msg: "Serviço selecionado não existe ou não pertence ao instituto." };
  }

  let classDetails = null;
  if (effectiveClassId) {
    classDetails = await loadClassDetails(effectiveClassId, instituteCode);
    if (!classDetails) return { studentId, action: "matricula", success: false, code: "INVALID_CLASS", msg: "Turma selecionada não existe ou não pertence ao instituto." };
  }

  // Ano lectivo resolvido apenas para efeitos de REGISTO (para saber em
  // que ano esta matrícula concreta aconteceu) — já não decide se o aluno
  // pode ou não matricular-se (isso é a verificação global acima).
  const academicYearId = classDetails?.ed_academic_year_id
    || (await getCurrentAcademicYear(res, instituteCode))?.ed_academic_year_id
    || null;

  if (classDetails) {
    const capacity = await checkClassCapacity(res, classDetails, instituteCode, studentId);
    if (capacity.isFull) {
      return {
        studentId, action: "matricula", success: false, code: "CLASS_FULL",
        msg: `A turma "${classDetails.ed_class_title}" está lotada (${capacity.current}/${capacity.limit} alunos). Não é possível matricular mais alunos nesta turma.`,
        capacity,
      };
    }
  }

  let vendus = null;
  let selectedPaymentMethod = null;
  let bordereauAmountUsed = 0;
  let balanceUsed = 0;
  let bordereauNumber = "";
  let paidValue = 0;
  let paidCurrency = "AOA";
  let paymentBank = "";
  let paymentPlace = "";

  if (effectivePayment?.enabled) {
    if (!serviceId || !serviceInfo) {
      return { studentId, action: "matricula", success: false, code: "MISSING_SERVICE", msg: "É necessário selecionar um serviço para efetuar o pagamento da matrícula." };
    }

    const paymentMethods = await getPaymentMethods(req);
    if (!paymentMethods?.length) return { studentId, action: "matricula", success: false, code: "NO_PAYMENT_METHODS", msg: "Nenhum método de pagamento configurado." };

    selectedPaymentMethod = resolvePaymentMethod(Number(effectivePayment.paymentMethodIndex ?? 0), paymentMethods);
    if (!selectedPaymentMethod) return { studentId, action: "matricula", success: false, code: "INVALID_PAYMENT_METHOD", msg: "Método de pagamento inválido." };

    bordereauNumber = (effectivePayment.bordereauNumber || effectivePayment.paymentReference || "").trim();
    if (requiresBordereau(selectedPaymentMethod.name) && !bordereauNumber) {
      return { studentId, action: "matricula", success: false, code: "MISSING_BORDEREAU", msg: `O método "${selectedPaymentMethod.name}" requer número de borderô/referência.` };
    }

    bordereauAmountUsed = Math.max(0, parseFloat(effectivePayment.bordereauAmountUsed) || 0);
    balanceUsed = Math.max(0, parseFloat(effectivePayment.balanceUsed) || 0);

    if (balanceUsed > 0) {
      const { balance: currentBalance, currency } = await getStudentBalancePreview(studentId, instituteCode);
      if (balanceUsed > currentBalance + 0.001) {
        return {
          studentId, action: "matricula", success: false, code: "INSUFFICIENT_BALANCE",
          msg: `Saldo insuficiente. Saldo atual: ${currentBalance.toFixed(2)} ${currency}. Tentou usar: ${balanceUsed.toFixed(2)} ${currency}.`,
        };
      }
    }

    if (bordereauNumber && bordereauAmountUsed > 0) {
      const available = await getBordereauAvailablePreview(bordereauNumber, instituteCode);
      if (available !== null && bordereauAmountUsed > available + 0.001) {
        return {
          studentId, action: "matricula", success: false, code: "INSUFFICIENT_BORDEREAU",
          msg: `Saldo insuficiente no borderô ${bordereauNumber}. Disponível: ${available.toFixed(2)}. Tentou usar: ${bordereauAmountUsed.toFixed(2)}.`,
        };
      }
    }

    const basePrice = serviceInfo.ed_service_price;
    const invoiceLines = buildInvoiceLines({
      baseService: serviceInfo,
      basePrice: effectivePayment.servicePrice ?? basePrice,
      baseTitle: `Matrícula - ${serviceInfo.ed_service_title}`,
      extraServices: effectivePayment.extraServices || [],
    });

    const totalInvoiceValue = invoiceLines.reduce((acc, l) => acc + l.line_total, 0);
    if (!Number.isFinite(totalInvoiceValue) || totalInvoiceValue <= 0) {
      return { studentId, action: "matricula", success: false, code: "ZERO_TOTAL_VALUE", msg: "Valor total do pagamento não pode ser zero." };
    }
    paidValue = totalInvoiceValue;
    paymentBank = effectivePayment.paymentBank || "";
    paymentPlace = effectivePayment.paymentPlace || "";

    const obsParts = [];
    obsParts.push("Matrícula");
    obsParts.push(`Nº matrícula: ${student.ed_student_code || "-"}`);
    const classObs = buildClassObsBlock(classDetails);
    if (classObs) obsParts.push(classObs);
    if (instituteName) obsParts.push(`Instituição: ${instituteName}`);
    obsParts.push(`Operador: ${operator.name}`);
    obsParts.push("---");
    obsParts.push(`Forma de pagamento: ${selectedPaymentMethod.name}`);
    if (bordereauNumber) {
      obsParts.push(`Nº Borderô/Referência: ${bordereauNumber}`);
      if (effectivePayment.paymentBank) obsParts.push(`Banco: ${effectivePayment.paymentBank}`);
      if (effectivePayment.paymentPlace) obsParts.push(`Local: ${effectivePayment.paymentPlace}`);
      if (bordereauAmountUsed > 0) obsParts.push(`Valor do borderô aplicado: ${bordereauAmountUsed.toFixed(2)} AOA`);
    }
    if (balanceUsed > 0) obsParts.push(`Saldo do aluno utilizado: ${balanceUsed.toFixed(2)} AOA`);
    if (effectivePayment.observations) obsParts.push(effectivePayment.observations);
    const obs = obsParts.join("\n");

    const customer = {
      code: student.ed_student_code, name: student.ed_student_name,
      email: student.ed_student_email || "", address: student.ed_student_address || "",
      nif: student.ed_student_identityCard || "",
    };

    try {
      vendus = await VENDUS_CreateInvoiceCodeAndDoc(req, customer, invoiceLines, Number(effectivePayment.paymentMethodIndex ?? 0), obs);
    } catch (vErr) {
      return { studentId, action: "matricula", success: false, code: "VENDUS_ERROR", msg: `Falha ao criar fatura: ${vErr.message}` };
    }
    if (!vendus?.number || !vendus?.id) {
      return { studentId, action: "matricula", success: false, code: "VENDUS_INVALID_RESPONSE", msg: "Resposta inválida da VENDUS." };
    }
  }

  await ExecuteQuery(res, "START TRANSACTION", [], false);
  try {
    if (classDetails) {
      const capacityRecheck = await checkClassCapacity(res, classDetails, instituteCode, studentId);
      if (capacityRecheck.isFull) {
        throw Object.assign(
          new Error(`A turma "${classDetails.ed_class_title}" ficou lotada enquanto este pedido era processado. Não foi possível concluir a matrícula.`),
          { code: "CLASS_FULL" }
        );
      }
    }

    // FIX: reconfirma o conflito global DENTRO da transação (protege contra
    // pedidos em paralelo para o mesmo aluno enviados quase ao mesmo tempo).
    const conflictRecheck = await findActiveEnrollmentConflict(res, studentId, instituteCode);
    if (conflictRecheck) {
      throw Object.assign(
        new Error(`${student.ed_student_name} já possui uma matrícula ativa na escola.`),
        { code: "ALREADY_ENROLLED" }
      );
    }

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_enrollment
         (ed_enrollment_student, ed_enrollment_service, ed_enrollment_class,
          ed_enrollment_academic_year, ed_enrollment_institute_code,
          ed_enrollment_paid_value, ed_enrollment_currency,
          ed_enrollment_payment_method_id, ed_enrollment_payment_bank, ed_enrollment_payment_place,
          ed_enrollment_bordereau, ed_enrollment_bordereau_amount, ed_enrollment_balance_used)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        studentId, serviceId || null, effectiveClassId || null, academicYearId || null, instituteCode,
        paidValue || 0, paidCurrency,
        selectedPaymentMethod?.vendus_id ?? null, paymentBank || null, paymentPlace || null,
        bordereauNumber || null, bordereauAmountUsed || 0, balanceUsed || 0,
      ],
      false
    );

    const [enrollmentRow] = await ExecuteQuery(
      res,
      `SELECT ed_enrollment_id FROM eduall_enrollment
       WHERE ed_enrollment_deleted = 0 AND ed_enrollment_institute_code = ? AND ed_enrollment_student = ?
       ORDER BY ed_enrollment_id DESC LIMIT 1`,
      [instituteCode, studentId], true
    );
    if (!enrollmentRow) throw Object.assign(new Error("Matrícula não confirmada na base de dados."), { code: "ENROLLMENT_NOT_CONFIRMED" });

    if (effectiveClassId && student.ed_student_class && student.ed_student_class != effectiveClassId) {
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class) VALUES (?, ?)`,
        [studentId, student.ed_student_class], false
      );
    }
    if (effectiveClassId && student.ed_student_class != effectiveClassId) {
      await ExecuteQuery(res, `UPDATE eduall_students SET ed_student_class = ? WHERE ed_student_id = ?`, [effectiveClassId, studentId], false);
    }

    // FIX: a flag ed_student_enrolled deixa de ser a fonte de verdade para
    // "matriculado" (isso agora vive em eduall_enrollment), mas continua a
    // ser actualizada para não quebrar integrações antigas que ainda a
    // consultem. ed_student_awaiting_payment é a NOVA fonte de verdade
    // para "pode receber turma?" quando a escola usa o modelo de
    // confirmação financeira.
    await ExecuteQuery(
      res,
      `UPDATE eduall_students
          SET ed_student_enrolled = GREATEST(COALESCE(ed_student_enrolled,0), 1),
              ed_student_awaiting_payment = ?
        WHERE ed_student_id = ?`,
      [financialConfirmationMode ? 1 : 0, studentId], false
    );

    for (const doc of docs) {
      if (!doc?.name || !String(doc.name).trim()) continue;
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_enrollment_docs
         (ed_enrollment_docs_enrollment, ed_enrollment_docs_name, ed_enrollment_docs_status,
          ed_enrollment_docs_file, ed_enrollment_docs_file_name, ed_enrollment_docs_institute)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [enrollmentRow.ed_enrollment_id, doc.name.trim(), doc.status ?? 0, doc.file || null, doc.fileName || null, instituteCode],
        false
      );
    }

    let balanceResult = null;
    if (balanceUsed > 0) {
      balanceResult = await debitStudentBalance(res, {
        studentId, instituteCode, amountToDebit: balanceUsed,
        description: `Matrícula — Fatura ${vendus?.number || "?"}. Saldo utilizado: ${balanceUsed.toFixed(2)} AOA.`,
        reference: vendus?.number, operatorId: operator.id,
      });
    }

    if (vendus) {
      await ExecuteQuery(
        res,
        `UPDATE eduall_enrollment SET ed_enrollment_invoice_code = ?, ed_enrollment_invoice_file = ?
         WHERE ed_enrollment_id = ?`,
        [vendus.number, vendus.id, enrollmentRow.ed_enrollment_id], false
      ).catch(() => {
        console.warn(`${C.yellow}[processMatricula] eduall_enrollment sem colunas de fatura — corre EnrollmentTables.ESPERADO.sql. (ignorado, não crítico)${C.reset}`);
      });
    }

    await ExecuteQuery(res, "COMMIT", [], false);

    if (bordereauNumber && bordereauAmountUsed > 0) {
      try {
        await debitBordereau(res, {
          bordereauNumber, instituteCode, amountToDebit: bordereauAmountUsed,
          studentId, invoiceCode: vendus?.number || null,
          operatorName: operator.name, operatorId: operator.id,
        });
      } catch (bErr) {
        console.error(`${C.red}[processMatricula] Erro ao debitar borderô (após commit): ${bErr.message}${C.reset}`);
      }
    }

    RegisterAuditAction({
      session: req.session, action: 1, form: "Matrículas",
      description: financialConfirmationMode
        ? `Registou matrícula para o estudante #${student.ed_student_code} – ${student.ed_student_name} — aguarda confirmação de pagamento (modelo: matrícula + confirmação financeira)`
        : `Registou matrícula para o estudante #${student.ed_student_code} – ${student.ed_student_name}${classDetails ? ` na turma ${classDetails.ed_class_title}` : " (sem turma)"}${vendus ? ` — Fatura ${vendus.number}` : " (sem pagamento)"}`,
    }).catch((e) => console.error(`${C.red}Erro auditoria: ${e.message}${C.reset}`));

    return {
      studentId, action: "matricula", success: true, code: "SUCCESS",
      msg: financialConfirmationMode
        ? `${student.ed_student_name} matriculado com sucesso — aguarda confirmação de pagamento.`
        : `${student.ed_student_name} matriculado com sucesso.`,
      awaitingPayment: financialConfirmationMode,
      enrollmentId: enrollmentRow.ed_enrollment_id,
      classId: effectiveClassId || null,
      serviceId: serviceId || null,
      academicYearId: academicYearId || null,
      invoice: vendus ? { number: vendus.number, id: vendus.id } : null,
    };
  } catch (err) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    return { studentId, action: "matricula", success: false, code: err.code || "INTERNAL_ERROR", msg: err.message };
  }
}

// ──────────────────────────────────────────────────────────────
// PROCESSAMENTO DE UM ALUNO — CONFIRMAÇÃO DE MATRÍCULA
//
// FIX: o pagamento é OPCIONAL, tal como em processMatricula. `classId`
// continua OBRIGATÓRIO (é o próprio objectivo da confirmação: mudar o
// aluno para a turma definitiva). `serviceId` e o bloco de
// pagamento/fatura só são exigidos/processados se `payment?.enabled ===
// true`.
//
// FIX (pedido do utilizador): a confirmação DEIXOU DE EXIGIR qualquer
// matrícula activa prévia do aluno na escola — foi removida a verificação
// findActiveEnrollmentConflict / o código NO_ACTIVE_ENROLLMENT que aqui
// existia. Um aluno pode ser confirmado quantas vezes forem necessárias.
// A ÚNICA restrição que se mantém é não permitir confirmar para a MESMA
// turma em que o aluno já está actualmente (ed_student_class) — nesse
// caso devolve-se o código SAME_CLASS.
//
// NOTA (Modelo de Processo de Matrícula): esta função é reaproveitada
// tal-e-qual por processPaymentConfirmation (abaixo) — é o "motor" que
// atribui turma + processa pagamento opcional; a única coisa que
// processPaymentConfirmation acrescenta é a transição de
// ed_student_awaiting_payment de 1 para 0.
// ──────────────────────────────────────────────────────────────
async function processConfirmacao(req, res, entry, ctx) {
  const { instituteCode, operator, instituteName } = ctx;
  const { studentId, classId, serviceId = null, payment } = entry;

  if (!classId) return { studentId, action: "confirmacao", success: false, code: "MISSING_CLASS", msg: "A nova turma é obrigatória para confirmar a matrícula." };

  const [student] = await ExecuteQuery(
    res,
    `SELECT ed_student_id, ed_student_code, ed_student_name, ed_student_class,
            ed_student_identityCard, ed_student_address, ed_student_email, ed_student_enrolled
     FROM eduall_students
     WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_id = ?
     LIMIT 1`,
    [instituteCode, studentId], true
  );
  if (!student) return { studentId, action: "confirmacao", success: false, code: "STUDENT_NOT_FOUND", msg: "Aluno não encontrado." };

  const classDetails = await loadClassDetails(classId, instituteCode);
  if (!classDetails) return { studentId, action: "confirmacao", success: false, code: "INVALID_CLASS", msg: "Turma selecionada não existe ou não pertence ao instituto." };

  // FIX (pedido do utilizador): já NÃO se verifica se o aluno tem alguma
  // matrícula activa registada — a confirmação não depende disso e não
  // tem limite de quantas vezes pode ser feita. A ÚNICA coisa que
  // continua a ser bloqueada é confirmar o aluno para a turma em que ele
  // já se encontra neste momento.
  if (student.ed_student_class && Number(student.ed_student_class) === Number(classId)) {
    return {
      studentId, action: "confirmacao", success: false, code: "SAME_CLASS",
      msg: `${student.ed_student_name} já se encontra na turma "${classDetails.ed_class_title}". Selecione uma turma diferente para confirmar.`,
    };
  }

  const capacity = await checkClassCapacity(res, classDetails, instituteCode, studentId);
  if (capacity.isFull) {
    return {
      studentId, action: "confirmacao", success: false, code: "CLASS_FULL",
      msg: `A turma "${classDetails.ed_class_title}" está lotada (${capacity.current}/${capacity.limit} alunos). Não é possível confirmar mais alunos nesta turma.`,
      capacity,
    };
  }

  let serviceInfo = null;
  let vendus = null;
  let selectedPaymentMethod = null;
  let bordereauNumber = "";
  let bordereauAmountUsed = 0;
  let balanceUsed = 0;
  let paidValue = 0;
  let paidCurrency = "AOA";
  let paymentBank = "";
  let paymentPlace = "";

  if (payment?.enabled) {
    if (!serviceId) {
      return { studentId, action: "confirmacao", success: false, code: "MISSING_SERVICE", msg: "É necessário selecionar um serviço para efetuar o pagamento da confirmação." };
    }

    serviceInfo = await loadServiceInfo(serviceId, instituteCode);
    if (!serviceInfo) return { studentId, action: "confirmacao", success: false, code: "INVALID_SERVICE", msg: "Serviço selecionado não existe ou não pertence ao instituto." };

    const paymentMethods = await getPaymentMethods(req);
    if (!paymentMethods?.length) return { studentId, action: "confirmacao", success: false, code: "NO_PAYMENT_METHODS", msg: "Nenhum método de pagamento configurado." };

    selectedPaymentMethod = resolvePaymentMethod(Number(payment.paymentMethodIndex ?? 0), paymentMethods);
    if (!selectedPaymentMethod) return { studentId, action: "confirmacao", success: false, code: "INVALID_PAYMENT_METHOD", msg: "Método de pagamento inválido." };

    bordereauNumber = (payment.bordereauNumber || payment.paymentReference || "").trim();
    if (requiresBordereau(selectedPaymentMethod.name) && !bordereauNumber) {
      return { studentId, action: "confirmacao", success: false, code: "MISSING_BORDEREAU", msg: `O método "${selectedPaymentMethod.name}" requer número de borderô/referência.` };
    }

    bordereauAmountUsed = Math.max(0, parseFloat(payment.bordereauAmountUsed) || 0);
    balanceUsed = Math.max(0, parseFloat(payment.balanceUsed) || 0);

    if (balanceUsed > 0) {
      const { balance: currentBalance, currency } = await getStudentBalancePreview(studentId, instituteCode);
      if (balanceUsed > currentBalance + 0.001) {
        return {
          studentId, action: "confirmacao", success: false, code: "INSUFFICIENT_BALANCE",
          msg: `Saldo insuficiente. Saldo atual: ${currentBalance.toFixed(2)} ${currency}. Tentou usar: ${balanceUsed.toFixed(2)} ${currency}.`,
        };
      }
    }

    if (bordereauNumber && bordereauAmountUsed > 0) {
      const available = await getBordereauAvailablePreview(bordereauNumber, instituteCode);
      if (available !== null && bordereauAmountUsed > available + 0.001) {
        return {
          studentId, action: "confirmacao", success: false, code: "INSUFFICIENT_BORDEREAU",
          msg: `Saldo insuficiente no borderô ${bordereauNumber}. Disponível: ${available.toFixed(2)}. Tentou usar: ${bordereauAmountUsed.toFixed(2)}.`,
        };
      }
    }

    const invoiceLines = buildInvoiceLines({
      baseService: serviceInfo,
      basePrice: payment.servicePrice ?? serviceInfo.ed_service_price,
      baseTitle: `Confirmação de Matrícula - ${serviceInfo.ed_service_title}`,
      extraServices: payment.extraServices || [],
    });

    const totalInvoiceValue = invoiceLines.reduce((acc, l) => acc + l.line_total, 0);
    if (!Number.isFinite(totalInvoiceValue) || totalInvoiceValue <= 0) {
      return { studentId, action: "confirmacao", success: false, code: "ZERO_TOTAL_VALUE", msg: "Valor total do pagamento não pode ser zero." };
    }

    paidValue = totalInvoiceValue;
    paymentBank = payment.paymentBank || "";
    paymentPlace = payment.paymentPlace || "";

    const obsParts = [];
    obsParts.push("Confirmação de Matrícula");
    obsParts.push(`Nº matrícula: ${student.ed_student_code || "-"}`);
    const classObs = buildClassObsBlock(classDetails);
    if (classObs) obsParts.push(classObs);
    if (instituteName) obsParts.push(`Instituição: ${instituteName}`);
    obsParts.push(`Operador: ${operator.name}`);
    obsParts.push("---");
    obsParts.push(`Forma de pagamento: ${selectedPaymentMethod.name}`);
    if (bordereauNumber) {
      obsParts.push(`Nº Borderô/Referência: ${bordereauNumber}`);
      if (payment.paymentBank) obsParts.push(`Banco: ${payment.paymentBank}`);
      if (payment.paymentPlace) obsParts.push(`Local: ${payment.paymentPlace}`);
      if (bordereauAmountUsed > 0) obsParts.push(`Valor do borderô aplicado: ${bordereauAmountUsed.toFixed(2)} AOA`);
    }
    if (balanceUsed > 0) obsParts.push(`Saldo do aluno utilizado: ${balanceUsed.toFixed(2)} AOA`);
    if (payment.observations) obsParts.push(payment.observations);
    const obs = obsParts.join("\n");

    const customer = {
      code: student.ed_student_code, name: student.ed_student_name,
      email: student.ed_student_email || "", address: student.ed_student_address || "",
      nif: student.ed_student_identityCard || "",
    };

    try {
      vendus = await VENDUS_CreateInvoiceCodeAndDoc(req, customer, invoiceLines, Number(payment.paymentMethodIndex ?? 0), obs);
    } catch (vErr) {
      return { studentId, action: "confirmacao", success: false, code: "VENDUS_ERROR", msg: `Falha ao criar fatura: ${vErr.message}` };
    }
    if (!vendus?.number || !vendus?.id) {
      return { studentId, action: "confirmacao", success: false, code: "VENDUS_INVALID_RESPONSE", msg: "Resposta inválida da VENDUS." };
    }
  }

  await ExecuteQuery(res, "START TRANSACTION", [], false);
  try {
    const capacityRecheck = await checkClassCapacity(res, classDetails, instituteCode, studentId);
    if (capacityRecheck.isFull) {
      throw Object.assign(
        new Error(`A turma "${classDetails.ed_class_title}" ficou lotada enquanto este pedido era processado. Não foi possível concluir a confirmação.`),
        { code: "CLASS_FULL" }
      );
    }

    // FIX: reconfirma DENTRO da transação que o aluno continua a não estar
    // já na turma de destino (protege contra pedidos em paralelo para o
    // mesmo aluno enviados quase ao mesmo tempo).
    const [studentRecheck] = await ExecuteQuery(
      res,
      `SELECT ed_student_class FROM eduall_students
       WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_id = ?
       LIMIT 1`,
      [instituteCode, studentId], true
    );
    if (studentRecheck?.ed_student_class && Number(studentRecheck.ed_student_class) === Number(classId)) {
      throw Object.assign(
        new Error(`${student.ed_student_name} já se encontra na turma "${classDetails.ed_class_title}".`),
        { code: "SAME_CLASS" }
      );
    }

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_enrollment_confirmations(
         ed_enrollment_confirmation_student, ed_enrollment_confirmation_class, ed_enrollment_confirmation_service,
         ed_enrollment_confirmation_institute_code, ed_enrollment_confirmation_invoice_code,
         ed_enrollment_confirmation_invoice_file, ed_enrollment_confirmation_payment_method_id,
         ed_enrollment_confirmation_payment_bank, ed_enrollment_confirmation_payment_place,
         ed_enrollment_confirmation_bordereau, ed_enrollment_confirmation_bordereau_amount,
         ed_enrollment_confirmation_balance_used, ed_enrollment_confirmation_paid_value,
         ed_enrollment_confirmation_currency
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        studentId, classId, serviceId || null, instituteCode,
        vendus?.number || null, vendus?.id || null,
        selectedPaymentMethod?.vendus_id ?? null, paymentBank || null, paymentPlace || null,
        bordereauNumber || null, bordereauAmountUsed || 0, balanceUsed || 0,
        paidValue || 0, paidCurrency,
      ],
      false
    );

    const [confirmationRow] = await ExecuteQuery(
      res,
      `SELECT ed_enrollment_confirmation_id FROM eduall_enrollment_confirmations
       WHERE ed_enrollment_confirmation_deleted = 0 AND ed_enrollment_confirmation_institute_code = ?
         AND ed_enrollment_confirmation_student = ?
       ORDER BY ed_enrollment_confirmation_id DESC LIMIT 1`,
      [instituteCode, studentId], true
    );

    if (student.ed_student_class && student.ed_student_class != classId) {
      await ExecuteQuery(
        res,
        `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class) VALUES (?, ?)`,
        [studentId, student.ed_student_class], false
      );
    }

    await ExecuteQuery(
      res,
      `UPDATE eduall_students SET ed_student_class = ?, ed_student_enrolled = 2 WHERE ed_student_id = ?`,
      [classId, studentId], false
    );

    let balanceResult = null;
    if (balanceUsed > 0) {
      balanceResult = await debitStudentBalance(res, {
        studentId, instituteCode, amountToDebit: balanceUsed,
        description: `Confirmação de matrícula — Fatura ${vendus?.number || "sem fatura"}. Saldo utilizado: ${balanceUsed.toFixed(2)} AOA.`,
        reference: vendus?.number, operatorId: operator.id,
      });
    }

    await ExecuteQuery(res, "COMMIT", [], false);

    if (bordereauNumber && bordereauAmountUsed > 0) {
      try {
        await debitBordereau(res, {
          bordereauNumber, instituteCode, amountToDebit: bordereauAmountUsed,
          studentId, invoiceCode: vendus?.number || null,
          operatorName: operator.name, operatorId: operator.id,
        });
      } catch (bErr) {
        console.error(`${C.red}[processConfirmacao] Erro ao debitar borderô (após commit): ${bErr.message}${C.reset}`);
      }
    }

    RegisterAuditAction({
      session: req.session, action: 1, form: "Confirmações de Matrícula",
      description: `Registou confirmação de matrícula para #${student.ed_student_code} – ${student.ed_student_name} na turma ${classDetails.ed_class_title}${vendus ? ` — Fatura ${vendus.number}` : " (sem pagamento)"}`,
    }).catch((e) => console.error(`${C.red}Erro auditoria: ${e.message}${C.reset}`));

    return {
      studentId, action: "confirmacao", success: true, code: "SUCCESS",
      msg: `Confirmação de matrícula de ${student.ed_student_name} registada com sucesso.`,
      confirmationId: confirmationRow?.ed_enrollment_confirmation_id || null,
      classId,
      invoice: vendus ? { number: vendus.number, id: vendus.id } : null,
    };
  } catch (err) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    return { studentId, action: "confirmacao", success: false, code: err.code || "INTERNAL_ERROR", msg: err.message };
  }
}

// ──────────────────────────────────────────────────────────────
// PROCESSAMENTO DE UM ALUNO — CONFIRMAÇÃO DE PAGAMENTO DA MATRÍCULA
// (Modelo de Processo de Matrícula: "matricula_confirmacao_financeira")
//
// NOVO — Ver PATCH_modelo_matricula_configuravel.md, secção 6.
//
// Este é o momento em que a Secretaria confirma o pagamento de uma
// matrícula pendente e o aluno passa "Aguarda Pagamento → Activo",
// ficando elegível para receber turma. Reaproveita TUDO o que já existe
// em processConfirmacao (fatura VENDUS, borderô, saldo, capacidade da
// turma) — só acrescenta a transição de ed_student_awaiting_payment.
// ──────────────────────────────────────────────────────────────
async function processPaymentConfirmation(req, res, entry, ctx) {
  const { instituteCode, operator } = ctx;
  const { studentId } = entry;

  const [student] = await ExecuteQuery(
    res,
    `SELECT ed_student_id, ed_student_code, ed_student_name, ed_student_awaiting_payment
       FROM eduall_students
      WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_id = ?
      LIMIT 1`,
    [instituteCode, studentId], true
  );
  if (!student) {
    return { studentId, action: "confirmacao_pagamento", success: false, code: "STUDENT_NOT_FOUND", msg: "Aluno não encontrado." };
  }
  if (Number(student.ed_student_awaiting_payment) !== 1) {
    return {
      studentId, action: "confirmacao_pagamento", success: false, code: "NOT_AWAITING_PAYMENT",
      msg: `${student.ed_student_name} não está com o status "Aguarda Pagamento".`,
    };
  }

  // Reutiliza o fluxo de confirmação existente (turma + pagamento opcional).
  const confirmationResult = await processConfirmacao(req, res, entry, ctx);
  if (!confirmationResult.success) {
    return { ...confirmationResult, action: "confirmacao_pagamento" };
  }

  // Activa o aluno — só depois do sucesso da confirmação acima.
  await ExecuteQuery(
    res,
    `UPDATE eduall_students SET ed_student_awaiting_payment = 0
      WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
    [studentId, instituteCode], false
  );

  await RegisterAuditAction({
    session: req.session, action: 2, form: "Matrículas",
    description: `Confirmou o pagamento da matrícula de ${student.ed_student_name} (#${student.ed_student_code}) — status alterado para Activo.`,
  }).catch((e) => console.error(`${C.red}Erro auditoria: ${e.message}${C.reset}`));

  return {
    ...confirmationResult,
    action: "confirmacao_pagamento",
    msg: `Pagamento confirmado. ${student.ed_student_name} está agora Activo e pode ser atribuído a uma turma.`,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT PRINCIPAL — REGISTAR MATRÍCULAS E/OU CONFIRMAÇÕES EM LOTE
// (sem alterações de estrutura — só beneficia das correções acima + a nova
//  acção "confirmacao_pagamento" do Modelo de Processo de Matrícula)
// ═════════════════════════════════════════════════════════════════════════════
const RegisterUnifiedEnrollmentOrConfirmation = async (req, res) => {
  const t0 = Date.now();
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida: instituto não identificado." });
    }

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    if (!entries.length) {
      return res.status(400).json({ success: false, msg: "Nenhum aluno fornecido em 'entries'." });
    }

    console.log("");
    console.log(`${C.cyan}${C.bold}[RegisterUnifiedEnrollmentOrConfirmation]${C.reset} ${entries.length} aluno(s) recebido(s) para o instituto ${C.bold}${instituteCode}${C.reset}`);

    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(operatorId);

    const [inst] = await ExecuteQuery(res, `SELECT ed_institute_name FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`, [instituteCode], true);
    const instituteName = inst?.ed_institute_name || "";

    const ctx = { instituteCode, operator, instituteName };

    // Acções válidas do endpoint unificado:
    //   "matricula"            → processMatricula
    //   "confirmacao"          → processConfirmacao
    //   "confirmacao_pagamento" → processPaymentConfirmation (NOVO)
    const VALID_ACTIONS = ["matricula", "confirmacao", "confirmacao_pagamento"];

    const results = [];
    for (const entry of entries) {
      if (!entry || !entry.studentId || !VALID_ACTIONS.includes(entry.action)) {
        const invalidResult = {
          studentId: entry?.studentId ?? null, action: entry?.action ?? null,
          success: false, code: "INVALID_ENTRY",
          msg: `Entrada inválida: studentId e action (${VALID_ACTIONS.map(a => `'${a}'`).join(" | ")}) são obrigatórios.`,
        };
        results.push(invalidResult);
        logEntryResult(invalidResult, entry);
        continue;
      }

      try {
        const result = entry.action === "matricula"
          ? await processMatricula(req, res, entry, ctx)
          : entry.action === "confirmacao_pagamento"
            ? await processPaymentConfirmation(req, res, entry, ctx)
            : await processConfirmacao(req, res, entry, ctx);
        results.push(result);
        logEntryResult(result, entry);
      } catch (err) {
        console.error(`${C.bgRed}${C.white}${C.bold} EXCEÇÃO NÃO TRATADA ${C.reset} ${C.red}Aluno ${entry.studentId}: ${err.message}${C.reset}`);
        console.error(`${C.red}${err.stack}${C.reset}`);
        const errorResult = { studentId: entry.studentId, action: entry.action, success: false, code: "UNEXPECTED_ERROR", msg: err.message };
        results.push(errorResult);
        logEntryResult(errorResult, entry);
      }
    }

    const succeeded = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const matriculas = results.filter((r) => r.action === "matricula" && r.success).length;
    const confirmacoes = results.filter((r) => (r.action === "confirmacao" || r.action === "confirmacao_pagamento") && r.success).length;

    if (succeeded.length > 0) {
      await RefreshEnrollmentCaches(instituteCode);
    }

    const durationMs = Date.now() - t0;

    logBatchSummary({
      total: entries.length,
      succeeded: succeeded.length,
      failed: failed.length,
      matriculas,
      confirmacoes,
      durationMs,
    });

    return res.status(failed.length > 0 && succeeded.length === 0 ? 400 : 200).json({
      success: succeeded.length > 0,
      summary: {
        total: entries.length,
        succeeded: succeeded.length,
        failed: failed.length,
        matriculas,
        confirmacoes,
      },
      results,
      duration_ms: durationMs,
    });
  } catch (error) {
    console.error(`${C.bgRed}${C.white}${C.bold} ERRO GERAL ${C.reset} ${C.red}[RegisterUnifiedEnrollmentOrConfirmation]: ${error.message}${C.reset}`);
    console.error(`${C.red}${error.stack}${C.reset}`);
    return res.status(500).json({
      success: false,
      msg: "Erro ao processar o registo de matrículas/confirmações.",
      error: error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS GERAIS
// ─────────────────────────────────────────────────────────────────────────────
const parseIds = (str) => {
  if (!str) return [];
  return String(str)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
};

const parseBehaviors = (csv) => {
  const map = new Map();
  if (!csv) return map;
  String(csv)
    .split(",")
    .filter(Boolean)
    .forEach((pair) => {
      const [id, behavior] = pair.split(":");
      if (id && behavior) map.set(Number(id), behavior);
    });
  return map;
};

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const clean2 = (v) => {
  if (v === null || v === undefined) return null;
  return Math.round(v * 100) / 100;
};

const applyRounding = (v, roundMode) => {
  if (v === null || v === undefined) return null;
  const n = clean2(v);
  if (!roundMode) return n;
  if (roundMode === "ceil") return Math.ceil(n);
  return Math.round(n);
};

const shortName = (fullName) => {
  if (!fullName) return "";
  const parts = String(fullName).trim().split(/\s+/);
  if (parts.length <= 2) return fullName;
  return `${parts[0]} ${parts[parts.length - 1]}`;
};

const periodLabel = (v) => {
  const n = Number(v);
  if (n === 0) return "Manhã";
  if (n === 1) return "Tarde";
  if (n === 2) return "Noturno";
  return "";
};

const parseStudentIdFilter = (value) => {
  if (value === undefined || value === null || value === "") return [];
  const arr = Array.isArray(value) ? value : [value];
  return arr.map(Number).filter(Number.isFinite);
};

const chunkArray = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const QUARTER_LABEL = { 1: "1º Trimestre", 2: "2º Trimestre", 3: "3º Trimestre" };
const APPROVAL_WEIGHTED_THRESHOLD = 3;

const MONTHS_LIST = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function buildAcademicYearMonths(start, end) {
  if (!start || !end || !String(start).includes("-") || !String(end).includes("-")) return [];
  const [Y1, M1] = String(start).split("-").map(Number);
  const [Y2, M2] = String(end).split("-").map(Number);
  const months = [];
  const pushMonth = (m, y) => months.push({ month: `${MONTHS_LIST[m]} de ${y}`, code: parseFloat(`${m}.${y}`) });
  if (Y1 === Y2) {
    for (let m = M1 - 1; m <= M2 - 1; m++) pushMonth(m, Y1);
  } else {
    for (let m = M1 - 1; m <= 11; m++) pushMonth(m, Y1);
    for (let m = 0; m <= M2 - 1; m++) pushMonth(m, Y2);
  }
  return months;
}

// ─────────────────────────────────────────────────────────────────────────────
// TURMAS
// ─────────────────────────────────────────────────────────────────────────────
async function loadClasses(res, instituteCode, classId, academicYear) {
  let query = `
    SELECT c.*,
      cr.ed_classroom_id,
      cr.ed_classroom_title,
      al.ed_academic_level_id,
      al.ed_academic_level_title,
      al.ed_academic_level_avaliationtype_endat AS max_value,
      ci.ed_cicle_id,
      ci.ed_cicle_title,
      f.ed_faculty_id,
      f.ed_faculty_title,
      ay.ed_academic_year_id   AS academic_year_id,
      ay.ed_academic_year_title,
      ay.ed_academic_year_startDate,
      ay.ed_academic_year_endDate,
      co.ed_course_id,
      co.ed_course_title,
      emp.ed_employee_id   AS director_id,
      emp.ed_employee_name AS director_name
    FROM eduall_class c
    LEFT JOIN eduall_classrooms     cr  ON cr.ed_classroom_id      = c.ed_class_room       AND cr.ed_classroom_deleted = 0
    LEFT JOIN eduall_academic_level al  ON al.ed_academic_level_id = c.ed_class_academic_level AND al.ed_academic_level_deleted = 0
    LEFT JOIN eduall_cicles         ci  ON ci.ed_cicle_id          = c.ed_class_cicle       AND ci.ed_cicle_deleted = 0
    LEFT JOIN eduall_faculty        f   ON f.ed_faculty_id         = c.ed_class_faculty     AND f.ed_faculty_deleted = 0
    LEFT JOIN eduall_academic_year  ay  ON ay.ed_academic_year_id  = c.ed_class_year        AND ay.ed_academic_year_deleted = 0
    LEFT JOIN eduall_courses        co  ON co.ed_course_id         = c.ed_class_course      AND co.ed_course_deleted = 0
    LEFT JOIN eduall_employees      emp ON emp.ed_employee_id      = c.ed_class_director
    WHERE c.ed_class_deleted = 0
      AND c.ed_class_institute_code = ?
  `;
  const params = [instituteCode];

  if (classId) {
    query += ` AND c.ed_class_id = ?`;
    params.push(classId);
  }
  if (academicYear) {
    const isNumeric = /^\d+$/.test(String(academicYear));
    query += isNumeric ? ` AND c.ed_class_year = ?` : ` AND ay.ed_academic_year_title = ?`;
    params.push(academicYear);
  }
  query += ` ORDER BY c.ed_class_title ASC`;

  return ExecuteQuery(res, query, params, true);
}

async function loadStudentsOfClasses(res, instituteCode, classIds, search, studentIdList) {
  let query = `
    SELECT * FROM eduall_students
    WHERE ed_student_deleted = 0
      AND ed_student_institute_code = ?
      AND ed_student_class IN (${classIds.map(() => "?").join(",")})
  `;
  const params = [instituteCode, ...classIds];

  const searchTerm = typeof search === "string" ? search.trim() : "";
  if (searchTerm) {
    query += ` AND (ed_student_name LIKE ? OR ed_student_code LIKE ?)`;
    params.push(`%${searchTerm}%`, `%${searchTerm}%`);
  }

  if (studentIdList.length) {
    query += ` AND ed_student_id IN (${studentIdList.map(() => "?").join(",")})`;
    params.push(...studentIdList);
  }

  query += ` ORDER BY ed_student_class ASC, ed_student_name ASC`;

  return ExecuteQuery(res, query, params, true);
}

// FIX (pedido do utilizador): novo helper — vai buscar os alunos que NÃO
// têm nenhuma turma atribuída (ed_student_class vazio, nulo ou 0). Antes
// desta correção, estes alunos nunca entravam em loadStudentsOfClasses
// (que filtra por `ed_student_class IN (classIds)`) e por isso
// desapareciam completamente da listagem geral, mesmo pedindo "todos os
// alunos". No Modelo de Processo de Matrícula "matricula_confirmacao_
// financeira" é AQUI que os alunos "Aguarda Pagamento" aparecem — já que
// nascem sempre sem turma.
async function loadStudentsWithoutClass(res, instituteCode, search, studentIdList) {
  let query = `
    SELECT * FROM eduall_students
    WHERE ed_student_deleted = 0
      AND ed_student_institute_code = ?
      AND (ed_student_class IS NULL OR ed_student_class = 0 OR ed_student_class = '')
  `;
  const params = [instituteCode];

  const searchTerm = typeof search === "string" ? search.trim() : "";
  if (searchTerm) {
    query += ` AND (ed_student_name LIKE ? OR ed_student_code LIKE ?)`;
    params.push(`%${searchTerm}%`, `%${searchTerm}%`);
  }

  if (studentIdList.length) {
    query += ` AND ed_student_id IN (${studentIdList.map(() => "?").join(",")})`;
    params.push(...studentIdList);
  }

  query += ` ORDER BY ed_student_name ASC`;

  return ExecuteQuery(res, query, params, true);
}

async function loadStudentCountsByClass(res, instituteCode, classIds) {
  const map = new Map();
  if (!classIds.length) return map;

  const rows = await ExecuteQuery(
    res,
    `SELECT ed_student_class AS class_id, COUNT(*) AS total
     FROM eduall_students
     WHERE ed_student_deleted = 0
       AND ed_student_institute_code = ?
       AND ed_student_class IN (${classIds.map(() => "?").join(",")})
     GROUP BY ed_student_class`,
    [instituteCode, ...classIds],
    true
  );

  rows.forEach((r) => map.set(Number(r.class_id), Number(r.total) || 0));
  return map;
}

async function loadSubjectsBatch(res, subjectIds) {
  const map = new Map();
  if (!subjectIds.length) return map;
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_subject_id, ed_subject_title
     FROM eduall_subjects
     WHERE ed_subject_id IN (${subjectIds.map(() => "?").join(",")})
       AND ed_subject_deleted = 0`,
    subjectIds,
    true
  );
  rows.forEach((r) => map.set(Number(r.ed_subject_id), r.ed_subject_title));
  return map;
}

async function loadQuarterlyNotesBatch(res, classIds) {
  const map = new Map();
  if (!classIds.length) return map;
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_quarter_note_class, ed_quarter_note_studentcode, ed_quarter_note_subject,
            ed_quarter_note_quarter, ed_quarter_note_mac, ed_quarter_note_npt
     FROM eduall_quarterly_notes
     WHERE ed_quarter_note_deleted = 0
       AND ed_quarter_note_class IN (${classIds.map(() => "?").join(",")})`,
    classIds,
    true
  );
  rows.forEach((n) => {
    const key = `${n.ed_quarter_note_class}_${n.ed_quarter_note_studentcode}_${n.ed_quarter_note_subject}_${n.ed_quarter_note_quarter}`;
    map.set(key, { mac: num(n.ed_quarter_note_mac), npt: num(n.ed_quarter_note_npt) });
  });
  return map;
}

// FIX: continua a devolver TODAS as linhas de eduall_enrollment por aluno
// (enrollmentsByStudent: Map<studentId, row[]>), ordenadas da mais
// recente para a mais antiga (ORDER BY ed_enrollment_id DESC). Como a
// validação global agora impede um aluno ter mais do que uma linha
// activa, normalmente só existirá uma — mas mantemos o array por
// segurança/histórico, e escolhemos sempre a mais recente.
async function loadEnrollmentAndConfirmationBatch(res, instituteCode, studentIds) {
  if (!studentIds.length) {
    return {
      enrollmentsByStudent: new Map(),
      confirmationByStudent: new Map(),
      confirmationsHistoryByStudent: new Map(),
    };
  }

  const chunks = chunkArray(studentIds, 1000);

  const enrollmentChunks = await Promise.all(
    chunks.map((chunk) =>
      ExecuteQuery(
        res,
        `SELECT se.*, sv.ed_service_title, sv.ed_service_price, c.ed_class_title,
                c.ed_class_year AS class_academic_year_id
         FROM eduall_enrollment se
         LEFT JOIN eduall_services sv ON sv.ed_service_id = se.ed_enrollment_service
         LEFT JOIN eduall_class    c  ON c.ed_class_id    = se.ed_enrollment_class
         WHERE se.ed_enrollment_deleted = 0
           AND se.ed_enrollment_institute_code = ?
           AND se.ed_enrollment_student IN (${chunk.map(() => "?").join(",")})
         ORDER BY se.ed_enrollment_id DESC`,
        [instituteCode, ...chunk],
        true
      )
    )
  );

  const confirmationChunks = await Promise.all(
    chunks.map((chunk) =>
      ExecuteQuery(
        res,
        `SELECT ec.*, c.ed_class_title, c.ed_class_code,
                srv.ed_service_title, srv.ed_service_price
         FROM eduall_enrollment_confirmations ec
         LEFT JOIN eduall_class    c   ON c.ed_class_id   = ec.ed_enrollment_confirmation_class
         LEFT JOIN eduall_services srv ON srv.ed_service_id = ec.ed_enrollment_confirmation_service
         WHERE ec.ed_enrollment_confirmation_deleted = 0
           AND ec.ed_enrollment_confirmation_institute_code = ?
           AND ec.ed_enrollment_confirmation_student IN (${chunk.map(() => "?").join(",")})
         ORDER BY ec.ed_enrollment_confirmation_id DESC`,
        [instituteCode, ...chunk],
        true
      )
    )
  );

  const enrollmentsByStudent = new Map();
  enrollmentChunks.flat().forEach((e) => {
    const sid = Number(e.ed_enrollment_student);
    if (!enrollmentsByStudent.has(sid)) enrollmentsByStudent.set(sid, []);
    enrollmentsByStudent.get(sid).push(e);
  });

  const confirmationByStudent = new Map();
  const confirmationsHistoryByStudent = new Map();
  confirmationChunks.flat().forEach((c) => {
    const sid = Number(c.ed_enrollment_confirmation_student);
    if (!confirmationsHistoryByStudent.has(sid)) confirmationsHistoryByStudent.set(sid, []);
    confirmationsHistoryByStudent.get(sid).push(c);
    if (!confirmationByStudent.has(sid)) confirmationByStudent.set(sid, c);
  });

  return { enrollmentsByStudent, confirmationByStudent, confirmationsHistoryByStudent };
}

// FIX (pedido do utilizador): já não escolhe por ano lectivo. Escolhe
// sempre a matrícula MAIS RECENTE do aluno (a lista já vem ordenada por
// ed_enrollment_id DESC) — que é a mesma regra "existe um registo na
// escola" usada em findActiveEnrollmentConflict. Isto é o que garante que
// o `is_enrolled` que aparece no ecrã nunca mais contradiz o bloqueio de
// ALREADY_ENROLLED no backend.
function pickEnrollmentRecord(enrollmentRows) {
  if (!enrollmentRows || !enrollmentRows.length) return null;
  return enrollmentRows[0];
}

async function loadFeesPaymentsBatch(res, instituteCode, studentIds, academicYearIds) {
  const map = new Map();
  if (!studentIds.length || !academicYearIds.length) return map;

  const chunks = chunkArray(studentIds, 1000);

  const rowsChunks = await Promise.all(
    chunks.map((chunk) =>
      ExecuteQuery(
        res,
        `SELECT ed_fee_payment_student, ed_fee_payment_academic_year, ed_fee_payment_month
         FROM eduall_fees_payments
         WHERE ed_fee_payment_deleted = 0
           AND ed_fee_payment_institute_code = ?
           AND ed_fee_payment_student IN (${chunk.map(() => "?").join(",")})
           AND ed_fee_payment_academic_year IN (${academicYearIds.map(() => "?").join(",")})`,
        [instituteCode, ...chunk, ...academicYearIds],
        true
      )
    )
  );

  rowsChunks.flat().forEach((p) => {
    const key = `${p.ed_fee_payment_student}_${p.ed_fee_payment_academic_year}`;
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(parseFloat(p.ed_fee_payment_month));
  });

  return map;
}

function buildPaymentStatus(academicYearMonths, paidMonthsSet) {
  if (!academicYearMonths.length) {
    return { total_months: 0, paid_count: 0, notpaid_count: 0, months: [] };
  }
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth();

  const months = academicYearMonths.map((m) => {
    const paid = paidMonthsSet.has(m.code);
    const [monthIndex, year] = m.code.toString().split(".").map(Number);
    let status = "other";
    if (paid) status = "paid";
    else if (year < curYear || (year === curYear && monthIndex < curMonth)) status = "notpaid";
    return { ...m, status };
  });

  return {
    total_months: months.length,
    paid_count: months.filter((m) => m.status === "paid").length,
    notpaid_count: months.filter((m) => m.status === "notpaid").length,
    months,
  };
}

function buildClassCapacity(studentLimitRaw, currentStudents) {
  const studentLimit =
    studentLimitRaw === null || studentLimitRaw === undefined || studentLimitRaw === ""
      ? null
      : Number(studentLimitRaw);

  const hasLimit = studentLimit !== null && Number.isFinite(studentLimit) && studentLimit > 0;

  return {
    student_limit: hasLimit ? studentLimit : null,
    current_students: currentStudents,
    available_spots: hasLimit ? Math.max(studentLimit - currentStudents, 0) : null,
    is_full: hasLimit ? currentStudents >= studentLimit : false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CRITÉRIO DE APROVAÇÃO (sem alterações)
// ─────────────────────────────────────────────────────────────────────────────
function resolveSubjectApproval(subjectId, mtOrMdf, passValue, keySet, behaviorMap) {
  const isKey = keySet.has(subjectId);
  const behavior = behaviorMap.get(subjectId) || "negative_reprova";
  const excludedFromApproval = behavior === "approve_anyway";

  const passed = mtOrMdf !== null ? mtOrMdf >= passValue : null;
  const countsAsNegative = passed === false && !excludedFromApproval;
  const weight = isKey ? 2 : 1;

  return {
    is_key: isKey,
    behavior,
    passed,
    counts_for_approval: !excludedFromApproval,
    weighted_negative: countsAsNegative ? weight : 0,
  };
}

function computeSituation(subjectIds, gradeGetter, passValue, keySet, behaviorMap, requireComplete) {
  let weightedNegatives = 0;
  let gradedCount = 0;
  let completeCount = 0;

  subjectIds.forEach((subjectId) => {
    const value = gradeGetter(subjectId);
    if (value !== null) {
      gradedCount++;
      completeCount++;
      const approval = resolveSubjectApproval(subjectId, value, passValue, keySet, behaviorMap);
      weightedNegatives += approval.weighted_negative;
    }
  });

  if (!subjectIds.length) return { situation: "SEM DADOS", weighted_negatives: 0 };
  if (requireComplete && completeCount < subjectIds.length) {
    return { situation: "EM AVALIAÇÃO", weighted_negatives: weightedNegatives };
  }
  if (gradedCount === 0) return { situation: "SEM DADOS", weighted_negatives: 0 };

  return {
    situation: weightedNegatives >= APPROVAL_WEIGHTED_THRESHOLD ? "NÃO TRANSITA" : "TRANSITA",
    weighted_negatives: weightedNegatives,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// ENDPOINT PRINCIPAL — GetStudentsFullOverview
// ═════════════════════════════════════════════════════════════════════════════
const GetStudentsFullOverview = async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      classId,
      academicYear,
      roundMode = null,
      page = null,
      pageSize = null,
      search = null,
      studentId = null,
      includeQuarterlyReport = true,
      includePaymentStatus = true,
    } = req.body;

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida: instituto não identificado." });
    }

    const studentIdList = parseStudentIdFilter(studentId);

    const classes = await loadClasses(res, instituteCode, classId, academicYear);
    const classIds = classes.map((c) => Number(c.ed_class_id));

    // FIX (pedido do utilizador): só faz sentido ir buscar os alunos "sem
    // turma" quando a listagem é geral (não se filtrou por uma turma
    // específica). Se veio um `classId` no pedido, o utilizador quer ver
    // só aquela turma — nesse caso não faz sentido misturar os alunos sem
    // turma nenhuma.
    const wantsUnclassedGroup = !classId;

    const classStudents = classIds.length
      ? await loadStudentsOfClasses(res, instituteCode, classIds, search, studentIdList)
      : [];

    // FIX: antes desta correção, alunos com ed_student_class vazio/nulo/0
    // nunca entravam em nenhuma query (loadStudentsOfClasses filtra
    // sempre por `ed_student_class IN (classIds)`) e por isso
    // desapareciam por completo da listagem geral. Agora vão também
    // buscar-se explicitamente. É também aqui que aparecem os alunos
    // "Aguarda Pagamento" do Modelo de Processo de Matrícula configurável.
    const unclassedStudents = wantsUnclassedGroup
      ? await loadStudentsWithoutClass(res, instituteCode, search, studentIdList)
      : [];

    let allStudents = [...classStudents, ...unclassedStudents];

    if (!allStudents.length) {
      return res.status(200).json({
        success: true,
        total_classes: classes.length,
        total_students: 0,
        classes: [],
      });
    }

    const totalStudentsAvailable = allStudents.length;

    const studentCountsByClass = await loadStudentCountsByClass(res, instituteCode, classIds);

    let pagination = null;
    if (pageSize) {
      const p = Math.max(1, Number(page) || 1);
      const ps = Math.max(1, Number(pageSize));
      const start = (p - 1) * ps;
      allStudents = allStudents.slice(start, start + ps);
      pagination = {
        page: p,
        page_size: ps,
        total_students: totalStudentsAvailable,
        total_pages: Math.ceil(totalStudentsAvailable / ps),
        returned: allStudents.length,
      };
    }

    if (!allStudents.length) {
      return res.status(200).json({
        success: true,
        total_classes: classes.length,
        total_students: 0,
        total_students_available: totalStudentsAvailable,
        pagination,
        classes: [],
      });
    }

    const allStudentIds = allStudents.map((s) => Number(s.ed_student_id));

    const allSubjectIdsSet = new Set();
    const subjectsByClass  = new Map();
    const keySetByClass    = new Map();
    const behaviorByClass  = new Map();
    const academicYearIdsSet = new Set();

    classes.forEach((c) => {
      const cid = Number(c.ed_class_id);
      const ids = parseIds(c.ed_class_subjects);
      subjectsByClass.set(cid, ids);
      keySetByClass.set(cid, new Set(parseIds(c.ed_class_key_subjects)));
      behaviorByClass.set(cid, parseBehaviors(c.ed_class_subject_behaviors));
      ids.forEach((id) => allSubjectIdsSet.add(id));
      if (c.academic_year_id) academicYearIdsSet.add(Number(c.academic_year_id));
    });
    const allSubjectIds = [...allSubjectIdsSet];
    const academicYearIds = [...academicYearIdsSet];

    const [subjectMap, notesMap, { enrollmentsByStudent, confirmationByStudent, confirmationsHistoryByStudent }, paymentsMap] =
      await Promise.all([
        loadSubjectsBatch(res, allSubjectIds),
        loadQuarterlyNotesBatch(res, classIds),
        loadEnrollmentAndConfirmationBatch(res, instituteCode, allStudentIds),
        includePaymentStatus
          ? loadFeesPaymentsBatch(res, instituteCode, allStudentIds, academicYearIds)
          : Promise.resolve(new Map()),
      ]);

    // FIX: alunos sem ed_student_class válido (null/0/'') são agrupados
    // sob a chave sentinela 0, que representa o grupo virtual "Sem Turma".
    const studentsByClass = new Map();
    allStudents.forEach((s) => {
      const cid = s.ed_student_class ? Number(s.ed_student_class) : 0;
      if (!studentsByClass.has(cid)) studentsByClass.set(cid, []);
      studentsByClass.get(cid).push(s);
    });

    // FIX: turmas a percorrer no loop principal = turmas reais + (se
    // existirem, depois da paginação) o grupo virtual "Sem Turma".
    // Construído aqui, e não antes, para só aparecer quando há mesmo
    // alunos sem turma na página actual de resultados.
    const classesForRendering = [...classes];
    if (studentsByClass.has(0)) {
      classesForRendering.push({
        ed_class_id: 0,
        ed_class_title: "Sem Turma",
        ed_class_code: "",
        ed_class_subjects: "",
        ed_class_key_subjects: "",
        ed_class_subject_behaviors: "",
        ed_class_student_limit: null,
        ed_class_period: null,
        ed_classroom_id: null,
        ed_classroom_title: "",
        ed_academic_level_id: null,
        ed_academic_level_title: "",
        max_value: 20,
        ed_cicle_id: null,
        ed_cicle_title: "",
        ed_faculty_id: null,
        ed_faculty_title: "",
        academic_year_id: null,
        ed_academic_year_title: "",
        ed_academic_year_startDate: null,
        ed_academic_year_endDate: null,
        ed_course_id: null,
        ed_course_title: "",
        director_id: null,
        director_name: "",
      });
    }

    const resultClasses = [];
    let totalStudents = 0;

    for (const classInfo of classesForRendering) {
      const classIdNum    = Number(classInfo.ed_class_id);
      const classStudentsGroup = studentsByClass.get(classIdNum) || [];

      if (pagination && !classStudentsGroup.length) continue;

      const subjectIds    = subjectsByClass.get(classIdNum) || [];
      const keySet          = keySetByClass.get(classIdNum) || new Set();
      const behaviorMap      = behaviorByClass.get(classIdNum) || new Map();
      const maxValue           = Number(classInfo.max_value) || 20;
      const passValue           = maxValue / 2;

      const academicYearIdNum = classInfo.academic_year_id ? Number(classInfo.academic_year_id) : null;
      const academicYearMonths = includePaymentStatus
        ? buildAcademicYearMonths(classInfo.ed_academic_year_startDate, classInfo.ed_academic_year_endDate)
        : [];

      // FIX: para o grupo virtual "Sem Turma" (classIdNum === 0) o total
      // de alunos "actuais" é simplesmente o tamanho deste grupo — não
      // faz sentido ir a studentCountsByClass (que só conta alunos de
      // turmas reais) nem aplicar limite de vagas.
      const currentStudentsInClass = classIdNum === 0
        ? classStudentsGroup.length
        : (studentCountsByClass.get(classIdNum) || 0);
      const capacity = buildClassCapacity(classInfo.ed_class_student_limit, currentStudentsInClass);

      const classData = {
        class_id: classIdNum === 0 ? null : classIdNum,
        class_title: classInfo.ed_class_title || "",
        class_code: classInfo.ed_class_code || "",
        academic_level_id: classInfo.ed_academic_level_id ?? null,
        academic_level: classInfo.ed_academic_level_title || "",
        course_id: classInfo.ed_course_id ?? null,
        course: classInfo.ed_course_title || "",
        classroom_id: classInfo.ed_classroom_id ?? null,
        classroom: classInfo.ed_classroom_title || "",
        cicle_id: classInfo.ed_cicle_id ?? null,
        cicle: classInfo.ed_cicle_title || "",
        faculty_id: classInfo.ed_faculty_id ?? null,
        faculty: classInfo.ed_faculty_title || "",
        academic_year_id: academicYearIdNum,
        academic_year: classInfo.ed_academic_year_title || "",
        academic_year_start: classInfo.ed_academic_year_startDate || null,
        academic_year_end: classInfo.ed_academic_year_endDate || null,
        period: classInfo.ed_class_period ?? "",
        period_label: periodLabel(classInfo.ed_class_period),
        director_id: classInfo.director_id ?? null,
        director_name: shortName(classInfo.director_name || ""),
        max_value: maxValue,
        capacity,
        // FIX: assinala explicitamente que este é o grupo virtual, para o
        // frontend poder tratar/destacar de forma diferente se quiser
        // (ex: não mostrar pauta/disciplinas, mostrar aviso "atribuir turma").
        is_unclassed_group: classIdNum === 0,
        approval_criteria: {
          weighted_threshold: APPROVAL_WEIGHTED_THRESHOLD,
          key_subjects_weight: 2,
          normal_subjects_weight: 1,
          rule_description:
            "Reprova se a soma ponderada de negativas atingir " +
            APPROVAL_WEIGHTED_THRESHOLD +
            ". Disciplinas chave contam com peso 2; as restantes, peso 1. " +
            "Disciplinas com comportamento 'approve_anyway' nunca contam para a reprovação.",
        },
      };

      if (!classStudentsGroup.length) {
        resultClasses.push({ ...classData, total_students: 0, students: [] });
        continue;
      }

      const students = classStudentsGroup.map((student) => {
        const studentId = Number(student.ed_student_id);

        const quarterCache = new Map();
        const getQuarterMt = (subjectId, q) => {
          if (!quarterCache.has(subjectId)) quarterCache.set(subjectId, {});
          const cached = quarterCache.get(subjectId);
          if (cached[q]) return cached[q];
          const d = notesMap.get(`${classIdNum}_${studentId}_${subjectId}_${q}`);
          let result;
          if (!d) {
            result = { mac: null, npt: null, mt: null };
          } else {
            const rawMt = d.mac !== null && d.npt !== null ? (d.mac + d.npt) / 2 : null;
            result = { mac: d.mac, npt: d.npt, mt: applyRounding(rawMt, roundMode) };
          }
          cached[q] = result;
          return result;
        };

        const grades = subjectIds.map((subjectId) => {
          const q1 = getQuarterMt(subjectId, 1);
          const q2 = getQuarterMt(subjectId, 2);
          const q3 = getQuarterMt(subjectId, 3);
          const rawMdf =
            q1.mt !== null && q2.mt !== null && q3.mt !== null
              ? (q1.mt + q2.mt + q3.mt) / 3
              : null;
          const mdf = applyRounding(rawMdf, roundMode);
          const approval = resolveSubjectApproval(subjectId, mdf, passValue, keySet, behaviorMap);

          return {
            subject_id: subjectId,
            subject_title: subjectMap.get(subjectId) || "",
            mt1: q1.mt,
            mt2: q2.mt,
            mt3: q3.mt,
            mdf,
            passed: approval.passed,
            is_key: approval.is_key,
            behavior: approval.behavior,
            counts_for_approval: approval.counts_for_approval,
          };
        });

        const graded      = grades.filter((g) => g.mdf !== null);
        const failed      = graded.filter((g) => g.passed === false);
        const allComplete = grades.every((g) => g.mt1 !== null && g.mt2 !== null && g.mt3 !== null);
        const excusedFailures = failed.filter((g) => !g.counts_for_approval);
        const keySubjectsAnnual = grades.filter((g) => g.is_key);

        const annualResult = computeSituation(
          subjectIds,
          (subjectId) => grades.find((g) => g.subject_id === subjectId)?.mdf ?? null,
          passValue, keySet, behaviorMap, true
        );

        let quarterly_report = undefined;
        if (includeQuarterlyReport) {
          quarterly_report = [1, 2, 3].map((q) => {
            const subjectsForQuarter = subjectIds.map((subjectId) => {
              const { mac, npt, mt } = getQuarterMt(subjectId, q);
              const approval = resolveSubjectApproval(subjectId, mt, passValue, keySet, behaviorMap);
              return {
                subject_id: subjectId,
                subject_title: subjectMap.get(subjectId) || "",
                mac, npt, mt,
                passed: approval.passed,
                is_key: approval.is_key,
                behavior: approval.behavior,
                counts_for_approval: approval.counts_for_approval,
              };
            });
            const gradedQ = subjectsForQuarter.filter((g) => g.mt !== null);
            const keySubjectsQ = subjectsForQuarter.filter((g) => g.is_key);

            const quarterResult = computeSituation(
              subjectIds,
              (subjectId) => subjectsForQuarter.find((g) => g.subject_id === subjectId)?.mt ?? null,
              passValue, keySet, behaviorMap, false
            );

            return {
              quarter: q,
              quarter_label: QUARTER_LABEL[q],
              subjects: subjectsForQuarter,
              summary: {
                total_subjects: subjectIds.length,
                key_subjects_count: keySubjectsQ.length,
                key_subjects: keySubjectsQ.map((g) => g.subject_title),
                graded: gradedQ.length,
                passed_count: gradedQ.filter((g) => g.passed).length,
                failed_count: gradedQ.filter((g) => g.passed === false).length,
                failed_key_subjects: gradedQ.filter((g) => g.is_key && g.passed === false).map((g) => g.subject_title),
                weighted_negative_count: quarterResult.weighted_negatives,
                quarter_situation: quarterResult.situation,
              },
            };
          });
        }

        // FIX — NÚCLEO DA CORREÇÃO (pedido do utilizador): escolhe a linha
        // de eduall_enrollment MAIS RECENTE do aluno, INDEPENDENTEMENTE do
        // ano lectivo da turma mostrada. Isto é a MESMA lógica ("existe um
        // registo activo na escola") usada em findActiveEnrollmentConflict
        // — por isso o que aparece no ecrã deixa de poder contradizer o
        // que bloqueia o registo no backend.
        const allEnrollmentRows = enrollmentsByStudent.get(studentId) || [];
        const enrollmentRecord = pickEnrollmentRecord(allEnrollmentRows);

        const confirmationRecord = confirmationByStudent.get(studentId) || null;
        const confirmationsHistory = confirmationsHistoryByStudent.get(studentId) || [];
        const hasConfirmation = confirmationsHistory.length > 0;

        // FIX: is_enrolled passa a reflectir a EXISTÊNCIA de qualquer linha
        // de matrícula activa do aluno na escola — a mesma condição que
        // bloqueia uma nova matrícula no backend (ALREADY_ENROLLED).
        // A flag antiga (ed_student_enrolled) é mantida só como campo
        // legado/informativo, não decide mais nada.
        const legacyEnrolledFlag = Number(student.ed_student_enrolled || 0) >= 1;
        const isEnrolled = !!enrollmentRecord;

        // NOVO: Modelo de Processo de Matrícula — reflecte se o aluno
        // está com o status "Aguarda Pagamento". `student` já vem de
        // `SELECT * FROM eduall_students ...`, logo o campo já está
        // disponível sem alterar nenhuma query. Ver
        // PATCH_modelo_matricula_configuravel.md, secção 7.
        const isAwaitingPayment = Number(student.ed_student_awaiting_payment || 0) === 1;

        let payment_status = undefined;
        if (includePaymentStatus) {
          const paidMonthsSet = academicYearIdNum
            ? paymentsMap.get(`${studentId}_${academicYearIdNum}`) || new Set()
            : new Set();
          const paymentStatus = buildPaymentStatus(academicYearMonths, paidMonthsSet);
          payment_status = {
            academic_year_id: academicYearIdNum,
            academic_year: classInfo.ed_academic_year_title || "",
            total_months: paymentStatus.total_months,
            paid_count: paymentStatus.paid_count,
            notpaid_count: paymentStatus.notpaid_count,
            months: paymentStatus.months,
          };
        }

        const result = {
          student_id: studentId,
          student_name: student.ed_student_name || "",
          student_code: student.ed_student_code || "",
          student_picture: student.ed_student_picture || null,
          class_info: classData,
          academic_grades: {
            grades,
            summary: {
              total_subjects: subjectIds.length,
              key_subjects_count: keySubjectsAnnual.length,
              key_subjects: keySubjectsAnnual.map((g) => g.subject_title),
              graded: graded.length,
              passed_count: graded.filter((g) => g.passed).length,
              failed_count: failed.length,
              failed_key_subjects: failed.filter((g) => g.is_key).map((g) => g.subject_title),
              excused_failed_count: excusedFailures.length,
              weighted_negative_count: annualResult.weighted_negatives,
              approval_threshold: APPROVAL_WEIGHTED_THRESHOLD,
              all_quarters_complete: allComplete,
              final_situation: annualResult.situation,
            },
          },
          school_situation: {
            // FIX: fonte de verdade única, GLOBAL (não escopada por ano
            // lectivo) — reflecte exactamente a mesma verificação usada
            // no backend para bloquear/permitir uma nova matrícula.
            is_enrolled: isEnrolled,
            // Campo legado, mantido só para depuração/compatibilidade —
            // NÃO usar para decidir nada no frontend.
            is_enrolled_legacy_flag: legacyEnrolledFlag,
            is_confirmed: hasConfirmation,
            // NOVO — Modelo de Processo de Matrícula configurável por
            // escola: true quando o aluno já se matriculou mas ainda não
            // teve o pagamento confirmado pela Secretaria (não pode
            // receber turma nem ser tratado como activo).
            awaiting_payment: isAwaitingPayment,
            enrollment: enrollmentRecord
              ? {
                  enrollment_id: enrollmentRecord.ed_enrollment_id,
                  service_id: enrollmentRecord.ed_enrollment_service,
                  service_name: enrollmentRecord.ed_service_title || "",
                  // FIX: service_current_price é o preço ACTUAL do serviço
                  // (pode já ter mudado desde a matrícula) — só informativo.
                  // O valor que conta é paid_value, gravado na própria linha.
                  service_current_price: enrollmentRecord.ed_service_price ?? null,
                  class_id: enrollmentRecord.ed_enrollment_class,
                  class_title: enrollmentRecord.ed_class_title || "",
                  academic_year_id: enrollmentRecord.class_academic_year_id
                    ?? enrollmentRecord.ed_enrollment_academic_year
                    ?? null,
                  // FIX (pedido): valor efectivamente pago nesta matrícula,
                  // independente do preço actual do serviço.
                  paid_value: enrollmentRecord.ed_enrollment_paid_value ?? null,
                  currency: enrollmentRecord.ed_enrollment_currency || "AOA",
                  invoice_code: enrollmentRecord.ed_enrollment_invoice_code || null,
                  payment_method_id: enrollmentRecord.ed_enrollment_payment_method_id || null,
                  payment_bank: enrollmentRecord.ed_enrollment_payment_bank || null,
                  payment_place: enrollmentRecord.ed_enrollment_payment_place || null,
                  bordereau: enrollmentRecord.ed_enrollment_bordereau || null,
                  bordereau_amount: enrollmentRecord.ed_enrollment_bordereau_amount ?? null,
                  balance_used: enrollmentRecord.ed_enrollment_balance_used ?? null,
                }
              : null,
            confirmation: confirmationRecord
              ? {
                  confirmation_id: confirmationRecord.ed_enrollment_confirmation_id,
                  invoice_code: confirmationRecord.ed_enrollment_confirmation_invoice_code || null,
                  payment_method_id: confirmationRecord.ed_enrollment_confirmation_payment_method_id || null,
                  payment_bank: confirmationRecord.ed_enrollment_confirmation_payment_bank || null,
                  payment_place: confirmationRecord.ed_enrollment_confirmation_payment_place || null,
                  bordereau: confirmationRecord.ed_enrollment_confirmation_bordereau || null,
                  bordereau_amount: confirmationRecord.ed_enrollment_confirmation_bordereau_amount ?? null,
                  balance_used: confirmationRecord.ed_enrollment_confirmation_balance_used ?? null,
                  // FIX (pedido): valor efectivamente pago nesta confirmação.
                  paid_value: confirmationRecord.ed_enrollment_confirmation_paid_value ?? null,
                  currency: confirmationRecord.ed_enrollment_confirmation_currency || "AOA",
                  confirmed_class: {
                    class_id: confirmationRecord.ed_enrollment_confirmation_class,
                    class_title: confirmationRecord.ed_class_title || "",
                    class_code: confirmationRecord.ed_class_code || "",
                  },
                  confirmed_service: {
                    service_id: confirmationRecord.ed_enrollment_confirmation_service,
                    service_name: confirmationRecord.ed_service_title || "",
                    service_current_price: confirmationRecord.ed_service_price ?? null,
                  },
                }
              : null,
            confirmations_count: confirmationsHistory.length,
            confirmations_history: confirmationsHistory.map((c) => ({
              confirmation_id: c.ed_enrollment_confirmation_id,
              invoice_code: c.ed_enrollment_confirmation_invoice_code || null,
              payment_method_id: c.ed_enrollment_confirmation_payment_method_id || null,
              bordereau: c.ed_enrollment_confirmation_bordereau || null,
              class_id: c.ed_enrollment_confirmation_class,
              class_title: c.ed_class_title || "",
              service_id: c.ed_enrollment_confirmation_service,
              service_name: c.ed_service_title || "",
              // FIX (pedido): valor pago em CADA confirmação do histórico.
              paid_value: c.ed_enrollment_confirmation_paid_value ?? null,
              currency: c.ed_enrollment_confirmation_currency || "AOA",
            })),
          },
        };

        if (includeQuarterlyReport) result.quarterly_report = quarterly_report;
        if (includePaymentStatus) result.payment_status = payment_status;

        return result;
      });

      totalStudents += students.length;
      resultClasses.push({ ...classData, total_students: students.length, students });
    }

    const durationMs = Date.now() - t0;
    console.log(`${C.dim}[GetStudentsFullOverview] ${totalStudents} aluno(s) em ${resultClasses.length} turma(s) — ${durationMs}ms${C.reset}`);

    return res.status(200).json({
      success: true,
      total_classes: resultClasses.length,
      total_students: totalStudents,
      total_students_available: totalStudentsAvailable,
      pagination,
      filters_applied: {
        classId: classId || null,
        academicYear: academicYear || null,
        search: search || null,
        studentId: studentIdList.length ? studentIdList : null,
        roundMode: roundMode || "none (valores decimais exactos)",
        includeQuarterlyReport,
        includePaymentStatus,
        includesUnclassedGroup: wantsUnclassedGroup,
      },
      duration_ms: durationMs,
      classes: resultClasses,
    });
  } catch (error) {
    console.error(`${C.bgRed}${C.white}${C.bold} ERRO ${C.reset} ${C.red}[GetStudentsFullOverview]: ${error.message}${C.reset}`);
    console.error(`${C.red}${error.stack}${C.reset}`);
    return res.status(500).json({
      success: false,
      msg: "Erro ao obter visão geral dos alunos.",
      error: error.message,
    });
  }
};
 



// ═════════════════════════════════════════════════════════════════════════════
// GetEnrollmentConfirmationReport — Relatório de Matrículas e Confirmações
// ═════════════════════════════════════════════════════════════════════════════
//
// Rota a registar junto do teu GetStudentsFullOverview:
//
//   router.post("/eduallenrollmentreport/get", VerifyToken, GetEnrollmentConfirmationReport);
//
// ── NOTA / ASSUNÇÃO (mesmo espírito do comentário `yearId` no Dashboard.jsx) ──
// Este controller assume as seguintes colunas de DATA nas tabelas de
// matrícula/confirmação, que não apareciam no GetStudentsFullOverview
// (aquele endpoint nunca precisou de data, só do registo "mais recente"):
//
//   eduall_enrollment              → ed_enrollment_date       (DATETIME)
//   eduall_enrollment_confirmation → ed_enrollment_confirmation_date (DATETIME)
//
// Se no teu schema real essas colunas tiverem outro nome (ex.: `created_at`,
// `ed_enrollment_created_at`), basta ajustar as duas constantes
// `ENROLLMENT_DATE_COL` / `CONFIRMATION_DATE_COL` abaixo — o resto da lógica
// não muda.
// ─────────────────────────────────────────────────────────────────────────────

const ENROLLMENT_DATE_COL   = "ed_enrollment_date";
const CONFIRMATION_DATE_COL = "ed_enrollment_confirmation_date";

const MONTH_LABEL = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Devolve { year, month(1-12) } a partir de um valor de data do MySQL. */
function ymFromDate(dateVal) {
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Agrega uma lista de registos (já filtrados) por mês (1-12), devolvendo um Map<mes, count>. */
function countByMonth(rows, dateCol) {
  const map = new Map();
  for (let m = 1; m <= 12; m++) map.set(m, 0);
  rows.forEach((r) => {
    const ym = ymFromDate(r[dateCol]);
    if (!ym) return;
    map.set(ym.month, (map.get(ym.month) || 0) + 1);
  });
  return map;
}

/** Agrupa uma lista de registos por uma chave (ex.: título de turma/curso/classe). */
function countByKey(rows, keyFn) {
  const map = new Map();
  rows.forEach((r) => {
    const key = keyFn(r) || "Sem atribuição";
    map.set(key, (map.get(key) || 0) + 1);
  });
  return [...map.entries()]
    .map(([label, val]) => ({ label, val }))
    .sort((a, b) => b.val - a.val);
}

function pct(part, total) {
  return total > 0 ? +((part / total) * 100).toFixed(1) : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint principal
// ─────────────────────────────────────────────────────────────────────────────
const GetEnrollmentConfirmationReport = async (req, res) => {
  const t0 = Date.now();
  try {
    const {
      academicYearId = null,        // filtro de ano lectivo (obrigatório para "comparação com ano anterior")
      previousAcademicYearId = null, // opcional — se não vier, tentamos inferir pelo ed_academic_year_startDate
      month = null,                  // 1-12, opcional — filtra o mês exibido nas distribuições
    } = req.body;

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida: instituto não identificado." });
    }

    // ── 1. Carregar anos lectivos (para resolver "ano anterior" e para o filtro do frontend) ──
    const academicYears = await ExecuteQuery(
      `SELECT ed_academic_year_id, ed_academic_year_title, ed_academic_year_startDate, ed_academic_year_endDate
       FROM eduall_academic_year
       WHERE institute_code = ?
       ORDER BY ed_academic_year_startDate DESC`,
      [instituteCode],
      res
    );

    let resolvedPreviousYearId = previousAcademicYearId;
    if (!resolvedPreviousYearId && academicYearId) {
      const currentYear = academicYears.find(
        (ay) => String(ay.ed_academic_year_id) === String(academicYearId)
      );
      if (currentYear) {
        // ano anterior = o ano lectivo imediatamente antes, por data de início
        const sorted = [...academicYears].sort(
          (a, b) => new Date(b.ed_academic_year_startDate) - new Date(a.ed_academic_year_startDate)
        );
        const idx = sorted.findIndex(
          (ay) => String(ay.ed_academic_year_id) === String(academicYearId)
        );
        if (idx >= 0 && sorted[idx + 1]) resolvedPreviousYearId = sorted[idx + 1].ed_academic_year_id;
      }
    }

    // ── 2. Carregar matrículas e confirmações (ano seleccionado) ──
    const enrollmentWhere = academicYearId
      ? "AND e.ed_enrollment_academic_year = ?"
      : "";
    const enrollmentParams = academicYearId
      ? [instituteCode, academicYearId]
      : [instituteCode];

    const enrollments = await ExecuteQuery(
      `SELECT
         e.ed_enrollment_id, e.ed_enrollment_student, e.ed_enrollment_class,
         e.ed_enrollment_service, e.ed_enrollment_academic_year, e.${ENROLLMENT_DATE_COL},
         c.ed_class_title, c.ed_academic_level_title, c.ed_course_title
       FROM eduall_enrollment e
       LEFT JOIN eduall_class c ON c.ed_class_id = e.ed_enrollment_class
       WHERE e.institute_code = ? ${enrollmentWhere}`,
      enrollmentParams,
      res
    );

    const confirmationWhere = academicYearId
      ? "AND cf.ed_enrollment_confirmation_academic_year = ?"
      : "";
    const confirmationParams = academicYearId
      ? [instituteCode, academicYearId]
      : [instituteCode];

    const confirmations = await ExecuteQuery(
      `SELECT
         cf.ed_enrollment_confirmation_id, cf.ed_enrollment_confirmation_student,
         cf.ed_enrollment_confirmation_class, cf.ed_enrollment_confirmation_academic_year,
         cf.${CONFIRMATION_DATE_COL},
         c.ed_class_title, c.ed_academic_level_title, c.ed_course_title
       FROM eduall_enrollment_confirmation cf
       LEFT JOIN eduall_class c ON c.ed_class_id = cf.ed_enrollment_confirmation_class
       WHERE cf.institute_code = ? ${confirmationWhere}`,
      confirmationParams,
      res
    );

    // ── 3. KPIs de topo ──
    const confirmedStudentIds = new Set(confirmations.map((c) => Number(c.ed_enrollment_confirmation_student)));
    const totalMatriculas   = enrollments.length;
    const totalConfirmacoes = confirmations.length;
    const totalPendentes    = enrollments.filter(
      (e) => !confirmedStudentIds.has(Number(e.ed_enrollment_student))
    ).length;
    const pctConfirmacao = pct(totalConfirmacoes, totalMatriculas);

    // ── 4. Evolução mensal (matrículas vs confirmações) ──
    const matriculasByMonth   = countByMonth(enrollments, ENROLLMENT_DATE_COL);
    const confirmacoesByMonth = countByMonth(confirmations, CONFIRMATION_DATE_COL);

    const monthlyTable = MONTH_LABEL.map((label, i) => {
      const m = i + 1;
      const mat = matriculasByMonth.get(m) || 0;
      const conf = confirmacoesByMonth.get(m) || 0;
      return {
        month: m,
        month_label: label,
        matriculas: mat,
        confirmacoes: conf,
        pendentes: Math.max(mat - conf, 0),
        pct_confirmacao: pct(conf, mat),
      };
    });

    const monthWithMostEnrollments  = [...monthlyTable].sort((a, b) => b.matriculas - a.matriculas)[0];
    const monthWithLeastEnrollments = [...monthlyTable]
      .filter((m) => m.matriculas > 0)
      .sort((a, b) => a.matriculas - b.matriculas)[0] || monthlyTable[0];
    const monthWithMostConfirmations = [...monthlyTable].sort((a, b) => b.confirmacoes - a.confirmacoes)[0];

    // ── 5. Distribuições (respeitam o filtro de mês, se enviado) ──
    const enrollmentsForDistribution = month
      ? enrollments.filter((e) => ymFromDate(e[ENROLLMENT_DATE_COL])?.month === Number(month))
      : enrollments;

    const byTurma  = countByKey(enrollmentsForDistribution, (e) => e.ed_class_title);
    const byCurso  = countByKey(enrollmentsForDistribution, (e) => e.ed_course_title);
    const byClasse = countByKey(enrollmentsForDistribution, (e) => e.ed_academic_level_title);

    // ── 6. Comparação com o ano lectivo anterior ──
    let previousYearComparison = null;
    if (resolvedPreviousYearId) {
      const [prevEnrollments, prevConfirmations] = await Promise.all([
        ExecuteQuery(
          `SELECT ed_enrollment_id FROM eduall_enrollment
           WHERE institute_code = ? AND ed_enrollment_academic_year = ?`,
          [instituteCode, resolvedPreviousYearId],
          res
        ),
        ExecuteQuery(
          `SELECT ed_enrollment_confirmation_id FROM eduall_enrollment_confirmation
           WHERE institute_code = ? AND ed_enrollment_confirmation_academic_year = ?`,
          [instituteCode, resolvedPreviousYearId],
          res
        ),
      ]);

      const prevTotalMatriculas   = prevEnrollments.length;
      const prevTotalConfirmacoes = prevConfirmations.length;

      const growthPct = (curr, prev) =>
        prev > 0 ? +(((curr - prev) / prev) * 100).toFixed(1) : (curr > 0 ? 100 : 0);

      previousYearComparison = {
        academic_year_id: resolvedPreviousYearId,
        total_matriculas: prevTotalMatriculas,
        total_confirmacoes: prevTotalConfirmacoes,
        matriculas_growth_pct: growthPct(totalMatriculas, prevTotalMatriculas),
        confirmacoes_growth_pct: growthPct(totalConfirmacoes, prevTotalConfirmacoes),
      };
    }

    const durationMs = Date.now() - t0;

    return res.status(200).json({
      success: true,
      academic_years: academicYears,
      filters_applied: {
        academicYearId: academicYearId || null,
        previousAcademicYearId: resolvedPreviousYearId || null,
        month: month ? Number(month) : null,
      },
      kpis: {
        total_matriculas: totalMatriculas,
        total_confirmacoes: totalConfirmacoes,
        total_pendentes: totalPendentes,
        pct_confirmacao: pctConfirmacao,
      },
      monthly: monthlyTable,
      insights: {
        month_most_enrollments: monthWithMostEnrollments,
        month_least_enrollments: monthWithLeastEnrollments,
        month_most_confirmations: monthWithMostConfirmations,
      },
      distribution: {
        by_turma: byTurma,
        by_curso: byCurso,
        by_classe: byClasse,
      },
      previous_year_comparison: previousYearComparison,
      duration_ms: durationMs,
    });
  } catch (error) {
    console.error(`[GetEnrollmentConfirmationReport]: ${error.message}`);
    console.error(error.stack);
    return res.status(500).json({
      success: false,
      msg: "Erro ao gerar relatório de matrículas e confirmações.",
      error: error.message,
    });
  }
};





// ── Cores ANSI para o console (sem dependências externas) ──────────────────
const CONSOLE_COLORS = {
  reset:   "\x1b[0m",
  bright:  "\x1b[1m",
  red:     "\x1b[31m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  cyan:    "\x1b[36m",
  gray:    "\x1b[90m",
};

/**
 * Log colorido genérico.
 * @param {"success"|"error"|"warn"|"info"} type
 * @param {string} label   - título curto do evento (ex: "ConfirmEnrollmentPayment")
 * @param {string} message - mensagem descritiva
 * @param {object} [extra] - dados adicionais (payload, erro, etc.)
 */
function logColored(type, label, message, extra) {
  const c = CONSOLE_COLORS;
  const styles = {
    success: { color: c.green,   icon: "✅" },
    error:   { color: c.red,     icon: "❌" },
    warn:    { color: c.yellow,  icon: "⚠️ " },
    info:    { color: c.cyan,    icon: "ℹ️ " },
  };
  const style = styles[type] || styles.info;
  const timestamp = new Date().toISOString();

  console.log(
    `${style.color}${style.icon} ${c.bright}[${label}]${c.reset}${style.color} ${message}${c.reset} ${c.gray}(${timestamp})${c.reset}`
  );

  if (extra !== undefined) {
    console.log(`${c.gray}   ↳`, extra, c.reset);
  }
}

const ConfirmEnrollmentPayment = async (req, res) => {
  const startTime = Date.now();
  let inTransaction = false;
  const LABEL = "ConfirmEnrollmentPayment";

  try {
    const { ID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      logColored("error", LABEL, "Instituição não encontrada na sessão.", { studentId: ID });
      return res.status(401).json({ success: false, msg: "Instituição não encontrada na sessão." });
    }

    // ── O frontend só envia estes dois campos: a turma escolhida
    //    e o nº de recibo/fatura. Todos os outros campos da tabela
    //    eduall_enrollment (serviço, ficheiro, valor pago, moeda,
    //    método/banco/local de pagamento) não são preenchidos por
    //    este formulário e vão gravados como null/0. ──
    const { student_class, invoice_code } = req.body;

    // ── Só faz sentido se o modelo activo da escola for o de
    //    confirmação financeira. ──
    const enrollmentModel = await getInstituteEnrollmentModel(res, instituteCode);
    if (!usesFinancialConfirmation(enrollmentModel)) {
      logColored("warn", LABEL, "Escola não utiliza o modelo de confirmação financeira.", {
        studentId: ID,
        instituteCode,
        enrollmentModel,
      });
      return res.status(409).json({
        success: false,
        msg: "Esta escola não utiliza o modelo de matrícula com confirmação financeira.",
        code: "WRONG_ENROLLMENT_MODEL",
      });
    }

    if (!student_class) {
      logColored("warn", LABEL, "Turma não informada no pedido.", { studentId: ID, instituteCode });
      return res.status(400).json({ success: false, msg: "Turma obrigatória para activar o aluno." });
    }

    // ── Confirmar que o aluno existe, pertence ao instituto e está
    //    de facto "Aguarda Pagamento".
    //    NOTA: a fonte da verdade passou a ser ed_student_status (0 = aguarda
    //    pagamento / inactivo, 1 = activo), alinhado com o frontend.
    //    ed_student_awaiting_payment é legado e já não é usado para decidir. ──
    const studentRows = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_name, ed_student_code, ed_student_status, ed_student_awaiting_payment
       FROM eduall_students
       WHERE ed_student_id = ? AND ed_student_institute_code = ? AND ed_student_deleted = 0`,
      [ID, instituteCode],
      true
    );

    if (!studentRows.length) {
      logColored("error", LABEL, "Estudante não encontrado.", { studentId: ID, instituteCode });
      return res.status(404).json({ success: false, msg: "Estudante não encontrado." });
    }

    const student = studentRows[0];

    if (student.ed_student_status * 1 !== 0) {
      logColored("warn", LABEL, "Aluno já não está a aguardar confirmação de pagamento.", {
        studentId: ID,
        studentName: student.ed_student_name,
        status: student.ed_student_status,
      });
      return res.status(409).json({
        success: false,
        msg: "Este aluno já não está a aguardar confirmação de pagamento.",
        code: "NOT_AWAITING_PAYMENT",
      });
    }

    // ── Validar turma + capacidade ──
    const classRows = await ExecuteQuery(
      res,
      `SELECT ed_class_id, ed_class_title, ed_class_year
       FROM eduall_class
       WHERE ed_class_id = ? AND ed_class_institute_code = ?`,
      [student_class, instituteCode],
      true
    );

    if (!classRows.length) {
      logColored("error", LABEL, "Turma seleccionada não existe ou não pertence ao instituto.", {
        studentId: ID,
        student_class,
        instituteCode,
      });
      return res.status(404).json({
        success: false,
        msg: "Turma selecionada não existe ou não pertence ao seu instituto!",
        code: "INVALID_CLASS",
      });
    }
    const classInfo = classRows[0];

    const capacity = await checkClassCapacity(res, student_class, instituteCode);
    if (capacity.isFull) {
      logColored("warn", LABEL, `Turma "${capacity.title || classInfo.ed_class_title}" está lotada.`, {
        studentId: ID,
        limit: capacity.limit,
        current: capacity.current,
      });
      return res.status(409).json({
        success: false,
        msg: `A turma "${capacity.title || classInfo.ed_class_title}" já atingiu o limite máximo de ${capacity.limit} aluno(s).`,
        code: "CLASS_FULL",
        maxStudents: capacity.limit,
        currentOccupancy: capacity.current,
      });
    }

    // ── Escrita — usar transação ──
    await ExecuteQuery(res, "START TRANSACTION", [], false);
    inTransaction = true;

    // Reconfirmar capacidade dentro da transação (protege contra concorrência)
    const capacityRecheck = await checkClassCapacity(res, student_class, instituteCode);
    if (capacityRecheck.isFull) {
      throw Object.assign(
        new Error(`A turma "${capacityRecheck.title || classInfo.ed_class_title}" ficou lotada enquanto este pagamento era confirmado (${capacityRecheck.current}/${capacityRecheck.limit}).`),
        { code: "CLASS_FULL", status: 409 }
      );
    }

    // ── O aluno já tem registo de matrícula em eduall_enrollment
    //    (criado quando ficou "Aguarda Pagamento"). Aqui não se cria
    //    um novo registo — apenas se localiza o existente e:
    //      • actualiza-se sempre a turma para a seleccionada agora;
    //      • actualiza-se o nº de recibo/fatura só se ainda estiver
    //        NULL na BD e tiver sido enviado pelo frontend. ──
    const enrollmentRows = await ExecuteQuery(
      res,
      `SELECT ed_enrollment_id, ed_enrollment_invoice_code
       FROM eduall_enrollment
       WHERE ed_enrollment_student = ? AND ed_enrollment_institute_code = ?
       ORDER BY ed_enrollment_id DESC
       LIMIT 1`,
      [ID, instituteCode],
      true
    );

    if (!enrollmentRows.length) {
      throw Object.assign(
        new Error("Não foi encontrado nenhum registo de matrícula para este aluno."),
        { code: "ENROLLMENT_NOT_FOUND", status: 404 }
      );
    }

    const enrollment = enrollmentRows[0];
    const shouldUpdateInvoice = !enrollment.ed_enrollment_invoice_code && !!invoice_code;

    await ExecuteQuery(
      res,
      shouldUpdateInvoice
        ? `UPDATE eduall_enrollment
           SET ed_enrollment_class = ?, ed_enrollment_invoice_code = ?
           WHERE ed_enrollment_id = ?`
        : `UPDATE eduall_enrollment
           SET ed_enrollment_class = ?
           WHERE ed_enrollment_id = ?`,
      shouldUpdateInvoice
        ? [student_class, invoice_code, enrollment.ed_enrollment_id]
        : [student_class, enrollment.ed_enrollment_id],
      false,
      { db: "eduall_enrollment", type: "update", data: req }
    );

    // ── Activa o aluno: sai de "Aguarda Pagamento" e recebe turma.
    //    Actualiza tanto o campo novo (ed_student_status) como o legado
    //    (ed_student_awaiting_payment), para manter os dois sincronizados
    //    enquanto o campo antigo não for removido definitivamente. ──
    await ExecuteQuery(
      res,
      `UPDATE eduall_students
       SET ed_student_awaiting_payment = 0,
           ed_student_status           = 1,
           ed_student_class            = ?,
           ed_student_enrolled         = 1
       WHERE ed_student_id = ? AND ed_student_institute_code = ? AND ed_student_deleted = 0`,
      [student_class, ID, instituteCode],
      false,
      { db: "eduall_students", type: "update", data: req }
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Estudantes",
      description: `Confirmou pagamento de matrícula do estudante "${student.ed_student_name}" (#${student.ed_student_code}) — turma: "${classInfo.ed_class_title}"`
        + (invoice_code ? ` | recibo/fatura: ${invoice_code}` : ""),
    });

    await ExecuteQuery(res, "COMMIT", [], false);
    inTransaction = false;
 

    const duration = Date.now() - startTime;

    logColored(
      "success",
      LABEL,
      `Aluno "${student.ed_student_name}" (#${student.ed_student_code}) activado e colocado na turma "${classInfo.ed_class_title}" (${duration}ms)`,
      {
        studentId: Number(ID),
        classId: classInfo.ed_class_id,
        enrollmentId: enrollment.ed_enrollment_id,
        invoiceUpdated: shouldUpdateInvoice,
      }
    );

    return res.status(200).json({
      success: true,
      msg: "Pagamento confirmado! Aluno activado e colocado na turma.",
      student_id: Number(ID),
      class_id: classInfo.ed_class_id,
      class_title: classInfo.ed_class_title,
      enrollment_id: enrollment.ed_enrollment_id,
    });

  } catch (error) {
    if (inTransaction) {
      try {
        await ExecuteQuery(res, "ROLLBACK", [], false);
        logColored("warn", LABEL, "Transacção revertida (ROLLBACK) após erro.");
      } catch (rollbackError) {
        logColored("error", LABEL, "Falha ao reverter a transacção (ROLLBACK).", rollbackError);
      }
    }

    const duration = Date.now() - startTime;
    const status = error.status || 500;

    logColored(
      "error",
      LABEL,
      `Erro ao confirmar pagamento de matrícula (status ${status}, ${duration}ms): ${error.message}`,
      error
    );

    return res.status(status).json({
      success: false,
      msg: error.code === "CLASS_FULL" ? error.message : "Erro ao confirmar pagamento de matrícula. Tente novamente.",
      error_code: error.code || "UNKNOWN_ERROR",
    });
  }
};

 

module.exports = {
  GetStudentsFullOverview,
  GetEnrollmentConfirmationReport,
  RegisterUnifiedEnrollmentOrConfirmation,
  ConfirmEnrollmentPayment
};