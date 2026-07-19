/**
 * FinesController.js — v16
 *
 * ═══════════════════════════════════════════════════════════════════
 * NOVIDADES v16 — CalculateStudentFineByRule COMPLETA
 * ═══════════════════════════════════════════════════════════════════
 *
 * 1. SUPORTE A TODOS OS MODELOS (A, B, C, D, E)
 *    A função CalculateStudentFineByRule agora calcula correctamente
 *    qualquer modelo de multa, não apenas o Modelo D.
 *
 * 2. FINS DE SEMANA — CORRECÇÃO (Sáb=6, Dom=0)
 *    A contagem de dias úteis exclui Sábado (dow=6) e Domingo (dow=0).
 *    O cálculo é feito no backend com base nas datas reais, incluindo
 *    todos os fins de semana que ocorrem entre o vencimento e hoje.
 *
 * 3. PONTO DE PARAGEM — 4 TIPOS:
 *    • none            → sem paragem
 *    • end_of_month    → fim do mês de vencimento (último dia útil)
 *    • day_same_month  → dia X do mesmo mês do vencimento
 *    • day_next_month  → dia X do mês seguinte (ex: pagar até dia 10/mês+1)
 *    • fixed_days      → máximo de N dias úteis de atraso
 *
 *    O ponto de paragem é calculado com base nas datas REAIS do mês
 *    do vencimento — não é uma estimativa.
 *
 * 4. LOG DETALHADO NO CONSOLE (formato solicitado)
 *    Imprime resumo completo por mês e por modelo.
 *
 * 5. TODOS OS FIXES v15 MANTIDOS
 *
 * SCHEMA — colunas novas (executar UMA VEZ):
 *   ALTER TABLE eduall_fine_rules
 *     ADD COLUMN fine_rule_skip_weekends        TINYINT(1)        NOT NULL DEFAULT 1    COMMENT '1=excluir Sáb+Dom',
 *     ADD COLUMN fine_rule_stop_point_type      VARCHAR(30)       NOT NULL DEFAULT 'none' COMMENT 'none|end_of_month|day_same_month|day_next_month|fixed_days',
 *     ADD COLUMN fine_rule_stop_point_day       TINYINT UNSIGNED  NULL     COMMENT 'Dia do mês para paragem',
 *     ADD COLUMN fine_rule_stop_point_max_days  SMALLINT UNSIGNED NULL     COMMENT 'Máximo de dias úteis';
 * ═══════════════════════════════════════════════════════════════════
 */

const ExecuteQuery = require("../Functions/ExecuteQuery");
const cron         = require("node-cron");
const axios        = require("axios");

const TELCO_API_URL = "https://www.telcosms.co.ao/send_message";
const TELCO_API_KEY = "prdd0cf231ad82fcfa9c4c8654742";

const PAYMENT_TYPE_PROPINA    = "propina";
const PAYMENT_TYPE_TRANSPORTE = "transporte";

function instituteOf(req) { return req.session.user.eduall_user_session_curentinstitute; }
function userIdOf(req)    { return req.session?.user?.eduall_user_session_ID || null; }

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS DE DATA — v16
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Conta dias úteis (Seg=1…Sex=5) entre from e to, inclusive.
 * Sábado (dow=6) e Domingo (dow=0) são excluídos.
 */
