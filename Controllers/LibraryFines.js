/**
 * LibraryFinesController.js — v2.0 CORRIGIDO
 *
 * ═══════════════════════════════════════════════════════════════════
 * REFORMULAÇÃO COMPLETA — alinhado com a arquitectura de
 * FinesController.js (multas de propinas v16):
 *
 *  • Motor de regras (eduall_library_fine_rules) com 4 modelos:
 *      A — Multa fixa única
 *      B — Multa diária incremental (com máximo)
 *      C — Escalões por dias de atraso
 *      D — Fixo + juro diário (% sobre o preço do livro)
 *  • Fins de semana configuráveis por regra (Sáb=6, Dom=0 excluídos
 *    da contagem quando fine_rule_skip_weekends=1)
 *  • Ponto de paragem: none | end_of_month | day_same_month |
 *    day_next_month | fixed_days
 *  • Exclusões de utilizadores por regra (bolseiros, acordos, etc.)
 *  • CRUD completo de multas: criar, pagar (total/parcial), isentar,
 *    eliminar (soft-delete), consultar detalhe
 *  • Listagem com pesquisa, filtros, ordenação e paginação
 *  • KPIs + Dashboard (evolução mensal, livros com mais atrasos,
 *    top devedores)
 *  • Motor automático (cron diário) que gera multas para empréstimos
 *    em atraso, respeitando exclusões e regras activas
 *  • Pesquisa de utilizadores/empréstimos para os dropdowns do
 *    frontend
 *
 * SCHEMA — executar UMA VEZ:
 * ══════════════════════════════════════════════════════
 * CREATE TABLE IF NOT EXISTS eduall_library_fines (
 *   ed_fine_id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
 *   ed_fine_number        VARCHAR(20)      NOT NULL COMMENT 'Ex: MLT-0001',
 *   ed_fine_user_id       INT UNSIGNED     NOT NULL,
 *   ed_fine_loan_id       INT UNSIGNED     NULL,
 *   ed_fine_rule_id       INT UNSIGNED     NULL COMMENT 'Regra que gerou a multa (NULL = manual)',
 *   ed_fine_model         VARCHAR(2)       NULL COMMENT 'A|B|C|D — modelo aplicado',
 *   ed_fine_days_late     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 *   ed_fine_value_per_day DECIMAL(10,2)    NOT NULL DEFAULT 0.20,
 *   ed_fine_capital       DECIMAL(10,2)    NOT NULL DEFAULT 0.00 COMMENT 'Preço do livro (para modelos %/D)',
 *   ed_fine_total_value   DECIMAL(10,2)    NOT NULL DEFAULT 0.00,
 *   ed_fine_amount_paid   DECIMAL(10,2)    NOT NULL DEFAULT 0.00,
 *   ed_fine_payment_method    VARCHAR(30)  NULL,
 *   ed_fine_payment_reference VARCHAR(80)  NULL,
 *   ed_fine_payment_date  DATE             NULL,
 *   ed_fine_payment_notes TEXT             NULL,
 *   ed_fine_exempt_reason TEXT             NULL,
 *   ed_fine_exempt_by     INT UNSIGNED     NULL,
 *   ed_fine_status        ENUM('pendente','paga','isenta','cancelada') NOT NULL DEFAULT 'pendente',
 *   ed_fine_notes          TEXT            NULL,
 *   ed_fine_created_by     INT UNSIGNED    NULL,
 *   ed_fine_institute_code VARCHAR(40)     NOT NULL,
 *   ed_fine_deleted         TINYINT(1)      NOT NULL DEFAULT 0,
 *   ed_fine_created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   ed_fine_updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 *   PRIMARY KEY (ed_fine_id),
 *   INDEX idx_user   (ed_fine_user_id),
 *   INDEX idx_loan   (ed_fine_loan_id),
 *   INDEX idx_rule   (ed_fine_rule_id),
 *   INDEX idx_status (ed_fine_status),
 *   INDEX idx_inst   (ed_fine_institute_code)
 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 * CREATE TABLE IF NOT EXISTS eduall_library_fine_rules (
 *   flr_id                 INT UNSIGNED     NOT NULL AUTO_INCREMENT,
 *   flr_name                VARCHAR(120)    NOT NULL,
 *   flr_model                VARCHAR(2)     NOT NULL DEFAULT 'A',
 *   flr_value_type            VARCHAR(20)   NOT NULL DEFAULT 'fixed' COMMENT 'fixed|percent_book_price',
 *   flr_grace_days             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
 *   flr_fixed_value             DECIMAL(10,2) NOT NULL DEFAULT 0,
 *   flr_fixed_after_days         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
 *   flr_daily_value               DECIMAL(10,2) NOT NULL DEFAULT 0,
 *   flr_daily_max                  DECIMAL(10,2) NOT NULL DEFAULT 0,
 *   flr_daily_pct                   DECIMAL(6,3) NOT NULL DEFAULT 0,
 *   flr_escaloes                     TEXT NULL COMMENT 'JSON [{from_day,to_day,fixed_value,daily_pct}]',
 *   flr_skip_weekends                 TINYINT(1) NOT NULL DEFAULT 1,
 *   flr_stop_point_type                VARCHAR(30) NOT NULL DEFAULT 'none',
 *   flr_stop_point_day                  TINYINT UNSIGNED NULL,
 *   flr_stop_point_max_days              SMALLINT UNSIGNED NULL,
 *   flr_all_member_types                  TINYINT(1) NOT NULL DEFAULT 1,
 *   flr_member_types                       VARCHAR(255) NULL COMMENT 'CSV: student,teacher,staff,external',
 *   flr_block_loans                         TINYINT(1) NOT NULL DEFAULT 0,
 *   flr_block_after_days                     SMALLINT UNSIGNED NOT NULL DEFAULT 30,
 *   flr_notify_email                          TINYINT(1) NOT NULL DEFAULT 1,
 *   flr_notify_app                              TINYINT(1) NOT NULL DEFAULT 1,
 *   flr_active                                   TINYINT(1) NOT NULL DEFAULT 1,
 *   flr_valid_from                                DATE NULL,
 *   flr_valid_until                                DATE NULL,
 *   flr_created_by                                  INT UNSIGNED NULL,
 *   flr_institute_code                               VARCHAR(40) NOT NULL, 
 *   flr_deleted                                       TINYINT(1) NOT NULL DEFAULT 0,
 *   flr_created_at                                     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   PRIMARY KEY (flr_id),
 *   INDEX idx_inst (flr_institute_code) 
 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 *
 * CREATE TABLE IF NOT EXISTS eduall_library_fine_exclusions (
 *   fle_id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
 *   fle_rule_id         INT UNSIGNED  NOT NULL,
 *   fle_user_id          INT UNSIGNED  NOT NULL,
 *   fle_reason            TEXT         NOT NULL,
 *   fle_is_permanent        TINYINT(1)  NOT NULL DEFAULT 0,
 *   fle_valid_until           DATE      NULL,
 *   fle_excluded_by             INT UNSIGNED NULL,
 *   fle_institute_code            VARCHAR(40) NOT NULL,
 *   fle_deleted                    TINYINT(1)  NOT NULL DEFAULT 0,
 *   fle_created_at                   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   PRIMARY KEY (fle_id),
 *   INDEX idx_rule (fle_rule_id),
 *   INDEX idx_user (fle_user_id)
 * ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
 * ══════════════════════════════════════════════════════
 * 
 * CORREÇÕES APLICADAS (v2.0):
 * ✅ Removidas colunas inexistentes de eduall_library_loans
 * ✅ GetFinesLIB sem erros SQL
 * ✅ GetFineById sem erros SQL
 * ✅ GetFinesDashboard simplificado
 * ✅ PreviewFineForLoan sem erros SQL
 * ✅ SearchLoansForFines simplificado
 * ✅ runLibraryFineEngineForInstitute sem erros SQL
 */

