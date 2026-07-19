const ExecuteQuery = require("../Functions/ExecuteQuery");
const { FACTPLUS_GenerateDocumentBody, FACTPLUS_decodificarMesEAno, FACTPLUS_formatarPreco, FACTPLUS_createDocumentFunction } = require("../Functions/FACTPLUS_HELPERS");
const { VENDUS_CreateInvoiceCodeAndDoc } = require("../Functions/VENDUS");
const { RegisterAuditAction } = require("./Auditory");
const { getSingleStudentByInstitute } = require("./Students");

const Cache = require("../Functions/CacheRoutes");
const PAYMENT_TYPE_BALANCE = 4;

// ──────────────────────────────────────────────────────────────
// ── CACHE CONFIGURATION (same pattern as AcademicYear.js) ─────
// ──────────────────────────────────────────────────────────────
const FEES_PAYMENT_CACHE_TTL = 3600; // 1 hour

const CacheKeys = {
  list: (instituteCode) => `feespayment:list:${instituteCode}`,
  single: (id, instituteCode) => `feespayment:single:${id}:${instituteCode}`,
  byInvoice: (invoiceCode, instituteCode) => `feespayment:invoice:${invoiceCode}:${instituteCode}`,
  studentFees: (studentId, instituteCode) => `feespayment:student:${studentId}:${instituteCode}`,
  studentStatus: (studentId, instituteCode) => `feespayment:status:${studentId}:${instituteCode}`,
  classStatus: (classId, instituteCode) => `feespayment:classstatus:${classId}:${instituteCode}`,
  bordereauDetail: (bordereauNumber, instituteCode) => `feespayment:bordereau:${bordereauNumber}:${instituteCode}`,
  bordereauStatus: (bordereauNumber, instituteCode) => `feespayment:bordstatus:${bordereauNumber}:${instituteCode}`,
  allClassesStatus: (instituteCode) => `feespayment:allclassstatus:${instituteCode}`,
  paidMonth: (month, studentId, instituteCode) => `feespayment:paidmonth:${month}:${studentId}:${instituteCode}`,
  allGlobal: () => "feespayment:*",
};

/**
 * ──────────────────────────────────────────────────────────────
 * REFRESH CACHE FUNCTION — called after writes
 * ──────────────────────────────────────────────────────────────
 */
