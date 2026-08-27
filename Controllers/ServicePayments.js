// ────────────────────────────────────────────────────────────────────────────────
// ServicePayments.js - BACKEND CONTROLLER (VERSÃO FINAL - COM PREÇO HISTÓRICO)
// ────────────────────────────────────────────────────────────────────────────────
// ✅ CORRIGIDO: Guardar preço histórico de propinas
// ✅ NOVO: Retornar null para propinas antigas (price = 0)
// ✅ CORRIGIDO: Remover `res` de FetchServicePayments e getOperatorData
// ✅ CORRIGIDO: Sanitizar com JSON.parse(JSON.stringify()) antes de enviar
// ✅ CORRIGIDO: Usar `return` em todas as respostas res.status().json()
// ✅ CORRIGIDO: Passar `null` em ExecuteQuery em vez de `res`
// ────────────────────────────────────────────────────────────────────────────────

const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const { 
  VENDUS_CreateInvoiceCodeAndDoc,
  getPaymentMethods,
  resolvePaymentMethod
} = require("../Functions/VENDUS");

// ════════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Formata valor monetário
 */
function formatCurrency(value) {
  return Number(value).toLocaleString('pt-AO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Valida se value é um preço válido
 */
function isValidPrice(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) && num >= 0;
}

/**
 * Converte número do mês (1-12) para nome (Janeiro, Fevereiro, ...)
 */
function getMonthName(monthNumber) {
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  return months[monthNumber - 1] || `Mês ${monthNumber}`;
}

/**
 * Converte mês 0-indexed (0-11) para nome
 * Exemplo: 0 → "Janeiro", 1 → "Fevereiro", 11 → "Dezembro"
 */
function getMonthNameFrom0Index(monthIndex) {
  const months = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
  ];
  return months[monthIndex] || `Mês ${monthIndex}`;
}

/**
 * Formata lista de meses para string legível
 * Aceita AMBOS: 0-indexed (0-11) E 1-indexed (1-12)
 * Exemplo: [0, 1, 2] → "Janeiro 2025, Fevereiro 2025, Março 2025"
 * Exemplo: [1, 2, 3] → "Janeiro 2025, Fevereiro 2025, Março 2025"
 */
function formatMonthsList2(monthNumbers) {
  const year = new Date().getFullYear();
  return monthNumbers
    .map(month => {
      // Detectar se é 0-indexed (0-11) ou 1-indexed (1-12)
      if (month >= 0 && month <= 11) {
        return `${getMonthNameFrom0Index(month)} ${year}`;
      } else if (month >= 1 && month <= 12) {
        return `${getMonthName(month)} ${year}`;
      }
      return `Mês ${month} ${year}`;
    })
    .join(', ');
}

/**
 * Obtém dados do operador (APENAS ID)
 */
async function getOperatorData(userId) {
  if (!userId) return null;
  try {
    const [operator] = await ExecuteQuery(
      null,
      `SELECT ed_user_account_id, ed_user_account_name
       FROM eduall_user_accounts
       WHERE ed_user_account_id = ? AND ed_user_account_deleted = 0 LIMIT 1`,
      [userId],
      true
    );
    return operator
      ? { id: operator.ed_user_account_id, name: operator.ed_user_account_name }
      : null;
  } catch (err) {
    console.warn("Erro ao buscar operador:", err.message);
    return null;
  }
}

/**
 * Verifica se método requer borderô
 */
function requiresBordereau(methodName) {
  const name = String(methodName || "").toLowerCase().trim();
  
  const requiresIt = [
    "transfer", "transferência", "deposito", "deposit",
    "tpa", "referência", "reference", "bordereau", "cheque", "mbway"
  ];

  return requiresIt.some(req => name.includes(req));
}

// ════════════════════════════════════════════════════════════════════════════════
// GET - LISTAR PAGAMENTOS DE SERVIÇO
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Busca pagamentos de serviço com JOINs
 */
const FetchServicePayments = async (req, instituteCode) => {
  const query = `
    SELECT 
      sp.ed_service_payment_id,
      sp.ed_service_payment_code,
      sp.ed_service_payment_student_code,
      sp.ed_service_payment_amount,
      sp.ed_service_payment_discount,
      sp.ed_service_payment_type,
      sp.ed_service_payment_bank,
      sp.ed_service_payment_place,
      sp.ed_service_payment_reference,
      sp.ed_service_payment_receipt_number,
      sp.ed_service_payment_observations,
      sp.ed_service_payment_value_delivered,
      sp.ed_service_payment_exchange,
      sp.ed_service_payment_invoiceCode,
      sp.ed_service_payment_file_code,
      sp.ed_service_payment_has_matricula,
      sp.ed_service_payment_has_confirmacao,
      sp.ed_service_payment_new_class,
      sp.ed_service_payment_includes_fees,
      sp.ed_service_payment_fee_count,
      sp.ed_service_payment_operator,
      sp.ed_service_payment_operator_id,
      sp.ed_service_payment_registerDate,
      sp.ed_service_payment_deleted,
      
      st.ed_student_id,
      st.ed_student_name,
      st.ed_student_code,
      st.ed_student_class,
      st.ed_student_picture,
      st.ed_student_deleted,
      
      c.ed_coin_code,
      c.ed_coin_id,
      
      (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', spi.ed_service_payment_item_id,
            'service_id', spi.ed_service_id,
            'service_title', srv_item.ed_service_title,
            'service_type', srv_item.ed_service_type,
            'quantity', spi.ed_service_quantity,
            'unit_price', spi.ed_service_unit_price,
            'discount_percent', spi.ed_service_discount_percent,
            'total_price', (spi.ed_service_unit_price * spi.ed_service_quantity) - 
                          ((spi.ed_service_unit_price * spi.ed_service_quantity * spi.ed_service_discount_percent) / 100),
            'is_matricula', spi.ed_service_is_matricula,
            'is_confirmation', spi.ed_service_is_confirmation,
            'deleted', COALESCE(spi.ed_service_payment_item_deleted, 0)
          )
        )
        FROM eduall_service_payment_items spi
        LEFT JOIN eduall_services srv_item ON srv_item.ed_service_id = spi.ed_service_id
        WHERE spi.ed_service_payment_code COLLATE utf8mb4_general_ci
            = sp.ed_service_payment_code COLLATE utf8mb4_general_ci
          AND COALESCE(spi.ed_service_payment_item_deleted, 0) = 0
      ) AS items,
      
      (
        SELECT JSON_ARRAYAGG(
          JSON_OBJECT(
            'id', fp.ed_fee_payment_id,
            'student_id', fp.ed_fee_payment_student,
            'month', fp.ed_fee_payment_month,
            'month_name', ELT(fp.ed_fee_payment_month, 
              'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
              'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'),
            'service_id', fp.ed_fee_payment_service,
            'service_title', srv_fee.ed_service_title,
            'price', IF(fp.ed_fee_payment_price > 0, fp.ed_fee_payment_price, NULL),
            'deleted', COALESCE(fp.ed_fee_payment_deleted, 0)
          )
        )
        FROM eduall_fees_payments fp
        LEFT JOIN eduall_services srv_fee ON srv_fee.ed_service_id = fp.ed_fee_payment_service
        WHERE fp.ed_fee_payment_invoiceCode COLLATE utf8mb4_general_ci
            = sp.ed_service_payment_code COLLATE utf8mb4_general_ci
          AND COALESCE(fp.ed_fee_payment_deleted, 0) = 0
      ) AS fees
      
    FROM eduall_service_payments sp
    LEFT JOIN eduall_students st ON st.ed_student_id = sp.ed_service_payment_student_code
      AND COALESCE(st.ed_student_deleted, 0) = 0
    LEFT JOIN eduall_coins c ON c.ed_coin_institute_code = sp.ed_service_payment_institute_code
      AND COALESCE(c.ed_coin_deleted, 0) = 0
    
    WHERE COALESCE(sp.ed_service_payment_deleted, 0) = 0
      AND sp.ed_service_payment_institute_code = ?
    
    ORDER BY sp.ed_service_payment_registerDate DESC
  `; 
  
  const PARAMS = [instituteCode];
  
  try {
    const payments = await ExecuteQuery(null, query, PARAMS, true, {
      db: "eduall_service_payments",
      type: "select",
      data: req,
    });
    
    const processedPayments = payments.map(payment => {
      let items = typeof payment.items === 'string' 
        ? JSON.parse(payment.items || '[]') 
        : (Array.isArray(payment.items) ? payment.items : []);
      
      items = items || [];
        
      let fees = typeof payment.fees === 'string' 
        ? JSON.parse(payment.fees || '[]') 
        : (Array.isArray(payment.fees) ? payment.fees : []);
      
      fees = fees || [];
      
      const itemsTotal = items.reduce((sum, item) => sum + (parseFloat(item.total_price) || 0), 0);
      const feesTotal = fees.reduce((sum, fee) => sum + (parseFloat(fee.price) || 0), 0);
      const totalAmount = itemsTotal + feesTotal;
      
      return {
        ...payment,
        items,
        fees,
        _summary: {
          itemsCount: items.length,
          itemsTotal: Number(itemsTotal.toFixed(2)),
          feesCount: fees.length,
          feesTotal: Number(feesTotal.toFixed(2)),
          totalAmount: Number(totalAmount.toFixed(2)),
          hasDeletedItems: items.some(i => i.deleted === 1),
          hasDeletedFees: fees.some(f => f.deleted === 1),
          isPaymentDeleted: payment.ed_service_payment_deleted === 1,
          isStudentDeleted: payment.ed_student_deleted === 1,
        }
      };
    });
    
    return processedPayments;
    
  } catch (error) {
    console.error('Erro ao buscar pagamentos de serviços:', error.message);
    throw error;
  }
};

/**
 * GET /api/servicepayments - Listar todos os pagamentos de serviço
 */
const GetServicePayments = async (req, res) => {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        msg: "Sessão inválida.",
      });
    }

    console.log(`\n[GetServicePayments] Listando pagamentos para institute ${instituteCode}...`);
    const startTime = Date.now();

    const rows = await FetchServicePayments(req, instituteCode);

    const duration = Date.now() - startTime;
    console.log(`Encontrados ${rows?.length || 0} pagamento(s)`);
    console.log(`BASE DE DADOS -> GetServicePayments demorou ${duration}ms\n`);
 
    const safeData = JSON.parse(JSON.stringify(rows || []));

    return res.status(200).json({
      success: true,
      data: safeData,
      count: safeData.length,
    });
  } catch (error) {
    console.error(`[GetServicePayments] Erro:`, error.message);
    console.error(`Stack:`, error.stack);
    return res.status(500).json({
      success: false,
      msg: "Erro ao buscar pagamentos de serviços",
      error: error.message,
    });
  }
};