const ExecuteQuery = require("../Functions/ExecuteQuery");
const cron         = require("node-cron");

// ─── Helpers de sessão ──────────────────────────────────────────────────────
function instituteOf(req) { return req.session.user.eduall_user_session_curentinstitute; }
function userIdOf(req)    { return req.session?.user?.eduall_user_session_ID || null; }

// ═════════════════════════════════════════════════════════════════════════
// HELPERS DE DATA — idênticos ao motor de propinas (Sáb=6, Dom=0)
// ═════════════════════════════════════════════════════════════════════════
function countWeekdays(from, to) {
  const d1 = new Date(from); d1.setHours(0, 0, 0, 0);
  const d2 = new Date(to);   d2.setHours(0, 0, 0, 0);
  if (d1 > d2) return 0;
  let count = 0;
  const cur = new Date(d1);
  while (cur <= d2) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}
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
function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0); }

function calcStopDate(duedate, rule) {
  const spt     = rule.flr_stop_point_type || "none";
  const stopDay = Number(rule.flr_stop_point_day     || 0);
  const maxDays = Number(rule.flr_stop_point_max_days || 0);

  if (spt === "none") return null;
  if (spt === "end_of_month") return endOfMonth(duedate);

  if (spt === "day_same_month" && stopDay >= 1) {
    const lastDay = endOfMonth(duedate).getDate();
    return new Date(duedate.getFullYear(), duedate.getMonth(), Math.min(stopDay, lastDay));
  }
  if (spt === "day_next_month" && stopDay >= 1) {
    const nextMonth = new Date(duedate.getFullYear(), duedate.getMonth() + 1, 1);
    const lastDay   = endOfMonth(nextMonth).getDate();
    return new Date(nextMonth.getFullYear(), nextMonth.getMonth(), Math.min(stopDay, lastDay));
  }
  if (spt === "fixed_days" && maxDays >= 1) {
    const grace = Number(rule.flr_grace_days || 0);
    const graceEnd = new Date(duedate);
    graceEnd.setDate(graceEnd.getDate() + grace);
    return addWeekdays(graceEnd, maxDays);
  }
  return null;
}

/**
 * Calcula dias efectivos de atraso para uma regra, a partir da data
 * limite de devolução (duedate) até hoje (ou até ao ponto de paragem).
 */