const RefreshFeesPaymentCache = async (req, res, instituteCode) => {
  const startTime = Date.now();
  await Cache.eduallClear(CacheKeys.allGlobal());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode} (FeesPayment)`);
  
  const duration = Date.now() - startTime;
  console.log(`🗄️🧹 CACHE CLEAR (FeesPayment) demorou ${duration}ms para institute ${instituteCode}`);
};


// ════════════════════════════════════════════════════════════════════════════════
// HELPERS INTERNOS
// ════════════════════════════════════════════════════════════════════════════════

async function getOperatorData(res, userId) {
  if (!userId) return null;
  try {
    const [operator] = await ExecuteQuery(res,
      `SELECT ed_user_account_id, ed_user_account_name
       FROM eduall_user_accounts
       WHERE ed_user_account_id = ? AND ed_user_account_deleted = 0
       LIMIT 1`,
      [userId], true, { db: "eduall_user_accounts", type: "select", data: { operatorLookup: true } }
    );
    return operator
      ? { id: operator.ed_user_account_id, name: operator.ed_user_account_name || "Operador Desconhecido" }
      : null;
  } catch (err) {
    console.warn("Erro ao buscar dados do operador:", err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// BORDERÔ — HELPERS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Garante linha na tabela de controlo.
 * DEVE ser chamado FORA de transacção activa.
 */
async function ensureBordereauRow(res, bordereauNumber, instituteCode) {
  await ExecuteQuery(
    res,
    `INSERT IGNORE INTO eduall_bordereau_control
       (ed_bordereau_number, ed_bordereau_original_value, ed_bordereau_used_value, ed_bordereau_institute_code)
     VALUES (?, 0, 0, ?)`,
    [bordereauNumber, instituteCode], false
  );
}

/**
 * Debita um valor do borderô e regista o log.
 * DEVE ser chamado APÓS o COMMIT da transacção principal.
 * Usa a sua própria mini-transacção para garantir consistência.
 *
 * @param {object} opts
 * @param {string}   opts.bordereauNumber
 * @param {string}   opts.instituteCode
 * @param {number}   opts.amountToDebit
 * @param {number}   opts.studentId
 * @param {string}   opts.invoiceCode
 * @param {string}   opts.operatorName
 * @param {number}   opts.operatorId
 * @param {number}   opts.paymentType
 * @param {string[]} opts.months        ← array de month codes da fatura (ex: ["0.2026","1.2026"])
 * @returns {{ balanceBefore, balanceAfter }} | null
 */
async function debitBordereau(res, {
  bordereauNumber,
  instituteCode,
  amountToDebit,
  studentId,
  invoiceCode,
  operatorName,
  operatorId,
  paymentType,
}) {
  if (!bordereauNumber || !amountToDebit || amountToDebit <= 0) return null;

  // Garantir que a linha existe antes de arrancar a transacção
  await ensureBordereauRow(res, bordereauNumber, instituteCode);

  await ExecuteQuery(res, "START TRANSACTION", [], false);
  try {
    // LOCK + LER saldo actual
    const [row] = await ExecuteQuery(
      res,
      `SELECT ed_bordereau_original_value, ed_bordereau_used_value
       FROM eduall_bordereau_control
       WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ? FOR UPDATE`,
      [bordereauNumber, instituteCode], true
    );

    const originalValue = parseFloat(row?.ed_bordereau_original_value ?? 0);
    const usedBefore    = parseFloat(row?.ed_bordereau_used_value ?? 0);
    const available     = Math.max(0, originalValue - usedBefore);

    if (amountToDebit > available + 0.001) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      throw new Error(
        `Saldo insuficiente no borderô ${bordereauNumber}. Disponível: ${available.toFixed(2)}. Tentou usar: ${amountToDebit.toFixed(2)}.`
      );
    }

    const usedAfter = Number((usedBefore + amountToDebit).toFixed(2));

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
         (ed_bl_bordereau_number, ed_bl_institute_code, ed_bl_student_id,
          ed_bl_invoice_code, ed_bl_amount_used,
          ed_bl_balance_before, ed_bl_balance_after,
          ed_bl_operator, ed_bl_operator_id, ed_bl_payment_type)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        bordereauNumber, instituteCode, studentId || null,
        invoiceCode || null, amountToDebit,
        available, Math.max(0, available - amountToDebit),
        operatorName || null, operatorId || null, paymentType ?? 0,
      ], false
    );

    await ExecuteQuery(res, "COMMIT", [], false);

    return {
      balanceBefore: available,
      balanceAfter:  Math.max(0, available - amountToDebit),
    };
  } catch (err) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    throw err;
  }
}

/**
 * Reverte a utilização de borderô de um aluno específico num pagamento.
 * Chamado em FeePaymentDelete APÓS anular as linhas de pagamento.
 * Não afecta logs de outros alunos no mesmo borderô.
 *
 * @param {string} invoiceCode  — código da fatura anulada
 * @param {number} studentId    — ID do aluno (para confirmar o log correcto)
 * @param {string} institute
 */
async function revertBordereauForStudent(res, invoiceCode, studentId, institute) {
  if (!invoiceCode) return;

  // Localizar o(s) log(s) deste aluno nesta fatura
  const logs = await ExecuteQuery(
    res,
    `SELECT ed_bl_id, ed_bl_bordereau_number, ed_bl_amount_used, ed_bl_institute_code
     FROM eduall_bordereau_usage_logs
     WHERE ed_bl_invoice_code = ?
       AND ed_bl_institute_code = ?
       AND ed_bl_student_id = ?
     ORDER BY ed_bl_id DESC`,
    [invoiceCode, institute, studentId], true
  );

  if (!logs || !logs.length) return;

  for (const log of logs) {
    const { ed_bl_id, ed_bl_bordereau_number, ed_bl_amount_used } = log;
    const amountToRevert = parseFloat(ed_bl_amount_used || 0);
    if (!amountToRevert || amountToRevert <= 0) continue;

    try {
      // Reverter o saldo utilizado (decrementar ed_bordereau_used_value)
      await ExecuteQuery(
        res,
        `UPDATE eduall_bordereau_control
         SET ed_bordereau_used_value = GREATEST(0, ed_bordereau_used_value - ?)
         WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ?`,
        [amountToRevert, ed_bl_bordereau_number, institute], false
      );

      // Apagar apenas o log deste aluno (outros alunos do mesmo borderô ficam intactos)
      await ExecuteQuery(
        res,
        `DELETE FROM eduall_bordereau_usage_logs WHERE ed_bl_id = ?`,
        [ed_bl_id], false
      );
    } catch (err) {
      console.warn(`[revertBordereauForStudent] Erro ao reverter log ${ed_bl_id}:`, err.message);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// BORDERÔ — VERIFICAR EXISTÊNCIA E SALDO
// ════════════════════════════════════════════════════════════════════════════════

const CheckBordereauStatus = async (req, res) => {
   console.log("cheking sttaus 1 ......")
  try {
    
    const { NUMBER }  = req.params;
    const institute   = req.session?.user?.eduall_user_session_curentinstitute;
    const cacheKey    = CacheKeys.bordereauStatus(NUMBER, institute);
    const startTime   = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> CheckBordereauStatus demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    if (!NUMBER || !NUMBER.trim()) {
      return res.status(400).json({ success: false, msg: "Número de borderô inválido." });
    }

    const num = NUMBER.trim();

    const [bRow] = await ExecuteQuery(
      res,
      `SELECT ed_bordereau_number, ed_bordereau_original_value, ed_bordereau_used_value
       FROM eduall_bordereau_control
       WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ?
         AND COALESCE(ed_bordereau_deleted,0) = 0
       LIMIT 1`,
      [num, institute], true
    );

    let result;

    if (!bRow) {
      result = {
        success: true,
        exists: false,
        bordereauNumber: num,
        originalValue: 0,
        usedValue: 0,
        availableValue: null,
        usageCount: 0,
        usages: [],
        message: "Borderô ainda não registado. Será criado no primeiro pagamento.",
      };
    } else {
      const originalValue  = parseFloat(bRow.ed_bordereau_original_value || 0);
      const usedValue      = parseFloat(bRow.ed_bordereau_used_value || 0);
      const availableValue = Math.max(0, originalValue - usedValue);

      const usageRows = await ExecuteQuery(
        res,
        `SELECT
           l.ed_bl_id,
           l.ed_bl_amount_used,
           l.ed_bl_balance_before,
           l.ed_bl_balance_after,
           l.ed_bl_invoice_code,
           l.ed_bl_operator,
           l.ed_bl_payment_type,
           l.ed_bl_created_at,
           s.ed_student_name,
           s.ed_student_code,
           s.ed_student_picture
         FROM eduall_bordereau_usage_logs l
         LEFT JOIN eduall_students s ON s.ed_student_id = l.ed_bl_student_id
         WHERE l.ed_bl_bordereau_number = ?
           AND l.ed_bl_institute_code = ?
         ORDER BY l.ed_bl_created_at DESC`,
        [num, institute], true
      );

      // Enriquecer com meses vindos directamente de eduall_fees_payments
      const usages = await Promise.all((usageRows || []).map(async u => {
        let months = [];
        if (u.ed_bl_invoice_code) {
          try {
            const mRows = await ExecuteQuery(
              res,
              `SELECT ed_fee_payment_month FROM eduall_fees_payments
               WHERE ed_fee_payment_invoiceCode = ?
                 AND ed_fee_payment_institute_code = ?
                 AND COALESCE(ed_fee_payment_deleted,0) = 0`,
              [u.ed_bl_invoice_code, institute], true
            );
            months = (mRows || []).map(r => String(r.ed_fee_payment_month));
          } catch {}
        }
        return { ...u, months };
      }));

      result = {
        success: true,
        exists: true,
        bordereauNumber: num,
        originalValue,
        usedValue,
        availableValue,
        usageCount: usages.length,
        usages,
      };
    }

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, result, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> CheckBordereauStatus demorou ${duration}ms (${cacheKey})`);

    return res.status(200).json(result);
  } catch (err) {
    console.error("CheckBordereauStatus error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// BORDERÔ — DEFINIR / ACTUALIZAR VALOR ORIGINAL
// ════════════════════════════════════════════════════════════════════════════════

const SetBordereauOriginalValue = async (req, res) => {
   console.log("cheking sttaus 2 ......")
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    const { bordereauNumber, originalValue } = req.body;

    if (!bordereauNumber || originalValue === undefined || originalValue === null) {
      return res.status(400).json({ success: false, msg: "Dados incompletos." });
    }

    const val = parseFloat(originalValue);
    if (!Number.isFinite(val) || val < 0) {
      return res.status(400).json({ success: false, msg: "Valor original inválido." });
    }

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_bordereau_control
         (ed_bordereau_number, ed_bordereau_original_value, ed_bordereau_used_value, ed_bordereau_institute_code)
       VALUES (?, ?, 0, ?)
       ON DUPLICATE KEY UPDATE ed_bordereau_original_value = ?`,
      [bordereauNumber.trim(), val, institute, val], false
    );

    // ── Invalidate cache ──
    await RefreshFeesPaymentCache(req, res, institute);

    return res.status(200).json({ success: true, bordereauNumber, originalValue: val });
  } catch (err) {
    console.error("SetBordereauOriginalValue error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
}; 

// ════════════════════════════════════════════════════════════════════════════════
// BORDERÔ — DETALHE COMPLETO  
// Inclui ed_bl_months (array JSON) para mostrar quais meses foram pagos
// ════════════════════════════════════════════════════════════════════════════════

const GetBordereauDetail = async (req, res) => { 
   console.log("cheking sttaus 3 ......");
  try {
    const { NUMBER } = req.params;
    const institute  = req.session?.user?.eduall_user_session_curentinstitute;
    const cacheKey   = CacheKeys.bordereauDetail(NUMBER, institute);
    const startTime  = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetBordereauDetail demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const [bRow] = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_bordereau_control
       WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ?
         AND COALESCE(ed_bordereau_deleted,0) = 0
       LIMIT 1`,
      [NUMBER.trim(), institute], true
    );

    if (!bRow) {
      return res.status(404).json({ success: false, msg: "Borderô não encontrado." });
    }

    const usages = await ExecuteQuery(
      res,
      `SELECT
         l.*,
         s.ed_student_name,
         s.ed_student_code,
         s.ed_student_picture,
         p.ed_fee_payment_invoiceFile AS invoice_file
       FROM eduall_bordereau_usage_logs l
       LEFT JOIN eduall_students s ON s.ed_student_id = l.ed_bl_student_id
       LEFT JOIN eduall_fees_payments p
         ON p.ed_fee_payment_invoiceCode = l.ed_bl_invoice_code
        AND p.ed_fee_payment_institute_code = l.ed_bl_institute_code
        AND COALESCE(p.ed_fee_payment_deleted,0) = 0
       WHERE l.ed_bl_bordereau_number = ?
         AND l.ed_bl_institute_code = ?
       ORDER BY l.ed_bl_created_at DESC`,
      [NUMBER.trim(), institute], true
    );

    const originalValue  = parseFloat(bRow.ed_bordereau_original_value || 0);
    const usedValue      = parseFloat(bRow.ed_bordereau_used_value || 0);
    const availableValue = Math.max(0, originalValue - usedValue);

    // Enriquecer com meses de eduall_fees_payments (sem depender de ed_bl_months)
    const enrichedUsages = await Promise.all((usages || []).map(async u => {
      let months = [];
      if (u.ed_bl_invoice_code) {
        try {
          const mRows = await ExecuteQuery(
            res,
            `SELECT ed_fee_payment_month FROM eduall_fees_payments
             WHERE ed_fee_payment_invoiceCode = ?
               AND ed_fee_payment_institute_code = ?
               AND COALESCE(ed_fee_payment_deleted,0) = 0`,
            [u.ed_bl_invoice_code, institute], true
          );
          months = (mRows || []).map(r => String(r.ed_fee_payment_month));
        } catch {}
      }
      return { ...u, months };
    }));

    const result = {
      success: true,
      bordereau: {
        number: bRow.ed_bordereau_number,
        originalValue,
        usedValue,
        availableValue,
        createdAt: bRow.ed_bordereau_created_at,
      },
      usages: enrichedUsages,
    };

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, result, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetBordereauDetail demorou ${duration}ms (${cacheKey})`);

    return res.status(200).json(result);
  } catch (err) {
    console.error("GetBordereauDetail error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// LISTAGEM DE PAGAMENTOS
// ════════════════════════════════════════════════════════════════════════════════

const GetFeepayments = async (req, res) => {
  try {
    const institute  = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const cacheKey   = CacheKeys.list(institute);
    const startTime  = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetFeepayments demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const operator   = await getOperatorData(res, operatorId);

    const query = `
      SELECT
        efp.*,
        st.ed_student_id,
        st.ed_student_name,
        st.ed_student_code,
        s.ed_service_id,
        CASE
          WHEN efp.ed_fee_payment_external_origin IS NOT NULL
            OR efp.ed_fee_payment_invoiceCode LIKE 'IMP-%'
          THEN 'Pag. de propinas (Importação)'
          ELSE COALESCE(s.ed_service_title, 'Pag. de propinas (Importação)')
        END AS ed_service_title,
        c.ed_coin_code,
        ua.ed_user_account_name AS operator_name,
        ua.ed_user_account_id   AS operator_id,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id',          ex.ed_fee_additional_id,
              'description', ex.description,
              'amount',      ex.amount,
              'created_at',  ex.created_at
            )
          )
          FROM eduall_fee_additional_items ex
          WHERE ex.invoice_code = efp.ed_fee_payment_invoiceCode
            AND ex.institute_code = efp.ed_fee_payment_institute_code
            AND COALESCE(ex.ed_fee_additional_deleted,0)=0
        ) AS extras,
        bc.ed_bordereau_original_value AS bordereau_original_value,
        bc.ed_bordereau_used_value     AS bordereau_used_value,
        (
          SELECT COUNT(DISTINCT l.ed_bl_student_id)
          FROM eduall_bordereau_usage_logs l
          WHERE l.ed_bl_bordereau_number = efp.ed_fee_payment_bordereux
            AND l.ed_bl_institute_code = efp.ed_fee_payment_institute_code
        ) AS bordereau_student_count
      FROM eduall_fees_payments efp
      LEFT JOIN eduall_students st
        ON efp.ed_fee_payment_student = st.ed_student_id
        AND st.ed_student_deleted = 0
      LEFT JOIN eduall_services s
        ON efp.ed_fee_payment_service = s.ed_service_id
        AND s.ed_service_deleted = 0
      LEFT JOIN eduall_coins c
        ON c.ed_coin_institute_code = ?
      LEFT JOIN eduall_user_accounts ua
        ON ua.ed_user_account_id = ?
        AND ua.ed_user_account_deleted = 0
      LEFT JOIN eduall_bordereau_control bc
        ON bc.ed_bordereau_number = efp.ed_fee_payment_bordereux
        AND bc.ed_bordereau_institute_code = efp.ed_fee_payment_institute_code
        AND COALESCE(bc.ed_bordereau_deleted,0) = 0
      WHERE efp.ed_fee_payment_deleted = 0
        AND efp.ed_fee_payment_institute_code = ?
      ORDER BY efp.ed_fee_payment_registerDate DESC
    `;

    const rows = await ExecuteQuery(res, query, [institute, operatorId, institute], true, {
      db: "eduall_fees_payments", type: "select", data: req
    });

    const enrichedRows = rows.map(row => ({
      ...row,
      operator:    operator?.name || "operator:null",
      operator_id: operator?.id   || null,
    }));

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, enrichedRows, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetFeepayments demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(enrichedRows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar os pagamentos de taxa!", error: error.message });
  }
};

const GetSingleFeepayment = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey  = CacheKeys.single(ID, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleFeepayment demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT
        p.*,
        CASE
          WHEN p.ed_fee_payment_external_origin IS NOT NULL
            OR p.ed_fee_payment_invoiceCode LIKE 'IMP-%'
          THEN 'Pag. de propinas (Importação)'
          ELSE COALESCE(srv.ed_service_title, 'Pag. de propinas (Importação)')
        END AS ed_service_title,
        c.ed_coin_code,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT('id', ex.ed_fee_additional_id, 'description', ex.description, 'amount', ex.amount)
          )
          FROM eduall_fee_additional_items ex
          WHERE ex.invoice_code = p.ed_fee_payment_invoiceCode
            AND ex.institute_code = p.ed_fee_payment_institute_code
            AND COALESCE(ex.ed_fee_additional_deleted,0)=0
        ) AS extras,
        bc.ed_bordereau_original_value AS bordereau_original_value,
        bc.ed_bordereau_used_value     AS bordereau_used_value
      FROM eduall_fees_payments p
      LEFT JOIN eduall_services srv ON p.ed_fee_payment_service = srv.ed_service_id 
      LEFT JOIN eduall_coins c ON c.ed_coin_institute_code = ?
      LEFT JOIN eduall_bordereau_control bc
        ON bc.ed_bordereau_number = p.ed_fee_payment_bordereux
        AND bc.ed_bordereau_institute_code = p.ed_fee_payment_institute_code
        AND COALESCE(bc.ed_bordereau_deleted,0) = 0
      WHERE p.ed_fee_payment_deleted = 0
        AND p.ed_fee_payment_id = ?
        AND p.ed_fee_payment_institute_code = ?
      LIMIT 1;
    `;
    const rows = await ExecuteQuery(res, query, [institute, ID, institute], true, {
      db: "eduall_fees_payments", type: "select", data: req
    });

    const result = rows[0] || {};

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, result, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleFeepayment demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar o pagamento de taxa!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// REGISTO DE PAGAMENTO
// ════════════════════════════════════════════════════════════════════════════════
//
// ORDEM GARANTIDA:
// 1. Criar fatura (VENDUS)         ← antes de qualquer escrita em BD
// 2. START TRANSACTION
// 3. Inserir linhas de propina
// 4. Inserir extras
// 5. Debitar saldo do aluno (se aplicável)
// 6. COMMIT                        ← fatura + propinas persistidas
// 7. debitBordereau()              ← APÓS commit, na sua própria transacção
// 8. Auditoria
// 9. Invalidar cache