/**
 * GET /api/servicepayments/:ID - Buscar pagamento específico
 */
const GetSingleServicePayment = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[GetSingleServicePayment] Buscando pagamento ID ${ID}...`);
    const startTime = Date.now();

    const query = `
      SELECT 
        sp.*,
        st.ed_student_name,
        st.ed_student_code,
        st.ed_student_class,
        st.ed_student_picture,
        c.ed_coin_code,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', spi.ed_service_payment_item_id,
              'service_id', spi.ed_service_id,
              'service_title', srv.ed_service_title,
              'service_type', srv.ed_service_type,
              'quantity', spi.ed_service_quantity,
              'unit_price', spi.ed_service_unit_price,
              'discount_percent', spi.ed_service_discount_percent,
              'total_price', (spi.ed_service_unit_price * spi.ed_service_quantity) - 
                            ((spi.ed_service_unit_price * spi.ed_service_quantity * spi.ed_service_discount_percent) / 100),
              'is_matricula', spi.ed_service_is_matricula,
              'is_confirmation', spi.ed_service_is_confirmation
            )
          )
          FROM eduall_service_payment_items spi
          LEFT JOIN eduall_services srv ON srv.ed_service_id = spi.ed_service_id
          WHERE spi.ed_service_payment_code COLLATE utf8mb4_general_ci
              = sp.ed_service_payment_code COLLATE utf8mb4_general_ci
            AND COALESCE(spi.ed_service_payment_item_deleted, 0) = 0
        ) AS items,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', fp.ed_fee_payment_id,
              'month', fp.ed_fee_payment_month,
              'month_name', ELT(fp.ed_fee_payment_month, 
                'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'),
              'service_id', fp.ed_fee_payment_service,
              'service_title', srv_fee.ed_service_title,
              'price', IF(fp.ed_fee_payment_price > 0, fp.ed_fee_payment_price, NULL),
              'invoice_code', fp.ed_fee_payment_invoiceCode
            )
          )
          FROM eduall_fees_payments fp
          LEFT JOIN eduall_services srv_fee ON srv_fee.ed_service_id = fp.ed_fee_payment_service
          WHERE fp.ed_fee_payment_invoiceCode COLLATE utf8mb4_general_ci
              = sp.ed_service_payment_code COLLATE utf8mb4_general_ci
            AND COALESCE(fp.ed_fee_payment_deleted, 0) = 0
        ) AS fees
      FROM eduall_service_payments sp
      LEFT JOIN eduall_students st ON st.ed_student_id = sp.ed_service_payment_student_code
      LEFT JOIN eduall_coins c ON c.ed_coin_institute_code = ?
      WHERE COALESCE(sp.ed_service_payment_deleted, 0) = 0
        AND sp.ed_service_payment_id = ?
        AND sp.ed_service_payment_institute_code = ?
    `;

    const PARAMS = [instituteCode, ID, instituteCode];
    const rows = await ExecuteQuery(null, query, PARAMS, true, {
      db: "eduall_service_payments",
      type: "select",
      data: req,
    });

    const duration = Date.now() - startTime;
    console.log(`Pagamento encontrado`);
    console.log(`BASE DE DADOS -> GetSingleServicePayment demorou ${duration}ms\n`);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Pagamento não encontrado.",
      });
    }

    const safeData = JSON.parse(JSON.stringify(rows[0]));

    return res.status(200).json({
      success: true,
      data: safeData,
    });
  } catch (error) {
    console.error(`[GetSingleServicePayment] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

/**
 * GET /api/servicepayments/student/:STUDENTID - Pagamentos de um aluno
 */
const GetStudentServicePayments = async (req, res) => {
  try {
    const { STUDENTID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[GetStudentServicePayments] Buscando pagamentos do aluno ${STUDENTID}...`);
    const startTime = Date.now();

    const query = `
      SELECT 
        sp.*,
        st.ed_student_name,
        st.ed_student_code,
        st.ed_student_picture,
        c.ed_coin_code,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'service_id', spi.ed_service_id,
              'quantity', spi.ed_service_quantity,
              'unit_price', spi.ed_service_unit_price,
              'discount', spi.ed_service_discount_percent
            )
          )
          FROM eduall_service_payment_items spi
          WHERE spi.ed_service_payment_code COLLATE utf8mb4_general_ci
              = sp.ed_service_payment_code COLLATE utf8mb4_general_ci
        ) AS items
      FROM eduall_service_payments sp
      LEFT JOIN eduall_students st ON st.ed_student_id = sp.ed_service_payment_student_code
      LEFT JOIN eduall_coins c ON c.ed_coin_institute_code = ?
      WHERE COALESCE(sp.ed_service_payment_deleted, 0) = 0
        AND sp.ed_service_payment_student_code = ?
        AND sp.ed_service_payment_institute_code = ?
      ORDER BY sp.ed_service_payment_registerDate DESC
    `;

    const PARAMS = [instituteCode, STUDENTID, instituteCode];
    const rows = await ExecuteQuery(null, query, PARAMS, true, {
      db: "eduall_service_payments",
      type: "select",
      data: req,
    });

    const duration = Date.now() - startTime;
    console.log(`Encontrados ${rows?.length || 0} pagamento(s) do aluno`);
    console.log(`BASE DE DADOS -> GetStudentServicePayments demorou ${duration}ms\n`);

    const safeData = JSON.parse(JSON.stringify(rows || []));

    return res.status(200).json({
      success: true,
      data: safeData,
      count: safeData.length,
    });
  } catch (error) {
    console.error(`[GetStudentServicePayments] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// POST - REGISTAR PAGAMENTO DE SERVIÇO (VERSÃO FINAL COM PREÇO HISTÓRICO)
// ════════════════════════════════════════════════════════════════════════════════
 


const formatMonthsList = (months) => {
  if (!months || !Array.isArray(months) || months.length === 0) {
    return "";
  }
 
  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
 
  const formatSingleMonth = (monthStr) => {
    const str = String(monthStr).trim();
    
    // Padrão 1: "0.2025" ou "0.20252026" (sem espaço entre anos)
    let match = str.match(/^(\d+)\.(\d{4})(?:\s*(\d{4}))?$/);
    if (match) {
      const monthIndex = parseInt(match[1], 10);
      const yearStart = match[2];
      if (monthIndex >= 0 && monthIndex <= 11) {
        return `${monthNames[monthIndex]} de ${yearStart}`;
      }
    }
 
    // Padrão 2: "0-2025-2026"
    match = str.match(/^(\d+)-(\d{4})-(\d{4})$/);
    if (match) {
      const monthIndex = parseInt(match[1], 10);
      const yearStart = match[2];
      if (monthIndex >= 0 && monthIndex <= 11) {
        return `${monthNames[monthIndex]} de ${yearStart}`;
      }
    }
 
    // Padrão 3: "0 2025" (com espaço)
    match = str.match(/^(\d+)\s+(\d{4})$/);
    if (match) {
      const monthIndex = parseInt(match[1], 10);
      const yearStart = match[2];
      if (monthIndex >= 0 && monthIndex <= 11) {
        return `${monthNames[monthIndex]} de ${yearStart}`;
      }
    }
 
    console.warn(`Formato de mês nao reconhecido: "${str}"`);
    return str;
  };
 
  const formatted = months.map(formatSingleMonth);
  return formatted.join(", ");
};
 
 
const buildDuplicateFeesErrorResponse = (dupFeesRows, formattedMonths) => {
  const monthNames = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
 
  const monthDetails = dupFeesRows.map((row) => {
    const str = String(row.month).trim();
    
    // Padrão 1: "0.2025" ou similar
    let match = str.match(/^(\d+)\.(\d{4})(?:\s*(\d{4}))?$/);
    if (match) {
      const monthIndex = parseInt(match[1], 10);
      const yearStart = match[2];
      return {
        raw: row.month,
        formatted: `${monthNames[monthIndex] || `Mes ${monthIndex}`} de ${yearStart}`,
      };
    }
 
    // Padrão 2: "0-2025-2026"
    match = str.match(/^(\d+)-(\d{4})-(\d{4})$/);
    if (match) {
      const monthIndex = parseInt(match[1], 10);
      const yearStart = match[2];
      return {
        raw: row.month,
        formatted: `${monthNames[monthIndex] || `Mes ${monthIndex}`} de ${yearStart}`,
      };
    }
 
    return {
      raw: row.month,
      formatted: row.month,
    };
  });
 
  return {
    statusCode: 409,
    body: {
      success: false,
      code: "DUPLICATE_MONTHS",
      message: `O aluno ja pagou a(s) seguinte(s) propina(s): ${formattedMonths}. Remova estes meses antes de continuar.`,
      details: {
        monthsPaid: monthDetails.map((d) => d.formatted),
        monthsPayedRaw: dupFeesRows.map((r) => r.month),
        count: dupFeesRows.length,
      },
      userMessage: `Propinas ja pagas: ${formattedMonths}`,
      action: "REMOVE_DUPLICATE_MONTHS",
    },
  };
};
 
// ─────────────────────────────────────────────────────────────────────────────
// CONTROLADOR PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────
 
 

 // ═══════════════════════════════════════════════════════════════════════════════
// ✅ NOVO: HELPER DE CAPACIDADE DE TURMA
//
// Verifica se uma turma já atingiu o limite máximo de alunos configurado em
// eduall_class.ed_class_student_limit. Se o limite for 0/NULL, a turma é
// considerada sem restrição de vagas.
//
// `excludeStudentId` permite ignorar o próprio aluno na contagem (útil em
// confirmações, quando o aluno já pertence à turma de origem e não deve
// contar contra o limite da turma de destino se, por algum motivo, já
// estivesse listado nela).
// ═══════════════════════════════════════════════════════════════════════════════
async function checkClassCapacity(res, classId, instituteCode, excludeStudentId = null) {
  const [classRow] = await ExecuteQuery(
    res,
    `SELECT ed_class_id, ed_class_title, ed_class_student_limit
     FROM eduall_class
     WHERE ed_class_id = ? AND ed_class_institute_code = ? AND COALESCE(ed_class_deleted, 0) = 0
     LIMIT 1`,
    [classId, instituteCode],
    true
  );

  if (!classRow) {
    return { exists: false, isFull: false, current: 0, limit: null, title: null };
  }

  const limit = Number(classRow.ed_class_student_limit);

  // Sem limite configurado (0, NULL ou não numérico) = turma sem restrição de vagas
  if (!Number.isFinite(limit) || limit <= 0) {
    return { exists: true, isFull: false, current: 0, limit: null, title: classRow.ed_class_title };
  }

  const excludeClause = excludeStudentId ? "AND ed_student_id != ?" : "";
  const params = excludeStudentId
    ? [classId, instituteCode, excludeStudentId]
    : [classId, instituteCode];

  const [countRow] = await ExecuteQuery(
    res,
    `SELECT COUNT(*) AS total
     FROM eduall_students
     WHERE ed_student_class = ?
       AND ed_student_institute_code = ?
       AND COALESCE(ed_student_deleted, 0) = 0
       ${excludeClause}`,
    params,
    true
  );

  const current = Number(countRow?.total || 0);

  return {
    exists: true,
    isFull: current >= limit,
    current,
    limit,
    title: classRow.ed_class_title,
  };
}