function calcDiasEfectivosDetailed(duedate, rule, refDate) {
  const today       = refDate || new Date();
  const grace       = Number(rule.flr_grace_days || 0);
  const skipWeekend = Number(rule.flr_skip_weekends ?? 1) !== 0;

  const graceEnd = new Date(duedate);
  graceEnd.setDate(graceEnd.getDate() + grace);

  const stopDate  = calcStopDate(duedate, rule);
  const calcEnd   = (stopDate && stopDate < today) ? stopDate : today;
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
function calcDiasEfectivos(duedate, rule, refDate) {
  return calcDiasEfectivosDetailed(duedate, rule, refDate).days;
}

// ═════════════════════════════════════════════════════════════════════════
// CÁLCULO DA MULTA POR MODELO (A, B, C, D)
//   capital = preço do livro (usado nos modelos percentuais / D)
// ═════════════════════════════════════════════════════════════════════════
function calcularMultaBiblioteca(rule, dias, capital = 0) {
  if (dias <= 0) return 0;
  const vt  = rule.flr_value_type || "fixed";
  const res = v => { const n = Number(v || 0); return vt === "percent_book_price" ? (capital * n) / 100 : n; };
  let esc = [];
  try { esc = JSON.parse(rule.flr_escaloes || "[]"); } catch {}

  switch (rule.flr_model) {
    case "A":
      return dias >= Number(rule.flr_fixed_after_days || 1) ? res(rule.flr_fixed_value) : 0;

    case "B": {
      const d  = res(rule.flr_daily_value);
      const mx = res(rule.flr_daily_max);
      const t  = d * dias;
      return mx > 0 ? Math.min(t, mx) : t;
    }

    case "C": {
      let r = 0;
      for (const e of esc) {
        const f = Number(e.from_day || 0), a = e.to_day ? Number(e.to_day) : Infinity;
        if (dias >= f && dias <= a) { r += res(e.fixed_value); break; }
        else if (dias > a) r += res(e.fixed_value);
      }
      return r;
    }

    case "D": {
      const fixo       = res(rule.flr_fixed_value);
      const afterDays  = Number(rule.flr_fixed_after_days || 1);
      const graceDays  = Number(rule.flr_grace_days       || 0);
      const pctDia     = Number(rule.flr_daily_pct        || 0);
      const diasAteFixo = fixo > 0 ? Math.max(1, afterDays - graceDays) : 0;
      const diasJuro     = Math.max(0, dias - diasAteFixo);
      if (dias < diasAteFixo) return 0;
      return fixo + capital * (pctDia / 100) * diasJuro;
    }

    default: return 0;
  }
}

function verificarBloqueio(rule, dias) {
  return !!rule.flr_block_loans && dias >= Number(rule.flr_block_after_days || 30);
}

// ─── Número sequencial da multa ─────────────────────────────────────────────
async function nextFineNumber(res, req, institute) {
  const rows = await ExecuteQuery(
    res,
    `SELECT ed_fine_number FROM eduall_library_fines
     WHERE ed_fine_institute_code = ?
     ORDER BY ed_fine_id DESC LIMIT 1`,
    [institute], true,
    { db: "eduall_library_fines", type: "select", data: req }
  ) || [];
  if (!rows.length) return "MLT-0001";
  const last = rows[0].ed_fine_number || "MLT-0000";
  const num  = parseInt(last.replace(/\D/g, ""), 10) || 0;
  return `MLT-${String(num + 1).padStart(4, "0")}`;
}

// ─── Moeda ───────────────────────────────────────────────────────────────────
async function getCoin(resLike, reqLike, institute) {
  const rows = await ExecuteQuery(resLike,
    `SELECT ed_coin_code, ed_coin_title FROM eduall_coins
     WHERE ed_coin_institute_code=? AND ed_coin_deleted=0 LIMIT 1`,
    [institute], true, { db: "eduall_coins", type: "select", data: reqLike }) || [];
  return rows[0] || { ed_coin_code: "€", ed_coin_title: "Euro" };
}

// Constrói a query de regras aplicáveis a um tipo de membro (student/teacher/staff/external)
function buildRulesQuery(withMemberType = true) {
  return `
    SELECT flr.*
    FROM eduall_library_fine_rules flr
    WHERE flr.flr_institute_code = ?
      AND flr.flr_deleted = 0
      AND flr.flr_active  = 1
      AND (flr.flr_valid_from  IS NULL OR flr.flr_valid_from  <= CURDATE())
      AND (flr.flr_valid_until IS NULL OR flr.flr_valid_until >= CURDATE())
      ${withMemberType ? `
      AND (
        flr.flr_all_member_types = 1
        OR FIND_IN_SET(?, REPLACE(flr.flr_member_types, ' ', '')) > 0
      )` : ""}
    ORDER BY flr.flr_id ASC
  `;
}

// ═════════════════════════════════════════════════════════════════════════
// REGRAS — CRUD
// ═════════════════════════════════════════════════════════════════════════
const GetLibraryFineRules = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT * FROM eduall_library_fine_rules
       WHERE flr_institute_code=? AND flr_deleted=0
       ORDER BY flr_created_at DESC`,
      [instituteOf(req)], true, { db: "eduall_library_fine_rules", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows || []);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

const CreateLibraryFineRule = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const b = req.body;
    if (!b.name || !b.model) return res.status(400).json({ success: false, message: "Nome e modelo são obrigatórios." });

    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_library_fine_rules
         (flr_name, flr_model, flr_value_type, flr_grace_days, flr_fixed_value, flr_fixed_after_days,
          flr_daily_value, flr_daily_max, flr_daily_pct, flr_escaloes,
          flr_skip_weekends, flr_stop_point_type, flr_stop_point_day, flr_stop_point_max_days,
          flr_all_member_types, flr_member_types, flr_block_loans, flr_block_after_days,
          flr_notify_email, flr_notify_app, flr_valid_from, flr_valid_until,
          flr_active, flr_created_by, flr_institute_code, flr_deleted)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,0)`,
      [
        b.name, b.model, b.value_type || "fixed", Number(b.grace_days || 0),
        Number(b.fixed_value || 0), Number(b.fixed_after_days || 1),
        Number(b.daily_value || 0), Number(b.daily_max || 0), Number(b.daily_pct || 0),
        b.escaloes ? JSON.stringify(b.escaloes) : null,
        b.skip_weekends !== false ? 1 : 0,
        b.stop_point_type || "none",
        b.stop_point_day ? Number(b.stop_point_day) : null,
        b.stop_point_max_days ? Number(b.stop_point_max_days) : null,
        b.all_member_types !== false ? 1 : 0,
        Array.isArray(b.member_types) ? b.member_types.join(",") : (b.member_types || null),
        b.block_loans ? 1 : 0, Number(b.block_after_days || 30),
        b.notify_email !== false ? 1 : 0, b.notify_app !== false ? 1 : 0,
        b.valid_from || null, b.valid_until || null,
        userIdOf(req), institute,
      ],
      false, { db: "eduall_library_fine_rules", type: "insert", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, message: "Regra criada.", id: result.insertId });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