const RegisterFeepayment = async (req, res) => {

  function computeItemTotals({ price, discountPct = 0, fineType = 0, fineValue = 0, applyIVA = false, instituteIVAPct = 0 }) {
    const discountAmount     = discountPct > 0 ? (price * discountPct) / 100 : 0;
    const priceAfterDiscount = Math.max(0, price - discountAmount);
    const fineAmount         = fineType * 1 === 1 ? fineValue * 1 : fineValue > 0 ? (priceAfterDiscount * fineValue) / 100 : 0;
    const ivaAmount          = applyIVA ? (priceAfterDiscount * instituteIVAPct) / 100 : 0;
    const lineTotal          = priceAfterDiscount + fineAmount + ivaAmount;
    return { discountAmount, fineAmount, ivaAmount, lineTotal, baseAfterDiscount: priceAfterDiscount };
  }

  function monthLabel(mdotY) {
    const m = String(mdotY).split(".")[0] * 1;
    const y = String(mdotY).split(".")[1] * 1;
    const N = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    return Number.isFinite(m) && Number.isFinite(y) ? `${N[m]} / ${y}` : String(mdotY);
  }

  function sanitizeExtras(extras) {
    if (!Array.isArray(extras)) return [];
    return extras
      .map(e => ({ name: String(e?.name || "").trim(), value: Number(String(e?.value ?? "").replace(",", ".")) }))
      .filter(e => e.name.length > 0 && Number.isFinite(e.value) && e.value > 0);
  }

  try {
    const sessionInstitute = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId       = req.session?.user?.eduall_user_session_ID;
    const operator         = await getOperatorData(res, operatorId);

    if (!sessionInstitute) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    const {
      studentId,
      academicYearId,
      paymentType,
      bankName            = "",
      paymentPlace        = "",
      bordereux           = "",
      bordereauAmountUsed = 0,
      items               = [],
      extraServices       = [],
      balanceUsed         = 0,
    } = req.body || {};

    if (!studentId || !academicYearId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, msg: "Dados incompletos." });
    }

    const addons             = sanitizeExtras(extraServices);
    const balanceUsedValue   = Math.max(0, parseFloat(balanceUsed) || 0);
    const bordereauUsedValue = Math.max(0, parseFloat(bordereauAmountUsed) || 0);
    const bordereauNum       = (bordereux || "").trim();

    // ── 1) ALUNO ─────────────────────────────────────────────────────────────
    const studentSql = `
      SELECT
        s.ed_student_id, s.ed_student_code, s.ed_student_name, s.ed_student_identityCard,
        s.ed_student_address, s.ed_student_email, s.ed_student_class, s.ed_student_institute_code,
        cls.ed_class_title, room.ed_classroom_title, crs.ed_course_title, ay.ed_academic_year_title
      FROM eduall_students s
      LEFT JOIN eduall_class cls ON cls.ed_class_id = s.ed_student_class AND COALESCE(cls.ed_class_deleted,0)=0
      LEFT JOIN eduall_classrooms room ON room.ed_classroom_id = cls.ed_class_room AND COALESCE(room.ed_classroom_deleted,0)=0
      LEFT JOIN eduall_courses crs ON crs.ed_course_id = cls.ed_class_course AND COALESCE(crs.ed_course_deleted,0)=0
      LEFT JOIN eduall_academic_year ay ON ay.ed_academic_year_id = cls.ed_class_year AND COALESCE(ay.ed_academic_year_deleted,0)=0
      WHERE COALESCE(s.ed_student_deleted,0)=0
        AND s.ed_student_id = ?
        AND s.ed_student_institute_code = ?
      LIMIT 1
    `;
    const [student] = await ExecuteQuery(res, studentSql, [studentId, sessionInstitute], true);
    if (!student) {
      return res.status(404).json({ success: false, msg: "Estudante não encontrado." });
    }

    // ── 2) DUPLICATAS DE MESES ───────────────────────────────────────────────
    const months        = [...new Set(items.map(i => i.month))];
    const placeholdersM = months.map(() => "?").join(",");
    const dupSql        = `
      SELECT ed_fee_payment_month AS month
      FROM eduall_fees_payments
      WHERE ed_fee_payment_institute_code = ?
        AND ed_fee_payment_student        = ?
        AND ed_fee_payment_academic_year  = ?
        AND ed_fee_payment_month IN (${placeholdersM})
        AND COALESCE(ed_fee_payment_deleted,0) = 0
      GROUP BY ed_fee_payment_month
    `;
    const dupRows = await ExecuteQuery(res, dupSql, [sessionInstitute, studentId, academicYearId, ...months], true);
    if (dupRows?.length) {
      const paidLabels = dupRows.map(r => monthLabel(r.month));
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_MONTHS",
        msg: `Os seguintes meses já foram pagos: ${paidLabels.join(", ")}.`,
        monthsPaid: dupRows.map(r => String(r.month)),
      });
    }

    // ── 3) IVA DA INSTITUIÇÃO ─────────────────────────────────────────────────
    const [ivaRow] = await ExecuteQuery(res,
      `SELECT COALESCE(ed_institute_iva_value,0) AS iva, ed_institute_name FROM eduall_institutes WHERE ed_institute_code=? LIMIT 1`,
      [sessionInstitute], true
    );
    const instituteIVAPct = ivaRow?.iva * 1 || 0;
    const instituteName   = ivaRow?.ed_institute_name || "";

    // ── 4) PRÉ-VALIDAÇÃO DO SALDO DO BORDERÔ ─────────────────────────────────
    // Apenas leitura — sem transacção, sem escrita
    if (bordereauNum && bordereauUsedValue > 0) {
      const [bcRow] = await ExecuteQuery(res,
        `SELECT ed_bordereau_original_value, ed_bordereau_used_value
         FROM eduall_bordereau_control
         WHERE ed_bordereau_number = ? AND ed_bordereau_institute_code = ?
           AND COALESCE(ed_bordereau_deleted,0) = 0
         LIMIT 1`,
        [bordereauNum, sessionInstitute], true
      );
      if (bcRow) {
        const available = Math.max(0,
          parseFloat(bcRow.ed_bordereau_original_value) - parseFloat(bcRow.ed_bordereau_used_value)
        );
        if (bordereauUsedValue > available + 0.001) {
          return res.status(422).json({
            success: false,
            msg: `Saldo insuficiente no borderô ${bordereauNum}. Disponível: ${available.toFixed(2)}. Tentou usar: ${bordereauUsedValue.toFixed(2)}.`,
            bordereauAvailable: available,
            requested: bordereauUsedValue,
          });
        }
      }
    }

    // ── 5) CALCULAR TOTAIS ────────────────────────────────────────────────────
    const invoiceLines = [];
    const dbRows       = [];
    let grandTotal     = 0;

    for (const it of items) {
      const { serviceId, month, price, discountPct = 0, fineType = 0, fineValue = 0, applyIVA = 0 } = it;
      const calc = computeItemTotals({ price: price * 1, discountPct, fineType, fineValue, applyIVA: !!applyIVA, instituteIVAPct });

      invoiceLines.push({
        itemcode: `EDSERV-${serviceId}`,
        title:    `Propina ${monthLabel(month)}`,
        price:    Number(calc.baseAfterDiscount.toFixed(2)),
        tax:      applyIVA ? 1 : 0,
        discount: 0,
        quantity: "1",
      });

      if (calc.fineAmount > 0) {
        invoiceLines.push({
          itemcode: "FINE001",
          title:    "Multa por atraso",
          price:    Number(calc.fineAmount.toFixed(2)),
          tax: 0, discount: 0, quantity: "1",
        });
      }

      grandTotal += calc.lineTotal;
      dbRows.push({
        studentId, serviceId,
        price:       price * 1,
        month,
        discountPct,
        type:        paymentType,
        bankName,
        academicYearId,
        place:       paymentPlace,
        balance:     Number(calc.lineTotal.toFixed(2)),
        bordereux:   bordereauNum,
        ivaPct:      applyIVA ? instituteIVAPct : 0,
        fineType,
        fineValue:   Number(calc.fineAmount.toFixed(2)),
      });
    }

    if (addons.length) {
      addons.forEach((ex, idx) => {
        invoiceLines.push({
          itemcode: `EXTRA-${String(idx + 1).padStart(2, "0")}`,
          title:    ex.name,
          price:    Number(Number(ex.value).toFixed(2)),
          tax: 0, discount: 0, quantity: "1",
        });
        grandTotal += ex.value * 1;
      });
    }

    // ── 6) OBSERVAÇÕES ────────────────────────────────────────────────────────
    const obsParts = [];
    obsParts.push(`Nº matrícula: ${student.ed_student_code || "-"}`);
    if (student.ed_class_title)         obsParts.push(`Turma: ${student.ed_class_title}`);
    if (student.ed_classroom_title)     obsParts.push(`Sala: ${student.ed_classroom_title}`);
    if (student.ed_course_title)        obsParts.push(`Curso: ${student.ed_course_title}`);
    if (student.ed_academic_year_title) obsParts.push(`Ano letivo: ${student.ed_academic_year_title}`);
    if (instituteName)                  obsParts.push(`Instituição: ${instituteName}`);
    if (operator)                       obsParts.push(`Operador: ${operator.name}`);

    if (Number(paymentType) === PAYMENT_TYPE_BALANCE && balanceUsedValue > 0) {
      const remaining = Math.max(0, grandTotal - balanceUsedValue);
      obsParts.push("---");
      obsParts.push("Forma de pagamento: Saldo do aluno (PARCIAL)");
      obsParts.push(`Total da fatura: ${grandTotal.toFixed(2)}`);
      obsParts.push(`Saldo do aluno utilizado: ${balanceUsedValue.toFixed(2)}`);
      remaining > 0
        ? obsParts.push(`Valor restante (a cobrar por outro método): ${remaining.toFixed(2)}`)
        : obsParts.push("Fatura totalmente coberta pelo saldo do aluno.");
    }

    if (bordereauNum && bordereauUsedValue > 0) {
      const remaining = Math.max(0, grandTotal - bordereauUsedValue);
      obsParts.push("---");
      obsParts.push(`Borderô utilizado: ${bordereauNum}`);
      obsParts.push(`Valor do borderô aplicado: ${bordereauUsedValue.toFixed(2)}`);
      remaining > 0
        ? obsParts.push(`Restante da fatura após borderô: ${remaining.toFixed(2)}`)
        : obsParts.push("Fatura totalmente coberta pelo borderô.");
    }

    const obs = obsParts.join("\n");

    // ── 7) DADOS DO CLIENTE ───────────────────────────────────────────────────
    const customer = {
      name:      student.ed_student_name         || "",
      fiscal_id: student.ed_student_identityCard || "",
      address:   student.ed_student_address      || "",
      email:     student.ed_student_email        || "",
    };

    // ── 8) CRIAR FATURA ── (ANTES de qualquer escrita em BD) ─────────────────
    const vendus = await VENDUS_CreateInvoiceCodeAndDoc(req, customer, invoiceLines, paymentType, obs);
    if (!vendus?.number) {
      return res.status(500).json({ success: false, msg: "Falha ao criar fatura." });
    }

    // ── 9) TRANSACÇÃO PRINCIPAL ───────────────────────────────────────────────
    await ExecuteQuery(res, "START TRANSACTION", [], false);

    try {
      // 9.a) Inserir linhas de propina
      const insertSql = `
        INSERT INTO eduall_fees_payments (
          ed_fee_payment_student, ed_fee_payment_service, ed_fee_payment_price,
          ed_fee_payment_month, ed_fee_payment_discount, ed_fee_payment_type,
          ed_fee_payment_bank, ed_fee_payment_academic_year, ed_fee_payment_place,
          ed_fee_payment_balance, ed_fee_payment_bordereux, ed_fee_payment_iva,
          ed_fee_payment_code, ed_fee_payment_fineType, ed_fee_payment_fineValue,
          ed_fee_payment_invoiceCode, ed_fee_payment_invoiceFile,
          ed_fee_payment_institute_code, ed_fee_payment_operator, ed_fee_payment_operator_id
        ) VALUES
        ${dbRows.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}
      `;
      const params = [];
      for (const r of dbRows) {
        params.push(
          r.studentId, r.serviceId, r.price, r.month, r.discountPct,
          r.type, r.bankName, r.academicYearId, r.place, r.balance,
          r.bordereux, r.ivaPct, null, r.fineType, r.fineValue,
          vendus.number, vendus.id, sessionInstitute,
          operator?.name || "operator:null", operator?.id || null
        );
      }
      await ExecuteQuery(res, insertSql, params, false);

      // 9.b) Extras
      if (addons.length) {
        try {
          const addSql = `
            INSERT INTO eduall_fee_additional_items
              (student_id, academic_year_id, description, amount, invoice_code, invoice_id, institute_code, operator, operator_id)
            VALUES ${addons.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}
          `;
          const addParams = [];
          addons.forEach(a => {
            addParams.push(
              studentId, academicYearId, a.name,
              Number(Number(a.value).toFixed(2)),
              vendus.number, vendus.id, sessionInstitute,
              operator?.name || "operator:null", operator?.id || null
            );
          });
          await ExecuteQuery(res, addSql, addParams, false);
        } catch (auxErr) {
          console.warn("Persistência de extras ignorada:", auxErr?.message || auxErr);
        }
      }

      // 9.c) Debitar saldo do aluno (dentro da transacção — crítico)
      if (Number(paymentType) === PAYMENT_TYPE_BALANCE && balanceUsedValue > 0) {
        try {
          await ExecuteQuery(res,
            `INSERT IGNORE INTO eduall_student_balance (sb_student_id, sb_institute_code, sb_balance, sb_currency)
             VALUES (?, ?, 0, 'AOA')`,
            [studentId, sessionInstitute], false
          );
          const [current] = await ExecuteQuery(res,
            `SELECT sb_balance, sb_currency FROM eduall_student_balance
             WHERE sb_student_id = ? AND sb_institute_code = ? FOR UPDATE`,
            [studentId, sessionInstitute], true
          );
          const balanceBefore = parseFloat(current?.sb_balance ?? 0);
          const currency      = current?.sb_currency || "AOA";
          if (balanceUsedValue > balanceBefore) {
            await ExecuteQuery(res, "ROLLBACK", [], false);
            return res.status(422).json({
              success: false,
              msg: `Saldo insuficiente. Saldo atual: ${balanceBefore} ${currency}. Tentou usar: ${balanceUsedValue} ${currency}.`,
              balance: balanceBefore, requested: balanceUsedValue,
            });
          }
          const balanceAfter = Number((balanceBefore - balanceUsedValue).toFixed(2));
          const remaining    = Math.max(0, grandTotal - balanceUsedValue);
          let deductDesc = `Pagamento parcial de propina(s) — Fatura ${vendus.number}. Créditos usados: ${balanceUsedValue.toFixed(2)} ${currency} (total: ${grandTotal.toFixed(2)} ${currency})`;
          deductDesc += remaining > 0 ? `. Restante: ${remaining.toFixed(2)} ${currency}.` : ". Fatura totalmente coberta.";

          await ExecuteQuery(res,
            `UPDATE eduall_student_balance SET sb_balance = ?
             WHERE sb_student_id = ? AND sb_institute_code = ?`,
            [balanceAfter, studentId, sessionInstitute], false
          );
          await ExecuteQuery(res,
            `INSERT INTO eduall_student_balance_logs
               (sb_log_student_id, sb_log_institute, sb_log_type, sb_log_category,
                sb_log_amount, sb_log_balance_before, sb_log_balance_after,
                sb_log_description, sb_log_reference, sb_log_user_id)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [studentId, sessionInstitute, "deduct", "propinas", balanceUsedValue, balanceBefore, balanceAfter, deductDesc, vendus.number || null, operatorId || null],
            false
          );
        } catch (balanceErr) {
          console.error("Erro ao debitar saldo (não crítico):", balanceErr?.message || balanceErr);
        }
      }

      // ── COMMIT ── (fatura + propinas persistidas)
      await ExecuteQuery(res, "COMMIT", [], false);

    } catch (txErr) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      throw txErr;
    }

    // ── 10) DEBITAR BORDERÔ — APÓS COMMIT ────────────────────────────────────
    // Executado fora da transacção principal, na sua própria mini-transacção.
    // Se falhar, o pagamento já está registado; apenas o borderô não é debitado
    // (aceitável — borderô é rastreável; propinas não são desfeitas por erro de borderô).
    let bordereauResult = null;
    if (bordereauNum && bordereauUsedValue > 0) {
      try {
        bordereauResult = await debitBordereau(res, {
          bordereauNumber: bordereauNum,
          instituteCode:   sessionInstitute,
          amountToDebit:   bordereauUsedValue,
          studentId,
          invoiceCode:     vendus.number,
          operatorName:    operator?.name || null,
          operatorId:      operatorId     || null,
          paymentType,
        });
      } catch (bErr) {
        // Não é crítico — o pagamento foi registado com sucesso; apenas avisar
        console.error("[debitBordereau] Erro após commit:", bErr.message);
      }
    }

    // ── 11) AUDITORIA ─────────────────────────────────────────────────────────
    const bordereauNote = bordereauNum && bordereauUsedValue > 0
      ? `. Borderô ${bordereauNum}: ${bordereauUsedValue.toFixed(2)} usados.` : "";
    const auditDesc = `[${operator?.name || "Desconhecido"}] Registou ${dbRows.length} linha(s) + ${addons.length} extra(s) para aluno ${student.ed_student_code}. Fatura ${vendus.number}. Total: ${grandTotal.toFixed(2)}${balanceUsedValue > 0 ? `. Saldo usado: ${balanceUsedValue.toFixed(2)}` : ""}${bordereauNote}.`;

    await RegisterAuditAction({
      session: req.session,
      action:  1,
      form:    "Pagamentos de propinas (lote)",
      description: auditDesc,
    });

    // ── 12) INVALIDAR CACHE ──────────────────────────────────────────────────
    await RefreshFeesPaymentCache(req, res, sessionInstitute);

    return res.status(200).json({
      success:        true,
      invoice:        vendus,
      inserted:       dbRows.length,
      extrasInserted: addons.length,
      extras:         addons,
      total:          Number(grandTotal.toFixed(2)),
      balanceUsed:    balanceUsedValue > 0 ? Number(balanceUsedValue.toFixed(2)) : 0,
      bordereauUsed:  bordereauResult
        ? { number: bordereauNum, amountUsed: Number(bordereauUsedValue.toFixed(2)), ...bordereauResult }
        : null,
      remaining:      Math.max(0, grandTotal - balanceUsedValue),
      operator:       operator?.name || "operator:null",
    });

  } catch (err) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    console.error("RegisterFeepayment error:", err);
    return res.status(500).json({ success: false, msg: "Erro no processamento.", error: String(err?.message || err) });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// RESTANTES CONTROLLERS
// ════════════════════════════════════════════════════════════════════════════════
 
const GetSinglePaidMonth = async (req, res) => {
  try {
    const { MONTH, STUDENTCODE } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey  = CacheKeys.paidMonth(MONTH, STUDENTCODE, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSinglePaidMonth demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT
        p.*, srv.ed_service_title, c.ed_coin_code,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT('id', ex.ed_fee_additional_id, 'description', ex.description, 'amount', ex.amount)
          )
          FROM eduall_fee_additional_items ex
          WHERE ex.invoice_code = p.ed_fee_payment_invoiceCode
            AND ex.institute_code = p.ed_fee_payment_institute_code
            AND COALESCE(ex.ed_fee_additional_deleted,0)=0
        ) AS extras
      FROM eduall_fees_payments p
      LEFT JOIN eduall_services srv ON p.ed_fee_payment_service = srv.ed_service_id
      LEFT JOIN eduall_coins c ON c.ed_coin_id = srv.ed_service_coin
      WHERE p.ed_fee_payment_deleted = 0
        AND p.ed_fee_payment_month = ?
        AND p.ed_fee_payment_student = ?
        AND p.ed_fee_payment_institute_code = ?;
    `;
    const rows = await ExecuteQuery(res, query, [MONTH, STUDENTCODE, institute], true, {
      db: "eduall_fees_payments", type: "select", data: req
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSinglePaidMonth demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar o pagamento do mês!", error: error.message });
  }
};

const GetSinglePayment = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey  = CacheKeys.single(ID, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSinglePayment demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT
        p.*, s.ed_student_name, srv.ed_service_title, c.ed_coin_code,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT('id', ex.ed_fee_additional_id, 'description', ex.description, 'amount', ex.amount)
          )
          FROM eduall_fee_additional_items ex
          WHERE ex.invoice_code = p.ed_fee_payment_invoiceCode
            AND ex.institute_code = p.ed_fee_payment_institute_code
            AND COALESCE(ex.ed_fee_additional_deleted,0)=0
        ) AS extras
      FROM eduall_fees_payments p
      LEFT JOIN eduall_students s ON p.ed_fee_payment_student = s.ed_student_id
      LEFT JOIN eduall_services srv ON p.ed_fee_payment_service = srv.ed_service_id
      LEFT JOIN eduall_coins c ON c.ed_coin_id = srv.ed_service_coin
      WHERE p.ed_fee_payment_deleted = 0
        AND p.ed_fee_payment_id = ?
        AND p.ed_fee_payment_institute_code = ?;
    `;
    const rows = await ExecuteQuery(res, query, [ID, institute], true, {
      db: "eduall_fees_payments", type: "select", data: req
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSinglePayment demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar o pagamento!", error: error.message });
  }
};

const GetPaymentsByInvoiceCode = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey  = CacheKeys.byInvoice(ID, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetPaymentsByInvoiceCode demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const paymentRows = await ExecuteQuery(res,
      `SELECT * FROM eduall_fees_payments
       WHERE ed_fee_payment_deleted = 0 AND ed_fee_payment_id = ? AND ed_fee_payment_institute_code = ?`,
      [ID, institute], true, { db: "eduall_fees_payments", type: "select", data: req }
    );
    if (!paymentRows.length) return res.status(404).json({ success: false, message: "Pagamento não encontrado." });
    
    const invoiceCode = paymentRows[0].ed_fee_payment_invoiceCode;
    const rows = await ExecuteQuery(res,
      `SELECT * FROM eduall_fees_payments
       LEFT JOIN eduall_students ON eduall_fees_payments.ed_fee_payment_student = eduall_students.ed_student_id
       LEFT JOIN eduall_services ON eduall_fees_payments.ed_fee_payment_service = eduall_services.ed_service_id
       LEFT JOIN eduall_coins ON eduall_coins.ed_coin_id = eduall_services.ed_service_coin
       WHERE ed_fee_payment_deleted = 0
         AND ed_fee_payment_invoiceCode = ?
         AND ed_fee_payment_institute_code = ?`,
      [invoiceCode, institute], true, { db: "eduall_fees_payments", type: "select", data: req }
    );

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetPaymentsByInvoiceCode demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar os pagamentos!", error: error.message });
  }
};

const GetSingleStudentFees = async (req, res) => {
  try {
    const { ACADEMICYEAR, STUDENTCODE } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey  = CacheKeys.studentFees(STUDENTCODE, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleStudentFees demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT
        eduall_fees_payments.*, eduall_services.*, eduall_students.*, eduall_coins.*,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT('id', ex.ed_fee_additional_id, 'description', ex.description,
                        'amount', ex.amount, 'created_at', ex.created_at)
          )
          FROM eduall_fee_additional_items ex
          WHERE ex.invoice_code = eduall_fees_payments.ed_fee_payment_invoiceCode
            AND ex.institute_code = eduall_fees_payments.ed_fee_payment_institute_code
            AND COALESCE(ex.ed_fee_additional_deleted,0)=0
        ) AS extras
      FROM eduall_fees_payments
      LEFT JOIN eduall_services ON eduall_fees_payments.ed_fee_payment_service = eduall_services.ed_service_id
      LEFT JOIN eduall_coins ON eduall_coins.ed_coin_id = eduall_services.ed_service_coin
      LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_fees_payments.ed_fee_payment_student
      WHERE eduall_fees_payments.ed_fee_payment_deleted = 0
        AND eduall_fees_payments.ed_fee_payment_student = ?
        AND eduall_fees_payments.ed_fee_payment_academic_year = ?
        AND eduall_fees_payments.ed_fee_payment_institute_code = ?
      ORDER BY eduall_fees_payments.ed_fee_payment_registerDate DESC;
    `;
    const rows = await ExecuteQuery(res, query, [STUDENTCODE, ACADEMICYEAR, institute], true, {
      db: "eduall_fees_payments", type: "select", data: req
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, rows, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleStudentFees demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    console.error("ERRO GetSingleStudentFees:", error);
    res.status(500).json({ success: false, message: "Falha ao buscar taxas do estudante!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE — Remove pagamento E reverte borderô do aluno específico
// ════════════════════════════════════════════════════════════════════════════════

const FeePaymentDelete = async (req, res) => {
  console.log("Hello world !")
  const { ID }    = req.params;
  const institute = req.session?.user?.eduall_user_session_curentinstitute;

  if (!institute) {
    return res.status(400).json({ success: false, message: "Instituto inválido na sessão." });
  }

  try {
    await ExecuteQuery(res, "START TRANSACTION", [], false, { db: "", type: "tx-begin" });

    // Ler o pagamento (precisamos do invoiceCode, studentId e bordereux)
    const [payment] = await ExecuteQuery(res,
      `SELECT
         ed_fee_payment_invoiceCode AS invoice_code,
         ed_fee_payment_student    AS student_id,
         ed_fee_payment_bordereux  AS bordereau_number
       FROM eduall_fees_payments
       WHERE ed_fee_payment_id = ?
         AND ed_fee_payment_institute_code = ?
         AND COALESCE(ed_fee_payment_deleted,0)=0
       LIMIT 1`,
      [ID, institute], true, { db: "eduall_fees_payments", type: "select", data: req }
    );

    console.log(payment)

    if (!payment) {
      await ExecuteQuery(res, "ROLLBACK", [], false);
      return res.status(404).json({ success: false, message: "Pagamento não encontrado ou já eliminado." });
    }

    const { invoice_code: invoiceCode, student_id: studentId, bordereau_number: bordereauNumber } = payment;

    // Soft-delete nas linhas de propina desta fatura
    await ExecuteQuery(res,
      `UPDATE eduall_fees_payments SET ed_fee_payment_deleted = 1
       WHERE ed_fee_payment_invoiceCode = ?
         AND ed_fee_payment_institute_code = ?
         AND COALESCE(ed_fee_payment_deleted,0)=0`,
      [invoiceCode, institute], false, { db: "eduall_fees_payments", type: "update", data: req }
    );

    // Soft-delete nos extras desta fatura
    if (invoiceCode) {
      await ExecuteQuery(res,
        `UPDATE eduall_fee_additional_items SET ed_fee_additional_deleted = 1
         WHERE invoice_code = ? AND institute_code = ? AND COALESCE(ed_fee_additional_deleted,0)=0`,
        [invoiceCode, institute], false
      );
    }

    await ExecuteQuery(res, "COMMIT", [], false);

    // ── Reverter borderô APÓS commit ─────────────────────────────────────────
    // Remove só o log deste aluno (outros alunos que partilham o borderô ficam intactos)
    if (bordereauNumber && invoiceCode && studentId) {
      try {
        await revertBordereauForStudent(res, invoiceCode, studentId, institute);
      } catch (bErr) {
        console.warn("[FeePaymentDelete] Erro ao reverter borderô (não crítico):", bErr.message);
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action:  3,
      form:    "Pagamentos de propinas",
      description: `Eliminou o pagamento de propina com ID ${ID}${invoiceCode ? ` (fatura ${invoiceCode})` : ""}${bordereauNumber ? `. Borderô ${bordereauNumber} revertido para o aluno ID ${studentId}` : ""}.`,
    });

    // ── Invalidar cache ──
    await RefreshFeesPaymentCache(req, res, institute);

    res.status(200).json({
      success: true,
      message: `Pagamento (ID ${ID}) e serviços adicionais associados eliminados com sucesso.`,
      bordereauReverted: !!(bordereauNumber && invoiceCode && studentId),
    });
  } catch (error) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    console.error("Erro ao deletar pagamento:", error);
    res.status(500).json({ success: false, message: "Falha ao deletar o pagamento!", error: error.message || error });
  }
};

const FeePaymentUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const {
      feepayment_student_code, feepayment_servicecode, feepayment_price,
      feepayment_months, feepayment_discount, feepayment_type, feepayment_bank,
      feepayment_academic_year, feepayment_place, feepayment_balance,
      feepayment_bordereux_number, feepayment_iva, feepayment_fineType, feepayment_fineValue
    } = req.body;
    const query = `
      UPDATE eduall_fees_payments SET
        ed_fee_payment_student = ?, ed_fee_payment_service = ?, ed_fee_payment_price = ?,
        ed_fee_payment_month = ?, ed_fee_payment_discount = ?, ed_fee_payment_type = ?,
        ed_fee_payment_bank = ?, ed_fee_payment_academic_year = ?, ed_fee_payment_place = ?,
        ed_fee_payment_balance = ?, ed_fee_payment_bordereux = ?, ed_fee_payment_iva = ?,
        ed_fee_payment_fineType = ?, ed_fee_payment_fineValue = ?
      WHERE ed_fee_payment_deleted = 0
        AND ed_fee_payment_id = ?
        AND ed_fee_payment_institute_code = ?
    `;
    const PARAMS = [
      feepayment_student_code, feepayment_servicecode, feepayment_price,
      feepayment_months, feepayment_discount, feepayment_type, feepayment_bank,
      feepayment_academic_year, feepayment_place, feepayment_balance,
      feepayment_bordereux_number, feepayment_iva, feepayment_fineType, feepayment_fineValue,
      ID, institute
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fees_payments", type: "update", data: req });
    
    await RegisterAuditAction({
      session: req.session, action: 2, form: "Pagamentos de propinas",
      description: `Atualizou o pagamento de propina com ID ${ID}, para o estudante com o nº de matrícula #${feepayment_student_code}`,
    });

    // ── Invalidar cache ──
    await RefreshFeesPaymentCache(req, res, institute);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atualizar o pagamento da taxa!", error: error.message });
  }
};

const GetSingleStudentPaymentStatus = async (req, res) => {
  const timerLabel = `GetSingleStudentPaymentStatus_${Date.now()}`;
  console.time(timerLabel);
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) return res.status(400).json({ success: false, message: "Instituto inválido na sessão." });
    
    const { ano } = req.query;
    const { studentCode } = req.params;
    
    if (!studentCode || !ano) {
      return res.status(400).json({ success: false, message: "Parâmetros inválidos: envie o código do aluno e o ano letivo (?ano=2025)." });
    }

    const cacheKey = CacheKeys.studentStatus(studentCode, institute);
    const startTimeCache = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTimeCache;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleStudentPaymentStatus demorou ${duration}ms (${cacheKey})`);
      console.timeEnd(timerLabel);
      return res.status(200).json(cached);
    }

    const studentQuery = `
      SELECT
        s.ed_student_id, s.ed_student_code, s.ed_student_name, s.ed_student_picture,
        c.ed_class_title, c.ed_class_year,
        y.ed_academic_year_title, y.ed_academic_year_startDate, y.ed_academic_year_endDate,
        crs.ed_course_title, lvl.ed_academic_level_title, cic.ed_cicle_title,
        room.ed_classroom_title, fac.ed_faculty_title
      FROM eduall_students s
      INNER JOIN eduall_class c ON c.ed_class_id = s.ed_student_class AND COALESCE(c.ed_class_deleted,0)=0
      INNER JOIN eduall_academic_year y ON y.ed_academic_year_id = c.ed_class_year AND COALESCE(y.ed_academic_year_deleted,0)=0
      LEFT JOIN eduall_classrooms room ON room.ed_classroom_id = c.ed_class_room AND COALESCE(room.ed_classroom_deleted,0)=0
      LEFT JOIN eduall_courses crs ON crs.ed_course_id = c.ed_class_course AND COALESCE(crs.ed_course_deleted,0)=0
      LEFT JOIN eduall_academic_level lvl ON lvl.ed_academic_level_id = c.ed_class_academic_level AND COALESCE(lvl.ed_academic_level_deleted,0)=0
      LEFT JOIN eduall_cicles cic ON cic.ed_cicle_id = c.ed_class_cicle AND COALESCE(cic.ed_cicle_deleted,0)=0
      LEFT JOIN eduall_faculty fac ON fac.ed_faculty_id = c.ed_class_faculty AND COALESCE(fac.ed_faculty_deleted,0)=0
      WHERE s.ed_student_id = ? AND s.ed_student_institute_code = ? AND COALESCE(s.ed_student_deleted,0) = 0
      LIMIT 1;
    `;
    const [student] = await ExecuteQuery(res, studentQuery, [studentCode, institute], true, {
      db: "eduall_students", type: "select", data: req
    });
    if (!student) return res.status(404).json({ success: false, message: "Aluno não encontrado." });

    const payments = await ExecuteQuery(res,
      `SELECT ed_fee_payment_month FROM eduall_fees_payments
       WHERE ed_fee_payment_deleted = 0 AND ed_fee_payment_student = ?
         AND ed_fee_payment_institute_code = ? AND ed_fee_payment_academic_year = ?;`,
      [student.ed_student_id, institute, ano], true, { db: "eduall_fees_payments", type: "select", data: req }
    );
    const paidMonthsSet = new Set(payments.map(p => parseFloat(p.ed_fee_payment_month)));
    const MonthsList = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    const buildMonths = (start, end) => {
      if (!start || !end || !start.includes("-") || !end.includes("-")) return [];
      const [Y1, M1] = start.split("-").map(Number);
      const [Y2, M2] = end.split("-").map(Number);
      const months = [];
      const pushMonth = (m, y) => months.push({ month: `${MonthsList[m]} de ${y}`, code: parseFloat(`${m}.${y}`) });
      if (Y1 === Y2) { for (let m = M1 - 1; m <= M2 - 1; m++) pushMonth(m, Y1); }
      else { for (let m = M1 - 1; m <= 11; m++) pushMonth(m, Y1); for (let m = 0; m <= M2 - 1; m++) pushMonth(m, Y2); }
      return months;
    };
    const months = buildMonths(student.ed_academic_year_startDate, student.ed_academic_year_endDate);
    const now = new Date(); const curYear = now.getFullYear(); const curMonth = now.getMonth();
    const monthsStatus = months.map(m => {
      const paid = paidMonthsSet.has(m.code);
      const [monthIndex, year] = m.code.toString().split(".").map(Number);
      let status = "other";
      if (paid) status = "paid";
      else if (year < curYear || (year === curYear && monthIndex < curMonth)) status = "notpaid";
      return { ...m, status };
    });

    const result = { success: true, data: {
      student: {
        id: student.ed_student_id, code: student.ed_student_code, name: student.ed_student_name,
        picture: student.ed_student_picture, class_title: student.ed_class_title,
        course_title: student.ed_course_title, classroom_title: student.ed_classroom_title,
        level_title: student.ed_academic_level_title, cicle_title: student.ed_cicle_title,
        faculty_title: student.ed_faculty_title, year_title: student.ed_academic_year_title, academic_year: ano
      },
      months: monthsStatus
    }};

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, result, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTimeCache;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleStudentPaymentStatus demorou ${duration}ms (${cacheKey})`);
    console.timeEnd(timerLabel);

    return res.status(200).json(result);
  } catch (error) {
    console.error("ERRO em GetSingleStudentPaymentStatus:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar estado de pagamento do aluno!", error: error.message || error });
  }
};

const GetSingleStudentPaymentStatusByRFID = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) return res.status(400).json({ success: false, message: "Instituto inválido na sessão." });
    
    const { rfidCode } = req.params;
    const code = (rfidCode || "").trim();
    
    if (!code) return res.status(400).json({ success: false, message: "Parâmetros inválidos: envie o RFID do aluno." });

    const cacheKey = CacheKeys.studentStatus(`rfid_${code}`, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleStudentPaymentStatusByRFID demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const studentQuery = `
      SELECT s.ed_student_id, s.ed_student_code, s.ed_student_name, s.ed_student_picture,
        c.ed_class_title, c.ed_class_year,
        y.ed_academic_year_title, y.ed_academic_year_startDate, y.ed_academic_year_endDate,
        crs.ed_course_title, lvl.ed_academic_level_title, cic.ed_cicle_title,
        room.ed_classroom_title, fac.ed_faculty_title
      FROM eduall_students s
      INNER JOIN eduall_class c ON c.ed_class_id = s.ed_student_class AND COALESCE(c.ed_class_deleted,0)=0
      INNER JOIN eduall_academic_year y ON y.ed_academic_year_id = c.ed_class_year AND COALESCE(y.ed_academic_year_deleted,0)=0
      LEFT JOIN eduall_classrooms room ON room.ed_classroom_id = c.ed_class_room AND COALESCE(room.ed_classroom_deleted,0)=0
      LEFT JOIN eduall_courses crs ON crs.ed_course_id = c.ed_class_course AND COALESCE(crs.ed_course_deleted,0)=0
      LEFT JOIN eduall_academic_level lvl ON lvl.ed_academic_level_id = c.ed_class_academic_level AND COALESCE(lvl.ed_academic_level_deleted,0)=0
      LEFT JOIN eduall_cicles cic ON cic.ed_cicle_id = c.ed_class_cicle AND COALESCE(cic.ed_cicle_deleted,0)=0
      LEFT JOIN eduall_faculty fac ON fac.ed_faculty_id = c.ed_class_faculty AND COALESCE(fac.ed_faculty_deleted,0)=0
      WHERE s.ed_student_rfid_code = ? AND s.ed_student_institute_code = ? AND COALESCE(s.ed_student_deleted,0) = 0
      LIMIT 1;
    `;
    const [student] = await ExecuteQuery(res, studentQuery, [code, institute], true, {
      db: "eduall_students", type: "select", data: req
    });
    if (!student) return res.status(404).json({ success: false, message: "Cartão não associado a nenhum aluno." });

    const ano = student.ed_class_year;
    if (!ano) return res.status(400).json({ success: false, message: "Ano lectivo actual do aluno não encontrado." });

    const payments = await ExecuteQuery(res,
      `SELECT ed_fee_payment_month FROM eduall_fees_payments
       WHERE ed_fee_payment_deleted = 0 AND ed_fee_payment_student = ?
         AND ed_fee_payment_institute_code = ? AND ed_fee_payment_academic_year = ?;`,
      [student.ed_student_id, institute, ano], true, { db: "eduall_fees_payments", type: "select", data: req }
    );
    const paidMonthsSet = new Set((payments || []).map(p => parseFloat(p.ed_fee_payment_month)));
    const MonthsList = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    const buildMonths = (start, end) => {
      if (!start || !end || !start.includes("-") || !end.includes("-")) return [];
      const [Y1, M1] = start.split("-").map(Number);
      const [Y2, M2] = end.split("-").map(Number);
      const months = [];
      const pushMonth = (m, y) => months.push({ month: `${MonthsList[m]} de ${y}`, code: parseFloat(`${m}.${y}`) });
      if (Y1 === Y2) { for (let m = M1-1; m <= M2-1; m++) pushMonth(m, Y1); }
      else { for (let m = M1-1; m <= 11; m++) pushMonth(m, Y1); for (let m = 0; m <= M2-1; m++) pushMonth(m, Y2); }
      return months;
    };
    const months = buildMonths(student.ed_academic_year_startDate, student.ed_academic_year_endDate);
    const now = new Date(); const curYear = now.getFullYear(); const curMonth = now.getMonth();
    const monthsStatus = months.map(m => {
      const paid = paidMonthsSet.has(m.code);
      const [monthIndex, year] = m.code.toString().split(".").map(Number);
      let status = "other";
      if (paid) status = "paid";
      else if (year < curYear || (year === curYear && monthIndex < curMonth)) status = "notpaid";
      return { ...m, status };
    });

    const result = {
      success: true,
      data: {
        student: {
          id: student.ed_student_id, code: student.ed_student_code, name: student.ed_student_name,
          picture: student.ed_student_picture, class_title: student.ed_class_title,
          course_title: student.ed_course_title, classroom_title: student.ed_classroom_title,
          level_title: student.ed_academic_level_title, cicle_title: student.ed_cicle_title,
          faculty_title: student.ed_faculty_title, year_title: student.ed_academic_year_title, academic_year: ano
        },
        months: monthsStatus
      },
      meta: { source: "rfid", academicYear: ano }
    };

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, result, FEES_PAYMENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleStudentPaymentStatusByRFID demorou ${duration}ms (${cacheKey})`);

    return res.status(200).json(result);
  } catch (error) {
    console.error("ERRO em GetSingleStudentPaymentStatusByRFID:", error);
    return res.status(500).json({ success: false, message: "Erro ao carregar estado de pagamento do aluno (RFID)!", error: error.message || error });
  }
};

const GetAllClassesPaymentsStatus = async (req, res) => {
  try {
    console.time("GetAllClassesPaymentsStatus");
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) return res.status(400).json({ success: false, message: "Instituto inválido na sessão." });

    const cacheKey = CacheKeys.allClassesStatus(institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAllClassesPaymentsStatus demorou ${duration}ms (${cacheKey})`);
      console.timeEnd("GetAllClassesPaymentsStatus");
      return res.status(200).json(cached);
    }

    const MonthsList = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    const buildMonths = (yearData) => {
      const { ed_academic_year_startDate: start, ed_academic_year_endDate: end } = yearData || {};
      if (!start || !end) return [];
      const [Y1, M1] = start.split("-").map(Number);
      const [Y2, M2] = end.split("-").map(Number);
      const months = [];
      if (Y2 > Y1) {
        for (let i = M1-1; i <= 11; i++) months.push({ month: `${MonthsList[i]} de ${Y1}`, code: parseFloat(`${i}.${Y1}`), status: "other" });
        for (let i = 0; i <= M2-1; i++) months.push({ month: `${MonthsList[i]} de ${Y2}`, code: parseFloat(`${i}.${Y2}`), status: "other" });
      } else {
        for (let i = M1-1; i <= M2-1; i++) months.push({ month: `${MonthsList[i]} de ${Y1}`, code: parseFloat(`${i}.${Y1}`), status: "other" });
      }
      return months;
    };
    const classes = await ExecuteQuery(res,
      `SELECT c.*, y.ed_academic_year_id, y.ed_academic_year_startDate, y.ed_academic_year_endDate
       FROM eduall_class c INNER JOIN eduall_academic_year y ON y.ed_academic_year_id = c.ed_class_year
       WHERE c.ed_class_deleted = 0 AND c.ed_class_institute_code = ? AND y.ed_academic_year_institute_code = ?`,
      [institute, institute], true, { db: "eduall_class", type: "select", data: req }
    );
    if (!Array.isArray(classes) || !classes.length) return res.status(404).json({ success: false, message: "Nenhuma turma encontrada!" });
    const allStudents = await ExecuteQuery(res,
      `SELECT s.* FROM eduall_students s WHERE s.ed_student_deleted = 0 AND s.ed_student_institute_code = ? ORDER BY s.ed_student_name ASC`,
      [institute], true, { db: "eduall_students", type: "select", data: req }
    );
    const allPayments = await ExecuteQuery(res,
      `SELECT p.* FROM eduall_fees_payments p WHERE p.ed_fee_payment_deleted = 0 AND p.ed_fee_payment_institute_code = ?`,
      [institute], true, { db: "eduall_fees_payments", type: "select", data: req }
    );
    const currentYear = new Date().getFullYear(); const currentMonth = new Date().getMonth();
    const finalResult = classes.map(cls => {
      const yearData = { ed_academic_year_id: cls.ed_academic_year_id, ed_academic_year_startDate: cls.ed_academic_year_startDate, ed_academic_year_endDate: cls.ed_academic_year_endDate };
      const months   = buildMonths(yearData);
      const students = allStudents.filter(st => st.ed_student_class === cls.ed_class_id);
      const studentsData = students.map(st => {
        const stPayments = allPayments.filter(p => p.ed_fee_payment_student === st.ed_student_id && p.ed_fee_payment_academic_year === cls.ed_class_year);
        const monthsStatus = months.map(m => {
          const paid = stPayments.find(p => parseFloat(p.ed_fee_payment_month) === m.code);
          let status = paid ? "paid" : "other";
          const mYear = parseInt(m.month.split(" ")[2]); const mMonth = parseInt(m.code.toString().split(".")[0]);
          if (!paid && (mYear < currentYear || (mYear === currentYear && mMonth < currentMonth))) status = "notpaid";
          return { ...m, status };
        });
        return { id: st.ed_student_id, name: st.ed_student_name, code: st.ed_student_code, picture: st.ed_student_picture, months: monthsStatus };
      });
      return { class_id: cls.ed_class_id, class_title: cls.ed_class_title, academic_year: yearData, students: studentsData };
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, finalResult, FEES_PAYMENT_CACHE_TTL);

    console.timeEnd("GetAllClassesPaymentsStatus");
    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAllClassesPaymentsStatus demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(finalResult);
  } catch (error) {
    console.error("ERRO:", error);
    res.status(500).json({ success: false, message: "Erro ao carregar pagamentos das turmas!", error: error.message });
  }
};