function countWeekdays(from, to) {
  const d1 = new Date(from); d1.setHours(0, 0, 0, 0);
  const d2 = new Date(to);   d2.setHours(0, 0, 0, 0);
  if (d1 > d2) return 0;
  let count = 0;
  const cur = new Date(d1);
  while (cur <= d2) {
    const dow = cur.getDay(); // 0=Dom, 6=Sáb
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

/**
 * Avança N dias úteis a partir de uma data.
 */
function addWeekdays(from, n) {
  const d = new Date(from);
  let added = 0;
  while (added < n) {
    d.setDate(d.getDate() + 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return d;
}

/**
 * Último dia do mês de uma data.
 */
function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/**
 * Calcula o ponto de paragem (stopDate) para uma dada data de vencimento e regra.
 * Devolve null se não há ponto de paragem.
 *
 * Tipos suportados:
 *   none            → null
 *   end_of_month    → último dia do mês de vencimento
 *   day_same_month  → dia X do mesmo mês do vencimento
 *   day_next_month  → dia X do mês seguinte ao vencimento
 *   fixed_days      → graceDays + N dias úteis após o vencimento
 */
function calcStopDate(duedate, rule) {
  const spt      = rule.fine_rule_stop_point_type || "none";
  const stopDay  = Number(rule.fine_rule_stop_point_day     || 0);
  const maxDays  = Number(rule.fine_rule_stop_point_max_days || 0);

  if (spt === "none") return null;

  if (spt === "end_of_month") {
    return endOfMonth(duedate);
  }

  if (spt === "day_same_month" && stopDay >= 1) {
    const lastDay = endOfMonth(duedate).getDate();
    const day     = Math.min(stopDay, lastDay);
    const d       = new Date(duedate.getFullYear(), duedate.getMonth(), day);
    return d;
  }

  if (spt === "day_next_month" && stopDay >= 1) {
    const nextMonth = new Date(duedate.getFullYear(), duedate.getMonth() + 1, 1);
    const lastDay   = endOfMonth(nextMonth).getDate();
    const day       = Math.min(stopDay, lastDay);
    return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), day);
  }

  if (spt === "fixed_days" && maxDays >= 1) {
    // Para após maxDays dias úteis de atraso (contados após a carência)
    // O stopDate é duedate + graceDays (calendário) + maxDays (úteis)
    const grace = Number(rule.fine_rule_grace_days || 0);
    const graceEnd = new Date(duedate);
    graceEnd.setDate(graceEnd.getDate() + grace);
    return addWeekdays(graceEnd, maxDays);
  }

  return null;
}

/**
 * Calcula dias efectivos de atraso para uma regra e data de vencimento.
 *
 * @param {Date}   duedate  - data de vencimento do pagamento
 * @param {object} rule     - regra de multa
 * @param {Date}   [refDate] - data de referência (default: hoje)
 * @returns {{days: number, stopDate: Date|null, wasCapped: boolean}}
 */
function calcDiasEfectivosDetailed(duedate, rule, refDate) {
  const today       = refDate || new Date();
  const grace       = Number(rule.fine_rule_grace_days || 0);
  const skipWeekend = Number(rule.fine_rule_skip_weekends ?? 1) !== 0;

  // Fim do período de carência (em dias de calendário)
  const graceEnd = new Date(duedate);
  graceEnd.setDate(graceEnd.getDate() + grace);

  // Ponto de paragem
  const stopDate = calcStopDate(duedate, rule);

  // Data efectiva de fim: menor entre hoje e stopDate (se existir)
  const calcEnd  = (stopDate && stopDate < today) ? stopDate : today;
  const wasCapped = !!(stopDate && stopDate < today);

  if (calcEnd <= graceEnd) return { days: 0, stopDate, wasCapped };

  let days;
  if (skipWeekend) {
    const from = new Date(graceEnd);
    from.setDate(from.getDate() + 1);
    days = Math.max(0, countWeekdays(from, calcEnd));
  } else {
    days = Math.max(0, Math.floor((calcEnd - graceEnd) / 86400000));
  }

  return { days, stopDate, wasCapped };
}

// Versão simplificada (só devolve o número de dias)
function calcDiasEfectivos(duedate, rule, refDate) {
  return calcDiasEfectivosDetailed(duedate, rule, refDate).days;
}

// ─── Moeda ────────────────────────────────────────────────────────────────────
async function getCoin(resLike, reqLike, institute) {
  const rows = await ExecuteQuery(resLike,
    `SELECT ed_coin_code, ed_coin_title FROM eduall_coins
     WHERE ed_coin_institute_code=? AND ed_coin_deleted=0 LIMIT 1`,
    [institute], true, { db: "eduall_coins", type: "select", data: reqLike }) || [];
  return rows[0] || { ed_coin_code: "KZ", ed_coin_title: "Kwanza" };
}

// ─── Contactos ────────────────────────────────────────────────────────────────
function getAllContactPhones(student) {
  return [...new Set([
    student.ed_student_phone, student.ed_student_phone2,
    student.ed_student_father_phone, student.ed_student_father_emergency_phone,
    student.ed_student_mother_phone, student.ed_student_mother_emergency_phone,
    student.ed_student_guardion_phone, student.ed_student_guardion_emergency_phone,
  ].filter(p => p && String(p).trim() !== ""))];
}

// ─── Meses do ano letivo ──────────────────────────────────────────────────────
function buildAcademicMonths(yearData) {
  if (!yearData) return [];
  const start = yearData.ed_academic_year_startDate;
  const end   = yearData.ed_academic_year_endDate;
  if (!start || !end || typeof start !== "string" || typeof end !== "string") return [];
  const sp = start.split("-").map(Number);
  const ep = end.split("-").map(Number);
  if (sp.length < 2 || ep.length < 2 || sp.some(isNaN) || ep.some(isNaN)) return [];
  const [Y1, M1] = sp, [Y2, M2] = ep;
  const s = M1 - 1, e = M2 - 1;
  const months = [];
  const push = (m, y) => months.push({ monthIndex: m, year: y, code: parseFloat(`${m}.${y}`) });
  if (Y2 > Y1) {
    for (let i = s; i <= 11; i++) push(i, Y1);
    for (let i = 0; i <= e;  i++) push(i, Y2);
  } else {
    for (let i = s; i <= e; i++) push(i, Y1);
  }
  return months;
}

// ─── Período ──────────────────────────────────────────────────────────────────
function resolvePeriodFilter(filter) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const pad = n => String(n).padStart(2, "0");
  const ymd = (yr, mo, dy) => `${yr}-${pad(mo + 1)}-${pad(dy)}`;
  if (!filter || filter === "month")
    return { start: ymd(y, m, 1), end: ymd(y, m, new Date(y, m + 1, 0).getDate()) };
  if (filter === "last_month") {
    const lm = m === 0 ? 11 : m - 1, ly = m === 0 ? y - 1 : y;
    return { start: ymd(ly, lm, 1), end: ymd(ly, lm, new Date(ly, lm + 1, 0).getDate()) };
  }
  if (filter === "quarter") {
    const q = Math.floor(m / 3);
    return { start: ymd(y, q * 3, 1), end: ymd(y, q * 3 + 2, new Date(y, q * 3 + 3, 0).getDate()) };
  }
  if (filter === "semester") {
    const h = m < 6 ? 0 : 1;
    return { start: ymd(y, h * 6, 1), end: ymd(y, h * 6 + 5, new Date(y, h * 6 + 6, 0).getDate()) };
  }
  if (filter === "year")      return { start: `${y}-01-01`, end: `${y}-12-31` };
  if (filter === "last_year") return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  if (typeof filter === "object" && filter.from && filter.to) return { start: filter.from, end: filter.to };
  return { start: ymd(y, m, 1), end: ymd(y, m, new Date(y, m + 1, 0).getDate()) };
}

// ─── SMS ──────────────────────────────────────────────────────────────────────
function calculateSmsParts(msg) {
  return Math.ceil((msg || "").length / (/[^\x00-\x7F]/.test(msg) ? 70 : 160));
}

async function sendSMSViaTelco(phone, message, institute, studentId, resLike, reqLike) {
  try {
    if (/(https?:\/\/[^\s]+)/gi.test(message)) {
      await _smsLog(resLike, reqLike, { phone, message, institute, studentId, status: 1, error: "Mensagem contém link." });
      return { sent: false };
    }
    const clean = (phone || "").replace(/\s+/g, "");
    if (!/^9\d{8}$/.test(clean)) {
      await _smsLog(resLike, reqLike, { phone: clean, message, institute, studentId, status: 1, error: "Número inválido." });
      return { sent: false };
    }
    const credits = await ExecuteQuery(resLike,
      `SELECT ed_sms_credit_total FROM eduall_sms_credits WHERE ed_sms_credit_institute_code=? LIMIT 1`,
      [institute], true, { db: "eduall_sms_credits", type: "select", data: reqLike });
    const parts = calculateSmsParts(message);
    if (Number(credits?.[0]?.ed_sms_credit_total || 0) < parts) {
      await _smsLog(resLike, reqLike, { phone: clean, message, institute, studentId, status: 1, error: "Créditos insuficientes." });
      return { sent: false };
    }
    const { status } = await axios.post(TELCO_API_URL,
      { message: { api_key_app: TELCO_API_KEY, phone_number: clean, message_body: message } },
      { headers: { "Content-Type": "application/json" } });
    if (status === 200 || status === 201) {
      await ExecuteQuery(resLike,
        `UPDATE eduall_sms_credits SET ed_sms_credit_total=ed_sms_credit_total-?
         WHERE ed_sms_credit_institute_code=? AND ed_sms_credit_total>=?`,
        [parts, institute, parts], false, { db: "eduall_sms_credits", type: "update", data: reqLike });
      await _smsLog(resLike, reqLike, { phone: clean, message, institute, studentId, status: 0, error: null });
      return { sent: true };
    }
    await _smsLog(resLike, reqLike, { phone: clean, message, institute, studentId, status: 1, error: `HTTP ${status}` });
    return { sent: false };
  } catch (err) {
    await _smsLog(resLike, reqLike, { phone, message, institute, studentId, status: 1, error: err.message });
    return { sent: false };
  }
}

async function _smsLog(resLike, reqLike, { phone, message, institute, studentId, status, error }) {
  try {
    await ExecuteQuery(resLike,
      `INSERT INTO eduall_sms_records
         (ed_sms_record_message, ed_sms_sent_to, ed_sms_record_sent_usertype,
          ed_sms_sent_contactid, ed_sms_record_status, ed_sms_record_instituteCode)
       VALUES(?,?,'multa',?,?,?)`,
      [error ? `${message} [ERRO: ${error}]` : message, phone || "", studentId || null, status, institute],
      false, { db: "eduall_sms_records", type: "insert", data: reqLike });
  } catch (e) { console.error("[SMS log]", e.message); }
}

function buildSMSMessage(name, daysLate, months, fine, currency, className) {
  const m = months > 1 ? `${months} meses` : "1 mês";
  return `EduAll | O/A aluno(a) ${name} (${className}) tem ${m} de propina em atraso (${daysLate} dia(s) útil/úteis). Multa: ${Number(fine).toFixed(2)} ${currency || ""}. Regularize para evitar bloqueio.`;
}

const STUDENT_CONTACT_FIELDS = `
  s.ed_student_id, s.ed_student_class, s.ed_student_name,
  s.ed_student_phone, s.ed_student_phone2,
  s.ed_student_father_phone, s.ed_student_father_emergency_phone,
  s.ed_student_mother_phone, s.ed_student_mother_emergency_phone,
  s.ed_student_guardion_phone, s.ed_student_guardion_emergency_phone,
  c.ed_class_title AS ed_class_name, c.ed_class_year, c.ed_class_service
`;

// ═════════════════════════════════════════════════════════════════════════════
// CÁLCULO DE MULTA — v16
//
// Recebe `dias` em dias ÚTEIS (já processados por calcDiasEfectivos).
// Suporta todos os modelos A, B, C, D, E.
//
// MODELO D (v14 ministerial, mantido):
//   diasAteFixo = fixed_after_days - grace_days (mín. 1)
//   diasJuro    = max(0, dias - diasAteFixo)
//   multa       = fixo + capital × (pct/100) × diasJuro
// ═════════════════════════════════════════════════════════════════════════════

function calcularMulta(rule, dias, capital = 0) {
  if (dias <= 0) return 0;
  const vt  = rule.fine_rule_value_type || "fixed";
  const res = v => { const n = Number(v || 0); return vt === "percent" ? (capital * n) / 100 : n; };
  let esc = [];
  try { esc = JSON.parse(rule.fine_rule_escaloes || "[]"); } catch {}

  switch (rule.fine_rule_model) {

    // ── A: Multa fixa única ───────────────────────────────────────────────────
    case "A":
      return dias >= Number(rule.fine_rule_fixed_after_days || 1)
        ? res(rule.fine_rule_fixed_value) : 0;

    // ── B: Multa diária crescente ─────────────────────────────────────────────
    case "B": {
      const d  = res(rule.fine_rule_daily_value);
      const mx = res(rule.fine_rule_daily_max);
      const t  = d * dias;
      return mx > 0 ? Math.min(t, mx) : t;
    }

    // ── C: Escalões por dias ──────────────────────────────────────────────────
    case "C": {
      let r = 0;
      for (const e of esc) {
        const f = Number(e.from_day || 0), a = e.to_day ? Number(e.to_day) : Infinity;
        if (dias >= f && dias <= a) { r += res(e.fixed_value); break; }
        else if (dias > a) r += res(e.fixed_value);
      }
      return r;
    }

    // ── D: Multa fixa + juro diário (v14 ministerial) ────────────────────────
    case "D": {
      const fixo      = res(rule.fine_rule_fixed_value);
      const afterDays = Number(rule.fine_rule_fixed_after_days || 1);
      const graceDays = Number(rule.fine_rule_grace_days       || 0);
      const pctDia    = Number(rule.fine_rule_daily_pct        || 0);
      const diasAteFixo = fixo > 0 ? Math.max(1, afterDays - graceDays) : 0;
      const diasJuro    = Math.max(0, dias - diasAteFixo);
      if (dias < diasAteFixo) return 0;
      return fixo + capital * (pctDia / 100) * diasJuro;
    }

    // ── E: Escalões com juro diário ───────────────────────────────────────────
    case "E": {
      let r = 0;
      for (const e of esc) {
        const f = Number(e.from_day || 0), a = e.to_day ? Number(e.to_day) : Infinity;
        if (dias < f) break;
        const n = Math.min(dias, a) - f + 1;
        if (n <= 0) continue;
        r += res(e.fixed_value);
        r += capital * (Number(e.daily_pct || 0) / 100) * n;
        if (dias <= a) break;
      }
      return r;
    }

    default: return 0;
  }
}

/**
 * Calcula detalhes internos do Modelo D para logging.
 */
function calcModelDDetails(rule, dias, capital) {
  const vt         = rule.fine_rule_value_type || "fixed";
  const resVal     = v => { const n = Number(v || 0); return vt === "percent" ? (capital * n) / 100 : n; };
  const fixo       = resVal(rule.fine_rule_fixed_value);
  const afterDays  = Number(rule.fine_rule_fixed_after_days || 1);
  const graceDays  = Number(rule.fine_rule_grace_days       || 0);
  const pctDia     = Number(rule.fine_rule_daily_pct        || 0);
  const diasAteFixo = fixo > 0 ? Math.max(1, afterDays - graceDays) : 0;
  const diasJuro    = Math.max(0, dias - diasAteFixo);
  const jurosVal    = capital * (pctDia / 100) * diasJuro;
  const total       = dias >= diasAteFixo ? fixo + jurosVal : 0;
  return { fixo, diasAteFixo, diasJuro, pctDia, jurosVal, total, capital };
}

/**
 * Calcula detalhes internos do Modelo B para logging.
 */
function calcModelBDetails(rule, dias, capital) {
  const vt     = rule.fine_rule_value_type || "fixed";
  const resVal = v => { const n = Number(v || 0); return vt === "percent" ? (capital * n) / 100 : n; };
  const d      = resVal(rule.fine_rule_daily_value);
  const mx     = resVal(rule.fine_rule_daily_max);
  const total  = mx > 0 ? Math.min(d * dias, mx) : d * dias;
  return { valorDia: d, maxValue: mx, dias, total };
}

function verificarBloqueio(rule, dias) {
  return !!rule.fine_rule_block_services && dias >= Number(rule.fine_rule_block_after_days || 30);
}

// ─── Pagamentos em atraso ─────────────────────────────────────────────────────
async function getOverduePayments(resLike, reqLike, {
  studentId, institute, paymentType, classId, academicYearData, servicePrice,
  selectedMonthCodes = null,
}) {
  const tipo  = (paymentType || PAYMENT_TYPE_PROPINA).toLowerCase();
  const today = new Date();

  if (tipo === PAYMENT_TYPE_TRANSPORTE) {
    const [pass] = await ExecuteQuery(resLike,
      `SELECT ed_transport_passenger_id FROM eduall_transport_passengers
       WHERE ed_transport_passenger_code=? AND ed_transport_passenger_institute_code=?
         AND ed_transport_passenger_deleted=0 LIMIT 1`,
      [studentId, institute], true, { db: "eduall_transport_passengers", type: "select", data: reqLike }) || [null];
    if (!pass) return [];
    const payments = await ExecuteQuery(resLike,
      `SELECT etp.ed_transport_payment_id AS payment_id, etp.ed_transport_payment_month AS payment_month,
              etp.ed_transport_payment_price AS value, sv.ed_service_price AS service_price
       FROM eduall_transport_payments etp
       LEFT JOIN eduall_services sv ON sv.ed_service_id=etp.ed_transport_payment_service
       WHERE etp.ed_transport_payment_student=? AND etp.ed_transport_payment_institute_code=?
         AND etp.ed_transport_payment_deleted=0 AND etp.ed_transport_payment_status!='canceled'`,
      [pass.ed_transport_passenger_id, institute], true,
      { db: "eduall_transport_payments", type: "select", data: reqLike }) || [];
    return payments
      .map(p => { const [m, y] = String(p.payment_month).split("."); return { ...p, duedate: new Date(parseInt(y), parseInt(m), 0) }; })
      .filter(p => p.duedate < today);
  }

  let yearData = academicYearData;
  if (!yearData && classId) {
    const [ay] = await ExecuteQuery(resLike,
      `SELECT y.ed_academic_year_id, y.ed_academic_year_startDate, y.ed_academic_year_endDate
       FROM eduall_class c INNER JOIN eduall_academic_year y ON y.ed_academic_year_id=c.ed_class_year
       WHERE c.ed_class_id=? LIMIT 1`,
      [classId], true, { db: "eduall_class", type: "select", data: reqLike }) || [null];
    if (!ay) return [];
    yearData = ay;
  }

  const allMonths = buildAcademicMonths(yearData);
  if (!allMonths.length) return [];

  const paid = await ExecuteQuery(resLike,
    `SELECT ed_fee_payment_month FROM eduall_fees_payments
     WHERE ed_fee_payment_student=? AND ed_fee_payment_institute_code=?
       AND ed_fee_payment_academic_year=? AND ed_fee_payment_deleted=0`,
    [studentId, institute, yearData.ed_academic_year_id], true,
    { db: "eduall_fees_payments", type: "select", data: reqLike }) || [];

  const paidSet = new Set(paid.map(p => parseFloat(p.ed_fee_payment_month)));
  const cy = today.getFullYear(), cm = today.getMonth();

  let overdue = allMonths.filter(m => {
    if (paidSet.has(m.code)) return false;
    return m.year < cy || (m.year === cy && m.monthIndex < cm);
  });

  if (selectedMonthCodes && selectedMonthCodes.length > 0) {
    const selSet = new Set(selectedMonthCodes.map(c => parseFloat(c)));
    overdue = overdue.filter(m => selSet.has(m.code));
  }

  if (!overdue.length) return [];

  let capital = Number(servicePrice || 0);
  if (!capital && classId) {
    const [svc] = await ExecuteQuery(resLike,
      `SELECT sv.ed_service_price FROM eduall_class c
       LEFT JOIN eduall_services sv ON sv.ed_service_id=c.ed_class_service
       WHERE c.ed_class_id=? LIMIT 1`,
      [classId], true, { db: "eduall_services", type: "select", data: reqLike }) || [null];
    capital = Number(svc?.ed_service_price || 0);
  }

  return overdue.map(m => ({
    payment_month: String(m.code),
    value: capital, service_price: capital,
    monthIndex: m.monthIndex, year: m.year,
    duedate: new Date(m.year, m.monthIndex + 1, 1),
  }));
}

// ─── Query de regras ──────────────────────────────────────────────────────────
function buildRulesQuery(tipoFiltro, classId, withExclude = false) {
  return `
    SELECT fr.*
    FROM eduall_fine_rules fr
    WHERE fr.fine_rule_institute_code = ?
      AND fr.fine_rule_deleted  = 0
      AND fr.fine_rule_active   = 1
      AND fr.fine_rule_payment_type = ?
      AND (fr.fine_rule_valid_from  IS NULL OR fr.fine_rule_valid_from  <= CURDATE())
      AND (fr.fine_rule_valid_until IS NULL OR fr.fine_rule_valid_until >= CURDATE())
      AND (
        fr.fine_rule_all_classes = 1
        OR fr.fine_rule_id IN (
          SELECT frc.frc_rule_id FROM eduall_fine_rule_classes frc
          WHERE frc.frc_class_id = ? AND frc.frc_deleted = 0
        )
      )
    ${withExclude ? "AND fr.fine_rule_id != ?" : ""}
    ORDER BY fr.fine_rule_id ASC
  `;
}

// ═════════════════════════════════════════════════════════════════════════════
// REGRAS — CRUD
// ═════════════════════════════════════════════════════════════════════════════

const GetFineRules = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT fr.*, GROUP_CONCAT(frc.frc_class_id ORDER BY frc.frc_class_id SEPARATOR ',') AS rule_classes
       FROM eduall_fine_rules fr
       LEFT JOIN eduall_fine_rule_classes frc ON frc.frc_rule_id=fr.fine_rule_id AND frc.frc_deleted=0
       WHERE fr.fine_rule_institute_code=? AND fr.fine_rule_deleted=0
       GROUP BY fr.fine_rule_id ORDER BY fr.fine_rule_created_at DESC`,
      [instituteOf(req)], true, { db: "eduall_fine_rules", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const GetClassListForFines = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT c.ed_class_id, c.ed_class_title,
              COUNT(DISTINCT s.ed_student_id) AS student_count
       FROM eduall_class c
       LEFT JOIN eduall_students s ON s.ed_student_class=c.ed_class_id AND s.ed_student_deleted=0
       WHERE c.ed_class_deleted=0 AND c.ed_class_institute_code=?
       GROUP BY c.ed_class_id, c.ed_class_title ORDER BY c.ed_class_title ASC`,
      [instituteOf(req)], true, { db: "eduall_class", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows || []);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const CreateFineRule = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const {
      name, payment_type, grace_days, model, value_type, fixed_value, fixed_after_days,
      daily_value, daily_max, daily_pct, escaloes, all_classes, class_ids, academic_year_id,
      block_services, block_after_days, notify_email, notify_sms, notify_app,
      alert_responsible, valid_from, valid_until,
      // v16
      skip_weekends, stop_point_type, stop_point_day, stop_point_max_days,
    } = req.body;
    if (!name || !model) return res.status(400).json({ success: false, msg: "Nome e modelo são obrigatórios." });
    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_fine_rules
         (fine_rule_name,fine_rule_payment_type,fine_rule_grace_days,fine_rule_model,fine_rule_value_type,
          fine_rule_fixed_value,fine_rule_fixed_after_days,fine_rule_daily_value,fine_rule_daily_max,
          fine_rule_daily_pct,fine_rule_escaloes,fine_rule_all_classes,fine_rule_academic_year,
          fine_rule_block_services,fine_rule_block_after_days,fine_rule_notify_email,fine_rule_notify_sms,
          fine_rule_notify_app,fine_rule_alert_responsible,fine_rule_valid_from,fine_rule_valid_until,
          fine_rule_skip_weekends,fine_rule_stop_point_type,fine_rule_stop_point_day,fine_rule_stop_point_max_days,
          fine_rule_active,fine_rule_created_by,fine_rule_institute_code,fine_rule_deleted)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,0)`,
      [name, payment_type || PAYMENT_TYPE_PROPINA, Number(grace_days || 0), model, value_type || "fixed",
       Number(fixed_value || 0), Number(fixed_after_days || 1), Number(daily_value || 0), Number(daily_max || 0),
       Number(daily_pct || 0), escaloes ? JSON.stringify(escaloes) : null,
       all_classes ? 1 : 0, academic_year_id || null, block_services ? 1 : 0, Number(block_after_days || 30),
       notify_email ? 1 : 0, notify_sms ? 1 : 0, notify_app ? 1 : 0, alert_responsible ? 1 : 0,
       valid_from || null, valid_until || null,
       skip_weekends !== false ? 1 : 0,
       stop_point_type || "none",
       stop_point_day  ? Number(stop_point_day)  : null,
       stop_point_max_days ? Number(stop_point_max_days) : null,
       userIdOf(req), institute],
      false, { db: "eduall_fine_rules", type: "insert", data: req });
    const id = result.insertId;
    if (!all_classes && Array.isArray(class_ids) && class_ids.length)
      for (const cid of class_ids)
        await ExecuteQuery(res, `INSERT INTO eduall_fine_rule_classes(frc_rule_id,frc_class_id,frc_deleted) VALUES(?,?,0)`,
          [id, cid], false, { db: "eduall_fine_rule_classes", type: "insert", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, msg: "Regra criada.", id });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const UpdateFineRule = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { id } = req.params;
    const {
      name, payment_type, grace_days, model, value_type, fixed_value, fixed_after_days,
      daily_value, daily_max, daily_pct, escaloes, all_classes, class_ids, academic_year_id,
      block_services, block_after_days, notify_email, notify_sms, notify_app,
      alert_responsible, valid_from, valid_until,
      // v16
      skip_weekends, stop_point_type, stop_point_day, stop_point_max_days,
    } = req.body;
    await ExecuteQuery(res,
      `UPDATE eduall_fine_rules SET
         fine_rule_name=?,fine_rule_payment_type=?,fine_rule_grace_days=?,fine_rule_model=?,fine_rule_value_type=?,
         fine_rule_fixed_value=?,fine_rule_fixed_after_days=?,fine_rule_daily_value=?,fine_rule_daily_max=?,
         fine_rule_daily_pct=?,fine_rule_escaloes=?,fine_rule_all_classes=?,fine_rule_academic_year=?,
         fine_rule_block_services=?,fine_rule_block_after_days=?,fine_rule_notify_email=?,fine_rule_notify_sms=?,
         fine_rule_notify_app=?,fine_rule_alert_responsible=?,fine_rule_valid_from=?,fine_rule_valid_until=?,
         fine_rule_skip_weekends=?,fine_rule_stop_point_type=?,fine_rule_stop_point_day=?,fine_rule_stop_point_max_days=?
       WHERE fine_rule_id=? AND fine_rule_institute_code=? AND fine_rule_deleted=0`,
      [name, payment_type || PAYMENT_TYPE_PROPINA, Number(grace_days || 0), model, value_type || "fixed",
       Number(fixed_value || 0), Number(fixed_after_days || 1), Number(daily_value || 0), Number(daily_max || 0),
       Number(daily_pct || 0), escaloes ? JSON.stringify(escaloes) : null,
       all_classes ? 1 : 0, academic_year_id || null, block_services ? 1 : 0, Number(block_after_days || 30),
       notify_email ? 1 : 0, notify_sms ? 1 : 0, notify_app ? 1 : 0, alert_responsible ? 1 : 0,
       valid_from || null, valid_until || null,
       skip_weekends !== false ? 1 : 0,
       stop_point_type || "none",
       stop_point_day  ? Number(stop_point_day)  : null,
       stop_point_max_days ? Number(stop_point_max_days) : null,
       id, institute],
      false, { db: "eduall_fine_rules", type: "update", data: req });
    await ExecuteQuery(res, `UPDATE eduall_fine_rule_classes SET frc_deleted=1 WHERE frc_rule_id=?`,
      [id], false, { db: "eduall_fine_rule_classes", type: "update", data: req });
    if (!all_classes && Array.isArray(class_ids) && class_ids.length)
      for (const cid of class_ids)
        await ExecuteQuery(res,
          `INSERT INTO eduall_fine_rule_classes(frc_rule_id,frc_class_id,frc_deleted) VALUES(?,?,0)
           ON DUPLICATE KEY UPDATE frc_deleted=0`,
          [id, cid], false, { db: "eduall_fine_rule_classes", type: "insert", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, msg: "Regra actualizada." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const ToggleFineRule = async (req, res) => {
  try {
    await ExecuteQuery(res,
      `UPDATE eduall_fine_rules SET fine_rule_active=IF(fine_rule_active=1,0,1)
       WHERE fine_rule_id=? AND fine_rule_institute_code=?`,
      [req.params.id, instituteOf(req)], false, { db: "eduall_fine_rules", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const DeleteFineRule = async (req, res) => {
  try {
    await ExecuteQuery(res,
      `UPDATE eduall_fine_rules SET fine_rule_deleted=1 WHERE fine_rule_id=? AND fine_rule_institute_code=?`,
      [req.params.id, instituteOf(req)], false, { db: "eduall_fine_rules", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, msg: "Regra eliminada." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const ConflictCheck = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { payment_type, all_classes, class_ids = [], exclude_rule_id } = req.body;
    let q = `SELECT fr.fine_rule_id, fr.fine_rule_name, fr.fine_rule_all_classes,
               GROUP_CONCAT(frc.frc_class_id) AS rule_classes
             FROM eduall_fine_rules fr
             LEFT JOIN eduall_fine_rule_classes frc ON frc.frc_rule_id=fr.fine_rule_id AND frc.frc_deleted=0
             WHERE fr.fine_rule_institute_code=? AND fr.fine_rule_payment_type=?
               AND fr.fine_rule_active=1 AND fr.fine_rule_deleted=0`;
    const p = [institute, payment_type];
    if (exclude_rule_id) { q += " AND fr.fine_rule_id!=?"; p.push(exclude_rule_id); }
    q += " GROUP BY fr.fine_rule_id";
    const existing = await ExecuteQuery(res, q, p, true, { db: "eduall_fine_rules", type: "select", data: req }) || [];
    if (res.headersSent) return;
    if (!existing.length) return res.status(200).json({ hasConflict: false });
    if (all_classes) return res.status(200).json({ hasConflict: true, conflicting_rule_id: existing[0].fine_rule_id, conflicting_rule_name: existing[0].fine_rule_name, payment_type, scope: "class", names: ["todas as turmas"] });
    for (const rule of existing) {
      if (rule.fine_rule_all_classes) return res.status(200).json({ hasConflict: true, conflicting_rule_id: rule.fine_rule_id, conflicting_rule_name: rule.fine_rule_name, payment_type, scope: "class", names: (class_ids || []).map(String) });
      const ids = (rule.rule_classes || "").split(",").map(Number).filter(Boolean);
      const overlap = (class_ids || []).filter(id => ids.includes(Number(id)));
      if (overlap.length) {
        const cls = await ExecuteQuery(res, `SELECT ed_class_title AS name FROM eduall_class WHERE ed_class_id IN (?) AND ed_class_deleted=0`, [overlap], true, { db: "eduall_class", type: "select", data: req }) || [];
        if (res.headersSent) return;
        return res.status(200).json({ hasConflict: true, conflicting_rule_id: rule.fine_rule_id, conflicting_rule_name: rule.fine_rule_name, payment_type, scope: "class", names: cls.map(c => c.name) });
      }
    }
    if (res.headersSent) return;
    res.status(200).json({ hasConflict: false });
  } catch (e) { console.error("[ConflictCheck]", e.message); if (!res.headersSent) res.status(200).json({ hasConflict: false }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// EXCLUSÕES
// ═════════════════════════════════════════════════════════════════════════════

const GetExclusions = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT fe.*, s.ed_student_name, s.ed_student_code, c.ed_class_title AS ed_class_name,
              u.ed_user_account_name AS excluded_by_name
       FROM eduall_fine_exclusions fe
       LEFT JOIN eduall_students      s ON s.ed_student_id=fe.fe_student_id
       LEFT JOIN eduall_class         c ON c.ed_class_id=fe.fe_class_id
       LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id=fe.fe_excluded_by
       WHERE fe.fe_rule_id=? AND fe.fe_institute_code=? AND fe.fe_deleted=0 ORDER BY fe.fe_created_at DESC`,
      [req.params.ruleId, instituteOf(req)], true, { db: "eduall_fine_exclusions", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const AddExclusion = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { rule_id, student_id, class_id, reason, is_permanent, valid_until } = req.body;
    if (!rule_id || !student_id || !reason) return res.status(400).json({ success: false, msg: "rule_id, student_id e reason são obrigatórios." });
    const existing = await ExecuteQuery(res,
      `SELECT fe_id FROM eduall_fine_exclusions WHERE fe_rule_id=? AND fe_student_id=? AND fe_deleted=0
         AND (fe_valid_until IS NULL OR fe_valid_until>=CURDATE())`,
      [rule_id, student_id], true, { db: "eduall_fine_exclusions", type: "select", data: req });
    if (res.headersSent) return;
    if (existing?.length) return res.status(400).json({ success: false, msg: "Exclusão já activa para este aluno." });
    await ExecuteQuery(res,
      `INSERT INTO eduall_fine_exclusions(fe_rule_id,fe_student_id,fe_class_id,fe_reason,fe_is_permanent,fe_valid_until,fe_excluded_by,fe_institute_code,fe_deleted)
       VALUES(?,?,?,?,?,?,?,?,0)`,
      [rule_id, student_id, class_id || null, reason, is_permanent ? 1 : 0, valid_until || null, userIdOf(req), institute],
      false, { db: "eduall_fine_exclusions", type: "insert", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, msg: "Exclusão registada." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const RemoveExclusion = async (req, res) => {
  try {
    await ExecuteQuery(res,
      `UPDATE eduall_fine_exclusions SET fe_deleted=1 WHERE fe_id=? AND fe_institute_code=?`,
      [req.params.id, instituteOf(req)], false, { db: "eduall_fine_exclusions", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, msg: "Exclusão removida." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// LOGS
// ═════════════════════════════════════════════════════════════════════════════

const GetFineLogs = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT fl.*, s.ed_student_name, s.ed_student_code, c.ed_class_title AS ed_class_name, fr.fine_rule_name
       FROM eduall_fine_logs fl
       LEFT JOIN eduall_students   s  ON s.ed_student_id=fl.fl_student_id
       LEFT JOIN eduall_class      c  ON c.ed_class_id=fl.fl_class_id
       LEFT JOIN eduall_fine_rules fr ON fr.fine_rule_id=fl.fl_rule_id
       WHERE fl.fl_institute_code=? ORDER BY fl.fl_applied_at DESC LIMIT 500`,
      [instituteOf(req)], true, { db: "eduall_fine_logs", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const GetFineLogsByStudent = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT fl.*, fr.fine_rule_name, fr.fine_rule_payment_type FROM eduall_fine_logs fl
       LEFT JOIN eduall_fine_rules fr ON fr.fine_rule_id=fl.fl_rule_id
       WHERE fl.fl_student_id=? AND fl.fl_institute_code=? ORDER BY fl.fl_applied_at DESC`,
      [req.params.studentId, instituteOf(req)], true, { db: "eduall_fine_logs", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// DEVEDORES POR TURMA
// ═════════════════════════════════════════════════════════════════════════════

const GetClassDebtors = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { classId } = req.params;
    const rows = await ExecuteQuery(res,
      `SELECT s.ed_student_id, s.ed_student_name, s.ed_student_code, s.ed_student_phone,
              SUM(fl.fl_fine_value)  AS fine_total,
              COUNT(fl.fl_id)        AS fine_count,
              MAX(fl.fl_days_late)   AS max_days_late,
              COUNT(DISTINCT fl.fl_payment_month) AS overdue_months,
              COALESCE(SUM(fl.fl_capital),0) AS estimated_debt
       FROM eduall_fine_logs fl
       INNER JOIN eduall_students s ON s.ed_student_id=fl.fl_student_id
       WHERE fl.fl_class_id=? AND fl.fl_institute_code=?
         AND fl.fl_status='pendente' AND s.ed_student_deleted=0
       GROUP BY s.ed_student_id, s.ed_student_name, s.ed_student_code, s.ed_student_phone
       ORDER BY fine_total DESC`,
      [classId, institute], true, { db: "eduall_fine_logs", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows || []);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════

const GetFinesDashboard = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const periodParam = req.query.period || "month";
    const filterInput = periodParam === "custom" ? { from: req.query.from, to: req.query.to } : periodParam;
    const { start, end } = resolvePeriodFilter(filterInput);
    const coin = await getCoin(res, req, institute);
    const coinCode = coin.ed_coin_code || "KZ";

    const [kpiPeriod] = await ExecuteQuery(res,
      `SELECT COALESCE(SUM(fl_fine_value),0) AS total, COUNT(*) AS count FROM eduall_fine_logs
       WHERE fl_institute_code=? AND fl_applied_at BETWEEN ? AND ?`,
      [institute, `${start} 00:00:00`, `${end} 23:59:59`], true, { db: "eduall_fine_logs", type: "select", data: req });

    const byType = await ExecuteQuery(res,
      `SELECT fl_payment_type, COALESCE(SUM(fl_fine_value),0) AS total, COUNT(*) AS count
       FROM eduall_fine_logs WHERE fl_institute_code=? AND fl_applied_at BETWEEN ? AND ?
       GROUP BY fl_payment_type`,
      [institute, `${start} 00:00:00`, `${end} 23:59:59`], true, { db: "eduall_fine_logs", type: "select", data: req });

    const monthlyEvolution = await ExecuteQuery(res,
      `SELECT DATE_FORMAT(fl_applied_at,'%Y-%m') AS month_key,
              COALESCE(SUM(fl_fine_value),0) AS total, COUNT(*) AS count
       FROM eduall_fine_logs WHERE fl_institute_code=? AND fl_applied_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       GROUP BY month_key ORDER BY month_key ASC`,
      [institute], true, { db: "eduall_fine_logs", type: "select", data: req });

    const [pending] = await ExecuteQuery(res,
      `SELECT COUNT(DISTINCT fl_student_id) AS students_at_risk FROM eduall_fine_logs
       WHERE fl_institute_code=? AND fl_status='pendente'`,
      [institute], true, { db: "eduall_fine_logs", type: "select", data: req });

    const classTable = await ExecuteQuery(res,
      `SELECT c.ed_class_id, c.ed_class_title AS ed_class_name,
              COUNT(DISTINCT s.ed_student_id) AS total_students,
              COUNT(DISTINCT CASE WHEN fl.fl_status='pendente' THEN fl.fl_student_id END) AS with_active_fine,
              COALESCE(SUM(CASE WHEN fl.fl_status='pendente' THEN fl.fl_fine_value END),0) AS fine_debt,
              COUNT(DISTINCT fe.fe_student_id) AS excluded_count
       FROM eduall_class c
       LEFT JOIN eduall_students s ON s.ed_student_class=c.ed_class_id AND s.ed_student_deleted=0
       LEFT JOIN eduall_fine_logs fl ON fl.fl_class_id=c.ed_class_id AND fl.fl_institute_code=?
       LEFT JOIN eduall_fine_exclusions fe ON fe.fe_class_id=c.ed_class_id AND fe.fe_deleted=0
         AND (fe.fe_valid_until IS NULL OR fe.fe_valid_until>=CURDATE())
       WHERE c.ed_class_deleted=0 AND c.ed_class_institute_code=?
       GROUP BY c.ed_class_id, c.ed_class_title ORDER BY c.ed_class_title ASC`,
      [institute, institute], true, { db: "eduall_class", type: "select", data: req });

    const smsLogs = await ExecuteQuery(res,
      `SELECT sr.ed_sms_record_id, sr.ed_sms_sent_date, sr.ed_sms_sent_to, sr.ed_sms_record_status,
              sr.ed_sms_sent_contactid,
              COALESCE(s.ed_student_name,'Aluno removido') AS ed_student_name,
              COALESCE(c.ed_class_title,'Turma removida') AS ed_class_name
       FROM eduall_sms_records sr
       LEFT JOIN eduall_students s ON s.ed_student_id=sr.ed_sms_sent_contactid
       LEFT JOIN eduall_class    c ON c.ed_class_id=s.ed_student_class
       WHERE sr.ed_sms_record_instituteCode=? AND sr.ed_sms_record_sent_usertype='multa'
       ORDER BY sr.ed_sms_sent_date DESC LIMIT 20`,
      [institute], true, { db: "eduall_sms_records", type: "select", data: req }) || [];

    const [smsCredits] = await ExecuteQuery(res,
      `SELECT ed_sms_credit_total AS sms_credits FROM eduall_sms_credits WHERE ed_sms_credit_institute_code=? LIMIT 1`,
      [institute], true, { db: "eduall_sms_credits", type: "select", data: req }) || [{ sms_credits: 0 }];

    if (res.headersSent) return;
    res.status(200).json({
      kpiPeriod: kpiPeriod || { total: 0, count: 0 },
      periodFilter: { period: periodParam, start, end },
      byType: byType || [], monthlyEvolution: monthlyEvolution || [],
      pending: pending || { students_at_risk: 0 },
      classTable: classTable || [], smsLogs: smsLogs || [],
      smsCredits: Number(smsCredits?.sms_credits || 0),
      coin: coinCode, coinTitle: coin.ed_coin_title || coinCode,
    });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// CÁLCULO POR ALUNO — FinesBadge
// ═════════════════════════════════════════════════════════════════════════════

const CalculateStudentFine = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { studentId, paymentType } = req.body;
    if (!studentId) return res.status(400).json({ success: false, msg: "studentId obrigatório." });

    const [student] = await ExecuteQuery(res,
      `SELECT s.*, c.ed_class_id, c.ed_class_title AS ed_class_name, c.ed_class_service, c.ed_class_year,
              y.ed_academic_year_id, y.ed_academic_year_startDate, y.ed_academic_year_endDate,
              sv.ed_service_price
       FROM eduall_students s
       LEFT JOIN eduall_class c ON c.ed_class_id=s.ed_student_class
       LEFT JOIN eduall_academic_year y ON y.ed_academic_year_id=c.ed_class_year
       LEFT JOIN eduall_services sv ON sv.ed_service_id=c.ed_class_service
       WHERE s.ed_student_id=? AND s.ed_student_deleted=0 LIMIT 1`,
      [studentId], true, { db: "eduall_students", type: "select", data: req });
    if (res.headersSent) return;
    if (!student) return res.status(404).json({ success: false, msg: "Aluno não encontrado." });

    const tipoFiltro = (paymentType || PAYMENT_TYPE_PROPINA).toLowerCase();
    const classId    = student.ed_class_id;

    const rules = await ExecuteQuery(res,
      buildRulesQuery(tipoFiltro, classId, false),
      [institute, tipoFiltro, classId],
      true, { db: "eduall_fine_rules", type: "select", data: req });
    if (res.headersSent) return;
    if (!rules?.length) return res.status(200).json({ hasFine: false, fineValue: 0, unitFineValue: 0, reason: null });

    const excl = await ExecuteQuery(res,
      `SELECT fe_rule_id FROM eduall_fine_exclusions
       WHERE fe_student_id=? AND fe_deleted=0 AND (fe_valid_until IS NULL OR fe_valid_until>=CURDATE())`,
      [studentId], true, { db: "eduall_fine_exclusions", type: "select", data: req });
    const excludedIds = new Set((excl || []).map(e => e.fe_rule_id));

    const yearData = student.ed_academic_year_id ? {
      ed_academic_year_id:        student.ed_academic_year_id,
      ed_academic_year_startDate: student.ed_academic_year_startDate,
      ed_academic_year_endDate:   student.ed_academic_year_endDate,
    } : null;

    let totalFineHistorico = 0, unitFineValue = 0, appliedRule = null, maxDaysLate = 0, overdueCount = 0;

    for (const rule of rules) {
      if (excludedIds.has(rule.fine_rule_id)) continue;
      const payments = await getOverduePayments(res, req, {
        studentId, institute,
        paymentType:      rule.fine_rule_payment_type,
        classId:          student.ed_class_id,
        academicYearData: yearData,
        servicePrice:     student.ed_service_price,
        selectedMonthCodes: null,
      });
      for (const p of payments) {
        const days = calcDiasEfectivos(p.duedate, rule);
        if (days <= 0) continue;
        const fine = calcularMulta(rule, days, Number(p.service_price || 0));
        if (fine > 0) {
          totalFineHistorico += fine;
          overdueCount++;
          appliedRule = rule;
          if (days > maxDaysLate) { maxDaysLate = days; unitFineValue = fine; }
        }
      }
    }

    const coin = await getCoin(res, req, institute);
    if (res.headersSent) return;
    if (totalFineHistorico <= 0) return res.status(200).json({ hasFine: false, fineValue: 0, unitFineValue: 0, reason: null });

    const currency = coin.ed_coin_code || "KZ";
    const fmtv = v => `${Number(v).toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`.trim();
    const reason = overdueCount > 1
      ? `${overdueCount} meses em dívida — ${maxDaysLate} dia(s) úteis de atraso — ${appliedRule?.fine_rule_name}. Multa por mês: ${fmtv(unitFineValue)}.`
      : `1 mês em dívida — ${maxDaysLate} dia(s) úteis de atraso — ${appliedRule?.fine_rule_name}. Multa: ${fmtv(unitFineValue)}.`;

    res.status(200).json({
      hasFine:         true,
      unitFineValue:   Math.round(unitFineValue      * 100) / 100,
      fineValue:       Math.round(totalFineHistorico * 100) / 100,
      debtValue:       Math.round((Number(student.ed_service_price || 0) * overdueCount) * 100) / 100,
      reason, ruleId: appliedRule?.fine_rule_id, ruleName: appliedRule?.fine_rule_name,
      daysLate: maxDaysLate, overdueMonths: overdueCount,
      currency, coinTitle: coin.ed_coin_title,
      valueType:       appliedRule?.fine_rule_value_type || "fixed",
      skipWeekends:    Number(appliedRule?.fine_rule_skip_weekends ?? 1) !== 0,
      stopPointType:   appliedRule?.fine_rule_stop_point_type || "none",
    });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// SMS
// ═════════════════════════════════════════════════════════════════════════════

const GetSMSCredits = async (req, res) => {
  try {
    const [row] = await ExecuteQuery(res,
      `SELECT ed_sms_credit_total AS credits FROM eduall_sms_credits WHERE ed_sms_credit_institute_code=? LIMIT 1`,
      [instituteOf(req)], true, { db: "eduall_sms_credits", type: "select", data: req }) || [{ credits: 0 }];
    if (res.headersSent) return;
    res.status(200).json({ credits: Number(row?.credits || 0) });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

const SendSMSToResponsibles = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { studentIds, all: sendAll, paymentType } = req.body;
    const todayStr = new Date().toISOString().slice(0, 10);
    const today    = new Date();
    const rules = await ExecuteQuery(res,
      `SELECT * FROM eduall_fine_rules WHERE fine_rule_institute_code=? AND fine_rule_deleted=0
         AND fine_rule_active=1 AND fine_rule_alert_responsible=1
         AND (fine_rule_valid_from IS NULL OR fine_rule_valid_from<=?)
         AND (fine_rule_valid_until IS NULL OR fine_rule_valid_until>=?)`,
      [institute, todayStr, todayStr], true, { db: "eduall_fine_rules", type: "select", data: req });
    if (res.headersSent) return;
    if (!rules?.length) return res.status(200).json({ success: true, msg: "Nenhuma regra com alerta activo.", sent: 0 });
    const coin = await getCoin(res, req, institute);
    let sentCount = 0, failCount = 0;
    for (const rule of rules) {
      const tipo = paymentType || rule.fine_rule_payment_type;
      let students;
      if (sendAll || !studentIds?.length) {
        if (rule.fine_rule_all_classes) {
          students = await ExecuteQuery(res,
            `SELECT ${STUDENT_CONTACT_FIELDS} FROM eduall_students s LEFT JOIN eduall_class c ON c.ed_class_id=s.ed_student_class
             WHERE s.ed_student_institute_code=? AND s.ed_student_deleted=0`,
            [institute], true, { db: "eduall_students", type: "select", data: req });
        } else {
          students = await ExecuteQuery(res,
            `SELECT ${STUDENT_CONTACT_FIELDS} FROM eduall_students s
             LEFT JOIN eduall_class c ON c.ed_class_id=s.ed_student_class
             WHERE s.ed_student_class IN (
               SELECT frc_class_id FROM eduall_fine_rule_classes WHERE frc_rule_id=? AND frc_deleted=0
             ) AND s.ed_student_institute_code=? AND s.ed_student_deleted=0`,
            [rule.fine_rule_id, institute], true, { db: "eduall_students", type: "select", data: req });
        }
      } else {
        students = await ExecuteQuery(res,
          `SELECT ${STUDENT_CONTACT_FIELDS} FROM eduall_students s LEFT JOIN eduall_class c ON c.ed_class_id=s.ed_student_class
           WHERE s.ed_student_id IN (${studentIds.map(() => "?").join(",")}) AND s.ed_student_institute_code=? AND s.ed_student_deleted=0`,
          [...studentIds, institute], true, { db: "eduall_students", type: "select", data: req });
      }
      if (!students?.length) continue;
      const excl = await ExecuteQuery(res,
        `SELECT fe_student_id FROM eduall_fine_exclusions WHERE fe_rule_id=? AND fe_deleted=0 AND (fe_valid_until IS NULL OR fe_valid_until>=?)`,
        [rule.fine_rule_id, todayStr], true, { db: "eduall_fine_exclusions", type: "select", data: req });
      const excludedSet = new Set((excl || []).map(e => e.fe_student_id));
      for (const student of students) {
        if (excludedSet.has(student.ed_student_id)) continue;
        const phones = getAllContactPhones(student);
        if (!phones.length) continue;
        const [alreadySent] = await ExecuteQuery(res,
          `SELECT ed_sms_record_id FROM eduall_sms_records WHERE ed_sms_sent_contactid=? AND ed_sms_record_sent_usertype='multa'
             AND ed_sms_record_instituteCode=? AND DATE(ed_sms_sent_date)=? LIMIT 1`,
          [student.ed_student_id, institute, todayStr], true, { db: "eduall_sms_records", type: "select", data: req }) || [null];
        if (alreadySent) continue;
        const payments = await getOverduePayments(res, req, { studentId: student.ed_student_id, institute, paymentType: tipo, classId: student.ed_student_class });
        if (!payments?.length) continue;
        let totalFine = 0, maxDays = 0, months = 0;
        for (const p of payments) {
          const days = calcDiasEfectivos(p.duedate, rule, today);
          if (days <= 0) continue;
          totalFine += calcularMulta(rule, days, Number(p.service_price || 0));
          months++;
          if (days > maxDays) maxDays = days;
        }
        if (totalFine <= 0) continue;
        const msg = buildSMSMessage(student.ed_student_name, maxDays, months, totalFine, coin.ed_coin_code || "", student.ed_class_name || "");
        for (const phone of phones) {
          const r = await sendSMSViaTelco(phone, msg, institute, student.ed_student_id, res, req);
          if (r.sent) sentCount++; else failCount++;
        }
      }
    }
    if (res.headersSent) return;
    res.status(200).json({ success: true, msg: `SMS enviados: ${sentCount}. Falhas: ${failCount}.`, sent: sentCount, failed: failCount });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, msg: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════════
// MOTOR CRON
// ═════════════════════════════════════════════════════════════════════════════

async function runFineEngineForInstitute(institute, reqLike, resLike) {
  const today = new Date(), todayStr = today.toISOString().slice(0, 10);
  let appliedCount = 0, blockedCount = 0, smsSentCount = 0, skippedNoYear = 0;
  const safeRes = resLike || { headersSent: false };
  const coin = await getCoin(safeRes, reqLike, institute);

  const rules = await ExecuteQuery(safeRes,
    `SELECT * FROM eduall_fine_rules WHERE fine_rule_institute_code=? AND fine_rule_deleted=0 AND fine_rule_active=1
       AND (fine_rule_valid_from IS NULL OR fine_rule_valid_from<=?) AND (fine_rule_valid_until IS NULL OR fine_rule_valid_until>=?)`,
    [institute, todayStr, todayStr], true, { db: "eduall_fine_rules", type: "select", data: reqLike });
  if (!rules?.length) return { applied: 0, blocked: 0, smsSent: 0, skippedNoYear: 0 };

  for (const rule of rules) {
    let students;
    if (rule.fine_rule_all_classes) {
      students = await ExecuteQuery(safeRes,
        `SELECT ${STUDENT_CONTACT_FIELDS} FROM eduall_students s LEFT JOIN eduall_class c ON c.ed_class_id=s.ed_student_class
         WHERE s.ed_student_institute_code=? AND s.ed_student_deleted=0`,
        [institute], true, { db: "eduall_students", type: "select", data: reqLike });
    } else {
      students = await ExecuteQuery(safeRes,
        `SELECT ${STUDENT_CONTACT_FIELDS} FROM eduall_students s
         LEFT JOIN eduall_class c ON c.ed_class_id=s.ed_student_class
         WHERE s.ed_student_class IN (
           SELECT frc_class_id FROM eduall_fine_rule_classes WHERE frc_rule_id=? AND frc_deleted=0
         ) AND s.ed_student_institute_code=? AND s.ed_student_deleted=0`,
        [rule.fine_rule_id, institute], true, { db: "eduall_students", type: "select", data: reqLike });
    }
    if (!students?.length) continue;

    const excl = await ExecuteQuery(safeRes,
      `SELECT fe_student_id FROM eduall_fine_exclusions WHERE fe_rule_id=? AND fe_deleted=0 AND (fe_valid_until IS NULL OR fe_valid_until>=?)`,
      [rule.fine_rule_id, todayStr], true, { db: "eduall_fine_exclusions", type: "select", data: reqLike });
    const excludedSet = new Set((excl || []).map(e => e.fe_student_id));

    for (const student of students) {
      if (excludedSet.has(student.ed_student_id)) continue;
      let payments;
      try {
        payments = await getOverduePayments(safeRes, reqLike, {
          studentId: student.ed_student_id, institute,
          paymentType: rule.fine_rule_payment_type,
          classId: student.ed_student_class,
          selectedMonthCodes: null,
        });
      } catch (pErr) {
        console.warn(`[FineCron] Aluno ${student.ed_student_id} sem ano letivo: ${pErr.message}`);
        skippedNoYear++;
        continue;
      }
      if (!payments?.length) continue;

      let totalFine = 0, maxDaysLate = 0, overdueCount = 0;
      for (const p of payments) {
        const days = calcDiasEfectivos(p.duedate, rule, today);
        if (days <= 0) continue;
        const logKey = String(p.payment_month);
        const [already] = await ExecuteQuery(safeRes,
          `SELECT fl_id FROM eduall_fine_logs WHERE fl_student_id=? AND fl_rule_id=? AND fl_payment_month=? AND DATE(fl_applied_at)=? LIMIT 1`,
          [student.ed_student_id, rule.fine_rule_id, logKey, todayStr], true,
          { db: "eduall_fine_logs", type: "select", data: reqLike }) || [null];
        const capital = Number(p.service_price || 0);
        if (already) { if (days > maxDaysLate) maxDaysLate = days; continue; }
        const fine = calcularMulta(rule, days, capital);
        if (fine <= 0) continue;
        await ExecuteQuery(safeRes,
          `INSERT INTO eduall_fine_logs(fl_rule_id,fl_student_id,fl_class_id,fl_payment_month,fl_payment_type,fl_days_late,fl_fine_value,fl_capital,fl_model,fl_status,fl_institute_code)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          [rule.fine_rule_id, student.ed_student_id, student.ed_student_class, logKey, rule.fine_rule_payment_type, days, fine, capital, rule.fine_rule_model, "pendente", institute],
          false, { db: "eduall_fine_logs", type: "insert", data: reqLike });
        appliedCount++;
        totalFine += fine; overdueCount++;
        if (days > maxDaysLate) maxDaysLate = days;
        if (verificarBloqueio(rule, days)) {
          await ExecuteQuery(safeRes,
            `UPDATE eduall_students SET ed_student_services_blocked=1 WHERE ed_student_id=? AND ed_student_institute_code=?`,
            [student.ed_student_id, institute], false, { db: "eduall_students", type: "update", data: reqLike });
          blockedCount++;
        }
      }

      if (rule.fine_rule_alert_responsible && maxDaysLate > 0) {
        const phones = getAllContactPhones(student);
        const [alreadySMS] = await ExecuteQuery(safeRes,
          `SELECT ed_sms_record_id FROM eduall_sms_records WHERE ed_sms_sent_contactid=? AND ed_sms_record_sent_usertype='multa' AND ed_sms_record_instituteCode=? AND DATE(ed_sms_sent_date)=? LIMIT 1`,
          [student.ed_student_id, institute, todayStr], true,
          { db: "eduall_sms_records", type: "select", data: reqLike }) || [null];
        if (!alreadySMS && phones.length) {
          const msg = buildSMSMessage(student.ed_student_name, maxDaysLate, overdueCount, totalFine, coin.ed_coin_code || "", student.ed_class_name || "");
          for (const phone of phones) {
            const r = await sendSMSViaTelco(phone, msg, institute, student.ed_student_id, safeRes, reqLike);
            if (r.sent) smsSentCount++;
          }
        }
      }
    }
  }
  return { applied: appliedCount, blocked: blockedCount, smsSent: smsSentCount, skippedNoYear };
}

const RunFineEngine = async (req, res) => {
  try {
    const result = await runFineEngineForInstitute(instituteOf(req), req, res);
    if (res.headersSent) return;
    const extra = result.skippedNoYear > 0 ? ` (${result.skippedNoYear} sem ano letivo ignorados)` : "";
    res.status(200).json({
      success: true,
      msg: `Motor executado. Multas: ${result.applied}. Bloqueios: ${result.blocked}. SMS: ${result.smsSent}.${extra}`,
      ...result, ran_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("[RunFineEngine] ERRO:", e.message, "\n", e.stack);
    if (!res.headersSent) res.status(400).json({ success: false, msg: e.message });
  }
};

// ─── CRON ────────────────────────────────────────────────────────────────────
function initFineCron() {
  cron.schedule("0 8 * * *", async () => {
    console.log(`[FineCron] A iniciar — ${new Date().toISOString()}`);
    try {
      const institutes = await ExecuteQuery(null,
        `SELECT DISTINCT fine_rule_institute_code AS code FROM eduall_fine_rules WHERE fine_rule_deleted=0 AND fine_rule_active=1`,
        [], true, { db: "eduall_fine_rules", type: "select", data: { session: { user: { eduall_user_session_curentinstitute: null, eduall_user_session_ID: null } } } }) || [];
      for (const inst of institutes) {
        const reqLike = { session: { user: { eduall_user_session_curentinstitute: inst.code, eduall_user_session_ID: null } } };
        try {
          const r = await runFineEngineForInstitute(inst.code, reqLike, null);
          console.log(`[FineCron] ${inst.code} multas:${r.applied} bloqueios:${r.blocked} SMS:${r.smsSent} semAno:${r.skippedNoYear}`);
        } catch (e) { console.error(`[FineCron] Erro em ${inst.code}:`, e.message); }
      }
    } catch (e) { console.error("[FineCron] Erro geral:", e.message); }
  }, { timezone: "Africa/Luanda" });
  console.log("[FineCron] Cron registado — execução diária às 08:00 (Africa/Luanda).");
}

// ═════════════════════════════════════════════════════════════════════════════
// CalculateStudentFineByRule — v16 COMPLETA
//
// Calcula a multa para um aluno + regra + lista de meses.
// Suporta todos os modelos (A, B, C, D, E).
// Aplica fins de semana (Sáb=6, Dom=0) e ponto de paragem.
// Imprime log detalhado no console.
// ═════════════════════════════════════════════════════════════════════════════
 const CalculateStudentFineByRule = async (req, res) => {
 try {
 const {
 studentId,
 ruleId,
 selectedMonthCodes,
 servicePrice: bodyServicePrice,
 } = req.body;

 console.log("[DEBUG] req.body:", JSON.stringify({ studentId, ruleId, selectedMonthCodes, servicePrice: bodyServicePrice }));

 if (!studentId || !ruleId || !Array.isArray(selectedMonthCodes)) {
 return res.status(400).json({ success: false, msg: "Dados inválidos." });
 }

 // ── Aluno ────────────────────────────────────────────────────────────────
 const [student] = await ExecuteQuery(
 null,
 `SELECT s.*, c.ed_class_title AS ed_class_name, sv.ed_service_price
 FROM eduall_students s
 LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class
 LEFT JOIN eduall_services sv ON sv.ed_service_id = c.ed_class_service
 WHERE s.ed_student_id = ? LIMIT 1`,
 [studentId]
 );
 if (!student)
 return res.status(404).json({ success: false, msg: "Aluno não encontrado." });

 // ── Regra ────────────────────────────────────────────────────────────────
 const [rule] = await ExecuteQuery(
 null,
 `SELECT * FROM eduall_fine_rules WHERE fine_rule_id = ? LIMIT 1`,
 [ruleId]
 );
 if (!rule)
 return res.status(404).json({ success: false, msg: "Regra não encontrada." });

 // ── Capital (preço do serviço) ───────────────────────────────────────────
 const capital = Number(student.ed_service_price || bodyServicePrice || 0);

 // ── Parâmetros da regra ──────────────────────────────────────────────────
 const skipWeekends = Number(rule.fine_rule_skip_weekends ?? 1) !== 0;
 const stopPointType = rule.fine_rule_stop_point_type || "none";
 const model = rule.fine_rule_model;
 const today = new Date();
 today.setHours(0, 0, 0, 0);

 // Dia do mês em que a multa começa a ser aplicada (definido na regra).
 // Ex: fine_rule_due_day = 10 → multa arranca no dia 10 do mesmo mês da propina.
 // Se não estiver definido: fallback para dia 1 do mês seguinte (comportamento legado).
 const ruleDueDay = Number(rule.fine_rule_due_day || 0);

 // ── Utilitários ──────────────────────────────────────────────────────────
 const fmt = v =>
 Number(v || 0).toLocaleString("pt-AO", {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 });

 // Usa hora local evita desfasamento de timezone (UTC+1 recuaria 1 dia com toISOString)
 const fmtDate = d => {
 if (!(d instanceof Date)) return String(d);
 const y = d.getFullYear();
 const m = String(d.getMonth() + 1).padStart(2, "0");
 const dd = String(d.getDate()).padStart(2, "0");
 return `${y}-${m}-${dd}`;
 };

 const nomeDiaSemana = d => {
 const nomes = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira",
 "Quinta-feira", "Sexta-feira", "Sábado"];
 return nomes[d.getDay()];
 };

 const nomeMes = idx => {
 const nomes = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho",
 "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
 return nomes[idx] || "";
 };

 // ─────────────────────────────────────────────────────────────────────────
 // Constrói o dueDate correcto para um mês/ano:
 // - Se fine_rule_due_day definido (ex: 10) → dia 10 do PRÓPRIO mês da propina
 // - Caso contrário → dia 1 do mês SEGUINTE (legado)
 // ─────────────────────────────────────────────────────────────────────────
 const buildDueDate = (monthIdx, year) => {
   let d;
   if (ruleDueDay > 0) {
     // Dia explícito definido na regra
     d = new Date(year, monthIdx, ruleDueDay);
   } else if (stopPointType === "end_of_month") {
     // end_of_month sem due_day: multa arranca no dia fine_rule_fixed_after_days
     // do próprio mês da propina e para no último dia desse mesmo mês
     const startDay = Number(rule.fine_rule_fixed_after_days || 1);
     d = new Date(year, monthIdx, startDay);
   } else {
     // Fallback: dia 1 do mês seguinte
     d = new Date(year, monthIdx + 1, 1);
   }
   d.setHours(0, 0, 0, 0);
   return d;
 };

 // ─────────────────────────────────────────────────────────────────────────
 // LOG: calendário completo do mês todos os dias, dia da semana,
 // indica fins de semana, úteis, HOJE e data de vencimento.
 // ─────────────────────────────────────────────────────────────────────────
 const logCalendarioMes = (monthIdx, year, dueDate) => {
 const SEP = "──────────────────────────────────────────────────────────────";
 const todayStr = fmtDate(today);
 const dueStr = fmtDate(dueDate);
 const abrev = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

 // Só mostramos o calendário se o vencimento é no próprio mês;
 // caso seja no mês seguinte mostramos esse mês como contexto também.
 const targetMonth = dueDate.getMonth();
 const targetYear = dueDate.getFullYear();

 // Imprimir o mês da propina
 console.log(`\n ${SEP}`);
 console.log(` 📅 CALENDÁRIO ${nomeMes(monthIdx).toUpperCase()} ${year}`);
 console.log(` ${SEP}`);

 const diasDoMes = new Date(year, monthIdx + 1, 0).getDate();
 let diaUtilCount = 0;
 let fdsDias = 0;

 for (let dia = 1; dia <= diasDoMes; dia++) {
 const d = new Date(year, monthIdx, dia);
 d.setHours(0, 0, 0, 0);
 const dow = d.getDay();
 const isFds = dow === 0 || dow === 6;
 const dStr = fmtDate(d);
 const isHoje = dStr === todayStr;
 const isDue = dStr === dueStr;

 const pref = isHoje ? "▶ " : " ";
 const tags = [];
 if (isHoje) tags.push("← HOJE");
 if (isDue) tags.push("← VENCIMENTO");
 const suf = tags.length ? " " + tags.join(" ") : "";

 if (isFds) {
 fdsDias++;
 console.log(`${pref} ${String(dia).padStart(2)} ${dStr} [${abrev[dow]}] 🔴 Fim de semana${suf}`);
 } else {
 diaUtilCount++;
 console.log(`${pref} ${String(dia).padStart(2)} ${dStr} [${abrev[dow]}] 🟢 Dia útil (${diaUtilCount}º útil do mês)${suf}`);
 }
 }

 console.log(` ${SEP}`);
 console.log(` ✅ Dias úteis : ${diaUtilCount}`);
 console.log(` 🔴 Fins de semana : ${fdsDias}`);
 console.log(` 📆 Total dias : ${diasDoMes}`);
 console.log(` 📍 Hoje : ${todayStr} ${nomeDiaSemana(today)}`);
 console.log(` 📌 Vencimento : ${dueStr}${ruleDueDay > 0 ? ` (dia ${ruleDueDay} definido na regra)` : " (1.º do mês seguinte fallback)"}`);
 console.log(` ${SEP}\n`);
 };

 // ─────────────────────────────────────────────────────────────────────────
 // Helper: conta dias de atraso a partir do dueDate (inclusive) até hoje
 // ou até ao stopDate (se configurado e anterior a hoje).
 // ─────────────────────────────────────────────────────────────────────────
 const resolveEffectiveDays = (dueDate, monthIdx, year) => {
 let stopDate = null;
 let wasCapped = false;

 if (stopPointType === "end_of_month") {
 // Último dia do mês da propina — multa para sempre no fim desse mês
 stopDate = new Date(year, monthIdx + 1, 0);
 stopDate.setHours(0, 0, 0, 0);
 } else if (stopPointType === "day_next_month") {
 // Último dia do mês do vencimento
 stopDate = new Date(dueDate.getFullYear(), dueDate.getMonth() + 1, 0);
 stopDate.setHours(0, 0, 0, 0);
 } else if (stopPointType === "specific_day" && (rule.fine_rule_stop_point_day || rule.fine_rule_stop_day)) {
 stopDate = new Date(
 dueDate.getFullYear(),
 dueDate.getMonth(),
 Number((rule.fine_rule_stop_point_day || rule.fine_rule_stop_day))
 );
 stopDate.setHours(0, 0, 0, 0);
 if (stopDate <= dueDate) stopDate.setMonth(stopDate.getMonth() + 1);
 }

 let effectiveEnd = new Date(today);
 if (stopDate && stopDate < today) {
 effectiveEnd = new Date(stopDate);
 wasCapped = true;
 }

 // Vencimento ainda não chegou → sem multa
 if (effectiveEnd < dueDate) {
 return { days: 0, stopDate, wasCapped: false, diasContados: [], diasFds: [] };
 }


 // end_of_month: sem grace — o "período livre" já é o facto de a multa
 // só arrancar no dia fixed_after_days do mês. Grace aplicado apenas nos outros modos.
 const graceDays = stopPointType === "end_of_month" ? 0 : Number(rule.fine_rule_grace_days || 0);
 const diasContados = [];
 const diasFds = [];

 let cursor = new Date(dueDate);
 let diaNumero = 0;

 while (cursor <= effectiveEnd) {
 const dow = cursor.getDay();
 const isFds = dow === 0 || dow === 6;
 const dateStr = fmtDate(cursor);
 const diaNome = nomeDiaSemana(cursor);

 if (skipWeekends && isFds) {
 diasFds.push({ data: dateStr, diaNome });
 } else {
 diaNumero++;
 diasContados.push({
 numero: diaNumero,
 data: dateStr,
 diaNome,
 isGrace: diaNumero <= graceDays,
 });
 }
 cursor.setDate(cursor.getDate() + 1);
 }

 const days = Math.max(0, diaNumero - graceDays);
 return { days, stopDate, wasCapped, diasContados, diasFds };
 };

 // ─────────────────────────────────────────────────────────────────────────
 // Helper Modelo D
 // ─────────────────────────────────────────────────────────────────────────
 const resolveModelDBreakdown = (daysLate) => {
 const fixedVal = Number(rule.fine_rule_fixed_value || 0);
 const pctDia = Number(rule.fine_rule_daily_pct || 0);
 const diasJuro = Math.max(0, daysLate - 1);
 const juroPorDia = capital * (pctDia / 100);
 const jurosTotal = juroPorDia * diasJuro;
 const total = fixedVal + jurosTotal;
 return { fixedVal, pctDia, diasJuro, juroPorDia, jurosTotal, total };
 };

 // ─────────────────────────────────────────────────────────────────────────
 // Helper: valor da multa por modelo
 // ─────────────────────────────────────────────────────────────────────────
 const resolveFinValue = (daysLate) => {
 if (daysLate <= 0) return 0;
 switch (model) {
 case "A":
 return Number(rule.fine_rule_fixed_value || 0);

 case "B": {
 const valorDia = Number(rule.fine_rule_daily_value || 0);
 const maxValue = Number(rule.fine_rule_max_value || 0);
 const total = valorDia * daysLate;
 return maxValue > 0 ? Math.min(total, maxValue) : total;
 }

 case "C": {
 const tiers = JSON.parse(rule.fine_rule_tiers || "[]");
 tiers.sort((a, b) => a.upTo - b.upTo);
 for (const tier of tiers) {
 if (daysLate <= tier.upTo) return Number(tier.value || 0);
 }
 return tiers.length ? Number(tiers[tiers.length - 1].value || 0) : 0;
 }

 case "D":
 return resolveModelDBreakdown(daysLate).total;

 case "E": {
 const tiers = JSON.parse(rule.fine_rule_tiers || "[]");
 const pctDia = Number(rule.fine_rule_daily_pct || 0);
 tiers.sort((a, b) => a.upTo - b.upTo);
 for (const tier of tiers) {
 if (daysLate <= tier.upTo) return Number(tier.value || 0);
 }
 const lastValue = tiers.length ? Number(tiers[tiers.length - 1].value || 0) : 0;
 const lastUpTo = tiers.length ? tiers[tiers.length - 1].upTo : 0;
 return lastValue + capital * (pctDia / 100) * (daysLate - lastUpTo);
 }

 default:
 return 0;
 }
 };

 // ─────────────────────────────────────────────────────────────────────────
 // HTML explicativo design system Bossabox, cores da marca, sem emojis
 //
 // Tokens de cor:
 // purple #6051ff purpleLight #EEEDFE
 // green #00C48C greenLight #e4f9f3
 // orange/amber #F7C948 orangeLight #fff3e6
 // neutral #111827 / #374151 / #6B7280 / #D1D5DB / #F9FAFB
 // ─────────────────────────────────────────────────────────────────────────
 const resolveExplicacaoHTML = (daysLate, monthIdx, year, dueDate, stopDate, wasCapped, diasContados, diasFds) => {
 if (daysLate <= 0) return null;

 const d = resolveModelDBreakdown(daysLate);
 // end_of_month: sem grace — o "período livre" já é o facto de a multa
 // só arrancar no dia fixed_after_days do mês. Grace aplicado apenas nos outros modos.
 const graceDays = stopPointType === "end_of_month" ? 0 : Number(rule.fine_rule_grace_days || 0);
 const afterDays = Number(rule.fine_rule_fixed_after_days || 1);

 const diaArranque = diasContados.find(dc => dc.numero === afterDays && !dc.isGrace);
 const diaArranqueStr = diaArranque
 ? `${diaArranque.data} · ${diaArranque.diaNome}`
 : "";

 const diasMulta = diasContados.filter(dc => !dc.isGrace);
 const linhasVisiveis = diasMulta; // mostrar todos os dias
 const linhasOmitidas = 0;

 // ── Tabela de progressão ───────────────────────────────────────────────
 const linhasHTML = linhasVisiveis.map((dc, i) => {
 const isFirst = i === 0;
 const acumulado = d.fixedVal + d.juroPorDia * Math.max(0, i);
 const bgRow = i % 2 === 0 ? "#ffffff" : "#F9FAFB";

 const eventoBadge = isFirst
 ? `<span style="display:inline-block;background:#6051ff;color:#fff;
 padding:2px 10px;border-radius:100px;font-size:11px;font-weight:600;
 letter-spacing:.3px;white-space:nowrap;">
 Multa fixa ${fmt(d.fixedVal)} Kz
 </span>`
 : `<span style="font-size:12px;color:#374151;">
 <span style="font-weight:600;color:#6051ff;">+${fmt(d.juroPorDia)} Kz</span>
 <span style="color:#9CA3AF;margin-left:4px;">${capital} × ${d.pctDia}%</span>
 </span>`;

 return `
 <tr style="background:${bgRow};border-bottom:1px solid #F3F4F6;">
 <td style="padding:10px 16px;font-size:12px;font-weight:600;
 color:#9CA3AF;white-space:nowrap;width:56px;">
 D+${dc.numero - graceDays}
 </td>
 <td style="padding:10px 16px;white-space:nowrap;">
 <span style="font-size:13px;color:#111827;font-weight:500;">${dc.data}</span>
 <br>
 <span style="font-size:11px;color:#9CA3AF;">${dc.diaNome}</span>
 </td>
 <td style="padding:10px 16px;">${eventoBadge}</td>
 <td style="padding:10px 16px;font-size:13px;font-weight:700;
 text-align:right;white-space:nowrap;color:#111827;">
 ${fmt(acumulado)}&nbsp;<span style="font-size:11px;color:#9CA3AF;font-weight:400;">Kz</span>
 </td>
 </tr>`;
 }).join("");

 const linhaOmitidaHTML = linhasOmitidas > 0 ? `
 <tr style="background:#F9FAFB;">
 <td colspan="4" style="padding:8px 16px;font-size:11px;color:#9CA3AF;text-align:center;">
 + ${linhasOmitidas} dia(s) adicionais omitidos
 </td>
 </tr>` : "";

 // ── Alertas contextuais (border-left strip padrão Bossabox) ──────────
 const graceHTML = graceDays > 0 ? `
 <div style="border-left:3px solid #00C48C;background:#e4f9f3;
 border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:10px;">
 <p style="font-size:13px;font-weight:600;color:#00C48C;margin:0 0 2px;">
 Período de tolerância ${graceDays} dia(s)
 </p>
 <p style="font-size:12px;color:#374151;margin:0;line-height:1.6;">
 Os primeiros <strong>${graceDays} dia(s) útil(eis)</strong> após o vencimento
 não geram qualquer penalização.
 </p>
 </div>` : "";

 const fdsHTML = skipWeekends && diasFds.length > 0 ? `
 <div style="border-left:3px solid #6051ff;background:#EEEDFE;
 border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:10px;">
 <p style="font-size:13px;font-weight:600;color:#6051ff;margin:0 0 4px;">
 ${diasFds.length} dia(s) de fim de semana excluídos
 </p>
 <p style="font-size:12px;color:#374151;margin:0 0 8px;line-height:1.6;">
 Esta regra penaliza apenas dias úteis (segunda a sexta-feira).
 Os seguintes dias foram ignorados na contagem:
 </p>
 <div style="display:flex;flex-wrap:wrap;gap:6px;">
 ${diasFds.map(df => `
 <span style="background:#fff;border:1px solid #D1D5DB;border-radius:6px;
 padding:2px 8px;font-size:11px;color:#374151;white-space:nowrap;">
 ${df.data} · ${df.diaNome}
 </span>`).join("")}
 </div>
 </div>` : (!skipWeekends ? `
 <div style="border-left:3px solid #D1D5DB;background:#F9FAFB;
 border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:10px;">
 <p style="font-size:13px;font-weight:600;color:#374151;margin:0 0 2px;">
 Fins de semana incluídos
 </p>
 <p style="font-size:12px;color:#6B7280;margin:0;line-height:1.6;">
 Esta regra conta todos os dias corridos, incluindo sábados e domingos.
 </p>
 </div>` : "");

 const paragemHTML = wasCapped ? `
 <div style="border-left:3px solid #F7C948;background:#fff3e6;
 border-radius:0 8px 8px 0;padding:12px 16px;margin-bottom:10px;">
 <p style="font-size:13px;font-weight:600;color:#92400e;margin:0 0 2px;">
 Ponto de paragem activo
 </p>
 <p style="font-size:12px;color:#374151;margin:0;line-height:1.6;">
 A contagem foi limitada até <strong>${fmtDate(stopDate)}</strong>,
 conforme definido na regra. A multa não cresce para além desse ponto.
 </p>
 </div>` : "";

 // Label de vencimento legível
 const dueDateLabel = ruleDueDay > 0
 ? `dia ${ruleDueDay} de ${nomeMes(monthIdx)} ${year}`
 : `dia 1 de ${nomeMes((monthIdx + 1) % 12)} ${monthIdx === 11 ? year + 1 : year}`;

 return `
<style>
 @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&display=swap');
</style>

<div style="font-family:'Inter',system-ui,sans-serif;background:#ffffff;
 width:100%;overflow:hidden;">

 <!-- ── Cabeçalho ─────────────────────────────────── -->
 <div style="padding:20px 24px;border-bottom:1px solid #E5E7EB;
 display:flex;align-items:flex-start;justify-content:space-between;gap:16px;">
 <div>
 <p style="font-size:11px;font-weight:600;letter-spacing:1px;color:#9CA3AF;
 text-transform:uppercase;margin:0 0 4px;">Multa por atraso · Modelo ${model}</p>
 <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0;">
 ${nomeMes(monthIdx)} ${year}
 </h2>
 <p style="font-size:12px;color:#6B7280;margin:4px 0 0;">
 Vencimento em ${fmtDate(dueDate)}
 </p>
 </div>
 <div style="text-align:right;flex-shrink:0;">
 <p style="font-size:11px;font-weight:600;color:#9CA3AF;
 text-transform:uppercase;letter-spacing:.8px;margin:0 0 2px;">Multa total</p>
 <p style="font-size:24px;font-weight:700;color:#6051ff;margin:0;
 font-family:'IBM Plex Mono',monospace;letter-spacing:-1px;line-height:1.1;">
 ${fmt(d.total)} <span style="font-size:13px;font-weight:500;color:#9CA3AF;">Kz</span>
 </p>
 </div>
 </div>

 <div style="padding:20px 24px;">

 <!-- ── Cards KPI ──────────────────────────────── -->
 <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px;">

 <div style="border:1px solid #E5E7EB;border-radius:8px;padding:14px;">
 <p style="font-size:11px;font-weight:600;color:#6B7280;
 text-transform:uppercase;letter-spacing:.8px;margin:0 0 6px;">Propina</p>
 <p style="font-size:18px;font-weight:700;color:#111827;margin:0;
 font-family:'IBM Plex Mono',monospace;">${fmt(capital)}</p>
 <p style="font-size:11px;color:#9CA3AF;margin:3px 0 0;">Kz</p>
 </div>

 <div style="border:1px solid #E5E7EB;border-left:3px solid #F7C948;
 border-radius:8px;padding:14px;background:#fff3e6;">
 <p style="font-size:11px;font-weight:600;color:#6B7280;
 text-transform:uppercase;letter-spacing:.8px;margin:0 0 6px;">Dias de atraso</p>
 <p style="font-size:18px;font-weight:700;color:#92400e;margin:0;
 font-family:'IBM Plex Mono',monospace;">${daysLate}</p>
 <p style="font-size:11px;color:#9CA3AF;margin:3px 0 0;">dia(s) útil(eis)</p>
 </div>

 <div style="border:1px solid #E5E7EB;border-left:3px solid #6051ff;
 border-radius:8px;padding:14px;background:#EEEDFE;">
 <p style="font-size:11px;font-weight:600;color:#6B7280;
 text-transform:uppercase;letter-spacing:.8px;margin:0 0 6px;">Total a pagar</p>
 <p style="font-size:18px;font-weight:700;color:#6051ff;margin:0;
 font-family:'IBM Plex Mono',monospace;">${fmt(capital + d.total)}</p>
 <p style="font-size:11px;color:#9CA3AF;margin:3px 0 0;">Kz</p>
 </div>

 </div>

 <!-- ── Explicação do modelo ────────────────────── -->
 <div style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:10px;">
 <div style="padding:10px 16px;background:#F9FAFB;border-bottom:1px solid #E5E7EB;">
 <p style="font-size:13px;font-weight:600;color:#111827;margin:0;">Como é calculada</p>
 </div>
 <div style="padding:16px;">
 <p style="font-size:13px;color:#374151;margin:0 0 10px;line-height:1.7;">
 A propina de <strong style="color:#111827;">${nomeMes(monthIdx)} ${year}</strong>
 venceu no <strong style="color:#111827;">${dueDateLabel}</strong>.
 ${graceDays > 0
 ? `Após <strong style="color:#00C48C;">${graceDays} dia(s) de tolerância</strong>, a`
 : "A"
 }
 contagem considera apenas dias úteis
 ${skipWeekends
 ? "<strong style=\"color:#6051ff;\">(segunda a sexta-feira)</strong>"
 : "<strong>(incluindo fins de semana)</strong>"
 }.
 </p>
 <p style="font-size:13px;color:#374151;margin:0 0 14px;line-height:1.7;">
 <strong style="color:#111827;">No 1.º dia de atraso</strong> (${diaArranqueStr})
 aplica-se uma <strong>multa fixa de ${fmt(d.fixedVal)} Kz</strong>.
 A partir do <strong>2.º dia</strong> acrescenta-se
 <strong>${d.pctDia}% da propina por dia</strong> ${fmt(d.juroPorDia)} Kz/dia.
 </p>
 <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:6px;
 padding:12px 14px;">
 <p style="font-size:11px;font-weight:600;color:#6B7280;
 text-transform:uppercase;letter-spacing:.8px;margin:0 0 6px;">Fórmula</p>
 <code style="font-family:'IBM Plex Mono',monospace;font-size:12px;
 color:#374151;line-height:1.8;">
 <span style="color:#9CA3AF;font-size:11px;">dia 1: multa fixa &nbsp;|&nbsp; dias 2 a ${daysLate}: juro diário (${d.diasJuro}d)</span><br>
 ${fmt(d.fixedVal)} + (${fmt(capital)} × ${d.pctDia}% × ${d.diasJuro}d)
 &nbsp;=&nbsp;<strong style="color:#6051ff;font-size:14px;">${fmt(d.total)} Kz</strong>
 </code>
 </div>
 </div>
 </div>

 ${graceHTML}
 ${fdsHTML}
 ${paragemHTML}

 <!-- ── Progressão dia a dia ───────────────────── -->
 <div style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;margin-bottom:10px;">
 <div style="padding:10px 16px;background:#F9FAFB;border-bottom:1px solid #E5E7EB;
 display:flex;align-items:center;justify-content:space-between;">
 <p style="font-size:13px;font-weight:600;color:#111827;margin:0;">Progressão dia a dia</p>
 <span style="background:#EEEDFE;border:1px solid #c4bffe;border-radius:100px;
 padding:2px 10px;font-size:11px;color:#6051ff;font-weight:600;">
 ${daysLate} dia(s) útil(eis)
 </span>
 </div>
 <div style="overflow-x:auto;">
 <table style="width:100%;border-collapse:collapse;min-width:380px;">
 <thead>
 <tr style="background:#F9FAFB;border-bottom:1px solid #E5E7EB;">
 <th style="padding:8px 16px;font-size:11px;font-weight:600;text-align:left;
 color:#6B7280;letter-spacing:.6px;text-transform:uppercase;">Dia</th>
 <th style="padding:8px 16px;font-size:11px;font-weight:600;text-align:left;
 color:#6B7280;letter-spacing:.6px;text-transform:uppercase;">Data</th>
 <th style="padding:8px 16px;font-size:11px;font-weight:600;text-align:left;
 color:#6B7280;letter-spacing:.6px;text-transform:uppercase;">Evento</th>
 <th style="padding:8px 16px;font-size:11px;font-weight:600;text-align:right;
 color:#6B7280;letter-spacing:.6px;text-transform:uppercase;">Acumulado</th>
 </tr>
 </thead>
 <tbody>
 ${linhasHTML}
 ${linhaOmitidaHTML}
 <tr style="background:#F9FAFB;border-top:1px solid #E5E7EB;">
 <td colspan="3" style="padding:12px 16px;font-size:13px;
 font-weight:600;color:#111827;">
 Total da multa
 </td>
 <td style="padding:12px 16px;font-size:14px;font-weight:700;
 text-align:right;color:#6051ff;font-family:'IBM Plex Mono',monospace;">
 ${fmt(d.total)}&nbsp;<span style="font-size:11px;color:#9CA3AF;font-weight:400;">Kz</span>
 </td>
 </tr>
 </tbody>
 </table>
 </div>
 </div>

 <!-- ── Resumo de liquidação ───────────────────── -->
 <div style="border:1px solid #E5E7EB;border-radius:8px;overflow:hidden;">
 <div style="padding:10px 16px;background:#F9FAFB;border-bottom:1px solid #E5E7EB;">
 <p style="font-size:13px;font-weight:600;color:#111827;margin:0;">Resumo de liquidação</p>
 </div>
 <div style="padding:4px 0;">

 <div style="display:flex;justify-content:space-between;align-items:center;
 padding:10px 16px;border-bottom:1px solid #F3F4F6;">
 <span style="font-size:13px;color:#6B7280;">Propina</span>
 <span style="font-size:13px;color:#374151;font-family:'IBM Plex Mono',monospace;font-weight:500;">
 ${fmt(capital)} Kz
 </span>
 </div>

 <div style="display:flex;justify-content:space-between;align-items:center;
 padding:10px 16px;border-bottom:1px solid #F3F4F6;">
 <span style="font-size:13px;color:#6B7280;">Multa fixa 1.º dia de atraso</span>
 <span style="font-size:13px;color:#374151;font-family:'IBM Plex Mono',monospace;font-weight:500;">
 + ${fmt(d.fixedVal)} Kz
 </span>
 </div>

 <div style="display:flex;justify-content:space-between;align-items:center;
 padding:10px 16px;border-bottom:1px solid #F3F4F6;">
 <span style="font-size:13px;color:#6B7280;">
 Juros ${d.diasJuro} dia(s) × ${fmt(d.juroPorDia)} Kz
 </span>
 <span style="font-size:13px;color:#374151;font-family:'IBM Plex Mono',monospace;font-weight:500;">
 + ${fmt(d.jurosTotal)} Kz
 </span>
 </div>

 <div style="display:flex;justify-content:space-between;align-items:center;
 padding:14px 16px;background:#EEEDFE;">
 <span style="font-size:14px;font-weight:700;color:#111827;">Total a pagar</span>
 <span style="font-size:18px;font-weight:700;color:#6051ff;
 font-family:'IBM Plex Mono',monospace;letter-spacing:-0.5px;">
 ${fmt(capital + d.total)}&nbsp;<span style="font-size:12px;font-weight:500;color:#9CA3AF;">Kz</span>
 </span>
 </div>

 </div>
 </div>

 </div>
</div>`.trim();
 };

 // ── Processar cada mês ───────────────────────────────────────────────────
 let totalFine = 0;
 const breakdown = [];

 for (const code of selectedMonthCodes) {
 const parts = code.split(".");
 const monthIdx = Number(parts[0]);
 const year = Number(parts[1]);

 // Vencimento correcto: usa o dia definido na regra, no próprio mês da propina
 const dueDate = buildDueDate(monthIdx, year);

 console.log(`[DEBUG] code=${code} monthIdx=${monthIdx} year=${year} dueDate=${fmtDate(dueDate)} stopPointType=${stopPointType} ruleDueDay=${ruleDueDay}`);

 // LOG: calendário completo do mês com vencimento assinalado
 logCalendarioMes(monthIdx, year, dueDate);

 const { days, stopDate, wasCapped, diasContados, diasFds } =
 resolveEffectiveDays(dueDate, monthIdx, year);

 console.log(`[DEBUG] days=${days} stopDate=${stopDate ? fmtDate(stopDate) : "null"} wasCapped=${wasCapped} graceDays=${rule.fine_rule_grace_days || 0} dueDate=${fmtDate(dueDate)}`);

 const fine = resolveFinValue(days);

 let details = {};
 if (model === "D" && days > 0) {
 const d = resolveModelDBreakdown(days);
 details = {
 fixedVal: d.fixedVal,
 diasJuro: d.diasJuro,
 juroPorDia: Math.round(d.juroPorDia * 100) / 100,
 jurosTotal: Math.round(d.jurosTotal * 100) / 100,
 pctDia: d.pctDia,
 formula: `${fmt(d.fixedVal)} + ${fmt(capital)} × ${d.pctDia}% × ${d.diasJuro}d`,
 explicacao_html: resolveExplicacaoHTML(
 days, monthIdx, year, dueDate, stopDate, wasCapped, diasContados, diasFds
 ),
 };
 } else if (model === "B" && days > 0) {
 details = {
 valorDia: Number(rule.fine_rule_daily_value || 0),
 maxValue: Number(rule.fine_rule_max_value || 0),
 };
 }

 breakdown.push({
 code,
 monthIdx,
 year,
 dueDate: fmtDate(dueDate),
 daysLate: days,
 fine: Math.round(fine * 100) / 100,
 wasCapped,
 stopDate: stopDate ? fmtDate(stopDate) : null,
 ...details,
 });

 totalFine += fine;
 }

 // ── LOG FINAL ────────────────────────────────────────────────────────────
 const fmtKz = v =>
 Number(v || 0).toLocaleString("pt-AO", {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 });
 const LINE = "══════════════════════════════════════════════════════════════";

 console.log(`\n${LINE}`);
 console.log("✅ FASE FINAL RESULTADO DETALHADO");
 console.log(LINE);
 console.log("▶ RESUMO GERAL");
 console.log(` Aluno : ${student.ed_student_name}`);
 console.log(` Data actual : ${fmtDate(today)} ${nomeDiaSemana(today)}`);
 console.log(` Modelo : ${model}`);
 console.log(` Dia de vencimento : ${ruleDueDay > 0 ? `dia ${ruleDueDay} do mês (definido na regra)` : "dia 1 do mês seguinte (fallback)"}`);
 console.log(` Meses com multa : ${breakdown.filter(b => b.fine > 0).length}`);
 console.log(` Capital base : ${fmtKz(capital)} Kz`);
 console.log(` Fins de semana : ${skipWeekends ? "Excluídos (Sáb+Dom não contam)" : "Incluídos"}`);
 console.log(` Ponto de paragem : ${stopPointType === "none" ? "Nenhum" : stopPointType}`);

 const maxMonth = breakdown.reduce(
 (a, b) => (b.daysLate > (a?.daysLate || 0) ? b : a),
 null
 );

 if (maxMonth && maxMonth.daysLate > 0) {
 console.log(` Mês mais atrasado : ${maxMonth.code} (venceu ${maxMonth.dueDate})`);
 console.log(` Dias de atraso : ${maxMonth.daysLate}${skipWeekends ? " úteis" : " corridos"}`);
 if (maxMonth.wasCapped)
 console.log(` ⚠ Paragem activa : contagem limitada a ${maxMonth.stopDate}`);

 if (model === "D") {
 console.log("\n▶ DETALHE MODELO D");
 console.log(` ┌─ Multa fixa (dia 1) : ${fmtKz(maxMonth.fixedVal)} Kz`);
 console.log(` ├─ Dias com juro : ${maxMonth.diasJuro} dia(s) útil(eis) após o 1.º dia`);
 console.log(` ├─ Juro por dia : ${fmtKz(capital)} × ${maxMonth.pctDia}% = ${fmtKz(maxMonth.juroPorDia)} Kz/dia`);
 console.log(` ├─ Total juros : ${fmtKz(maxMonth.juroPorDia)} × ${maxMonth.diasJuro} = ${fmtKz(maxMonth.jurosTotal)} Kz`);
 console.log(` └─ TOTAL multa : ${fmtKz(maxMonth.fixedVal)} + ${fmtKz(maxMonth.jurosTotal)} = ${fmtKz(maxMonth.fine)} Kz`);
 console.log(`\n ▷ Progressão:`);
 console.log(` Dia 1 → multa fixa = ${fmtKz(maxMonth.fixedVal)} Kz`);
 for (let i = 1; i <= Math.min(maxMonth.diasJuro, 5); i++) {
 const acum = maxMonth.fixedVal + maxMonth.juroPorDia * i;
 console.log(` Dia ${String(i + 1).padStart(2)} → +${fmtKz(maxMonth.juroPorDia)} Kz (juro dia ${i}) = ${fmtKz(acum)} Kz`);
 }
 if (maxMonth.diasJuro > 5)
 console.log(` … mais ${maxMonth.diasJuro - 5} dia(s)`);
 }
 }

 console.log("\n▶ TOTAL GERAL");
 console.log(` totalFine : ${fmtKz(totalFine)} Kz`);
 if (breakdown.length > 1) {
 console.log("▶ BREAKDOWN POR MÊS");
 breakdown.forEach(b => {
 const status = b.fine > 0
 ? `${fmtKz(b.fine)} Kz${b.wasCapped ? " (paragem activa)" : ""}`
 : "sem multa";
 console.log(` ${b.code.padEnd(10)} venc.${b.dueDate} ${b.daysLate}d → ${status}`);
 });
 }
 console.log(`${LINE}\n`);

 // ── Resposta ─────────────────────────────────────────────────────────────
 const withFine = breakdown.filter(b => b.fine > 0);
 const unitFineValue =
 withFine.length > 0
 ? Math.round((withFine.reduce((s, b) => s + b.fine, 0) / withFine.length) * 100) / 100
 : 0;

 const explicacao_html = breakdown
 .filter(b => b.explicacao_html)
 .map(b => b.explicacao_html)
 .join(`<hr style="margin:1.5rem 0;border:none;border-top:1px solid #e2e8f0;">`);

 return res.status(200).json({
 success: true,
 totalFine: Math.round(totalFine * 100) / 100,
 fineValue: Math.round(totalFine * 100) / 100,
 unitFineValue,
 hasFine: totalFine > 0,
 breakdown,
 skipWeekends,
 stopPointType,
 model,
 capital,
 explicacao_html,
 });

 } catch (e) {
 console.error("[CalculateStudentFineByRule] ERRO:", e);
 return res.status(500).json({ success: false, msg: e.message });
 }
};

module.exports = {
  GetFineRules, CreateFineRule, UpdateFineRule, ToggleFineRule, DeleteFineRule, ConflictCheck,
  GetExclusions, AddExclusion, RemoveExclusion,
  GetFineLogs, GetFineLogsByStudent,
  GetFinesDashboard,
  GetClassDebtors,
  GetClassListForFines,
  CalculateStudentFine,
  RunFineEngine,
  SendSMSToResponsibles, GetSMSCredits,
  initFineCron,
  CalculateStudentFineByRule,
};
  