const RegisterServicePayment = async (req, res) => {
  const timerLabel = `RegisterServicePayment_${Date.now()}`;
  console.time(timerLabel);

  try {
    const sessionInstitute = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    console.log("\n" + "=".repeat(90));
    console.log("REGISTAR PAGAMENTO DE SERVICO");
    console.log("=".repeat(90));
    console.log(`Instituto: ${sessionInstitute}`);
    console.log(`Operador: ID ${operatorId}`);

    if (!sessionInstitute) {
      return res.status(401).json({ success: false, msg: "Sessao invalida." });
    }

    // ✅ FIX: nome do operador buscado UMA ÚNICA VEZ aqui, em escopo de função,
    // para não ficar preso dentro do bloco do serviço customizado (era isso que
    // causava "ReferenceError: nome is not defined" mais abaixo, no INSERT do
    // pagamento, sempre que não havia nenhum serviço customizado no payload).
    let operatorName = "Desconhecido";
    try {
      const [operatorRow] = await ExecuteQuery(
        null,
        `SELECT u.ed_user_account_name
         FROM eduall_user_accounts u
         WHERE u.ed_user_account_id = ?
         LIMIT 1`,
        [operatorId],
        true
      );

      if (operatorRow && operatorRow.ed_user_account_name) {
        operatorName = operatorRow.ed_user_account_name;
      }
    } catch (opErr) {
      console.warn(`[OPERADOR] Falha ao obter nome do operador (a usar fallback):`, opErr.message || opErr);
    }
    console.log(`Operador (nome): ${operatorName}`);

    const {
      student_code: studentId,
      service_payment_type: paymentMethodIndex = "0",
      service_payment_bank: bankName = "",
      service_payment_place: paymentPlace = "",
      service_payment_reference: paymentReference = "",
      service_payment_receipt_number: receiptNumber = "",
      service_payment_observations: observations = "",
      balance_used = 0,
      service_payment_discount: discountPct = 0,
      services = [],
      has_matricula = false,
      matricula_class = null,
      matricula_service: matriculaServiceFromBody = null,
      has_confirmacao = false,
      confirmacao_class = null,
      confirmacao_service: confirmacaoServiceFromBody = null,
      alsofeepaymenet = false,
      feemonths = [],
      fee_service_code: feeServiceFromBody = null,
      // ✅ FIX: precisamos do ano letivo para gravar em eduall_fees_payments
      // (coluna ed_fee_payment_academic_year). Aceita tanto academic_year_id
      // como academicYearId, consoante o payload do frontend.
      academic_year_id: academicYearIdFromBody = null,
      academicYearId: academicYearIdCamel = null,
    } = req.body || {};

    const academicYearId = academicYearIdFromBody || academicYearIdCamel || null;

    const OTHER_SERVICE_ID = "OTHER_CUSTOM";

    // ✅ Helper: número positivo e finito, ou NaN caso contrário
    const toPositiveNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : NaN;
    };

    // NOVO (secção 23): a turma de matrícula deixou de ser obrigatória —
    // este helper trata "" / null / undefined / 0 / "0" como "sem turma",
    // tal como já é feito no frontend para o studentId.
    const isEmptyClassId = (value) =>
      value === null || value === undefined || value === '' || value === 0 || value === '0';

    const matriculaClassProvided = !isEmptyClassId(matricula_class);

    console.log("\n[VALIDACOES] Iniciando validacoes...");

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ VALIDAR CONSUMO DE SALDO
    // ═══════════════════════════════════════════════════════════════════════════════
    if (balance_used > 0) {
      console.log(`[SALDO] Balance Used: ${balance_used}`);

      if (!observations || !observations.includes("[SALDO CONSUMIDO")) {
        console.error("Consumo de saldo sem nota de descrição");
        return res.status(400).json({
          success: false,
          msg: "Consumo de saldo requer nota de descrição automatica.",
          error: "MISSING_BALANCE_CONSUMED_NOTE"
        });
      }

      console.log(`[SALDO] Nota de consumo validada`);
    }

    if (!studentId) {
      console.error("studentId ausente");
      return res.status(400).json({
        success: false,
        msg: "ID do aluno e obrigatorio.",
      });
    }

    if (!Array.isArray(services) || services.length === 0) {
      if (!has_matricula && !has_confirmacao && !alsofeepaymenet) {
        console.error("Nenhum servico selecionado");
        return res.status(400).json({
          success: false,
          msg: "Deve haver pelo menos um servico, matricula, confirmacao ou propina selecionado.",
        });
      }
    }

    console.log(`Dados basicos validos | Aluno: ${studentId} | Servicos: ${services.length}`);

    if (has_matricula && has_confirmacao) {
      console.error("Matricula E Confirmacao simultaneas - NAO PERMITIDO");
      return res.status(400).json({
        success: false,
        msg: "Nao e permitido fazer matricula E confirmacao na mesma operacao.",
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ PROCESSAR SERVICOS CUSTOMIZADOS COM ON DUPLICATE KEY UPDATE
    // (preço do serviço customizado SEMPRE vem do frontend)
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("\n[SERVICOS] Processando servicos (incluindo customizados)...");

    const processedServices = [];

    for (const service of services) {
      const {
        code,
        amount = 1,
        price,
        unit_price,
        discount = discountPct,
        service_name,
        isEnrollmentService = false,
        isConfirmationService = false,
        isFeeService = false,
        is_enrollment = 0,
        is_confirmation = 0,
      } = service;

      // ✅ Preço enviado pelo frontend (unit_price tem prioridade, price é fallback)
      const rawPrice = unit_price ?? price;

      if (code === OTHER_SERVICE_ID) {
        console.log(`[CUSTOM] Detectado serviço customizado: "${service_name}" | Preço enviado: ${rawPrice}`);

        // ✅ VALIDAR
        if (!service_name || !service_name.trim()) {
          return res.status(400).json({
            success: false,
            msg: "Serviço customizado requer nome/descrição.",
          });
        }

        const customPrice = toPositiveNumber(rawPrice);
        if (!customPrice || customPrice <= 0) {
          console.error(`❌ Serviço customizado com preço zerado/inválido: ${rawPrice}`);
          return res.status(400).json({
            success: false,
            msg: "Serviço customizado requer preço válido (maior que zero).",
            error: "ZERO_OR_INVALID_PRICE"
          });
        }

        try {
          // ✅ USAR ON DUPLICATE KEY UPDATE
          const upsertQuery = `
            INSERT INTO eduall_services (
              ed_service_title,
              ed_service_type,
              ed_service_price,
              ed_service_provider,
              ed_service_institute_code,
              ed_service_registerDate
            ) VALUES (?, ?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
              ed_service_price = VALUES(ed_service_price),
              ed_service_provider = VALUES(ed_service_provider)
          `;

          console.log(`[CUSTOM] Executando UPSERT...`);

          // ✅ FIX: já não voltamos a chamar getOperatorData aqui — usamos o
          // "operatorName" já resolvido no topo da função.
          await ExecuteQuery(
            null,
            upsertQuery,
            [
              service_name.trim(),
              "custom",
              customPrice,
              `${operatorName}`,
              sessionInstitute,
            ],
            false
          );

          // ✅ RECUPERAR ID
          const [serviceResult] = await ExecuteQuery(
            null,
            `SELECT ed_service_id FROM eduall_services 
             WHERE ed_service_title = ? 
             AND ed_service_institute_code = ? 
             AND COALESCE(ed_service_deleted, 0) = 0
             LIMIT 1`,
            [service_name.trim(), sessionInstitute],
            true
          );

          if (!serviceResult || !serviceResult.ed_service_id) {
            throw new Error(`Falha ao recuperar ID do serviço: ${service_name}`);
          }

          const customServiceId = serviceResult.ed_service_id;
          console.log(`[CUSTOM] ✓ Serviço garantido | ID: ${customServiceId}`);

          processedServices.push({
            code: customServiceId,
            amount,
            price: customPrice,          // ✅ PRECO DO FRONTEND
            discount,
            service_name,
            isEnrollmentService: false,
            isConfirmationService: false,
            isFeeService: false,
          });

        } catch (err) {
          console.error(`[CUSTOM] Erro:`, err.message);
          return res.status(400).json({
            success: false,
            msg: err.message || "Erro ao processar serviço customizado.",
          });
        }

      } else {
        // ✅ SERVICO NORMAL - preço também vem do frontend
        processedServices.push({
          code,
          amount,
          price: rawPrice,
          discount,
          service_name,
          isEnrollmentService: !!(isEnrollmentService || is_enrollment == 1 || is_enrollment === true),
          isConfirmationService: !!(isConfirmationService || is_confirmation == 1 || is_confirmation === true),
          isFeeService: !!isFeeService,
        });
      }
    }

    console.log(`[SERVICOS] ✓ ${processedServices.length} serviço(s) processado(s)`);

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ VALIDAR EXISTENCIA DOS SERVICOS NA BD E USAR PRECO ENVIADO PELO FRONTEND
    //    (a BD é usada apenas para confirmar que o serviço existe e pertence ao
    //    instituto, e para obter o título/tipo — NUNCA para sobrepor o preço)
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("\n[BUSCA DE DADOS] Confirmando existência dos serviços e usando preços do frontend...");

    const enrichedServices = [];

    for (const service of processedServices) {
      const { code, amount = 1, price, discount = discountPct } = service;

      console.log(`[BUSCA] Confirmando serviço ID: ${code}`);

      const [serviceData] = await ExecuteQuery(
        null,
        `SELECT 
          ed_service_id,
          ed_service_title,
          ed_service_type
         FROM eduall_services 
         WHERE ed_service_id = ? 
         AND ed_service_institute_code = ? 
         AND COALESCE(ed_service_deleted,0)=0 
         LIMIT 1`,
        [code, sessionInstitute],
        true
      );

      if (!serviceData) {
        console.error(`Servico ${code} nao encontrado`);
        return res.status(404).json({
          success: false,
          msg: `Servico ${code} nao encontrado na base de dados.`,
        });
      }

      const amountVal = Math.max(1, parseFloat(amount) || 1);
      const serviceName = serviceData.ed_service_title || service.service_name || `Serviço ${code}`;

      // ✅ PRECO SEMPRE DO FRONTEND (payload), NUNCA DA BD
      const priceVal = toPositiveNumber(price);
      const discountVal = Math.max(0, parseFloat(discount) || 0);

      console.log(`[PRECO] ${serviceName} (ID: ${code}) | Preço frontend: ${priceVal}`);

      // ✅ NUNCA REGISTAR SERVICO COM VALOR ZERADO/INVALIDO
      if (!priceVal || priceVal <= 0) {
        console.error(`❌ PRECO INVALIDO/ZERADO: ${serviceName} (${code}) = ${price}`);
        return res.status(400).json({
          success: false,
          msg: `Serviço ${code} (${serviceName}) tem preço inválido ou zerado: ${price}`,
          error: "ZERO_OR_INVALID_PRICE"
        });
      }

      if (!Number.isFinite(amountVal) || amountVal <= 0) {
        console.error(`❌ QUANTIDADE INVALIDA: ${serviceName} (${code}) = ${amount}`);
        return res.status(400).json({
          success: false,
          msg: `Serviço ${code} (${serviceName}) tem quantidade inválida: ${amount}`,
        });
      }

      const subtotal = priceVal * amountVal;
      const discountAmount = (subtotal * discountVal) / 100;
      const lineTotal = subtotal - discountAmount;

      // ✅ NUNCA REGISTAR LINHA COM TOTAL ZERADO (ex.: desconto de 100%)
      if (!lineTotal || lineTotal <= 0) {
        console.error(`❌ TOTAL DA LINHA ZERADO/INVALIDO: ${serviceName} (${code}) = ${lineTotal}`);
        return res.status(400).json({
          success: false,
          msg: `Serviço ${code} (${serviceName}) resulta num total zerado após desconto.`,
          error: "ZERO_LINE_TOTAL"
        });
      }

      enrichedServices.push({
        code,
        title: serviceName,
        type: serviceData.ed_service_type,
        amountVal,
        priceVal,                                  // ✅ DO FRONTEND
        discountVal,
        discountAmount,
        subtotal,
        lineTotal,
        isEnrollmentService: service.isEnrollmentService,
        isConfirmationService: service.isConfirmationService,
        isFeeService: service.isFeeService,
      });

      console.log(`  ✓ ${serviceName} (ID: ${code}) | Preço: ${priceVal} | Qtd: ${amountVal} | Total: ${lineTotal}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ SEPARAR SERVICOS ESPECIAIS (MATRICULA / CONFIRMACAO / PROPINA) DOS REGULARES
    // ═══════════════════════════════════════════════════════════════════════════════
    const matriculaEntry = enrichedServices.find(s => s.isEnrollmentService);
    const confirmacaoEntry = enrichedServices.find(s => s.isConfirmationService);
    const feeEntry = enrichedServices.find(s => s.isFeeService);

    const regularServices = enrichedServices.filter(
      s => !s.isEnrollmentService && !s.isConfirmationService && !s.isFeeService
    );

    const matricula_service = matriculaServiceFromBody || matriculaEntry?.code || null;
    const confirmacao_service = confirmacaoServiceFromBody || confirmacaoEntry?.code || null;
    const fee_service_code = feeServiceFromBody || feeEntry?.code || null;

    if (has_matricula && !matriculaEntry) {
      console.error("has_matricula=true mas nenhum serviço de matrícula foi enviado em services[]");
      return res.status(400).json({
        success: false,
        msg: "Serviço de matrícula não foi enviado corretamente.",
      });
    }

    if (has_confirmacao && !confirmacaoEntry) {
      console.error("has_confirmacao=true mas nenhum serviço de confirmação foi enviado em services[]");
      return res.status(400).json({
        success: false,
        msg: "Serviço de confirmação não foi enviado corretamente.",
      });
    }

    if (alsofeepaymenet && feemonths?.length > 0 && !feeEntry) {
      console.error("alsofeepaymenet=true mas nenhum serviço de propina foi enviado em services[]");
      return res.status(400).json({
        success: false,
        msg: "Serviço de propina não foi enviado corretamente.",
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ VALIDACOES DE TURMAS (existência + capacidade/vagas)
    //
    // NOVO (secção 23 — TURMA DE MATRÍCULA OPCIONAL):
    //   A validação de existência da turma de matrícula só corre quando uma
    //   turma foi de facto enviada (`matriculaClassProvided`). Sem turma, não
    //   há nada para validar aqui — a matrícula prossegue.
    //
    // ✅ NOVO — VALIDAÇÃO DE CAPACIDADE (VAGAS):
    //   Além de confirmar que a turma existe, agora também confirmamos que
    //   ainda há vagas disponíveis (com base em eduall_class.ed_class_student_limit
    //   vs. contagem actual de alunos na turma). Aplica-se tanto à matrícula
    //   (quando uma turma é fornecida) como à confirmação (turma sempre
    //   obrigatória). Esta é apenas a checagem "de fora da transação" — ela é
    //   REPETIDA dentro da transação, logo antes do UPDATE que efetivamente
    //   move o aluno para a turma, para proteger contra pedidos concorrentes.
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("\n[VALIDACOES] Validando turmas...");

    if (has_matricula && matriculaClassProvided) {
      const [classExists] = await ExecuteQuery(
        null,
        `SELECT ed_class_id FROM eduall_class WHERE ed_class_id = ? AND ed_class_institute_code = ? LIMIT 1`,
        [matricula_class, sessionInstitute],
        true
      );

      if (!classExists) {
        return res.status(400).json({
          success: false,
          msg: `Turma de matricula ${matricula_class} nao existe.`,
        });
      }

      // ✅ NOVO: validar limite de vagas da turma de matrícula
      const matriculaCapacity = await checkClassCapacity(res, matricula_class, sessionInstitute, studentId);
      console.log(`[TURMA][VAGAS] Matrícula | Turma: ${matriculaCapacity.title || matricula_class} | Ocupação: ${matriculaCapacity.current}/${matriculaCapacity.limit ?? "∞"}`);

      if (matriculaCapacity.isFull) {
        console.error(`❌ TURMA DE MATRICULA LOTADA: ${matriculaCapacity.title || matricula_class}`);
        return res.status(409).json({
          success: false,
          msg: `A turma "${matriculaCapacity.title || matricula_class}" está lotada (${matriculaCapacity.current}/${matriculaCapacity.limit} alunos). Não é possível matricular mais alunos nesta turma.`,
          error: "CLASS_FULL",
          capacity: matriculaCapacity,
        });
      }
    } else if (has_matricula && !matriculaClassProvided) {
      console.log("[TURMA] Matrícula sem turma associada — turma é opcional, a prosseguir sem validação de turma.");
    }

    if (has_confirmacao) {
      const [classExists] = await ExecuteQuery(
        null,
        `SELECT ed_class_id FROM eduall_class WHERE ed_class_id = ? AND ed_class_institute_code = ? LIMIT 1`,
        [confirmacao_class, sessionInstitute],
        true
      );

      if (!classExists) {
        return res.status(400).json({
          success: false,
          msg: `Turma de confirmacao ${confirmacao_class} nao existe.`,
        });
      }

      // ✅ NOVO: validar limite de vagas da turma de confirmação
      // (exclui o próprio aluno da contagem, caso por algum motivo já conste
      // na turma de destino, para não penalizá-lo contra o próprio limite)
      const confirmacaoCapacity = await checkClassCapacity(res, confirmacao_class, sessionInstitute, studentId);
      console.log(`[TURMA][VAGAS] Confirmação | Turma: ${confirmacaoCapacity.title || confirmacao_class} | Ocupação: ${confirmacaoCapacity.current}/${confirmacaoCapacity.limit ?? "∞"}`);

      if (confirmacaoCapacity.isFull) {
        console.error(`❌ TURMA DE CONFIRMACAO LOTADA: ${confirmacaoCapacity.title || confirmacao_class}`);
        return res.status(409).json({
          success: false,
          msg: `A turma "${confirmacaoCapacity.title || confirmacao_class}" está lotada (${confirmacaoCapacity.current}/${confirmacaoCapacity.limit} alunos). Não é possível confirmar mais alunos nesta turma.`,
          error: "CLASS_FULL",
          capacity: confirmacaoCapacity,
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ VALIDAR METODO DE PAGAMENTO
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("[VALIDACOES] Validando metodo de pagamento...");

    const paymentMethods = await getPaymentMethods(req);
    if (!paymentMethods || paymentMethods.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "Nenhum metodo de pagamento configurado no sistema!",
        error: "NO_PAYMENT_METHODS"
      });
    }

    const selectedPaymentMethod = resolvePaymentMethod(Number(paymentMethodIndex), paymentMethods);
    if (!selectedPaymentMethod) {
      return res.status(400).json({
        success: false,
        msg: "Metodo de pagamento invalido!",
        error: "INVALID_PAYMENT_METHOD"
      });
    }

    console.log(`Metodo: ${selectedPaymentMethod.name}`);

    const needsBordereau = requiresBordereau(selectedPaymentMethod.name);
    if (needsBordereau && !paymentReference) {
      return res.status(400).json({
        success: false,
        msg: `O metodo "${selectedPaymentMethod.name}" requer numero de borderô/referencia.`,
      });
    }

    console.log("TODAS AS VALIDACOES CONCLUIDAS COM SUCESSO");
    console.log("\n[PROCESSAMENTO] Iniciando processamento...");

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ CALCULAR TOTAIS (tudo com base nos preços do frontend, já validados > 0)
    // ═══════════════════════════════════════════════════════════════════════════════
    let totalInvoiceValue = 0;

    for (const srv of enrichedServices) {
      totalInvoiceValue += srv.lineTotal;
    }

    const matriculaTotal = matriculaEntry?.lineTotal || 0;
    const matriculaServiceName = matriculaEntry?.title || "Serviço de Matrícula";

    const confirmacaoTotal = confirmacaoEntry?.lineTotal || 0;
    const confirmacaoServiceName = confirmacaoEntry?.title || "Serviço de Confirmação";

    const feesTotalValue = feeEntry?.lineTotal || 0;
    const feeServiceName = feeEntry?.title || "Serviço de Propinas";
    const feePricePerMonth = feeEntry?.priceVal || 0;

    if (has_matricula) {
      console.log(`[MATRICULA] Serviço: ${matriculaServiceName} | ID: ${matricula_service} | Turma: ${matriculaClassProvided ? matricula_class : "(nao fornecida)"} | Preço: ${matriculaTotal}`);
    }
    if (has_confirmacao) {
      console.log(`[CONFIRMACAO] Serviço: ${confirmacaoServiceName} | ID: ${confirmacao_service} | Preço: ${confirmacaoTotal}`);
    }
    if (alsofeepaymenet && feemonths?.length > 0) {
      console.log(`[PROPINAS] Serviço: ${feeServiceName} | ID: ${fee_service_code} | Preço/mês: ${feePricePerMonth} | Meses: ${feemonths.length} | Total: ${feesTotalValue}`);
    }

    // ✅ NUNCA REGISTAR PAGAMENTO COM VALOR TOTAL ZERADO
    if (!totalInvoiceValue || totalInvoiceValue <= 0) {
      console.error(`❌ VALOR TOTAL DA FATURA ZERADO/INVALIDO: ${totalInvoiceValue}`);
      return res.status(400).json({
        success: false,
        msg: "O valor total do pagamento não pode ser zero.",
        error: "ZERO_TOTAL_VALUE"
      });
    }

    console.log(`Total do pagamento: ${Number(totalInvoiceValue.toFixed(2))}`);

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ BUSCAR ALUNO E VALIDAR
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("[ALUNO] Buscando dados do aluno...");

    const [student] = await ExecuteQuery(
      null,
      `SELECT
        s.ed_student_id, s.ed_student_code, s.ed_student_name,
        s.ed_student_identityCard, s.ed_student_email, s.ed_student_address,
        s.ed_student_class, s.ed_student_enrolled, cls.ed_class_title
       FROM eduall_students s
       LEFT JOIN eduall_class cls ON cls.ed_class_id = s.ed_student_class AND COALESCE(cls.ed_class_deleted,0)=0
       WHERE s.ed_student_id = ? AND s.ed_student_institute_code = ? AND COALESCE(s.ed_student_deleted,0)=0
       LIMIT 1`,
      [studentId, sessionInstitute],
      true
    );

    if (!student) {
      console.error(`Aluno ${studentId} nao encontrado`);
      return res.status(404).json({
        success: false,
        msg: "Aluno nao encontrado.",
      });
    }

    console.log(`Aluno encontrado: ${student.ed_student_name} (${student.ed_student_code})`);

    // 🆕 ✅ VERIFICAR MATRICULA NA TABELA eduall_enrollment (TABELA CORRETA)
    //    (fonte de verdade para saber se o aluno já está matriculado)
    //    ⚠️ FIX: a tabela "eduall_student_enrollment" NAO EXISTE / esta errada.
    //    A tabela correta e "eduall_enrollment", cujo campo "ed_enrollment_student"
    //    e int(11) — por isso usamos o ID numerico do aluno (student.ed_student_id),
    //    e nao o codigo (ed_student_code) como se fazia antes.
    console.log("[MATRICULA] Verificando matrícula existente em eduall_enrollment...");

    const [existingEnrollment] = await ExecuteQuery(
      null,
      `SELECT ed_enrollment_id
       FROM eduall_enrollment
       WHERE ed_enrollment_deleted = 0
         AND ed_enrollment_student = ?
         AND ed_enrollment_institute_code = ?
       LIMIT 1`,
      [student.ed_student_id, sessionInstitute],
      true
    );

    if (has_matricula && existingEnrollment) {
      return res.status(409).json({
        success: false,
        msg: "Este aluno ja foi matriculado! Nao e possivel fazer nova matricula.",
        error: "ALREADY_ENROLLED"
      });
    }

    if (has_confirmacao && !existingEnrollment) {
      return res.status(409).json({
        success: false,
        msg: "Este aluno NAO foi matriculado ainda! Faca a matricula primeiro.",
        error: "NOT_ENROLLED"
      });
    }

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🆕 ✅ BUSCAR DADOS COMPLETOS DA TURMA (ciclo, sala, curso, ano letivo,
    //    nível académico, director) PARA ENRIQUECER A OBSERVAÇÃO DA FATURA
    //
    //    A turma "efetiva" para este pagamento é:
    //      - a turma de matrícula, se has_matricula E turma tiver sido fornecida
    //      - caso contrário (matrícula sem turma), a turma actual do aluno,
    //        se já existir uma (NOVO — secção 23)
    //      - a turma de confirmação, se has_confirmacao
    //      - caso contrário, a turma atual do aluno (student.ed_student_class)
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("\n[TURMA] Buscando dados completos da turma para a observação da fatura...");

    const classIdForObs = has_matricula
      ? (matriculaClassProvided ? matricula_class : student.ed_student_class)
      : (has_confirmacao ? confirmacao_class : student.ed_student_class);

    let classDetails = null;

    if (classIdForObs) {
      const [classRow] = await ExecuteQuery(
        null,
        `SELECT
            c.ed_class_id,
            c.ed_class_title,
            cr.ed_classroom_title,
            al.ed_academic_level_title,
            ci.ed_cicle_title,
            ay.ed_academic_year_title,
            ay.ed_academic_year_id,
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
        [classIdForObs, sessionInstitute],
        true
      );

      classDetails = classRow || null;

      if (classDetails) {
        console.log(`[TURMA] ✓ Turma: ${classDetails.ed_class_title} | Ciclo: ${classDetails.ed_cicle_title || "-"} | Curso: ${classDetails.ed_course_title || "-"} | Sala: ${classDetails.ed_classroom_title || "-"}`);
      } else {
        console.warn(`[TURMA] ⚠ Turma ${classIdForObs} não encontrada — observação seguirá sem dados de turma`);
      }
    } else {
      console.log("[TURMA] Sem turma associada a este pagamento — observação seguirá sem dados de turma");
    }

    // 🆕 Monta o bloco de texto com os dados da turma, UM CAMPO POR LINHA
    //    (só entram os campos que existirem / não forem null)
    const buildClassObsBlock = (cls) => {
      if (!cls) return "";

      const lines = [];
      if (cls.ed_class_title)            lines.push(`Turma: ${cls.ed_class_title}`);
      if (cls.ed_cicle_title)            lines.push(`Ciclo: ${cls.ed_cicle_title}`);
      if (cls.ed_academic_level_title)   lines.push(`Classe: ${cls.ed_academic_level_title}`);
      if (cls.ed_course_title)           lines.push(`Curso: ${cls.ed_course_title}`);
      if (cls.ed_classroom_title)        lines.push(`Sala: ${cls.ed_classroom_title}`);
      if (cls.ed_academic_year_title)    lines.push(`Ano Letivo: ${cls.ed_academic_year_title}`);

      return lines.length ? lines.join("\n") : "";
    };

    const classObsBlock = buildClassObsBlock(classDetails);

    // ✅ FIX: se o payload não trouxe academic_year_id, tentamos usar o ano
    // letivo resolvido a partir da turma (classDetails), para não gravarmos
    // NULL desnecessariamente na tabela de propinas.
    const resolvedAcademicYearId = academicYearId || classDetails?.ed_academic_year_id || null;

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ CRIAR FATURA VENDUS - COM TITLE E GROSS_PRICE (uma linha por cada serviço,
    //    incluindo matrícula/confirmação/propina, todos já em enrichedServices)
    //
    // 🆕 FIX: passamos TODOS os aliases de nome possíveis para preço e quantidade
    //    (price, unit_price, gross_price, value, amount_value, qty, quantity),
    //    porque não sabemos exatamente que chave a função VENDUS_CreateInvoiceCodeAndDoc
    //    lê internamente. Isto garante que, seja qual for o nome usado lá dentro,
    //    o valor correto (não undefined) estará disponível.
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("[VENDUS] Preparando linhas de fatura com title e gross_price...");

    const invoiceLines = enrichedServices.map((srv) => {
      let title = srv.title;
      if (srv.isFeeService) {
        title = `${srv.title} (${srv.amountVal} meses)`;
      }

      const unitPriceRounded = Number(srv.priceVal.toFixed(2));
      const qtyVal = srv.amountVal;
      const lineTotalRounded = Number(srv.lineTotal.toFixed(2));

      return {
        // Identificação
        code: srv.code,
        reference: String(srv.code),
        title,
        description: title,

        // 🆕 FIX: aliases de preço unitário — cobre price / unit_price / gross_price / value
        price: unitPriceRounded,
        unit_price: unitPriceRounded,
        gross_price: unitPriceRounded,
        value: unitPriceRounded,

        // 🆕 FIX: aliases de quantidade — cobre quantity / qty / amount
        quantity: qtyVal,
        qty: qtyVal,
        amount: qtyVal,

        // Desconto
        discount_percent: srv.discountVal,
        discount: srv.discountVal,
        discount_amount: Number(srv.discountAmount.toFixed(2)),

        // Total da linha
        line_total: lineTotalRounded,
        total: lineTotalRounded,
        gross_amount: lineTotalRounded,
      };
    });

    invoiceLines.forEach((line, i) => {
      console.log(`[VENDUS] ✓ ${line.title} | Qty: ${line.quantity} | Price: ${line.unit_price} | Total: ${line.line_total}`);
    });

    // ✅ VALIDAR LINHAS
    console.log("\n[VENDUS] Validando linhas de fatura...");
    for (let i = 0; i < invoiceLines.length; i++) {
      const line = invoiceLines[i];

      if (!line.title || line.title.trim() === "") {
        console.error(`[VENDUS] Linha ${i} sem title`);
        return res.status(400).json({
          success: false,
          msg: `Linha de fatura ${i} sem título.`,
        });
      }

      if (!Number.isFinite(line.gross_price) || line.gross_price <= 0) {
        console.error(`[VENDUS] Linha ${i} com gross_price inválido: ${line.gross_price}`);
        return res.status(400).json({
          success: false,
          msg: `Linha de fatura ${i} com preço inválido: ${line.gross_price}`,
        });
      }

      if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
        console.error(`[VENDUS] Linha ${i} com quantity inválida: ${line.quantity}`);
        return res.status(400).json({
          success: false,
          msg: `Linha de fatura ${i} com quantidade inválida: ${line.quantity}`,
        });
      }

      if (!Number.isFinite(line.line_total) || line.line_total <= 0) {
        console.error(`[VENDUS] Linha ${i} com line_total inválido: ${line.line_total}`);
        return res.status(400).json({
          success: false,
          msg: `Linha de fatura ${i} com total inválido: ${line.line_total}`,
        });
      }
    }

    console.log(`[VENDUS] ✓ Todas as ${invoiceLines.length} linhas validadas com sucesso`);

    const customer = {
      code: student.ed_student_code,
      name: student.ed_student_name,
      email: student.ed_student_email || "",
      address: student.ed_student_address || "",
      nif: student.ed_student_identityCard || "",
    };

    // 🆕 ✅ OBS ROBUSTA: junta a observação original (ou a mensagem por omissão) com
    //    o bloco de dados da turma (ciclo, curso, sala, ano letivo, etc.) e o
    //    nome do operador que registou o pagamento, cada campo numa linha própria.
    const baseObs = observations || `Pagamento do aluno ${student.ed_student_code}`;
    const operatorObsLine = `Operador: ${operatorName}`;

    const obs = [baseObs, classObsBlock, operatorObsLine]
      .filter(Boolean)
      .join("\n");

    console.log(`[OBS] Observação final enviada à fatura: ${obs}`);

    // 🆕 FIX: sanity-check final ANTES de chamar a Vendus — recalcula o total
    // a partir do próprio array invoiceLines e recusa avançar se detectar NaN.
    // Isto impede que um payload com "gross_price": null chegue à API da Vendus.
    const recomputedTotal = invoiceLines.reduce((acc, l) => acc + (Number(l.gross_price) * Number(l.quantity)), 0);
    console.log(`[VENDUS] 🆕 Sanity-check pré-envio | Total recomputado a partir de invoiceLines: ${recomputedTotal}`);

    if (!Number.isFinite(recomputedTotal) || recomputedTotal <= 0) {
      console.error(`[VENDUS] ❌ SANITY-CHECK FALHOU: total recomputado = ${recomputedTotal}`);
      console.error(`[VENDUS] invoiceLines enviado:`, JSON.stringify(invoiceLines, null, 2));
      return res.status(500).json({
        success: false,
        msg: "Erro interno: as linhas de fatura ficaram com valores inválidos antes do envio à Vendus. Pagamento NAO foi registado.",
        error: "INVALID_INVOICE_LINES_PRE_VENDUS",
        debugInvoiceLines: invoiceLines,
      });
    }

    let vendus;
    try {
      vendus = await VENDUS_CreateInvoiceCodeAndDoc(
        req,
        customer,
        invoiceLines,
        Number(paymentMethodIndex),
        obs
      );
    } catch (vendusErr) {
      console.error(`[VENDUS] ERRO:`, vendusErr.message || vendusErr);
      return res.status(500).json({
        success: false,
        msg: "Falha ao criar fatura Vendus. Pagamento NAO foi registado.",
        vendusError: vendusErr.message || String(vendusErr),
      });
    }

    if (!vendus || !vendus.number || !vendus.id) {
      return res.status(500).json({
        success: false,
        msg: "Resposta Vendus invalida. Pagamento NAO foi registado.",
      });
    }

    // 🆕 FIX: se a Vendus devolveu amount_gross/amount_net a "0.00" com um total > 0,
    // isso é sinal de que o payload ainda seguiu com valores nulos (mesmo depois do
    // sanity-check acima, poderia ser um bug diferente dentro da função Vendus).
    // Não bloqueamos o fluxo (a fatura já foi criada do lado da Vendus), mas avisamos.
    const vendusGross = Number(vendus.amount_gross);
    if (Number.isFinite(vendusGross) && vendusGross === 0 && totalInvoiceValue > 0) {
      console.warn(`⚠️ [VENDUS] ALERTA: fatura ${vendus.number} foi criada com amount_gross=0.00 mas o total esperado era ${totalInvoiceValue}. Verificar VENDUS_CreateInvoiceCodeAndDoc.`);
    }

    console.log(`Fatura criada: ${vendus.number}`);

    // ═══════════════════════════════════════════════════════════════════════════════
    // ✅ INICIAR TRANSACAO
    // ═══════════════════════════════════════════════════════════════════════════════
    console.log("\n[TRANSACAO] Iniciando transacao...");

    const paymentCode = `SP-${Date.now()}-${studentId}`;

    await ExecuteQuery(null, "START TRANSACTION", [], false);

    try {

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ NOVO — RECONFIRMAR CAPACIDADE DE TURMA DENTRO DA TRANSAÇÃO
      //
      // Protege contra condição de corrida: entre a validação inicial (antes
      // da criação da fatura Vendus) e este ponto, outro pedido concorrente
      // pode ter preenchido a última vaga da turma. Se isso aconteceu,
      // abortamos e revertemos ANTES de tocar em eduall_students/eduall_enrollment.
      //
      // Nota: a fatura Vendus já foi emitida neste ponto. Se a turma lotou
      // entretanto, o pagamento é abortado (rollback) e a fatura Vendus
      // fica "órfã" do lado do operador — o response deixa isso explícito
      // para que a equipa possa anular/cancelar a fatura manualmente.
      // ═════════════════════════════════════════════════════════════════════════════
      if (has_matricula && matriculaClassProvided) {
        const matriculaCapacityRecheck = await checkClassCapacity(res, matricula_class, sessionInstitute, studentId);
        if (matriculaCapacityRecheck.isFull) {
          throw Object.assign(
            new Error(`A turma "${matriculaCapacityRecheck.title || matricula_class}" ficou lotada enquanto este pagamento era processado (${matriculaCapacityRecheck.current}/${matriculaCapacityRecheck.limit}). Matrícula NAO foi registada.`),
            { code: "CLASS_FULL", vendusOrphan: true }
          );
        }
      }

      if (has_confirmacao) {
        const confirmacaoCapacityRecheck = await checkClassCapacity(res, confirmacao_class, sessionInstitute, studentId);
        if (confirmacaoCapacityRecheck.isFull) {
          throw Object.assign(
            new Error(`A turma "${confirmacaoCapacityRecheck.title || confirmacao_class}" ficou lotada enquanto este pagamento era processado (${confirmacaoCapacityRecheck.current}/${confirmacaoCapacityRecheck.limit}). Confirmação NAO foi registada.`),
            { code: "CLASS_FULL", vendusOrphan: true }
          );
        }
      }

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ REGISTAR PAGAMENTO DE SERVICO
      // ═════════════════════════════════════════════════════════════════════════════
      console.log("[BD] Registando pagamento de servico...");

      const insertPaymentQuery = `
        INSERT INTO eduall_service_payments (
          ed_service_payment_code,
          ed_service_payment_student_code,
          ed_service_payment_amount,
          ed_service_payment_discount,
          ed_service_payment_type,
          ed_service_payment_bank,
          ed_service_payment_place,
          ed_service_payment_reference,
          ed_service_payment_receipt_number,
          ed_service_payment_observations,
          ed_service_payment_balance_used,
          ed_service_payment_exchange,
          ed_service_payment_invoiceCode,
          ed_service_payment_file_code,
          ed_service_payment_has_matricula,
          ed_service_payment_has_confirmacao,
          ed_service_payment_new_class,
          ed_service_payment_includes_fees,
          ed_service_payment_fee_count,
          ed_service_payment_operator,
          ed_service_payment_operator_id,
          ed_service_payment_institute_code,
          ed_service_payment_registerDate
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW()
        )
      `;

      // NOVO (secção 23): se a matrícula não trouxer turma, `matricula_class`
      // é null/"" — o campo `ed_service_payment_new_class` fica então null,
      // tal como já acontecia quando não havia matrícula nem confirmação.
      const newClassForPayment = has_matricula
        ? (matriculaClassProvided ? matricula_class : null)
        : (has_confirmacao ? confirmacao_class : null);

      await ExecuteQuery(null, insertPaymentQuery, [
        paymentCode,
        studentId,
        enrichedServices.length,
        discountPct,
        selectedPaymentMethod.vendus_id,
        bankName || null,
        paymentPlace || null,
        paymentReference || null,
        receiptNumber || null,
        obs,
        balance_used || 0,
        0,
        vendus.number,
        vendus.id,
        has_matricula ? 1 : 0,
        has_confirmacao ? 1 : 0,
        newClassForPayment || null,
        alsofeepaymenet ? 1 : 0,
        feemonths?.length || 0,
        // ✅ FIX: usa a variável de escopo de função, já não a `nome` inexistente
        `${operatorName}`,
        operatorId || null,
        sessionInstitute,
      ], false, {
        db: "eduall_service_payments",
        type: "insert",
        data: req,
      });

      console.log(`Pagamento registado: ${paymentCode}`);

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ REGISTAR ITENS DE SERVICO (apenas serviços regulares/customizados,
      //    matrícula/confirmação/propina têm o seu próprio fluxo abaixo)
      // ═════════════════════════════════════════════════════════════════════════════
      console.log("[BD] Registando itens de servico...");

      for (const srv of regularServices) {
        console.log(`[BD ITEM] Inserindo: code=${srv.code} | amount=${srv.amountVal} | price=${srv.priceVal} | discount=${srv.discountVal}`);

        await ExecuteQuery(null,
          `INSERT INTO eduall_service_payment_items (
            ed_service_payment_code,
            ed_service_id,
            ed_service_quantity,
            ed_service_unit_price,
            ed_service_discount_percent,
            ed_service_institute_code
          ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            paymentCode,
            srv.code,
            srv.amountVal,
            srv.priceVal,
            srv.discountVal,
            sessionInstitute,
          ], false,
          {
            db: "eduall_service_payment_items",
            type: "insert",
          });

        console.log(`[BD ITEM] ✓ Inserido com sucesso`);
      }

      console.log(`${regularServices.length} item(ns) regular(es) registado(s)`);

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ PROCESSAR MATRICULA
      //    ⚠️ FIX (mantido): grava em "eduall_enrollment" (tabela correta), usando
      //    "ed_enrollment_student" (int, ID do aluno) em vez de
      //    "ed_student_enrollment_studentcode" (tabela antiga/errada).
      //
      //    NOVO (secção 23 — TURMA DE MATRÍCULA OPCIONAL):
      //    `matricula_class` pode agora chegar como null/"" (turma não
      //    fornecida). Isso é gravado como `ed_enrollment_class = NULL` em
      //    `eduall_enrollment` (sem alteração ao endpoint/tabela). O impacto
      //    fica isolado à actualização do aluno, abaixo:
      //      - COM turma: comportamento inalterado — actualiza
      //        `ed_student_class` para a nova turma (guardando a turma
      //        anterior no histórico, se diferente) e marca `enrolled = 1`.
      //        A capacidade da turma já foi reconfirmada acima.
      //      - SEM turma: já NÃO actualizamos `ed_student_class` (evita
      //        apagar/anular a turma actual do aluno com NULL só porque a
      //        matrícula não especificou turma) — apenas marcamos
      //        `enrolled = 1`. O aluno fica matriculado e pode receber uma
      //        turma mais tarde (ex.: através de uma confirmação de
      //        matrícula, que continua a exigir turma).
      // ═════════════════════════════════════════════════════════════════════════════
      if (has_matricula) {
        console.log(`[BD] Registando matricula... (turma: ${matriculaClassProvided ? matricula_class : "nao fornecida"})`);

        await ExecuteQuery(
          null,
          `INSERT INTO eduall_enrollment(
            ed_enrollment_student,
            ed_enrollment_service,
            ed_enrollment_class,
            ed_enrollment_institute_code,
            ed_enrollment_paid_value,
            ed_enrollment_payment_method_id,
            ed_enrollment_payment_bank,
            ed_enrollment_payment_place,
            ed_enrollment_bordereau
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            student.ed_student_id,
            matricula_service,
            matriculaClassProvided ? matricula_class : null,
            sessionInstitute,
            matriculaTotal,
            selectedPaymentMethod.vendus_id,
            bankName || null,
            paymentPlace || null,
            paymentReference || null,
          ],
          false,
          { db: "eduall_enrollment", type: "insert", data: req }
        );

        if (matriculaClassProvided) {
          const currentClass = student.ed_student_class;
          const newClass = matricula_class;

          if (currentClass && currentClass !== newClass) {
            await ExecuteQuery(
              null,
              `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class)
               VALUES (?, ?)`,
              [studentId, currentClass],
              false
            );
            console.log(`Turma antiga registada no historico`);
          }

          await ExecuteQuery(
            null,
            `UPDATE eduall_students
             SET ed_student_class = ?, ed_student_enrolled = 1
             WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
            [newClass, studentId, sessionInstitute],
            false,
            {
              db: "eduall_students",
              type: "update",
              data: req,
            }
          );

          console.log("Aluno actualizado com matricula (com turma)");
        } else {
          // Turma não fornecida: marca o aluno como matriculado, mas não
          // mexe em ed_student_class (nem para NULL, nem para outro valor).
          await ExecuteQuery(
            null,
            `UPDATE eduall_students
             SET ed_student_enrolled = 1
             WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
            [studentId, sessionInstitute],
            false,
            {
              db: "eduall_students",
              type: "update",
              data: req,
            }
          );

          console.log("Aluno actualizado com matricula (sem turma — turma nao fornecida, ed_student_class mantido)");
        }
      }

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ PROCESSAR CONFIRMACAO
      //    (turma continua obrigatória na confirmação; capacidade já
      //    reconfirmada acima, dentro da transação)
      // ═════════════════════════════════════════════════════════════════════════════
      if (has_confirmacao) {
        console.log("[BD] Registando confirmacao...");

        const currentClass = student.ed_student_class;
        const newClass = confirmacao_class;

        if (currentClass && currentClass !== newClass) {
          await ExecuteQuery(
            null,
            `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class)
             VALUES (?, ?)`,
            [studentId, currentClass],
            false
          );
          console.log(`Turma anterior registada no historico`);
        }

        await ExecuteQuery(
          null,
          `UPDATE eduall_students
           SET ed_student_class = ?, ed_student_enrolled = 2
           WHERE ed_student_id = ? AND ed_student_institute_code = ?`,
          [newClass, studentId, sessionInstitute],
          false,
          {
            db: "eduall_students",
            type: "update",
            data: req,
          }
        );

        console.log("Aluno actualizado com confirmacao");
      }

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ PROCESSAR PROPINAS (preço por mês vem do frontend, já validado > 0)
      //
      // 🔧 FIX PRINCIPAL (mantido):
      // A query anterior usava as colunas "ed_fee_payment_amount" e
      // "ed_fee_payment_payment_code", que NAO EXISTEM na tabela
      // eduall_fees_payments (daí o erro "Unknown column 'ed_fee_payment_amount'
      // in 'INSERT INTO'"). O schema real (confirmado pelo INSERT usado em
      // RegisterFeepayment) usa "ed_fee_payment_price" para o valor da linha e
      // não tem coluna para o código do pagamento de serviço — em vez disso
      // guardamos a referência da fatura (ed_fee_payment_invoiceCode /
      // ed_fee_payment_invoiceFile) e o próprio código do pagamento de
      // propina (ed_fee_payment_code) fica a cargo do auto_increment/trigger
      // da tabela, tal como acontece no fluxo normal de propinas.
      // ═════════════════════════════════════════════════════════════════════════════
      if (alsofeepaymenet && feemonths?.length > 0) {
        console.log("[BD] Registando propinas...");

        for (const month of feemonths) {
          console.log(`[BD PROPINA] Inserindo: mes=${month} | servico=${fee_service_code} | preco=${feePricePerMonth}`);

          await ExecuteQuery(
            null,
            `INSERT INTO eduall_fees_payments(
              ed_fee_payment_student,
              ed_fee_payment_service,
              ed_fee_payment_price,
              ed_fee_payment_month,
              ed_fee_payment_discount,
              ed_fee_payment_type,
              ed_fee_payment_bank,
              ed_fee_payment_academic_year,
              ed_fee_payment_place,
              ed_fee_payment_balance,
              ed_fee_payment_bordereux,
              ed_fee_payment_invoiceCode,
              ed_fee_payment_invoiceFile,
              ed_fee_payment_institute_code,
              ed_fee_payment_operator,
              ed_fee_payment_operator_id,
              ed_fee_payment_observations
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              studentId,
              fee_service_code,
              feePricePerMonth,
              month,
              discountPct || 0,
              selectedPaymentMethod.vendus_id,
              bankName || null,
              resolvedAcademicYearId,
              paymentPlace || null,
              feePricePerMonth,
              paymentReference || null,
              vendus.number,
              vendus.id,
              sessionInstitute,
              operatorName,
              operatorId || null,
              `Pago via pagamento de serviço ${paymentCode}. ${obs}`,
            ],
            false,
            { db: "eduall_fees_payments", type: "insert", data: req }
          );

          console.log(`[BD PROPINA] ✓ Mês ${month} inserido com sucesso`);
        }

        console.log(`${feemonths.length} propina(s) registada(s)`);
      }

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ CONFIRMAR TRANSACAO
      // ═════════════════════════════════════════════════════════════════════════════
      await ExecuteQuery(null, "COMMIT", [], false);
      console.log("Transacao confirmada");

      // ═════════════════════════════════════════════════════════════════════════════
      // ✅ REGISTAR EM AUDITORIA
      // ═════════════════════════════════════════════════════════════════════════════
      if (balance_used > 0) {
        console.log(`[AUDITORIA] Registando consumo de saldo: ${balance_used}`);

        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Pagamento de Servicos",
          description: `Pagamento com consumo de saldo: ${balance_used} Kz. Aluno: ${student.ed_student_code}. Codigo: ${paymentCode}. Obs: ${obs.substring(0, 100)}`,
        });
      } else {
        await RegisterAuditAction({
          session: req.session,
          action: 1,
          form: "Pagamento de Servicos",
          description: `Registrou pagamento para aluno ${student.ed_student_code}. Codigo: ${paymentCode}. Fatura: ${vendus.number}.`,
        });
      }

      console.log("\n" + "=".repeat(90));
      console.log("PAGAMENTO REGISTADO COM SUCESSO");
      console.timeEnd(timerLabel);
      console.log("=".repeat(90) + "\n");

      return res.status(200).json({
        success: true,
        msg: "Pagamento registado com sucesso!",
        data: {
          paymentCode,
          services: enrichedServices.map((s, i) => ({
            index: i,
            code: s.code,
            title: s.title,
            amount: s.amountVal,
            price: s.priceVal,
            discount: s.discountVal,
            total: s.lineTotal,
          })),
          matricula: has_matricula ? {
            done: true,
            newClass: matriculaClassProvided ? matricula_class : null,
            amount: matriculaTotal
          } : null,
          confirmacao: has_confirmacao ? {
            done: true,
            newClass: confirmacao_class,
            amount: confirmacaoTotal
          } : null,
          // 🆕 Dados da turma que foram usados para compor a observação
          classInfo: classDetails ? {
            id: classDetails.ed_class_id,
            title: classDetails.ed_class_title,
            cicle: classDetails.ed_cicle_title,
            classe: classDetails.ed_academic_level_title,
            course: classDetails.ed_course_title,
            classroom: classDetails.ed_classroom_title,
            academicYear: classDetails.ed_academic_year_title,
          } : null,
          subtotal: Number((totalInvoiceValue - feesTotalValue).toFixed(2)),
          fees: feesTotalValue > 0 ? Number(feesTotalValue.toFixed(2)) : 0,
          total: Number(totalInvoiceValue.toFixed(2)),
          balanceUsed: balance_used > 0 ? Number(balance_used.toFixed(2)) : 0,
          observations: obs,
        },
        invoiceValue: Number(totalInvoiceValue.toFixed(2)),
        vendus: {
          number: vendus.number,
          id: vendus.id,
          output: vendus.output,
          source: vendus.source,
        },
        paymentMethod: {
          id: selectedPaymentMethod.vendus_id,
          name: selectedPaymentMethod.name,
        },
        operator: {
          id: operatorId,
          name: operatorName,
        },
        timestamp: new Date().toISOString(),
      });

    } catch (txErr) {
      await ExecuteQuery(null, "ROLLBACK", [], false);
      console.error(`[TRANSACAO] ERRO:`, txErr.message || txErr);

      // ✅ NOVO: resposta dedicada para o caso de a turma lotar durante o
      // processamento (fatura Vendus já emitida — sinalizamos isso ao cliente).
      if (txErr.code === "CLASS_FULL") {
        return res.status(409).json({
          success: false,
          msg: txErr.message,
          error: "CLASS_FULL",
          vendusOrphanInvoice: txErr.vendusOrphan ? { number: vendus?.number, id: vendus?.id } : null,
        });
      }

      throw txErr;
    }

  } catch (error) {
    console.error(`\n[ERRO GERAL]:`, error.message || error);
    console.error(`Stack:`, error.stack);
    console.log("=".repeat(90) + "\n");

    try {
      console.timeEnd(timerLabel);
    } catch (e) {
      // Ignore
    }

    return res.status(500).json({
      success: false,
      msg: "Erro ao processar o pagamento.",
      error: String(error.message || error),
    });
  }
};
 
 
 
 
// ════════════════════════════════════════════════════════════════════════════════
// ✅ HELPER FUNCTION: Obter Rótulo da Turma
// ════════════════════════════════════════════════════════════════════════════════
async function getClassLabel(classId, instituteCode) {
  if (!classId) return "Não definida";

  try {
    const [classData] = await ExecuteQuery(
      null,
      `SELECT ed_class_title FROM eduall_class 
       WHERE ed_class_id = ? AND ed_class_institute_code = ? 
       AND COALESCE(ed_class_deleted, 0) = 0 LIMIT 1`,
      [classId, instituteCode],
      true
    );

    return classData?.ed_class_title || `Turma ${classId}`;
  } catch (err) {
    console.warn(`Erro ao buscar rótulo da turma ${classId}:`, err.message);
    return `Turma ${classId}`;
  }
}

 
// ════════════════════════════════════════════════════════════════════════════════
// PUT - ATUALIZAR PAGAMENTO
// ════════════════════════════════════════════════════════════════════════════════

const ServicePaymentUpdate = async (req, res) => {
  try {
    const { PAYMENTID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[ServicePaymentUpdate] Atualizando pagamento ${PAYMENTID}...`);
    const startTime = Date.now();

    const updateFields = [];
    const updateValues = [];

    if (req.body.bankName !== undefined) {
      updateFields.push("ed_service_payment_bank = ?");
      updateValues.push(req.body.bankName || null);
    }
    if (req.body.paymentPlace !== undefined) {
      updateFields.push("ed_service_payment_place = ?");
      updateValues.push(req.body.paymentPlace || null);
    }
    if (req.body.observations !== undefined) {
      updateFields.push("ed_service_payment_observations = ?");
      updateValues.push(req.body.observations || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "Nenhum campo para atualizar.",
      });
    }

    updateValues.push(PAYMENTID);
    updateValues.push(instituteCode);

    const query = `
      UPDATE eduall_service_payments
      SET ${updateFields.join(", ")}
      WHERE ed_service_payment_id = ? AND ed_service_payment_institute_code = ?
    `;

    await ExecuteQuery(null, query, updateValues, false, {
      db: "eduall_service_payments",
      type: "update",
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Pagamentos de Serviços",
      description: `[ID ${operatorId}] Atualizou pagamento ${PAYMENTID}`,
    });

    const duration = Date.now() - startTime;
    console.log(`Pagamento atualizado (${duration}ms)`);

    return res.status(200).json({
      success: true,
      msg: "Pagamento atualizado com sucesso!",
      paymentId: PAYMENTID,
    });
  } catch (error) {
    console.error(`[ServicePaymentUpdate] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE - ELIMINAR PAGAMENTO
// ════════════════════════════════════════════════════════════════════════════════

const ServicePaymentDelete = async (req, res) => {
  try {
    const { PAYMENTID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[ServicePaymentDelete] Eliminando pagamento ${PAYMENTID}...`);
    const startTime = Date.now();

    await ExecuteQuery(
      null,
      `UPDATE eduall_service_payments
       SET ed_service_payment_deleted = 1
       WHERE ed_service_payment_id = ? AND ed_service_payment_institute_code = ?`,
      [PAYMENTID, instituteCode],
      false
    );

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Pagamentos de Serviços",
      description: `[ID ${operatorId}] Eliminou pagamento ${PAYMENTID}`,
    });

    const duration = Date.now() - startTime;
    console.log(`Pagamento eliminado (${duration}ms)`);

    return res.status(200).json({
      success: true,
      msg: "Pagamento eliminado com sucesso!",
    });
  } catch (error) {
    console.error(`[ServicePaymentDelete] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE - ELIMINAR SERVIÇO COM PAGAMENTOS E PROPINAS
// ════════════════════════════════════════════════════════════════════════════════

const DeleteServiceWithFees = async (req, res) => {
  try {
    const { SERVICEID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[DeleteServiceWithFees] Eliminando serviço ${SERVICEID}...`);
    const startTime = Date.now();

    const [paymentCount] = await ExecuteQuery(
      null,
      `SELECT COUNT(*) as cnt FROM eduall_service_payments
       WHERE ed_service_payment_id = ? AND ed_service_payment_institute_code = ? AND COALESCE(ed_service_payment_deleted,0)=0`,
      [SERVICEID, instituteCode],
      true
    );

    if (paymentCount?.cnt > 0) {
      await ExecuteQuery(
        null,
        `UPDATE eduall_service_payments
         SET ed_service_payment_deleted = 1
         WHERE ed_service_payment_id = ? AND ed_service_payment_institute_code = ?`,
        [SERVICEID, instituteCode],
        false
      );

      const [itemsCount] = await ExecuteQuery(
        null,
        `SELECT COUNT(*) as cnt FROM eduall_service_payment_items spi
         INNER JOIN eduall_service_payments sp
           ON spi.ed_service_payment_code COLLATE utf8mb4_general_ci
              = sp.ed_service_payment_code COLLATE utf8mb4_general_ci
         WHERE sp.ed_service_payment_id = ? AND COALESCE(spi.ed_service_payment_item_deleted,0)=0`,
        [SERVICEID],
        true
      );

      if (itemsCount?.cnt > 0) {
        await ExecuteQuery(
          null,
          `UPDATE eduall_service_payment_items spi
           INNER JOIN eduall_service_payments sp
             ON spi.ed_service_payment_code COLLATE utf8mb4_general_ci
                = sp.ed_service_payment_code COLLATE utf8mb4_general_ci
           SET spi.ed_service_payment_item_deleted = 1
           WHERE sp.ed_service_payment_id = ?`,
          [SERVICEID],
          false
        );
      }
    }

    const [feeCount] = await ExecuteQuery(
      null,
      `SELECT COUNT(*) as cnt FROM eduall_fees_payments
       WHERE ed_fee_payment_service = ? AND ed_fee_payment_institute_code = ?
         AND COALESCE(ed_fee_payment_deleted, 0) = 0`,
      [SERVICEID, instituteCode],
      true
    );

    if (feeCount?.cnt > 0) {
      await ExecuteQuery(
        null,
        `UPDATE eduall_fees_payments
         SET ed_fee_payment_deleted = 1
         WHERE ed_fee_payment_service = ? AND ed_fee_payment_institute_code = ?`,
        [SERVICEID, instituteCode],
        false
      );
    }

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Serviços",
      description: `[ID ${operatorId}] Eliminou ${paymentCount?.cnt || 0} pagamento(s) e ${feeCount?.cnt || 0} propina(s)`,
    });

    const duration = Date.now() - startTime;
    console.log(`Serviço eliminado (${duration}ms)`);

    return res.status(200).json({
      success: true,
      msg: "Pagamentos e propinas deletados com sucesso!",
      deleted: {
        serviceId: SERVICEID,
        paymentsDeleted: paymentCount?.cnt || 0,
        feesDeleted: feeCount?.cnt || 0,
      },
    });
  } catch (error) {
    console.error(`[DeleteServiceWithFees] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET - GERAR RECIBO COM DETALHES COMPLETOS
// ════════════════════════════════════════════════════════════════════════════════

const GenerateReceiptWithFees = async (req, res) => {
  try {
    const { PAYMENTCODE } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[GenerateReceiptWithFees] Gerando recibo para ${PAYMENTCODE}...`);
    const startTime = Date.now();

    const [payment] = await ExecuteQuery(
      null,
      `SELECT sp.*, st.ed_student_name, st.ed_student_code
       FROM eduall_service_payments sp
       LEFT JOIN eduall_students st ON st.ed_student_id = sp.ed_service_payment_student_code
       WHERE sp.ed_service_payment_code = ? AND sp.ed_service_payment_institute_code = ?
         AND COALESCE(sp.ed_service_payment_deleted, 0) = 0
       LIMIT 1`,
      [PAYMENTCODE, instituteCode],
      true
    );

    if (!payment) {
      console.error(`Pagamento ${PAYMENTCODE} não encontrado`);
      return res.status(404).json({
        success: false,
        msg: "Pagamento não encontrado.",
      });
    }

    const items = await ExecuteQuery(
      null,
      `SELECT spi.*, s.ed_service_title
       FROM eduall_service_payment_items spi
       LEFT JOIN eduall_services s ON s.ed_service_id = spi.ed_service_id
       WHERE spi.ed_service_payment_code = ?
         AND COALESCE(spi.ed_service_payment_item_deleted, 0) = 0`,
      [PAYMENTCODE],
      true
    );

    const fees = await ExecuteQuery(
      null,
      `SELECT * FROM eduall_fees_payments
       WHERE ed_fee_payment_invoiceCode = ? AND ed_fee_payment_institute_code = ?
         AND COALESCE(ed_fee_payment_deleted, 0) = 0
       ORDER BY ed_fee_payment_month ASC`,
      [PAYMENTCODE, instituteCode],
      true
    );

    const safeItems = Array.isArray(items) ? items : [];
    const safeFees = Array.isArray(fees) ? fees : [];

    let totalItems = 0;
    const itemsList = safeItems.map((item) => {
      const total = item.ed_service_quantity * item.ed_service_unit_price;
      totalItems += total;
      return {
        id: item.ed_service_payment_item_id,
        service: item.ed_service_title || "Serviço desconhecido",
        quantity: item.ed_service_quantity,
        unitPrice: Number(item.ed_service_unit_price),
        discount: item.ed_service_discount_percent || 0,
        total: Number(total.toFixed(2)),
      };
    });

    let totalFees = 0;
    const feesList = safeFees.map((fee) => {
      totalFees += fee.ed_fee_payment_price || 0;
      return {
        id: fee.ed_fee_payment_id,
        month: fee.ed_fee_payment_month,
        price: fee.ed_fee_payment_price !== null ? Number(fee.ed_fee_payment_price) : null,
        priceHistorical: fee.ed_fee_payment_price > 0 ? "Sim" : "Nao",
        status: "paid",
      };
    });

    const receipt = {
      success: true,
      receipt: {
        paymentCode: PAYMENTCODE,
        studentName: payment.ed_student_name || "-",
        studentCode: payment.ed_student_code || "-",
        paymentDate: payment.ed_service_payment_registerDate,
        paymentType: payment.ed_service_payment_type,
        bankName: payment.ed_service_payment_bank || "-",
        paymentPlace: payment.ed_service_payment_place || "-",
        reference: payment.ed_service_payment_reference || "-",
        receiptNumber: payment.ed_service_payment_receipt_number || "-",
        observations: payment.ed_service_payment_observations || "",
        items: itemsList,
        itemsTotal: Number(totalItems.toFixed(2)),
        fees: feesList,
        feesTotal: Number(totalFees.toFixed(2)),
        grandTotal: Number((totalItems + totalFees).toFixed(2)),
        hasMatricula: payment.ed_service_payment_has_matricula,
        hasConfirmacao: payment.ed_service_payment_has_confirmacao,
        newClass: payment.ed_service_payment_new_class || "-",
        feeCount: payment.ed_service_payment_fee_count,
      },
    };

    const duration = Date.now() - startTime;
    console.log(`Recibo gerado (${duration}ms)`);

    return res.status(200).json(receipt);
  } catch (error) {
    console.error(`[GenerateReceiptWithFees] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetServicePayments,
  GetSingleServicePayment,
  GetStudentServicePayments,
  GenerateReceiptWithFees,
  RegisterServicePayment,
  ServicePaymentUpdate,
  ServicePaymentDelete,
  DeleteServiceWithFees,
  FetchServicePayments,
  formatCurrency,
  isValidPrice,
  getOperatorData,
  getMonthName,
  getMonthNameFrom0Index,
  formatMonthsList,
  checkClassCapacity
};