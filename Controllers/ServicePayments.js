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
 
 
const RegisterServicePayment = async (req, res) => {
  const timerLabel = `RegisterServicePayment_${Date.now()}`;
  console.time(timerLabel);

  try {
    const sessionInstitute = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    console.log("\n" + "═".repeat(90));
    console.log("REGISTAR PAGAMENTO DE SERVIÇO - VERSÃO REFATORIZADA");
    console.log("═".repeat(90));
    console.log(`Instituto: ${sessionInstitute}`);
    console.log(`Operador: ID ${operatorId}`);

    if (!sessionInstitute) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    const {
      student_code: studentId,
      service_payment_type: paymentMethodIndex = "0",
      service_payment_bank: bankName = "",
      service_payment_place: paymentPlace = "",
      service_payment_reference: paymentReference = "",
      service_payment_receipt_number: receiptNumber = "",
      service_payment_observations: observations = "",
      service_payment_discount: discountPct = 0,
      service_payment_value_delivered: valueDelivered = 0,
      services = [],
      // ─── MATRÍCULA (CHECKBOX INDEPENDENTE) ──────────────────────────────
      has_matricula = false,
      matricula_class = null,
      // ─── CONFIRMAÇÃO (CHECKBOX INDEPENDENTE) ────────────────────────────
      has_confirmacao = false,
      confirmacao_class = null,
      // ─── PROPINAS ──────────────────────────────────────────────────────
      alsofeepaymenet = false,
      feemonths = [],
      fee_service_code = null,
    } = req.body || {};

    console.log("\n[1] Validando dados obrigatórios...");

    if (!studentId) {
      console.error("studentId ausente");
      return res.status(400).json({
        success: false,
        msg: "ID do aluno é obrigatório.",
      });
    }

    if (!Array.isArray(services) || services.length === 0) {
      if (!has_matricula && !has_confirmacao && !alsofeepaymenet) {
        console.error("Nenhum serviço, matrícula, confirmação ou propina selecionado");
        return res.status(400).json({
          success: false,
          msg: "Deve haver pelo menos um serviço, matrícula, confirmação ou propina selecionado.",
        });
      }
    }

    console.log(`Dados básicos válidos | Aluno: ${studentId} | Serviços regulares: ${services.length}`);

    // ─── VALIDAÇÃO CRÍTICA: Não permitir matrícula E confirmação simultâneas ─────
    if (has_matricula && has_confirmacao) {
      console.error("Matrícula E Confirmação simultâneas - NÃO PERMITIDO");
      return res.status(400).json({
        success: false,
        msg: "Não é permitido fazer matrícula E confirmação na mesma operação. Um aluno deve ser matriculado primeiro, depois confirmado.",
      });
    }

    // ─── VALIDAÇÃO: Turmas são obrigatórias se há matrícula ou confirmação ──────
    if ((has_matricula || has_confirmacao) && !matricula_class && !confirmacao_class) {
      console.error("Turma não especificada para matrícula/confirmação");
      return res.status(400).json({
        success: false,
        msg: "Turma é obrigatória para matrícula ou confirmação.",
      });
    }

    if (has_matricula && !matricula_class) {
      console.error("Turma não especificada para matrícula");
      return res.status(400).json({
        success: false,
        msg: "Turma é obrigatória para matrícula.",
      });
    }

    if (has_confirmacao && !confirmacao_class) {
      console.error("Turma não especificada para confirmação");
      return res.status(400).json({
        success: false,
        msg: "Turma é obrigatória para confirmação.",
      });
    }

    if (alsofeepaymenet && feemonths?.length > 0 && !fee_service_code) {
      console.error("Propinas sem serviço de propina");
      return res.status(400).json({
        success: false,
        msg: "Serviço de propina deve ser especificado.",
      });
    }

    // ───────────────────────────────────────────────────────────────────────────
    // [1.5] VALIDAÇÃO DE PROPINAS JÁ PAGAS
    // ───────────────────────────────────────────────────────────────────────────
    if (alsofeepaymenet && feemonths?.length > 0 && fee_service_code) {
      console.log("\n[1.5] Validando se o aluno já pagou alguma das propinas selecionadas...");

      const uniqueFeeMonths = [...new Set(feemonths)];
      const monthPlaceholders = uniqueFeeMonths.map(() => "?").join(",");

      const dupFeesRows = await ExecuteQuery(
        null,
        `SELECT ed_fee_payment_month AS month
         FROM eduall_fees_payments
         WHERE ed_fee_payment_institute_code = ?
           AND ed_fee_payment_student = ?
           AND ed_fee_payment_month IN (${monthPlaceholders})
           AND COALESCE(ed_fee_payment_deleted, 0) = 0
         GROUP BY ed_fee_payment_month`,
        [sessionInstitute, studentId, ...uniqueFeeMonths],
        true
      );

      if (dupFeesRows?.length) {
        const paidMonthsFormatted = formatMonthsList(dupFeesRows.map((r) => r.month));

        console.error(`Propinas já pagas detectadas: ${paidMonthsFormatted}`);
        console.log(`Meses em bruto: ${dupFeesRows.map((r) => r.month).join(", ")}`);
        console.log(`Contagem: ${dupFeesRows.length} propina(s)`);

        const errorResponse = buildDuplicateFeesErrorResponse(dupFeesRows, paidMonthsFormatted);

        return res.status(errorResponse.statusCode).json(errorResponse.body);
      }

      console.log(`Nenhuma propina duplicada encontrada - pode prosseguir.`);
    }

    // ───────────────────────────────────────────────────────────────────────────
    // [1.6] VERIFICAR SERVIÇOS CUSTOMIZADOS
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[1.6] Verificando serviços customizados...");

    const customServices = services.filter(s => s.isCustomService === true);
    if (customServices.length > 0) {
      console.log(`Encontrados ${customServices.length} serviço(s) customizado(s)`);

      const [defaultProvider] = await ExecuteQuery(
        null,
        `SELECT ed_provider_id FROM eduall_providers 
         WHERE ed_provider_institute_code = ? AND ed_provider_deleted = 0 
         LIMIT 1`,
        [sessionInstitute],
        true
      );

      const [defaultCoin] = await ExecuteQuery(
        null,
        `SELECT ed_coin_id FROM eduall_coins 
         WHERE ed_coin_institute_code = ? AND ed_coin_deleted = 0 
         LIMIT 1`,
        [sessionInstitute],
        true
      );

      if (!defaultProvider) {
        console.error("Nenhum fornecedor registado para a escola");
        return res.status(400).json({
          success: false,
          msg: "Nenhum fornecedor registado para esta escola. Registre um fornecedor primeiro.",
          error: "NO_PROVIDER"
        });
      }

      if (!defaultCoin) {
        console.error("Nenhuma moeda registada para a escola");
        return res.status(400).json({
          success: false,
          msg: "Nenhuma moeda registada para esta escola. Registre uma moeda primeiro.",
          error: "NO_COIN"
        });
      }

      for (const customSrv of customServices) {
        try {
          const insertCustomQuery = `
            INSERT INTO eduall_services (
              ed_service_title,
              ed_service_type,
              ed_service_provider,
              ed_service_price,
              ed_service_iva,
              ed_service_description,
              ed_service_coin,
              ed_service_is_matricula,
              ed_service_is_confirmation,
              ed_service_institute_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

          const insertCustomParams = [
            customSrv.service_name || "Serviço Customizado",
            "custom",
            defaultProvider.ed_provider_id,
            customSrv.price || 0,
            0,
            customSrv.service_name || "Serviço registado no pagamento",
            defaultCoin.ed_coin_id,
            0,
            0,
            sessionInstitute
          ];

          const serviceResult = await ExecuteQuery(
            null,
            insertCustomQuery,
            insertCustomParams,
            false,
            {
              db: "eduall_services",
              type: "insert",
              data: req,
            }
          );

          const generatedId = serviceResult?.insertId || serviceResult?.ed_service_id;

          if (!generatedId) {
            console.error(`Não foi gerado ID para serviço customizado: ${customSrv.service_name}`);
            return res.status(500).json({
              success: false,
              msg: `Falha ao obter ID do serviço customizado "${customSrv.service_name}".`,
              error: "NO_INSERT_ID"
            });
          }

          customSrv.code = generatedId;
          customSrv._registered = true;

          console.log(`Serviço customizado registado: "${customSrv.service_name}" (ID: ${customSrv.code})`);

          await RegisterAuditAction({
            session: req.session,
            action: 1,
            form: "Serviços - Customizado",
            description: `Registrou serviço customizado "${customSrv.service_name}" no pagamento do aluno ${studentId}. Preço: ${customSrv.price}.`,
          });

        } catch (customErr) {
          console.error(`Erro ao registar serviço customizado: ${customSrv.service_name}`);
          console.error(`Mensagem: ${customErr.message}`);
          return res.status(500).json({
            success: false,
            msg: `Falha ao registar o serviço customizado "${customSrv.service_name}".`,
            error: customErr.message,
          });
        }
      }
    }

    // ───────────────────────────────────────────────────────────────────────────
    // [2] RESOLVER MÉTODO DE PAGAMENTO
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[2] Resolvendo método de pagamento...");

    const paymentMethods = await getPaymentMethods(req);
    if (!paymentMethods || paymentMethods.length === 0) {
      console.error("Nenhum método de pagamento configurado!");
      return res.status(400).json({
        success: false,
        msg: "Nenhum método de pagamento configurado no sistema!",
        error: "NO_PAYMENT_METHODS"
      });
    }

    const selectedPaymentMethod = resolvePaymentMethod(Number(paymentMethodIndex), paymentMethods);
    if (!selectedPaymentMethod) {
      console.error(`Método de pagamento inválido: ${paymentMethodIndex}`);
      return res.status(400).json({
        success: false,
        msg: "Método de pagamento inválido!",
        error: "INVALID_PAYMENT_METHOD"
      });
    }

    console.log(`Método: ${selectedPaymentMethod.name} (ID Vendus: ${selectedPaymentMethod.vendus_id})`);

    const needsBordereau = requiresBordereau(selectedPaymentMethod.name);
    if (needsBordereau && !paymentReference) {
      console.error("Borderô obrigatório para este método");
      return res.status(400).json({
        success: false,
        msg: `O método "${selectedPaymentMethod.name}" requer número de borderô/referência.`,
      });
    }

    // ───────────────────────────────────────────────────────────────────────────
    // [3] BUSCAR DADOS DO ALUNO
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[3] Buscando aluno...");

    const [student] = await ExecuteQuery(
      null,
      `SELECT
        s.ed_student_id, s.ed_student_code, s.ed_student_name,
        s.ed_student_identityCard, s.ed_student_email, s.ed_student_address,
        s.ed_student_class, s.ed_student_enrolled, cls.ed_class_title, room.ed_classroom_title,
        crs.ed_course_title, ay.ed_academic_year_title
       FROM eduall_students s
       LEFT JOIN eduall_class cls ON cls.ed_class_id = s.ed_student_class AND COALESCE(cls.ed_class_deleted,0)=0
       LEFT JOIN eduall_classrooms room ON room.ed_classroom_id = cls.ed_class_room AND COALESCE(room.ed_classroom_deleted,0)=0
       LEFT JOIN eduall_courses crs ON crs.ed_course_id = cls.ed_class_course AND COALESCE(crs.ed_course_deleted,0)=0
       LEFT JOIN eduall_academic_year ay ON ay.ed_academic_year_id = cls.ed_class_year AND COALESCE(ay.ed_academic_year_deleted,0)=0
       WHERE s.ed_student_id = ? AND s.ed_student_institute_code = ? AND COALESCE(s.ed_student_deleted,0)=0
       LIMIT 1`,
      [studentId, sessionInstitute],
      true
    );

    if (!student) {
      console.error(`Aluno ${studentId} não encontrado`);
      return res.status(404).json({
        success: false,
        msg: "Aluno não encontrado.",
      });
    }

    console.log(`Aluno encontrado: ${student.ed_student_name} (${student.ed_student_code})`);
    console.log(`Estado de matrícula: ${student.ed_student_enrolled}`);
    console.log(`Turma atual: ${student.ed_student_class}`);

    // ─── VALIDAÇÃO DE MATRÍCULA/CONFIRMAÇÃO ────────────────────────────────
    if (has_matricula && student.ed_student_enrolled >= 1) {
      console.error(`Aluno ${studentId} já foi matriculado (enrolled: ${student.ed_student_enrolled})`);
      return res.status(409).json({
        success: false,
        msg: "Este aluno já foi matriculado! Não é possível fazer nova matrícula.",
        error: "ALREADY_ENROLLED"
      });
    }

    if (has_confirmacao && (!student.ed_student_enrolled || student.ed_student_enrolled < 1)) {
      console.error(`Aluno ${studentId} não foi matriculado (enrolled: ${student.ed_student_enrolled})`);
      return res.status(409).json({
        success: false,
        msg: "Este aluno NÃO foi matriculado ainda! Faça a matrícula primeiro.",
        error: "NOT_ENROLLED"
      });
    }

    // ─── VALIDAÇÃO: Confirmação não pode ser na mesma turma ──────────────────
    if (has_confirmacao && confirmacao_class && student.ed_student_class === confirmacao_class) {
      console.error(`Tentativa de confirmação na mesma turma ${confirmacao_class}`);
      return res.status(409).json({
        success: false,
        msg: "A confirmação de matrícula deve ser para uma turma DIFERENTE da atual. O aluno já está nesta turma.",
        error: "CONFIRMATION_SAME_CLASS"
      });
    }

    const [institute] = await ExecuteQuery(
      null,
      `SELECT ed_institute_name FROM eduall_institutes WHERE ed_institute_code=? LIMIT 1`,
      [sessionInstitute],
      true
    );
    const instituteName = institute?.ed_institute_name || "";

    // ───────────────────────────────────────────────────────────────────────────
    // [4] PROCESSAR SERVIÇOS E CALCULAR TOTAIS
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[4] Processando serviços e calculando totais...");

    let totalInvoiceValue = 0;
    const processedServices = [];

    // ─── SERVIÇOS REGULARES ────────────────────────────────────────────────────
    for (const service of services) {
      const { code, amount = 1, price, discount = discountPct, is_matricula, is_confirmation, isCustomService, service_name, label } = service;

      const amountVal = parseFloat(amount) || 1;
      const priceVal = parseFloat(price) || 0;
      const discountVal = parseFloat(discount) || 0;

      if (priceVal < 0) {
        console.error(`Preço inválido para serviço ${code}`);
        return res.status(400).json({
          success: false,
          msg: `Preço inválido para o serviço ${code}.`,
        });
      }

      let serviceName = service_name || label || null;

      if (!serviceName && !isCustomService) {
        try {
          const [serviceInfo] = await ExecuteQuery(
            null,
            `SELECT ed_service_title FROM eduall_services 
             WHERE ed_service_id = ? AND ed_service_institute_code = ? 
             AND COALESCE(ed_service_deleted,0)=0 LIMIT 1`,
            [code, sessionInstitute],
            true
          );

          if (serviceInfo) {
            serviceName = serviceInfo.ed_service_title;
            console.log(`Nome do serviço buscado da BD: "${serviceName}" (ID: ${code})`);
          }
        } catch (err) {
          console.warn(`Não foi possível buscar nome do serviço ${code} na BD`);
        }
      }

      serviceName = serviceName || String(code);

      const discountAmount = discountVal > 0 ? (priceVal * discountVal) / 100 : 0;
      const baseAfterDiscount = Math.max(0, priceVal - discountAmount);
      const lineTotal = baseAfterDiscount * amountVal;

      processedServices.push({
        code,
        name: serviceName,
        amount: amountVal,
        price: priceVal,
        discount: discountVal,
        discountAmount,
        baseAfterDiscount,
        lineTotal,
        is_matricula: is_matricula || 0,
        is_confirmation: is_confirmation || 0,
        isCustom: isCustomService || false,
      });

      totalInvoiceValue += lineTotal;

      const badge = isCustomService ? "NEW" : "OK";
      console.log(`${badge} ${serviceName} | Qtd: ${amountVal} | Preço: ${formatCurrency(priceVal)} | Total: ${formatCurrency(lineTotal)}`);
    }

    // ─── SERVIÇO DE MATRÍCULA ───────────────────────────────────────────────────
    let matriculaTotal = 0;
    if (has_matricula) {
      const matriculaService = services.find(s => s.isMatriculaService === true);
      if (matriculaService) {
        const matriculaPrice = parseFloat(matriculaService.price) || 0;
        matriculaTotal = matriculaPrice;
        totalInvoiceValue += matriculaTotal;
        console.log(`MATRÍCULA: ${formatCurrency(matriculaPrice)}`);
      }
    }

    // ─── SERVIÇO DE CONFIRMAÇÃO ────────────────────────────────────────────────
    let confirmacaoTotal = 0;
    if (has_confirmacao) {
      const confirmacaoService = services.find(s => s.isConfirmacaoService === true);
      if (confirmacaoService) {
        const confirmacaoPrice = parseFloat(confirmacaoService.price) || 0;
        confirmacaoTotal = confirmacaoPrice;
        totalInvoiceValue += confirmacaoTotal;
        console.log(`CONFIRMAÇÃO: ${formatCurrency(confirmacaoPrice)}`);
      }
    }

    // ─── PROPINAS ──────────────────────────────────────────────────────────────
    let feesTotalValue = 0;
    if (alsofeepaymenet && feemonths?.length > 0 && fee_service_code) {
      const [feeSrv] = await ExecuteQuery(
        null,
        `SELECT ed_service_id, ed_service_title, ed_service_price FROM eduall_services
         WHERE ed_service_id = ? AND ed_service_institute_code = ? AND COALESCE(ed_service_deleted,0)=0 LIMIT 1`,
        [fee_service_code, sessionInstitute],
        true
      );

      if (feeSrv) {
        const feePrice = parseFloat(feeSrv.ed_service_price) || 0;
        feesTotalValue = feePrice * feemonths.length;
        totalInvoiceValue += feesTotalValue;
        console.log(`Propinas: ${feemonths.length} mês(es) * ${formatCurrency(feePrice)} = ${formatCurrency(feesTotalValue)}`);
      }
    }

    console.log(`\nTOTAL: ${formatCurrency(totalInvoiceValue)}`);

    const [operatorUser] = await ExecuteQuery(
      null,
      `SELECT ed_user_account_name FROM eduall_user_accounts 
       WHERE ed_user_account_id = ? AND COALESCE(ed_user_account_deleted,0)=0 LIMIT 1`,
      [operatorId],
      true
    );

    const operatorName = operatorUser?.ed_user_account_name || `Operador ${operatorId}`;

    // ───────────────────────────────────────────────────────────────────────────
    // [5] CONSTRUIR OBSERVAÇÕES (COMPATÍVEL COM VENDUS)
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[5] Construindo observações...");

    // ✅ Determinar qual turma vai aparecer nas observações
    // A turma que aparece será a turma do payload (matricula_class ou confirmacao_class)
    // Esta será a turma FUTURA do aluno depois da operação
    const classForObservations = has_matricula ? matricula_class : (has_confirmacao ? confirmacao_class : student.ed_student_class);
    const classForObservationsLabel = await getClassLabel(classForObservations, sessionInstitute);

    const obsParts = [];
    obsParts.push(`Nº matrícula: ${student.ed_student_code || "-"}`);
    obsParts.push(`Turma (futura): ${classForObservationsLabel}`);
    if (student.ed_classroom_title) obsParts.push(`Sala: ${student.ed_classroom_title}`);
    if (student.ed_course_title) obsParts.push(`Curso: ${student.ed_course_title}`);
    if (student.ed_academic_year_title) obsParts.push(`Ano letivo: ${student.ed_academic_year_title}`);
    if (instituteName) obsParts.push(`Instituição: ${instituteName}`);
    obsParts.push(`Forma de pagamento: ${selectedPaymentMethod.name}`);

    if (has_matricula) obsParts.push(`[MATRÍCULA]`);
    if (has_confirmacao) obsParts.push(`[CONFIRMAÇÃO DE MATRÍCULA]`);

    if (processedServices.length > 0) {
      obsParts.push(`Serviços: ${processedServices.map(s => s.name).join(", ")}`);
    }
    if (alsofeepaymenet && feemonths?.length > 0) {
      const monthsFormatted = formatMonthsList(feemonths);
      obsParts.push(`Propinas: ${monthsFormatted}`);
    }
    if (observations) obsParts.push(`Observações: ${observations}`);
    obsParts.push(`Operador: ${operatorName}`);

    const obs = obsParts.join("\n");

    // ───────────────────────────────────────────────────────────────────────────
    // [6] PREPARAR DADOS PARA FATURA (VENDUS)
    // ───────────────────────────────────────────────────────────────────────────
    const customer = {
      name: student.ed_student_name || "",
      fiscal_id: student.ed_student_identityCard || "",
      address: student.ed_student_address || "",
      email: student.ed_student_email || "",
    };

    const invoiceLines = processedServices.map((srv) => ({
      itemcode: `EDSERV-${srv.code}`,
      title: srv.name || `Serviço ${srv.code}`,
      price: Number(srv.baseAfterDiscount.toFixed(2)),
      tax: 0,
      discount: srv.discount,
      quantity: String(srv.amount),
    }));

    // Adicionar linha de matrícula se aplicável
    if (has_matricula && matriculaTotal > 0) {
      invoiceLines.push({
        itemcode: `EDMAT-${studentId}`,
        title: `Matrícula`,
        price: Number(matriculaTotal.toFixed(2)),
        tax: 0,
        discount: 0,
        quantity: "1",
      });
    }

    // Adicionar linha de confirmação se aplicável
    if (has_confirmacao && confirmacaoTotal > 0) {
      invoiceLines.push({
        itemcode: `EDCONF-${studentId}`,
        title: `Confirmação de Matrícula`,
        price: Number(confirmacaoTotal.toFixed(2)),
        tax: 0,
        discount: 0,
        quantity: "1",
      });
    }

    if (feesTotalValue > 0 && alsofeepaymenet && fee_service_code) {
      const monthsFormatted = formatMonthsList(feemonths);

      invoiceLines.push({
        itemcode: `EDFEE-${fee_service_code}`,
        title: `Propinas (${monthsFormatted})`,
        price: Number((feesTotalValue / feemonths.length).toFixed(2)),
        tax: 0,
        discount: 0,
        quantity: String(feemonths.length),
      });
    }

    console.log("\nLinhas de fatura preparadas:");
    invoiceLines.forEach((line, idx) => {
      console.log(`[${idx + 1}] ${line.title} | Preço: ${line.price} | Qtd: ${line.quantity}`);
    });

    // ───────────────────────────────────────────────────────────────────────────
    // [7] CRIAR FATURA NO VENDUS
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[7] Criando fatura no Vendus...");
    const startVendusTime = Date.now();

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
        msg: "Falha ao criar fatura Vendus. Pagamento NÃO foi registado.",
        vendusError: vendusErr.message || String(vendusErr),
      });
    }

    if (!vendus || !vendus.number || !vendus.id) {
      console.error(`[VENDUS] Resposta inválida:`, JSON.stringify(vendus));
      return res.status(500).json({
        success: false,
        msg: "Resposta Vendus inválida. Pagamento NÃO foi registado.",
      });
    }

    const vendusTime = Date.now() - startVendusTime;
    console.log(`[VENDUS] Fatura criada com sucesso!`);
    console.log(`Número: ${vendus.number}`);
    console.log(`ID: ${vendus.id}`);
    console.log(`Valor: ${formatCurrency(totalInvoiceValue)}`);
    console.log(`PDF: ${vendus.output}`);
    console.log(`Tempo: ${vendusTime}ms`);

    // ───────────────────────────────────────────────────────────────────────────
    // [8] INICIAR TRANSAÇÃO DE BD
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[8] Iniciando transação de BD...");

    const paymentCode = `SP-${Date.now()}-${studentId}`;

    await ExecuteQuery(null, "START TRANSACTION", [], false);

    try {

      // ───────────────────────────────────────────────────────────────────────
      // INSERIR PAGAMENTO DE SERVIÇO
      // ───────────────────────────────────────────────────────────────────────
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
          ed_service_payment_value_delivered,
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

      const newClassForPayment = has_matricula ? matricula_class : (has_confirmacao ? confirmacao_class : null);

      const insertPaymentParams = [
        paymentCode,
        studentId,
        processedServices.length,
        discountPct,
        selectedPaymentMethod.vendus_id,
        bankName || null,
        paymentPlace || null,
        paymentReference || null,
        receiptNumber || null,
        obs,
        valueDelivered || 0,
        0,
        vendus.number,
        vendus.id,
        has_matricula ? 1 : 0,
        has_confirmacao ? 1 : 0,
        newClassForPayment || null,
        alsofeepaymenet ? 1 : 0,
        feemonths?.length || 0,
        `Operador ${operatorId}`,
        operatorId || null,
        sessionInstitute,
      ];

      await ExecuteQuery(null, insertPaymentQuery, insertPaymentParams, false, {
        db: "eduall_service_payments",
        type: "insert",
        data: req,
      });

      console.log(`Pagamento registado: ${paymentCode}`);

      // ───────────────────────────────────────────────────────────────────────
      // INSERIR ITENS DE SERVIÇO
      // ───────────────────────────────────────────────────────────────────────
      for (const srv of processedServices) {
        const itemQuery = `
          INSERT INTO eduall_service_payment_items (
            ed_service_payment_code,
            ed_service_id,
            ed_service_quantity,
            ed_service_unit_price,
            ed_service_discount_percent,
            ed_service_is_matricula,
            ed_service_is_confirmation,
            ed_service_institute_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const itemParams = [
          paymentCode,
          srv.code,
          srv.amount,
          srv.price,
          srv.discount,
          srv.is_matricula,
          srv.is_confirmation,
          sessionInstitute,
        ];

        await ExecuteQuery(null, itemQuery, itemParams, false, {
          db: "eduall_service_payment_items",
          type: "insert",
        });
      }

      console.log(`${processedServices.length} item(ns) de serviço registado(s)`);

      // ═══════════════════════════════════════════════════════════════════════════
      // ✅ PROCESSAR MATRÍCULA: Atualizar Turma do Aluno
      // ═══════════════════════════════════════════════════════════════════════════
      if (has_matricula && matricula_class) {
        console.log(`\n[MATRÍCULA] Processando matrícula para turma ${matricula_class}...`);

        const currentClass = student.ed_student_class;
        const newClass = matricula_class;

        console.log(`Turma atual: ${currentClass} | Turma nova: ${newClass}`);

        // ✅ Se as turmas são diferentes: registar a turma antiga no histórico
        if (currentClass && currentClass !== newClass) {
          console.log(`Turmas diferentes! Registando turma antiga ${currentClass} no histórico...`);

          await ExecuteQuery(
            null,
            `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class) 
             VALUES (?, ?)`,
            [studentId, currentClass],
            false
          );

          console.log(`✅ Turma antiga ${currentClass} registada no histórico`);
        } else if (currentClass === newClass) {
          console.log(`✅ Turmas são iguais (${newClass}). Aluno permanece na mesma turma. Nenhum histórico registado.`);
        } else {
          console.log(`⚠️ Aluno não tem turma anterior (null). Nenhum histórico a registar.`);
        }

        // ✅ Atualizar a turma do aluno
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

        console.log(`✅ Aluno movido para turma ${newClass} | Estado: matriculado (enrolled=1)`);
      }

      // ═══════════════════════════════════════════════════════════════════════════
      // ✅ PROCESSAR CONFIRMAÇÃO: Atualizar Turma do Aluno
      // ═══════════════════════════════════════════════════════════════════════════
      if (has_confirmacao && confirmacao_class) {
        console.log(`\n[CONFIRMAÇÃO] Processando confirmação para turma ${confirmacao_class}...`);

        const currentClass = student.ed_student_class;
        const newClass = confirmacao_class;

        console.log(`Turma atual: ${currentClass} | Turma nova: ${newClass}`);

        // ✅ Validação: A confirmação deve SER para uma turma diferente
        // (Esta validação já foi feita acima, mas deixamos aqui por segurança)
        if (currentClass === newClass) {
          console.error(`❌ Tentativa de confirmação na mesma turma ${newClass}`);
          throw new Error(`Confirmação não pode ser na mesma turma. Turma atual: ${currentClass}, Turma solicitada: ${newClass}`);
        }

        // ✅ Registar a turma antiga (que é obrigatório em confirmação)
        console.log(`Registando turma anterior ${currentClass} no histórico...`);

        await ExecuteQuery(
          null,
          `INSERT INTO eduall_student_old_classes(ed_student_old_class_student, ed_student_old_class) 
           VALUES (?, ?)`,
          [studentId, currentClass],
          false
        );

        console.log(`✅ Turma antiga ${currentClass} registada no histórico`);

        // ✅ Atualizar a turma e o estado do aluno
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

        console.log(`✅ Aluno movido para turma ${newClass} | Estado: confirmado (enrolled=2)`);
      }

      // ───────────────────────────────────────────────────────────────────────
      // PROCESSAR PROPINAS: Registar pagamento de propinas
      // ───────────────────────────────────────────────────────────────────────
      if (alsofeepaymenet && feemonths?.length > 0 && fee_service_code) {
        const [feeSrvForPrice] = await ExecuteQuery(
          null,
          `SELECT ed_service_price FROM eduall_services
           WHERE ed_service_id = ? AND ed_service_institute_code = ? AND COALESCE(ed_service_deleted,0)=0 LIMIT 1`,
          [fee_service_code, sessionInstitute],
          true
        );

        const feeHistoricalPrice = feeSrvForPrice?.ed_service_price || 0;

        for (const month of feemonths) {
          const feeQuery = `
            INSERT INTO eduall_fees_payments (
              ed_fee_payment_student,
              ed_fee_payment_month,
              ed_fee_payment_service,
              ed_fee_payment_price,
              ed_fee_payment_invoiceCode,
              ed_fee_payment_institute_code,
              ed_fee_payment_registerDate
            ) VALUES (?, ?, ?, ?, ?, ?, NOW())
          `;

          const feeParams = [
            studentId,
            month,
            fee_service_code,
            feeHistoricalPrice,
            paymentCode,
            sessionInstitute,
          ];

          await ExecuteQuery(null, feeQuery, feeParams, false);
        }

        console.log(`${feemonths.length} propina(s) registada(s) com preço histórico: ${formatCurrency(feeHistoricalPrice)}`);
      }

      await ExecuteQuery(null, "COMMIT", [], false);
      console.log(`✅ Transação confirmada com sucesso`);

    } catch (txErr) {
      await ExecuteQuery(null, "ROLLBACK", [], false);
      console.error(`[TX] Erro:`, txErr.message);
      throw txErr;
    }

    // ───────────────────────────────────────────────────────────────────────────
    // [9] REGISTAR AUDITORIA
    // ───────────────────────────────────────────────────────────────────────────
    console.log("\n[9] Registando auditoria...");

    let auditDesc = `[ID ${operatorId}] Registou pagamento de serviço(s) para ${student.ed_student_code}. `;
    auditDesc += `Método: ${selectedPaymentMethod.name}. `;
    auditDesc += `Fatura: ${vendus.number}. `;
    auditDesc += `Total: ${formatCurrency(totalInvoiceValue)}.`;

    if (customServices.length > 0) {
      auditDesc += ` [${customServices.length} SERVIÇO(S) CUSTOMIZADO(S)]`;
    }

    if (has_matricula) {
      auditDesc += ` [MATRÍCULA para turma ${matricula_class}]`;
    }
    if (has_confirmacao) {
      auditDesc += ` [CONFIRMAÇÃO para turma ${confirmacao_class}]`;
    }
    if (alsofeepaymenet && feemonths?.length > 0) {
      const monthsFormatted = formatMonthsList(feemonths);
      auditDesc += ` [PROPINAS: ${monthsFormatted}]`;
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Pagamentos de Serviços",
      description: auditDesc,
    });

    console.log(`✅ Auditoria registada`);

    console.log("\n" + "═".repeat(90));
    console.log("PAGAMENTO REGISTADO COM SUCESSO");
    console.log("═".repeat(90) + "\n");

    try {
      console.timeEnd(timerLabel);
    } catch (e) {
      // Ignore
    }

    return res.status(200).json({
      success: true,
      message: "Pagamento registado com sucesso!",
      payment: {
        code: paymentCode,
        studentId: student.ed_student_id,
        studentCode: student.ed_student_code,
        studentName: student.ed_student_name,
        services: processedServices.map(s => ({
          id: s.code,
          title: s.name,
          amount: s.amount,
          price: s.price,
          discount: s.discount,
          total: Number(s.lineTotal.toFixed(2)),
          isCustom: s.isCustom,
        })),
        matricula: has_matricula ? {
          done: true,
          newClass: matricula_class,
          amount: matriculaTotal
        } : null,
        confirmacao: has_confirmacao ? {
          done: true,
          newClass: confirmacao_class,
          amount: confirmacaoTotal
        } : null,
        subtotal: Number((totalInvoiceValue - feesTotalValue).toFixed(2)),
        fees: feesTotalValue > 0 ? Number(feesTotalValue.toFixed(2)) : 0,
        total: Number(totalInvoiceValue.toFixed(2)),
      },
      invoiceValue: Number(totalInvoiceValue.toFixed(2)),
      vendus: {
        number: vendus.number,
        id: vendus.id,
        output: vendus.output,
        source: vendus.source,
        ownKey: vendus.ownKey,
        warning: vendus.warning,
      },
      paymentMethod: {
        id: selectedPaymentMethod.vendus_id,
        name: selectedPaymentMethod.name,
      },
      operator: {
        id: operatorId,
      },
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error(`\n[RegisterServicePayment] ERRO GERAL:`, error.message || error);
    console.error(`Stack:`, error.stack);
    console.log("═".repeat(90) + "\n");

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
};