const GetClassPaymentsStatusById = async (req, res) => {
  try {
    console.time("GetClassPaymentsStatusById");
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const classId   = req.params.classId;
    const cacheKey  = CacheKeys.classStatus(classId, institute);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetClassPaymentsStatusById demorou ${duration}ms (${cacheKey})`);
      console.timeEnd("GetClassPaymentsStatusById");
      return res.status(200).json(cached);
    }

    const MonthsList = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    const buildMonths = (start, end) => {
      if (!start || !end || typeof start !== "string" || typeof end !== "string" || !start.includes("-") || !end.includes("-")) return [];
      const parts1 = start.split("-").map(Number); const parts2 = end.split("-").map(Number);
      if (parts1.length < 2 || parts2.length < 2 || parts1.some(isNaN) || parts2.some(isNaN)) return [];
      const [Y1, M1] = parts1; const [Y2, M2] = parts2;
      const months = [];
      const pushMonth = (m, y) => months.push({ month: `${MonthsList[m]} de ${y}`, code: parseFloat(`${m}.${y}`), status: "other" });
      if (Y1 === Y2) { for (let m = M1-1; m <= M2-1; m++) pushMonth(m, Y1); }
      else { for (let m = M1-1; m <= 11; m++) pushMonth(m, Y1); for (let m = 0; m <= M2-1; m++) pushMonth(m, Y2); }
      return months;
    };
    const classes = await ExecuteQuery(res,
      `SELECT c.ed_class_id, c.ed_class_title, c.ed_class_year, c.ed_class_institute_code, c.ed_class_deleted,
              y.ed_academic_year_id, y.ed_academic_year_startDate, y.ed_academic_year_endDate
       FROM eduall_class c INNER JOIN eduall_academic_year y ON y.ed_academic_year_id = c.ed_class_year AND y.ed_academic_year_deleted = 0
       WHERE c.ed_class_deleted = 0 AND c.ed_class_institute_code = ? AND c.ed_class_id = ? AND y.ed_academic_year_institute_code = ?`,
      [institute, classId, institute], true, { db: "eduall_class", type: "select", data: req }
    );
    if (!classes || !classes.length) return res.status(404).json({ success: false, message: "Turma não encontrada!" });
    const allStudents = await ExecuteQuery(res,
      `SELECT s.ed_student_id, s.ed_student_name, s.ed_student_picture, s.ed_student_code, s.ed_student_class
       FROM eduall_students s WHERE s.ed_student_deleted = 0 AND s.ed_student_class = ? AND s.ed_student_institute_code = ? ORDER BY s.ed_student_name ASC`,
      [classId, institute], true, { db: "eduall_students", type: "select", data: req }
    );
    const allPayments = await ExecuteQuery(res,
      `SELECT p.ed_fee_payment_id, p.ed_fee_payment_student, p.ed_fee_payment_month, p.ed_fee_payment_academic_year, p.ed_fee_payment_deleted, p.ed_fee_payment_institute_code
       FROM eduall_fees_payments p WHERE p.ed_fee_payment_deleted = 0 AND p.ed_fee_payment_institute_code = ?`,
      [institute], true, { db: "eduall_fees_payments", type: "select", data: req }
    );
    const currentYear = new Date().getFullYear(); const currentMonth = new Date().getMonth();
    const finalResult = classes.map(cls => {
      const start = cls.ed_academic_year_startDate; const end = cls.ed_academic_year_endDate;
      const months = buildMonths(start, end);
      const students = allStudents.filter(st => st.ed_student_class === cls.ed_class_id);
      const studentsData = students.map(st => {
        const stPayments = allPayments.filter(p => p.ed_fee_payment_student === st.ed_student_id && p.ed_fee_payment_academic_year === cls.ed_class_year);
        const monthsStatus = months.map(m => {
          const paid = stPayments.find(p => parseFloat(p.ed_fee_payment_month) === m.code);
          let status = paid ? "paid" : "other";
          const mYear = parseInt(m.month.split(" ")[2]); const mMonth = parseInt(m.code.toString().split(".")[0]);
          if (!paid && (mYear < currentYear || (mYear === currentYear && mMonth < currentMonth))) status = "notpaid";
          return { ...m, status };
        });
        return { id: st.ed_student_id, name: st.ed_student_name, picture: st.ed_student_picture, code: st.ed_student_code, months: monthsStatus };
      });
      return {
        class_id: cls.ed_class_id, class_title: cls.ed_class_title,
        academic_year: { ed_academic_year_id: cls.ed_academic_year_id, ed_academic_year_startDate: start, ed_academic_year_endDate: end },
        students: studentsData
      };
    });

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, finalResult, FEES_PAYMENT_CACHE_TTL);

    console.timeEnd("GetClassPaymentsStatusById");
    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetClassPaymentsStatusById demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(finalResult);
  } catch (error) {
    console.error("ERRO:", error);
    res.status(500).json({ success: false, message: "Erro ao carregar pagamentos da turma!", error: error.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// IMPORT FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════
 
async function importOne(row, institute, session, externalOrigin, externalFile, res) {
  const operatorId   = session?.user?.eduall_user_session_ID;
  const operatorName = session?.user?.eduall_user_session_name || "Importação";
 
  const {
    studentCode,
    month,
    price,
    paymentType    = 0,
    bankName       = "",
    paymentDate    = null,
    invoiceRef     = null,
    notes          = "",
    academicYearId = null,
  } = row;
 
  if (!studentCode || !month || price === undefined || price === null || price === "") {
    const err = new Error("Campos obrigatórios em falta (matrícula, mês ou valor).");
    err.code = "MISSING_FIELDS";
    throw err;
  }
 
  const priceVal = parseFloat(String(price).replace(",", "."));
  if (!Number.isFinite(priceVal) || priceVal <= 0) {
    const err = new Error(`Valor inválido: "${price}".`);
    err.code = "INVALID_PRICE";
    throw err;
  }
 
  if (!/^\d{1,2}\.\d{4}$/.test(String(month).trim())) {
    const err = new Error(`Formato de mês inválido: "${month}". Esperado M.AAAA.`);
    err.code = "INVALID_MONTH";
    throw err;
  }
 
  const codeStr = String(studentCode).trim();
  const [student] = await ExecuteQuery(
    res,
    `SELECT ed_student_id, ed_student_name, ed_student_code, ed_student_class
     FROM eduall_students
     WHERE ed_student_institute_code = ?
       AND COALESCE(ed_student_deleted, 0) = 0
       AND (ed_student_id = ? OR ed_student_code = ?)
     LIMIT 1`,
    [institute, codeStr, codeStr],
    true
  );
 
  if (!student) {
    const err = new Error(`Aluno não encontrado para o valor "${studentCode}" (tentado por ID e por matrícula).`);
    err.code = "STUDENT_NOT_FOUND";
    throw err;
  }
 
  let resolvedYearId = academicYearId ? parseInt(academicYearId, 10) : null;
  if (!resolvedYearId && student.ed_student_class) {
    const [classRow] = await ExecuteQuery(
      res,
      `SELECT ed_class_year FROM eduall_class WHERE ed_class_id = ? AND COALESCE(ed_class_deleted,0)=0 LIMIT 1`,
      [student.ed_student_class], true
    );
    resolvedYearId = classRow?.ed_class_year || null;
  }
 
  const dupParams = [student.ed_student_id, month.trim(), institute];
  let dupSql = `
    SELECT ed_fee_payment_id, ed_fee_payment_month, ed_fee_payment_academic_year
    FROM eduall_fees_payments
    WHERE ed_fee_payment_student        = ?
      AND ed_fee_payment_month          = ?
      AND ed_fee_payment_institute_code = ?
      AND COALESCE(ed_fee_payment_deleted, 0) = 0
  `;
  if (resolvedYearId) { dupSql += " AND ed_fee_payment_academic_year = ?"; dupParams.push(resolvedYearId); }
  dupSql += " LIMIT 1";
 
  const [dup] = await ExecuteQuery(res, dupSql, dupParams, true);
  if (dup) {
    const err = new Error(
      `Mês ${month} já registado para o aluno "${student.ed_student_code}"` +
      (resolvedYearId ? ` (ano lectivo ${resolvedYearId})` : "") + "."
    );
    err.code              = "DUPLICATE_MONTH";
    err.existingPaymentId = dup.ed_fee_payment_id;
    err.studentId         = student.ed_student_id;
    err.month             = month;
    throw err;
  }
 
  const [svc] = await ExecuteQuery(
    res,
    `SELECT ed_service_id FROM eduall_services
     WHERE ed_service_institute_code = ? AND COALESCE(ed_service_deleted,0)=0
     ORDER BY ed_service_id ASC LIMIT 1`,
    [institute], true
  );
  const serviceId = svc?.ed_service_id || 1;
 
  const generatedInvoiceCode = invoiceRef
    ? String(invoiceRef).trim()
    : `IMP-${student.ed_student_code}-${String(month).replace(".", "_")}-${Date.now()}`;
 
  await ExecuteQuery(
    res,
    `INSERT INTO eduall_fees_payments (
       ed_fee_payment_student, ed_fee_payment_service, ed_fee_payment_price,
       ed_fee_payment_month, ed_fee_payment_type, ed_fee_payment_bank,
       ed_fee_payment_academic_year, ed_fee_payment_balance,
       ed_fee_payment_invoiceCode, ed_fee_payment_invoiceFile,
       ed_fee_payment_institute_code, ed_fee_payment_operator, ed_fee_payment_operator_id,
       ed_fee_payment_external_file, ed_fee_payment_external_origin,
       ed_fee_payment_notes, ed_fee_payment_discount, ed_fee_payment_iva,
       ed_fee_payment_fineType, ed_fee_payment_fineValue
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,0)`,
    [
      student.ed_student_id, serviceId, priceVal,
      month.trim(), parseInt(paymentType, 10) || 0, bankName || "",
      resolvedYearId || null, priceVal,
      generatedInvoiceCode, externalFile || null,
      institute, operatorName, operatorId || null,
      externalFile || null, externalOrigin || null,
      notes || "",
    ], false
  );
 
  return {
    ok:          true,
    studentId:   student.ed_student_id,
    studentName: student.ed_student_name,
    studentCode: student.ed_student_code,
    month,
    inserted:    1,
    invoiceCode: generatedInvoiceCode,
  };
}
 
const ImportSinglePayment = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) return res.status(401).json({ success: false, msg: "Sessão inválida." });
 
    const { externalOrigin = null, externalFile = null, ...rowData } = req.body || {};
    const result = await importOne(rowData, institute, req.session, externalOrigin, externalFile, res);
 
    // ── Invalidar cache ──
    await RefreshFeesPaymentCache(req, res, institute);

    return res.status(200).json({
      success: true, studentName: result.studentName,
      studentCode: result.studentCode, month: result.month, invoiceCode: result.invoiceCode,
    });
  } catch (err) {
    if (err.code === "STUDENT_NOT_FOUND") return res.status(404).json({ success: false, code: err.code, msg: err.message });
    if (err.code === "DUPLICATE_MONTH")   return res.status(409).json({ success: false, code: err.code, msg: err.message, existingPaymentId: err.existingPaymentId });
    if (["MISSING_FIELDS","INVALID_PRICE","INVALID_MONTH"].includes(err.code))
      return res.status(400).json({ success: false, code: err.code, msg: err.message });
    console.error("ImportSinglePayment error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};
 
const ImportBatchPayments = async (req, res) => {
  try {
    const institute = req.session?.user?.eduall_user_session_curentinstitute;
    if (!institute) return res.status(401).json({ success: false, msg: "Sessão inválida." });
 
    const { rows = [], externalOrigin = null, externalFile = null, academicYearId: globalYearId = null } = req.body || {};
 
    if (!Array.isArray(rows) || rows.length === 0)
      return res.status(400).json({ success: false, msg: "Sem linhas para importar." });
 
    if (rows.length > 5000)
      return res.status(400).json({ success: false, msg: "Máximo de 5000 linhas por envio." });
 
    const allStudents = await ExecuteQuery(
      res,
      `SELECT ed_student_id, ed_student_code, ed_student_name, ed_student_class
       FROM eduall_students
       WHERE ed_student_institute_code = ?
         AND COALESCE(ed_student_deleted, 0) = 0`,
      [institute], true
    );
 
    const studentByIdMap = new Map(
      allStudents.map(s => [String(s.ed_student_id), s])
    );
    const studentByCodeMap = new Map(
      allStudents.map(s => [String(s.ed_student_code).trim().toLowerCase(), s])
    );
 
    const findStudent = (rawValue) => {
      const v = String(rawValue || "").trim();
      if (!v) return null;
      const byId = studentByIdMap.get(v);
      if (byId) return byId;
      return studentByCodeMap.get(v.toLowerCase()) || null;
    };
 
    const existingPayments = await ExecuteQuery(
      res,
      `SELECT ed_fee_payment_student AS studentId,
              ed_fee_payment_month   AS month,
              ed_fee_payment_academic_year AS yearId
       FROM eduall_fees_payments
       WHERE ed_fee_payment_institute_code = ?
         AND COALESCE(ed_fee_payment_deleted, 0) = 0`,
      [institute], true
    );
 
    const dupSet = new Set();
    for (const p of existingPayments) {
      dupSet.add(`${p.studentId}:${p.month}`);
      if (p.yearId) dupSet.add(`${p.studentId}:${p.month}:${p.yearId}`);
    }
 
    const allClasses = await ExecuteQuery(
      res,
      `SELECT ed_class_id, ed_class_year
       FROM eduall_class
       WHERE ed_class_institute_code = ? AND COALESCE(ed_class_deleted,0)=0`,
      [institute], true
    );
    const classYearMap = new Map(allClasses.map(c => [c.ed_class_id, c.ed_class_year]));
 
    const [svc] = await ExecuteQuery(
      res,
      `SELECT ed_service_id FROM eduall_services
       WHERE ed_service_institute_code = ? AND COALESCE(ed_service_deleted,0)=0
       ORDER BY ed_service_id ASC LIMIT 1`,
      [institute], true
    );
    const serviceId = svc?.ed_service_id || 1;
 
    const operatorId   = req.session?.user?.eduall_user_session_ID;
    const operatorName = req.session?.user?.eduall_user_session_name || "Importação";
 
    const results  = [];
    const toInsert = [];
 
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const {
        studentCode,
        month,
        price,
        paymentType   = 0,
        bankName      = "",
        notes         = "",
        invoiceRef    = null,
        academicYearId: rowYearId = null,
      } = row;
 
      const resolvedGlobalYear = globalYearId ? parseInt(globalYearId, 10) : null;
 
      if (!studentCode || !month || price === undefined || price === null || price === "") {
        results.push({ index:i, ok:false, dup:false, skipped:true, code:"MISSING_FIELDS",
          msg:"Matrícula, mês ou valor em falta.", studentCode, month });
        continue;
      }
 
      const priceVal = parseFloat(String(price).replace(",", "."));
      if (!Number.isFinite(priceVal) || priceVal <= 0) {
        results.push({ index:i, ok:false, dup:false, skipped:true, code:"INVALID_PRICE",
          msg:`Valor inválido: "${price}".`, studentCode, month });
        continue;
      }
 
      if (!/^\d{1,2}\.\d{4}$/.test(String(month).trim())) {
        results.push({ index:i, ok:false, dup:false, skipped:true, code:"INVALID_MONTH",
          msg:`Formato de mês inválido: "${month}".`, studentCode, month });
        continue;
      }
 
      const student = findStudent(studentCode);
      if (!student) {
        results.push({ index:i, ok:false, dup:false, skipped:true, code:"STUDENT_NOT_FOUND",
          msg:`Aluno não encontrado: "${studentCode}" (verificado por ID e por matrícula).`,
          studentCode, month });
        continue;
      }
 
      let resolvedYearId = rowYearId ? parseInt(rowYearId, 10)
                         : resolvedGlobalYear
                         ? resolvedGlobalYear
                         : (student.ed_student_class ? classYearMap.get(student.ed_student_class) || null : null);
 
      const monthStr   = String(month).trim();
      const dupKey     = `${student.ed_student_id}:${monthStr}`;
      const dupKeyYear = resolvedYearId ? `${dupKey}:${resolvedYearId}` : null;
      const isDup      = dupSet.has(dupKey) || (dupKeyYear && dupSet.has(dupKeyYear));
 
      if (isDup) {
        results.push({ index:i, ok:false, dup:true, skipped:false, code:"DUPLICATE_MONTH",
          msg:`Mês ${month} já registado para o aluno "${student.ed_student_code}".`,
          studentCode: student.ed_student_code, studentName: student.ed_student_name,
          month, studentId: student.ed_student_id });
        continue;
      }
 
      dupSet.add(dupKey);
      if (dupKeyYear) dupSet.add(dupKeyYear);
 
      const invoiceCode = invoiceRef
        ? String(invoiceRef).trim()
        : `IMP-${student.ed_student_code}-${monthStr.replace(".", "_")}-${Date.now()}-${i}`;
 
      toInsert.push({
        index:       i,
        studentId:   student.ed_student_id,
        studentName: student.ed_student_name,
        studentCode: student.ed_student_code,
        serviceId,
        priceVal,
        month:       monthStr,
        paymentType: parseInt(paymentType, 10) || 0,
        bankName:    bankName || "",
        yearId:      resolvedYearId,
        invoiceCode,
        notes:       notes || "",
      });
    }
 
    const CHUNK_SIZE = 500;
    for (let c = 0; c < toInsert.length; c += CHUNK_SIZE) {
      const chunk = toInsert.slice(c, c + CHUNK_SIZE);
 
      const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,0)").join(",");
      const params = [];
      for (const r of chunk) {
        params.push(
          r.studentId, r.serviceId, r.priceVal,
          r.month, r.paymentType, r.bankName,
          r.yearId, r.priceVal,
          r.invoiceCode, externalFile || null,
          institute, operatorName, operatorId || null,
          externalFile || null, externalOrigin || null,
          r.notes
        );
      }
 
      try {
        await ExecuteQuery(res,
          `INSERT INTO eduall_fees_payments (
             ed_fee_payment_student, ed_fee_payment_service, ed_fee_payment_price,
             ed_fee_payment_month, ed_fee_payment_type, ed_fee_payment_bank,
             ed_fee_payment_academic_year, ed_fee_payment_balance,
             ed_fee_payment_invoiceCode, ed_fee_payment_invoiceFile,
             ed_fee_payment_institute_code, ed_fee_payment_operator, ed_fee_payment_operator_id,
             ed_fee_payment_external_file, ed_fee_payment_external_origin,
             ed_fee_payment_notes, ed_fee_payment_discount, ed_fee_payment_iva,
             ed_fee_payment_fineType, ed_fee_payment_fineValue
           ) VALUES ${placeholders}`,
          params, false
        );
        for (const r of chunk) {
          results.push({ index:r.index, ok:true, dup:false,
            studentCode:r.studentCode, studentName:r.studentName,
            month:r.month, invoiceCode:r.invoiceCode });
        }
      } catch (chunkErr) {
        console.warn(`[ImportBatch] Grupo falhou, tentando linha a linha:`, chunkErr.message);
        for (const r of chunk) {
          try {
            await ExecuteQuery(res,
              `INSERT INTO eduall_fees_payments (
                 ed_fee_payment_student, ed_fee_payment_service, ed_fee_payment_price,
                 ed_fee_payment_month, ed_fee_payment_type, ed_fee_payment_bank,
                 ed_fee_payment_academic_year, ed_fee_payment_balance,
                 ed_fee_payment_invoiceCode, ed_fee_payment_invoiceFile,
                 ed_fee_payment_institute_code, ed_fee_payment_operator, ed_fee_payment_operator_id,
                 ed_fee_payment_external_file, ed_fee_payment_external_origin,
                 ed_fee_payment_notes, ed_fee_payment_discount, ed_fee_payment_iva,
                 ed_fee_payment_fineType, ed_fee_payment_fineValue
               ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,0)`,
              [r.studentId, r.serviceId, r.priceVal, r.month, r.paymentType, r.bankName,
               r.yearId, r.priceVal, r.invoiceCode, externalFile||null,
               institute, operatorName, operatorId||null,
               externalFile||null, externalOrigin||null, r.notes], false
            );
            results.push({ index:r.index, ok:true, dup:false,
              studentCode:r.studentCode, studentName:r.studentName,
              month:r.month, invoiceCode:r.invoiceCode });
          } catch (rowErr) {
            results.push({ index:r.index, ok:false, dup:false, skipped:false,
              code:"INSERT_ERROR", msg:rowErr.message,
              studentCode:r.studentCode, month:r.month });
          }
        }
      }
    }
 
    results.sort((a, b) => a.index - b.index);
 
    const okCount  = results.filter(r => r.ok).length;
    const dupCount = results.filter(r => r.dup).length;
    const errCount = results.filter(r => !r.ok && !r.dup).length;
 
    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Importação de pagamentos",
      description: `${okCount} gravados, ${dupCount} já existiam, ${errCount} com erros. Total: ${rows.length}. Origem: ${externalOrigin || "—"}.`,
    });

    // ── Invalidar cache ──
    await RefreshFeesPaymentCache(req, res, institute);
 
    return res.status(200).json({
      success: true, total: rows.length,
      inserted: okCount, skipped: dupCount, errors: errCount,
      results,
    });
 
  } catch (err) {
    console.error("ImportBatchPayments error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

const DeleteImportedPayments = async (req, res) => {
  try {
    const institute  = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
 
    if (!institute) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }
 
    const {
      origin       = null,
      academicYearId = null,
      dryRun       = false,
    } = req.body || {};
 
    const VALID_ORIGINS = ["banco", "sistema_antigo", "folha", "outro"];
    if (origin && !VALID_ORIGINS.includes(origin)) {
      return res.status(400).json({
        success: false,
        msg: `Origem inválida: "${origin}". Valores aceites: ${VALID_ORIGINS.join(", ")}.`,
      });
    }
 
    const conditions = [
      `ed_fee_payment_institute_code = ?`,
      `COALESCE(ed_fee_payment_deleted, 0) = 0`,
      `(
         ed_fee_payment_external_origin IS NOT NULL
         OR ed_fee_payment_invoiceCode LIKE 'IMP-%'
       )`,
    ];
    const params = [institute];
 
    if (origin) {
      conditions.push(`ed_fee_payment_external_origin = ?`);
      params.push(origin);
    }
 
    if (academicYearId) {
      conditions.push(`ed_fee_payment_academic_year = ?`);
      params.push(parseInt(academicYearId, 10));
    }
 
    const WHERE = conditions.join("\n        AND ");
 
    const preview = await ExecuteQuery(
      res,
      `SELECT
         p.ed_fee_payment_id          AS id,
         p.ed_fee_payment_invoiceCode AS invoiceCode,
         p.ed_fee_payment_student     AS studentId,
         p.ed_fee_payment_month       AS month,
         p.ed_fee_payment_price       AS price,
         p.ed_fee_payment_academic_year AS academicYear,
         p.ed_fee_payment_external_origin AS origin,
         p.ed_fee_payment_registerDate    AS registeredAt,
         s.ed_student_name                AS studentName,
         s.ed_student_code                AS studentCode
       FROM eduall_fees_payments p
       LEFT JOIN eduall_students s
         ON s.ed_student_id = p.ed_fee_payment_student
        AND COALESCE(s.ed_student_deleted, 0) = 0
       WHERE ${WHERE}
       ORDER BY p.ed_fee_payment_registerDate DESC
       LIMIT 5000`,
      params,
      true
    );
 
    const totalToDelete = preview.length;
 
    if (dryRun) {
      return res.status(200).json({
        success:  true,
        dryRun:   true,
        deleted:  0,
        total:    totalToDelete,
        message:  `Pré-visualização: ${totalToDelete} pagamento(s) seriam apagados.`,
        preview:  preview.slice(0, 200),
        filters: { origin: origin || "todas", academicYearId: academicYearId || "todos" },
      });
    }
 
    if (totalToDelete === 0) {
      return res.status(200).json({
        success: true,
        deleted: 0,
        message: "Nenhum pagamento importado encontrado com os filtros indicados.",
        filters: { origin: origin || "todas", academicYearId: academicYearId || "todos" },
      });
    }
 
    const idsToDelete = preview.map(r => r.id);
 
    const CHUNK = 500;
    let deletedCount = 0;
 
    for (let i = 0; i < idsToDelete.length; i += CHUNK) {
      const chunkIds     = idsToDelete.slice(i, i + CHUNK);
      const placeholders = chunkIds.map(() => "?").join(",");
 
      await ExecuteQuery(
        res,
        `DELETE FROM eduall_fees_payments
         WHERE ed_fee_payment_id IN (${placeholders})
           AND ed_fee_payment_institute_code = ?`,
        [...chunkIds, institute],
        false
      );
 
      deletedCount += chunkIds.length;
    }
 
    const originLabel      = origin       ? `origem "${origin}"`              : "todas as origens";
    const yearLabel        = academicYearId ? `ano lectivo ${academicYearId}` : "todos os anos";
    const auditDescription =
      `Eliminou ${deletedCount} pagamento(s) importados (${originLabel}, ${yearLabel}). ` +
      `Operador ID: ${operatorId || "desconhecido"}.`;
 
    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Importação de pagamentos",
      description: auditDescription,
    });

    // ── Invalidar cache ──
    await RefreshFeesPaymentCache(req, res, institute);
 
    return res.status(200).json({
      success:  true,
      dryRun:   false,
      deleted:  deletedCount,
      message:  `${deletedCount} pagamento(s) importado(s) eliminado(s) com sucesso.`,
      filters:  { origin: origin || "todas", academicYearId: academicYearId || "todos" },
    });
 
  } catch (err) {
    console.error("DeleteImportedPayments error:", err);
    return res.status(500).json({ success: false, msg: err.message });
  }
};

module.exports = {
  ImportSinglePayment, 
  ImportBatchPayments,
  GetFeepayments,
  GetSinglePayment,
  GetSingleFeepayment,
  GetSinglePaidMonth,
  GetAllClassesPaymentsStatus,
  GetSingleStudentFees,
  RegisterFeepayment,
  FeePaymentDelete,
  FeePaymentUpdate,
  GetClassPaymentsStatusById, 
  GetSingleStudentPaymentStatus,
  GetSingleStudentPaymentStatusByRFID,
  CheckBordereauStatus,
  SetBordereauOriginalValue,
  GetBordereauDetail,
  DeleteImportedPayments
};