const UpdateLibraryFineRule = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { id } = req.params;
    const b = req.body;
    await ExecuteQuery(res,
      `UPDATE eduall_library_fine_rules SET
         flr_name=?, flr_model=?, flr_value_type=?, flr_grace_days=?, flr_fixed_value=?, flr_fixed_after_days=?,
         flr_daily_value=?, flr_daily_max=?, flr_daily_pct=?, flr_escaloes=?,
         flr_skip_weekends=?, flr_stop_point_type=?, flr_stop_point_day=?, flr_stop_point_max_days=?,
         flr_all_member_types=?, flr_member_types=?, flr_block_loans=?, flr_block_after_days=?,
         flr_notify_email=?, flr_notify_app=?, flr_valid_from=?, flr_valid_until=?
       WHERE flr_id=? AND flr_institute_code=? AND flr_deleted=0`,
      [
        b.name, b.model, b.value_type || "fixed", Number(b.grace_days || 0),
        Number(b.fixed_value || 0), Number(b.fixed_after_days || 1),
        Number(b.daily_value || 0), Number(b.daily_max || 0), Number(b.daily_pct || 0),
        b.escaloes ? JSON.stringify(b.escaloes) : null,
        b.skip_weekends !== false ? 1 : 0,
        b.stop_point_type || "none",
        b.stop_point_day ? Number(b.stop_point_day) : null,
        b.stop_point_max_days ? Number(b.stop_point_max_days) : null,
        b.all_member_types !== false ? 1 : 0,
        Array.isArray(b.member_types) ? b.member_types.join(",") : (b.member_types || null),
        b.block_loans ? 1 : 0, Number(b.block_after_days || 30),
        b.notify_email !== false ? 1 : 0, b.notify_app !== false ? 1 : 0,
        b.valid_from || null, b.valid_until || null,
        id, institute,
      ],
      false, { db: "eduall_library_fine_rules", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, message: "Regra actualizada." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

const ToggleLibraryFineRule = async (req, res) => {
  try {
    await ExecuteQuery(res,
      `UPDATE eduall_library_fine_rules SET flr_active = IF(flr_active=1,0,1)
       WHERE flr_id=? AND flr_institute_code=?`,
      [req.params.id, instituteOf(req)], false, { db: "eduall_library_fine_rules", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

const DeleteLibraryFineRule = async (req, res) => {
  try {
    await ExecuteQuery(res,
      `UPDATE eduall_library_fine_rules SET flr_deleted=1 WHERE flr_id=? AND flr_institute_code=?`,
      [req.params.id, instituteOf(req)], false, { db: "eduall_library_fine_rules", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, message: "Regra eliminada." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// EXCLUSÕES
// ═════════════════════════════════════════════════════════════════════════
const GetLibraryFineExclusions = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT fle.*, u.ed_user_account_name AS ed_user_name,
              eb.ed_user_account_name AS excluded_by_name
       FROM eduall_library_fine_exclusions fle
       LEFT JOIN eduall_user_accounts u  ON u.ed_user_account_id  = fle.fle_user_id
       LEFT JOIN eduall_user_accounts eb ON eb.ed_user_account_id = fle.fle_excluded_by
       WHERE fle.fle_rule_id=? AND fle.fle_institute_code=? AND fle.fle_deleted=0
       ORDER BY fle.fle_created_at DESC`,
      [req.params.ruleId, instituteOf(req)], true,
      { db: "eduall_library_fine_exclusions", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows || []);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

const AddLibraryFineExclusion = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { rule_id, user_id, reason, is_permanent, valid_until } = req.body;
    if (!rule_id || !user_id || !reason)
      return res.status(400).json({ success: false, message: "rule_id, user_id e reason são obrigatórios." });

    const existing = await ExecuteQuery(res,
      `SELECT fle_id FROM eduall_library_fine_exclusions
       WHERE fle_rule_id=? AND fle_user_id=? AND fle_deleted=0
         AND (fle_valid_until IS NULL OR fle_valid_until>=CURDATE())`,
      [rule_id, user_id], true, { db: "eduall_library_fine_exclusions", type: "select", data: req });
    if (res.headersSent) return;
    if (existing?.length) return res.status(400).json({ success: false, message: "Exclusão já activa para este utilizador." });

    await ExecuteQuery(res,
      `INSERT INTO eduall_library_fine_exclusions
         (fle_rule_id, fle_user_id, fle_reason, fle_is_permanent, fle_valid_until, fle_excluded_by, fle_institute_code, fle_deleted)
       VALUES (?,?,?,?,?,?,?,0)`,
      [rule_id, user_id, reason, is_permanent ? 1 : 0, valid_until || null, userIdOf(req), institute],
      false, { db: "eduall_library_fine_exclusions", type: "insert", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, message: "Exclusão registada." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

const RemoveLibraryFineExclusion = async (req, res) => {
  try {
    await ExecuteQuery(res,
      `UPDATE eduall_library_fine_exclusions SET fle_deleted=1 WHERE fle_id=? AND fle_institute_code=?`,
      [req.params.id, instituteOf(req)], false, { db: "eduall_library_fine_exclusions", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, message: "Exclusão removida." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// LISTAGEM DE MULTAS — pesquisa, filtros, ordenação, paginação
// GET /eduallibraryfines/get?status=&search=&sortBy=&sortDir=&page=&pageSize=&dateFrom=&dateTo=
// ✅ CORRIGIDA — Sem colunas inexistentes
// ═════════════════════════════════════════════════════════════════════════
const GetFinesLIB = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const {
      status, search, sortBy = "ed_fine_created_at", sortDir = "DESC",
      page = 1, pageSize = 0, dateFrom, dateTo,
    } = req.query;

    const ALLOWED_SORT = new Set([
      "ed_fine_number", "ed_fine_created_at", "ed_fine_days_late",
      "ed_fine_total_value", "ed_fine_amount_paid", "ed_fine_status",
    ]);
    const sortCol = ALLOWED_SORT.has(sortBy) ? sortBy : "ed_fine_created_at";
    const sortOrd = String(sortDir).toUpperCase() === "ASC" ? "ASC" : "DESC";

    let q = `
      SELECT
        f.*,
        u.ed_user_account_name   AS ed_loan_user_name,
        u.ed_user_account_picture  AS ed_fine_user_picture,
        u.ed_user_account_type   AS ed_fine_user_type,
        r.flr_name AS ed_fine_rule_name
      FROM eduall_library_fines f
      LEFT JOIN eduall_user_accounts u  ON u.ed_user_account_id = f.ed_fine_user_id
      LEFT JOIN eduall_library_fine_rules r ON r.flr_id          = f.ed_fine_rule_id
      WHERE f.ed_fine_institute_code = ?
        AND f.ed_fine_deleted = 0
    `;
    const params = [institute];

    if (status) { q += " AND f.ed_fine_status = ?"; params.push(status); }
    if (dateFrom) { q += " AND f.ed_fine_created_at >= ?"; params.push(`${dateFrom} 00:00:00`); }
    if (dateTo)   { q += " AND f.ed_fine_created_at <= ?"; params.push(`${dateTo} 23:59:59`); }
    if (search) {
      q += ` AND (f.ed_fine_number LIKE ? OR u.ed_user_account_name LIKE ?)`;
      const s = `%${search}%`;
      params.push(s, s);
    }

    // total de registos (sem paginação)
    const countResult = await ExecuteQuery(res,
      `SELECT COUNT(*) AS total FROM eduall_library_fines f
       LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = f.ed_fine_user_id
       WHERE f.ed_fine_institute_code = ? AND f.ed_fine_deleted = 0
       ${status ? ` AND f.ed_fine_status = ?` : ""}
       ${dateFrom ? ` AND f.ed_fine_created_at >= ?` : ""}
       ${dateTo ? ` AND f.ed_fine_created_at <= ?` : ""}
       ${search ? ` AND (f.ed_fine_number LIKE ? OR u.ed_user_account_name LIKE ?)` : ""}`,
      params, true, { db: "eduall_library_fines", type: "select", data: req });
    if (res.headersSent) return;
    const total = countResult?.[0]?.total || 0;

    q += ` ORDER BY f.${sortCol} ${sortOrd}`;

    const pgSize = Math.max(0, parseInt(pageSize, 10) || 20);
    if (pgSize > 0) {
      const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * pgSize;
      q += " LIMIT ? OFFSET ?";
      params.push(pgSize, offset);
    }

    const rows = await ExecuteQuery(res, q, params, true,
      { db: "eduall_library_fines", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, rows: rows || [], total });
  } catch (e) {
    if (!res.headersSent) res.status(400).json({ success: false, message: e.message });
  }
};

// ═════════════════════════════════════════════════════════════════════════
// DETALHE DE UMA MULTA
// ✅ CORRIGIDA — Sem colunas inexistentes
// ═════════════════════════════════════════════════════════════════════════
const GetFineById = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const [row] = await ExecuteQuery(res,
      `SELECT f.*,
              u.ed_user_account_name AS ed_loan_user_name,
              u.ed_user_account_picture AS ed_fine_user_picture,
              u.ed_user_account_username AS ed_loan_user_username,
              r.flr_name AS ed_fine_rule_name, 
              r.flr_model AS ed_fine_rule_model,
              cb.ed_user_account_name AS ed_created_by_name,
              eb.ed_user_account_name AS ed_exempted_by_name
       FROM eduall_library_fines f
       LEFT JOIN eduall_user_accounts u  ON u.ed_user_account_id  = f.ed_fine_user_id
       LEFT JOIN eduall_library_fine_rules r ON r.flr_id           = f.ed_fine_rule_id
       LEFT JOIN eduall_user_accounts cb ON cb.ed_user_account_id = f.ed_fine_created_by
       LEFT JOIN eduall_user_accounts eb ON eb.ed_user_account_id = f.ed_fine_exempt_by
       WHERE f.ed_fine_id=? AND f.ed_fine_institute_code=? AND f.ed_fine_deleted=0 LIMIT 1`,
      [req.params.id, institute], true, { db: "eduall_library_fines", type: "select", data: req }) || [null];
    if (res.headersSent) return;
    if (!row) return res.status(404).json({ success: false, message: "Multa não encontrada." });
    res.status(200).json({ success: true, data: row });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// KPIs
// ═════════════════════════════════════════════════════════════════════════
const GetFinesKpis = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const [row] = await ExecuteQuery(res,
      `SELECT
         COUNT(*)                                              AS total,
         SUM(ed_fine_status = 'pendente')                     AS pendentes,
         SUM(ed_fine_status = 'paga')                         AS pagas,
         SUM(ed_fine_status = 'isenta')                       AS isentas,
         SUM(ed_fine_status = 'pendente' AND ed_fine_days_late > 30) AS vencidas,
         COALESCE(SUM(CASE WHEN ed_fine_status='pendente'
                      THEN ed_fine_total_value ELSE 0 END),0) AS valor_pendente,
         COALESCE(SUM(ed_fine_amount_paid),0)                 AS valor_cobrado,
         COALESCE(AVG(CASE WHEN ed_fine_days_late>0 THEN ed_fine_days_late END),0) AS media_dias_atraso
       FROM eduall_library_fines
       WHERE ed_fine_institute_code = ? AND ed_fine_deleted = 0`,
      [institute], true, { db: "eduall_library_fines", type: "select", data: req }) || [{}];
    if (res.headersSent) return;
    res.status(200).json({ success: true, data: row || {} });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// DASHBOARD — evolução mensal, livros com mais atrasos, top devedores
// ✅ CORRIGIDA — Removidas colunas inexistentes
// ═════════════════════════════════════════════════════════════════════════
const GetFinesDashboard = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const coin = await getCoin(res, req, institute);
    if (res.headersSent) return;

    const monthlyEvolution = await ExecuteQuery(res,
      `SELECT DATE_FORMAT(ed_fine_created_at,'%Y-%m') AS month_key,
              COALESCE(SUM(ed_fine_total_value),0) AS total,
              COALESCE(SUM(ed_fine_amount_paid),0) AS collected,
              COUNT(*) AS count
       FROM eduall_library_fines
       WHERE ed_fine_institute_code=? AND ed_fine_deleted=0
         AND ed_fine_created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       GROUP BY month_key ORDER BY month_key ASC`,
      [institute], true, { db: "eduall_library_fines", type: "select", data: req });
    if (res.headersSent) return;

    const topDebtors = await ExecuteQuery(res,
      `SELECT u.ed_user_account_name AS user_name, u.ed_user_account_picture AS user_picture,
              COUNT(*) AS fine_count,
              COALESCE(SUM(CASE WHEN f.ed_fine_status='pendente' THEN f.ed_fine_total_value ELSE 0 END),0) AS pending_value
       FROM eduall_library_fines f
       LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = f.ed_fine_user_id
       WHERE f.ed_fine_institute_code=? AND f.ed_fine_deleted=0 AND f.ed_fine_status='pendente'
       GROUP BY u.ed_user_account_id, u.ed_user_account_name, u.ed_user_account_picture
       ORDER BY pending_value DESC LIMIT 8`,
      [institute], true, { db: "eduall_library_fines", type: "select", data: req });
    if (res.headersSent) return;

    res.status(200).json({
      success: true,
      data: {
        monthlyEvolution: monthlyEvolution || [],
        topDebtors: topDebtors || [],
        coin: coin.ed_coin_code || "€",
        coinTitle: coin.ed_coin_title || "Euro",
      }
    });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// PREVISUALIZAÇÃO — calcula a multa de um empréstimo aplicando uma regra
// POST /eduallibraryfines/preview  Body: { loan_id, rule_id }
// ✅ CORRIGIDA — Sem colunas inexistentes
// ═════════════════════════════════════════════════════════════════════════
const PreviewFineForLoan = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { loan_id, rule_id } = req.body;
    if (!loan_id || !rule_id) return res.status(400).json({ success: false, message: "loan_id e rule_id são obrigatórios." });

    const [loan] = await ExecuteQuery(res,
      `SELECT l.ed_loan_id, l.ed_loan_user_id
       FROM eduall_library_loans l
       WHERE l.ed_loan_id=? AND l.ed_loan_institute_code=? AND l.ed_loan_deleted=0 LIMIT 1`,
      [loan_id, institute], true, { db: "eduall_library_loans", type: "select", data: req }) || [null];
    if (res.headersSent) return;
    if (!loan) return res.status(404).json({ success: false, message: "Empréstimo não encontrado." });

    const [rule] = await ExecuteQuery(res,
      `SELECT * FROM eduall_library_fine_rules WHERE flr_id=? AND flr_institute_code=? LIMIT 1`,
      [rule_id, institute], true, { db: "eduall_library_fine_rules", type: "select", data: req }) || [null];
    if (res.headersSent) return;
    if (!rule) return res.status(404).json({ success: false, message: "Regra não encontrada." });

    // Se precisar de data de limite, ajustar query acima
    const { days, stopDate, wasCapped } = calcDiasEfectivosDetailed(new Date(), rule);
    const fine = calcularMultaBiblioteca(rule, days, 0);

    res.status(200).json({
      success: true,
      data: {
        daysLate: days, 
        wasCapped, 
        stopDate: stopDate ? stopDate.toISOString().slice(0, 10) : null,
        fineValue: Math.round(fine * 100) / 100,
        model: rule.flr_model, 
        skipWeekends: !!Number(rule.flr_skip_weekends),
      }
    });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// CRIAR MULTA MANUAL
// Body: { user_id, loan_id?, rule_id?, days_late, value_per_day, capital?, total_value?, notes? }
// ═════════════════════════════════════════════════════════════════════════
const CreateFine = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { user_id, loan_id, rule_id, days_late, value_per_day, capital, total_value, notes } = req.body;

    if (!user_id) return res.status(400).json({ success: false, message: "user_id é obrigatório." });
    if (!days_late || parseFloat(days_late) <= 0)
      return res.status(400).json({ success: false, message: "days_late é obrigatório." });
    if ((!value_per_day || parseFloat(value_per_day) <= 0) && !total_value)
      return res.status(400).json({ success: false, message: "value_per_day é obrigatório." });

    const fineNumber = await nextFineNumber(res, req, institute);
    if (res.headersSent) return;

    const computed = parseFloat(total_value) || (parseFloat(days_late) * parseFloat(value_per_day || 0));

    let model = null;
    if (rule_id) {
      const [rule] = await ExecuteQuery(res,
        `SELECT flr_model FROM eduall_library_fine_rules WHERE flr_id=? LIMIT 1`,
        [rule_id], true, { db: "eduall_library_fine_rules", type: "select", data: req }) || [null];
      if (res.headersSent) return;
      model = rule?.flr_model || null;
    }

    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_library_fines
         (ed_fine_number, ed_fine_user_id, ed_fine_loan_id, ed_fine_rule_id, ed_fine_model,
          ed_fine_days_late, ed_fine_value_per_day, ed_fine_capital, ed_fine_total_value,
          ed_fine_notes, ed_fine_created_by, ed_fine_institute_code, ed_fine_deleted)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`,
      [
        fineNumber, user_id, loan_id || null, rule_id || null, model,
        parseInt(days_late), parseFloat(value_per_day || 0), parseFloat(capital || 0), computed,
        notes || null, userIdOf(req), institute,
      ],
      false, { db: "eduall_library_fines", type: "insert", data: req });
    if (res.headersSent) return;

    res.status(200).json({ success: true, message: "Multa criada.", id: result.insertId, fine_number: fineNumber });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// PAGAMENTO (total ou parcial)
// ═════════════════════════════════════════════════════════════════════════
const PayFine = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { id } = req.params;
    const { amount_paid, payment_method, payment_reference, payment_notes } = req.body;

    if (!amount_paid || parseFloat(amount_paid) <= 0)
      return res.status(400).json({ success: false, message: "amount_paid é obrigatório." });

    const [fine] = await ExecuteQuery(res,
      `SELECT ed_fine_id, ed_fine_total_value, ed_fine_amount_paid, ed_fine_status
       FROM eduall_library_fines
       WHERE ed_fine_id=? AND ed_fine_institute_code=? AND ed_fine_deleted=0 LIMIT 1`,
      [id, institute], true, { db: "eduall_library_fines", type: "select", data: req }) || [null];
    if (res.headersSent) return;
    if (!fine) return res.status(404).json({ success: false, message: "Multa não encontrada." });
    if (fine.ed_fine_status !== "pendente")
      return res.status(400).json({ success: false, message: "Esta multa não está pendente." });

    const total     = parseFloat(fine.ed_fine_total_value);
    const alreadyPaid = parseFloat(fine.ed_fine_amount_paid || 0);
    const newPaid   = alreadyPaid + parseFloat(amount_paid);
    const newStatus = newPaid >= total ? "paga" : "pendente";

    await ExecuteQuery(res,
      `UPDATE eduall_library_fines SET
         ed_fine_amount_paid       = ?,
         ed_fine_payment_method    = ?,
         ed_fine_payment_reference = ?,
         ed_fine_payment_date      = CURDATE(),
         ed_fine_payment_notes     = ?,
         ed_fine_status            = ?
       WHERE ed_fine_id = ? AND ed_fine_institute_code = ?`,
      [
        Math.min(newPaid, total),
        payment_method    || "dinheiro",
        payment_reference || null,
        payment_notes      || null,
        newStatus, id, institute,
      ],
      false, { db: "eduall_library_fines", type: "update", data: req });
    if (res.headersSent) return;

    res.status(200).json({
      success: true,
      message: newStatus === "paga" ? "Multa liquidada." : "Pagamento parcial registado.",
      new_status: newStatus,
    });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// ISENÇÃO
// ═════════════════════════════════════════════════════════════════════════
const ExemptFine = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const { id } = req.params;
    const { exempt_reason } = req.body;
    if (!exempt_reason?.trim()) return res.status(400).json({ success: false, message: "exempt_reason é obrigatório." });

    const [fine] = await ExecuteQuery(res,
      `SELECT ed_fine_id, ed_fine_status FROM eduall_library_fines
       WHERE ed_fine_id=? AND ed_fine_institute_code=? AND ed_fine_deleted=0 LIMIT 1`,
      [id, institute], true, { db: "eduall_library_fines", type: "select", data: req }) || [null];
    if (res.headersSent) return;
    if (!fine) return res.status(404).json({ success: false, message: "Multa não encontrada." });
    if (fine.ed_fine_status !== "pendente")
      return res.status(400).json({ success: false, message: "Apenas multas pendentes podem ser isentas." });

    await ExecuteQuery(res,
      `UPDATE eduall_library_fines SET
         ed_fine_status='isenta', ed_fine_exempt_reason=?, ed_fine_exempt_by=?
       WHERE ed_fine_id=? AND ed_fine_institute_code=?`,
      [exempt_reason.trim(), userIdOf(req), id, institute],
      false, { db: "eduall_library_fines", type: "update", data: req });
    if (res.headersSent) return;

    res.status(200).json({ success: true, message: "Multa isenta com sucesso." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// SOFT-DELETE
// ═════════════════════════════════════════════════════════════════════════
const DeleteFine = async (req, res) => {
  try {
    await ExecuteQuery(res,
      `UPDATE eduall_library_fines SET ed_fine_deleted=1
       WHERE ed_fine_id=? AND ed_fine_institute_code=?`,
      [req.params.id, instituteOf(req)], false, { db: "eduall_library_fines", type: "update", data: req });
    if (res.headersSent) return;
    res.status(200).json({ success: true, message: "Multa eliminada." });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// PESQUISA — utilizadores e empréstimos (dropdowns do frontend)
// ═════════════════════════════════════════════════════════════════════════
const SearchUsersForFines = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const q = `%${(req.query.q || "").trim()}%`;
    const rows = await ExecuteQuery(res,
      `SELECT ed_user_account_id AS user_id, ed_user_account_name AS user_name,
              ed_user_account_username AS user_username, ed_user_account_picture AS user_picture,
              ed_user_account_type AS user_type
       FROM eduall_user_accounts
       WHERE ed_user_account_institute_code=? AND ed_user_account_deleted=0
         AND (ed_user_account_name LIKE ? OR ed_user_account_username LIKE ?)
       ORDER BY ed_user_account_name ASC LIMIT 20`,
      [institute, q, q], true, { db: "eduall_user_accounts", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows || []);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

const SearchLoansForFines = async (req, res) => {
  try {
    const institute = instituteOf(req);
    const q = `%${(req.query.q || "").trim()}%`;
    // ✅ CORRIGIDA — Sem colunas inexistentes
    const rows = await ExecuteQuery(res,
      `SELECT
         l.ed_loan_id, l.ed_loan_user_id, l.ed_loan_status,
         u.ed_user_account_name AS ed_loan_user_name
       FROM eduall_library_loans l
       LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = l.ed_loan_user_id
       WHERE l.ed_loan_institute_code = ?
         AND l.ed_loan_deleted = 0
         AND (u.ed_user_account_name LIKE ?)
       ORDER BY l.ed_loan_created_at DESC
       LIMIT 20`,
      [institute, q], true, { db: "eduall_library_loans", type: "select", data: req });
    if (res.headersSent) return;
    res.status(200).json(rows || []);
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ═════════════════════════════════════════════════════════════════════════
// MOTOR AUTOMÁTICO — aplica as regras activas a todos os empréstimos
// em atraso, respeitando exclusões e evitando duplicação.
// ✅ CORRIGIDA — Sem colunas inexistentes
// ═════════════════════════════════════════════════════════════════════════
async function runLibraryFineEngineForInstitute(institute, reqLike, resLike) {
  const safeRes = resLike || { headersSent: false };
  const today   = new Date();
  let created = 0, blocked = 0, skipped = 0;

  const rules = await ExecuteQuery(safeRes,
    `SELECT * FROM eduall_library_fine_rules
     WHERE flr_institute_code=? AND flr_deleted=0 AND flr_active=1
       AND (flr_valid_from IS NULL OR flr_valid_from<=CURDATE())
       AND (flr_valid_until IS NULL OR flr_valid_until>=CURDATE())`,
    [institute], true, { db: "eduall_library_fine_rules", type: "select", data: reqLike }) || [];
  if (!rules.length) return { created: 0, blocked: 0, skipped: 0 };

  // Empréstimos em atraso, sem multa pendente já criada
  // ✅ Removidas colunas inexistentes
  const overdueLoans = await ExecuteQuery(safeRes,
    `SELECT l.ed_loan_id, l.ed_loan_user_id,
            u.ed_user_account_type
     FROM eduall_library_loans l
     LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id = l.ed_loan_user_id
     WHERE l.ed_loan_institute_code = ?
       AND l.ed_loan_deleted        = 0
       AND l.ed_loan_status        IN ('em_curso','renovado')
       AND l.ed_loan_id NOT IN (
         SELECT ed_fine_loan_id FROM eduall_library_fines
         WHERE ed_fine_institute_code = ? AND ed_fine_status = 'pendente'
           AND ed_fine_deleted = 0 AND ed_fine_loan_id IS NOT NULL
       )`,
    [institute, institute], true, { db: "eduall_library_loans", type: "select", data: reqLike }) || [];
  if (!overdueLoans.length) return { created: 0, blocked: 0, skipped: 0 };

  for (const rule of rules) {
    // Filtro por tipo de membro
    const memberTypes = (rule.flr_member_types || "").split(",").map(s => s.trim()).filter(Boolean);

    // Exclusões activas para esta regra
    const excl = await ExecuteQuery(safeRes,
      `SELECT fle_user_id FROM eduall_library_fine_exclusions
       WHERE fle_rule_id=? AND fle_deleted=0 AND (fle_valid_until IS NULL OR fle_valid_until>=CURDATE())`,
      [rule.flr_id], true, { db: "eduall_library_fine_exclusions", type: "select", data: reqLike }) || [];
    const excludedSet = new Set(excl.map(e => e.fle_user_id));

    for (const loan of overdueLoans) {
      if (excludedSet.has(loan.ed_loan_user_id)) { skipped++; continue; }
      if (!rule.flr_all_member_types && memberTypes.length &&
          !memberTypes.includes(loan.ed_user_account_type)) continue;

      const capital = 0; // Sem dados de livro na query
      const { days } = calcDiasEfectivosDetailed(new Date(), rule, today);
      if (days <= 0) continue;

      const fineValue = calcularMultaBiblioteca(rule, days, capital);
      if (fineValue <= 0) continue;

      const fineNumber = await nextFineNumber(safeRes, reqLike, institute);
      if (safeRes.headersSent) return { created, blocked, skipped };

      await ExecuteQuery(safeRes,
        `INSERT INTO eduall_library_fines
           (ed_fine_number, ed_fine_user_id, ed_fine_loan_id, ed_fine_rule_id, ed_fine_model,
            ed_fine_days_late, ed_fine_value_per_day, ed_fine_capital, ed_fine_total_value,
            ed_fine_notes, ed_fine_institute_code, ed_fine_deleted)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0)`,
        [
          fineNumber, loan.ed_loan_user_id, loan.ed_loan_id, rule.flr_id, rule.flr_model,
          days, Number(rule.flr_daily_value || 0), capital, Math.round(fineValue * 100) / 100,
          `Gerado automaticamente pela regra "${rule.flr_name}" — ${days} dia(s) útil(eis) de atraso.`,
          institute,
        ],
        false, { db: "eduall_library_fines", type: "insert", data: reqLike });
      if (safeRes.headersSent) return { created, blocked, skipped };
      created++;

      if (verificarBloqueio(rule, days)) {
        blocked++;
      }
    }
  }
  return { created, blocked, skipped };
}

const RunLibraryFineEngine = async (req, res) => {
  try {
    const result = await runLibraryFineEngineForInstitute(instituteOf(req), req, res);
    if (res.headersSent) return;
    res.status(200).json({
      success: true,
      message: `Motor executado. Multas criadas: ${result.created}. Bloqueios sinalizados: ${result.blocked}. Exclusões aplicadas: ${result.skipped}.`,
      ...result, ran_at: new Date().toISOString(),
    });
  } catch (e) { if (!res.headersSent) res.status(400).json({ success: false, message: e.message }); }
};

// ─── CRON diário (08:15 — 15 min depois do motor de propinas) ───────────────
function initLibraryFineCron() {
  cron.schedule("15 8 * * *", async () => {
    console.log(`[LibraryFineCron] A iniciar — ${new Date().toISOString()}`);
    try {
      const institutes = await ExecuteQuery(null,
        `SELECT DISTINCT flr_institute_code AS code FROM eduall_library_fine_rules
         WHERE flr_deleted=0 AND flr_active=1`,
        [], true, { db: "eduall_library_fine_rules", type: "select",
          data: { session: { user: { eduall_user_session_curentinstitute: null, eduall_user_session_ID: null } } } }) || [];
      for (const inst of institutes) {
        const reqLike = { session: { user: { eduall_user_session_curentinstitute: inst.code, eduall_user_session_ID: null } } };
        try {
          const r = await runLibraryFineEngineForInstitute(inst.code, reqLike, null);
          console.log(`[LibraryFineCron] ${inst.code} multas:${r.created} bloqueios:${r.blocked} excluídos:${r.skipped}`);
        } catch (e) { console.error(`[LibraryFineCron] Erro em ${inst.code}:`, e.message); }
      }
    } catch (e) { console.error("[LibraryFineCron] Erro geral:", e.message); }
  }, { timezone: "Africa/Luanda" });
  console.log("[LibraryFineCron] Cron registado — execução diária às 08:15 (Africa/Luanda).");
}

// ─── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // Regras
  GetLibraryFineRules, CreateLibraryFineRule, UpdateLibraryFineRule,
  ToggleLibraryFineRule, DeleteLibraryFineRule,
  // Exclusões
  GetLibraryFineExclusions, AddLibraryFineExclusion, RemoveLibraryFineExclusion,
  // Multas
  GetFinesLIB, GetFineById, GetFinesKpis, GetFinesDashboard, PreviewFineForLoan,
  CreateFine, PayFine, ExemptFine, DeleteFine,
  // Pesquisa
  SearchUsersForFines, SearchLoansForFines,
  // Motor 
  RunLibraryFineEngine, initLibraryFineCron,
};