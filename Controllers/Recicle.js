// ─────────────────────────────────────────────────────────────────────────────
// DeletedItemsRecovery.js - CONTROLLER DE ITENS DELETADOS E RESTAURAÇÃO
// ─────────────────────────────────────────────────────────────────────────────
// ✅ Lista TODOS os itens deletados (soft delete) de:
//    - Confirmações de matrícula
//    - Pagamentos de propinas
//    - Pagamentos de serviços
//    - Documentos de confirmação
// ✅ Restaura itens deletados (reverte soft delete)
// ✅ Todas as queries agora retornam TODAS as colunas das tabelas envolvidas
//    (via `tabela.*`), e não apenas colunas específicas mencionadas.
// ─────────────────────────────────────────────────────────────────────────────

const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const Cache = require("../Functions/CacheRoutes");

// ──────────────────────────────────────────────────────────────
// ── CACHE CONFIGURATION ──────────────────────────────────────
// ──────────────────────────────────────────────────────────────
const DELETED_ITEMS_CACHE_TTL = 1800; // 30 minutos

const CacheKeys = {
  deletedList: (instituteCode) => `deleted:list:${instituteCode}`,
  deletedByType: (type, instituteCode) => `deleted:type:${type}:${instituteCode}`,
  deletedSingle: (itemId, type, instituteCode) => `deleted:single:${itemId}:${type}:${instituteCode}`,
  allGlobal: () => "deleted:*",
};

/**
 * ──────────────────────────────────────────────────────────────
 * REFRESH CACHE FUNCTION — called after writes
 * ──────────────────────────────────────────────────────────────
 */
const RefreshDeletedItemsCache = async (req, res, instituteCode) => {
  const startTime = Date.now();
  await Cache.eduallClear(CacheKeys.allGlobal());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode} (DeletedItems)`);

  const duration = Date.now() - startTime;
  console.log(`🗄️🧹 CACHE CLEAR (DeletedItems) demorou ${duration}ms para institute ${instituteCode}`);
};

// ════════════════════════════════════════════════════════════════════════════════
// HELPER: OBTER DADOS DO OPERADOR
// ════════════════════════════════════════════════════════════════════════════════

async function getOperatorData(res, userId) {
  if (!userId) return null;

  try {
    const query = `
      SELECT *
      FROM eduall_user_accounts
      WHERE ed_user_account_id = ?
        AND ed_user_account_deleted = 0
      LIMIT 1
    `;

    const [operator] = await ExecuteQuery(res, query, [userId], true, {
      db: "eduall_user_accounts",
      type: "select",
      data: { operatorLookup: true }
    });

    if (operator) {
      return {
        id: operator.ed_user_account_id,
        name: operator.ed_user_account_name || "Operador Desconhecido",
        ...operator, // mantém todas as colunas originais disponíveis também
      };
    }

    return null;
  } catch (error) {
    console.warn("Erro ao buscar dados do operador:", error.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// GET - LISTAR TODOS OS ITENS DELETADOS (COM UNION)
// ════════════════════════════════════════════════════════════════════════════════

const GetAllDeletedItems = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.deletedList(instituteCode);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAllDeletedItems demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    console.log("\n[GetAllDeletedItems] Buscando itens deletados...");

    // ─────────────────────────────────────────────────────────────────────────
    // CONFIRMAÇÕES DE MATRÍCULA DELETADAS — TODAS AS COLUNAS
    // ─────────────────────────────────────────────────────────────────────────
    const enrollmentQuery = `
      SELECT
        ec.*,
        s.*,
        cls.*,
        srv.*,
        ec.ed_enrollment_confirmation_id AS item_id,
        'enrollment_confirmation' AS item_type,
        'Confirmação de Matrícula' AS item_category,
        COALESCE(
          CONCAT(s.ed_student_code, ' | ', s.ed_student_name),
          'Aluno desconhecido'
        ) AS display_name
      FROM eduall_enrollment_confirmations ec
      LEFT JOIN eduall_students s ON s.ed_student_id = ec.ed_enrollment_confirmation_student
      LEFT JOIN eduall_class cls ON cls.ed_class_id = ec.ed_enrollment_confirmation_class
      LEFT JOIN eduall_services srv ON srv.ed_service_id = ec.ed_enrollment_confirmation_service
      WHERE ec.ed_enrollment_confirmation_deleted = 1
        AND ec.ed_enrollment_confirmation_institute_code = ?
    `;

    const enrollmentRows = await ExecuteQuery(
      res,
      enrollmentQuery,
      [instituteCode],
      true,
      {
        db: "eduall_enrollment_confirmations",
        type: "select",
        data: req,
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // PAGAMENTOS DE PROPINAS DELETADOS — TODAS AS COLUNAS
    // ─────────────────────────────────────────────────────────────────────────
    const feesQuery = `
      SELECT
        fp.*,
        s.*,
        srv.*,
        fp.ed_fee_payment_id AS item_id,
        'fee_payment' AS item_type,
        'Pagamento de Propinas' AS item_category,
        CONCAT(
          ELT(fp.ed_fee_payment_month + 1,
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'),
          ' / ', YEAR(NOW())
        ) AS month_name,
        COALESCE(
          CONCAT(s.ed_student_code, ' | ', s.ed_student_name),
          'Aluno desconhecido'
        ) AS display_name
      FROM eduall_fees_payments fp
      LEFT JOIN eduall_students s ON s.ed_student_id = fp.ed_fee_payment_student
      LEFT JOIN eduall_services srv ON srv.ed_service_id = fp.ed_fee_payment_service
      WHERE fp.ed_fee_payment_deleted = 1
        AND fp.ed_fee_payment_institute_code = ?
    `;

    const feesRows = await ExecuteQuery(
      res,
      feesQuery,
      [instituteCode],
      true,
      {
        db: "eduall_fees_payments",
        type: "select",
        data: req,
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // PAGAMENTOS DE SERVIÇOS DELETADOS — TODAS AS COLUNAS
    // ─────────────────────────────────────────────────────────────────────────
    const servicePaymentQuery = `
      SELECT
        sp.*,
        s.*,
        sp.ed_service_payment_id AS item_id,
        'service_payment' AS item_type,
        'Pagamento de Serviço' AS item_category,
        GROUP_CONCAT(srv.ed_service_title SEPARATOR ', ') AS service_name,
        COALESCE(
          CONCAT(s.ed_student_code, ' | ', s.ed_student_name),
          'Aluno desconhecido'
        ) AS display_name
      FROM eduall_service_payments sp
      LEFT JOIN eduall_students s ON s.ed_student_id = sp.ed_service_payment_student_code
      LEFT JOIN eduall_service_payment_items spi ON spi.ed_service_payment_code = sp.ed_service_payment_code
      LEFT JOIN eduall_services srv ON srv.ed_service_id = spi.ed_service_id
      WHERE sp.ed_service_payment_deleted = 1
        AND sp.ed_service_payment_institute_code = ?
      GROUP BY sp.ed_service_payment_id
    `;

    const servicePaymentRows = await ExecuteQuery(
      res,
      servicePaymentQuery,
      [instituteCode],
      true,
      {
        db: "eduall_service_payments",
        type: "select",
        data: req,
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // ITENS DE CONFIRMAÇÃO DELETADOS (Documentos) — TODAS AS COLUNAS
    // ─────────────────────────────────────────────────────────────────────────
    const confirmationDocsQuery = `
      SELECT
        ecd.*,
        s.*,
        ecd.ed_conf_doc_id AS item_id,
        'enrollment_confirmation_doc' AS item_type,
        'Documento de Confirmação' AS item_category,
        COALESCE(
          CONCAT(s.ed_student_code, ' | ', s.ed_student_name),
          'Aluno desconhecido'
        ) AS display_name
      FROM eduall_enrollment_confirmation_docs ecd
      LEFT JOIN eduall_enrollment_confirmations ec ON ec.ed_enrollment_confirmation_id = ecd.ed_conf_doc_confirmation
      LEFT JOIN eduall_students s ON s.ed_student_id = ec.ed_enrollment_confirmation_student
      WHERE ecd.ed_conf_doc_deleted = 1
        AND ecd.ed_conf_doc_institute = ?
    `;

    const confirmationDocsRows = await ExecuteQuery(
      res,
      confirmationDocsQuery,
      [instituteCode],
      true,
      {
        db: "eduall_enrollment_confirmation_docs",
        type: "select",
        data: req,
      }
    );

    // ─────────────────────────────────────────────────────────────────────────
    // COMBINAR E ORDENAR TODOS OS ITENS POR DATA DE DELEÇÃO
    // ─────────────────────────────────────────────────────────────────────────
    const allDeletedItems = [
      ...(enrollmentRows || []),
      ...(feesRows || []),
      ...(servicePaymentRows || []),
      ...(confirmationDocsRows || []),
    ];

    // Ordenar por deleted_at DESC (mais recentes primeiro)
    allDeletedItems.sort((a, b) => {
      const dateA = new Date(a.deleted_at || a.created_at || 0);
      const dateB = new Date(b.deleted_at || b.created_at || 0);
      return dateB - dateA;
    });

    const result = {
      success: true,
      count: allDeletedItems.length,
      counts_by_type: {
        enrollment_confirmation: (enrollmentRows || []).length,
        fee_payment: (feesRows || []).length,
        service_payment: (servicePaymentRows || []).length,
        confirmation_doc: (confirmationDocsRows || []).length,
      },
      items: allDeletedItems,
    };

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, result, DELETED_ITEMS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`✅ Encontrados ${allDeletedItems.length} itens deletados`);
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAllDeletedItems demorou ${duration}ms (${cacheKey})`);

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Erro ao buscar itens deletados:", error.message);
    return res.status(500).json({
      success: false,
      message: "Falha ao buscar itens deletados!",
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET - LISTAR ITENS DELETADOS POR TIPO
// ════════════════════════════════════════════════════════════════════════════════

const GetDeletedItemsByType = async (req, res) => {
  try {
    const { TYPE } = req.params; // enrollment_confirmation, fee_payment, service_payment, confirmation_doc
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.deletedByType(TYPE, instituteCode);
    const startTime = Date.now();

    // ── Check cache ──
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetDeletedItemsByType demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    let rows = [];
    let categoryLabel = "";

    if (TYPE === "enrollment_confirmation") {
      categoryLabel = "Confirmações de Matrícula";
      const query = `
        SELECT
          ec.*,
          s.*,
          cls.*,
          srv.*,
          ua.*,
          ec.ed_enrollment_confirmation_id AS item_id
        FROM eduall_enrollment_confirmations ec
        LEFT JOIN eduall_students s ON s.ed_student_id = ec.ed_enrollment_confirmation_student
        LEFT JOIN eduall_class cls ON cls.ed_class_id = ec.ed_enrollment_confirmation_class
        LEFT JOIN eduall_services srv ON srv.ed_service_id = ec.ed_enrollment_confirmation_service
        LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = ec.ed_enrollment_confirmation_deleted_by
        WHERE ec.ed_enrollment_confirmation_deleted = 1
          AND ec.ed_enrollment_confirmation_institute_code = ?
        ORDER BY ec.ed_enrollment_confirmation_deleted_at DESC
      `;
      rows = await ExecuteQuery(res, query, [instituteCode], true);

    } else if (TYPE === "fee_payment") {
      categoryLabel = "Pagamentos de Propinas";
      const query = `
        SELECT
          fp.*,
          s.*,
          srv.*,
          fp.ed_fee_payment_id AS item_id,
          CONCAT(
            ELT(fp.ed_fee_payment_month + 1,
              'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
              'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'),
            ' / ', YEAR(NOW())
          ) AS month_name
        FROM eduall_fees_payments fp
        LEFT JOIN eduall_students s ON s.ed_student_id = fp.ed_fee_payment_student
        LEFT JOIN eduall_services srv ON srv.ed_service_id = fp.ed_fee_payment_service
        WHERE fp.ed_fee_payment_deleted = 1
          AND fp.ed_fee_payment_institute_code = ?
      `;
      rows = await ExecuteQuery(res, query, [instituteCode], true);

    } else if (TYPE === "service_payment") {
      categoryLabel = "Pagamentos de Serviço";
      const query = `
        SELECT
          sp.*,
          s.*,
          sp.ed_service_payment_id AS item_id,
          GROUP_CONCAT(srv.ed_service_title SEPARATOR ', ') AS service_name
        FROM eduall_service_payments sp
        LEFT JOIN eduall_students s ON s.ed_student_id = sp.ed_service_payment_student_code
        LEFT JOIN eduall_service_payment_items spi ON spi.ed_service_payment_code = sp.ed_service_payment_code
        LEFT JOIN eduall_services srv ON srv.ed_service_id = spi.ed_service_id
        WHERE sp.ed_service_payment_deleted = 1
          AND sp.ed_service_payment_institute_code = ?
        GROUP BY sp.ed_service_payment_id
      `;
      rows = await ExecuteQuery(res, query, [instituteCode], true);

    } else if (TYPE === "confirmation_doc") {
      categoryLabel = "Documentos de Confirmação";
      const query = `
        SELECT
          ecd.*,
          s.*,
          ecd.ed_conf_doc_id AS item_id
        FROM eduall_enrollment_confirmation_docs ecd
        LEFT JOIN eduall_enrollment_confirmations ec ON ec.ed_enrollment_confirmation_id = ecd.ed_conf_doc_confirmation
        LEFT JOIN eduall_students s ON s.ed_student_id = ec.ed_enrollment_confirmation_student
        WHERE ecd.ed_conf_doc_deleted = 1
          AND ecd.ed_conf_doc_institute = ?
      `;
      rows = await ExecuteQuery(res, query, [instituteCode], true);

    } else {
      return res.status(400).json({
        success: false,
        message: "Tipo de item inválido. Use: enrollment_confirmation, fee_payment, service_payment, confirmation_doc"
      });
    }

    const result = {
      success: true,
      type: TYPE,
      category: categoryLabel,
      count: (rows || []).length,
      items: rows || [],
    };

    // ── Set cache ──
    await Cache.eduallSet(cacheKey, result, DELETED_ITEMS_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`✅ Encontrados ${(rows || []).length} itens deletados do tipo ${TYPE}`);
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetDeletedItemsByType demorou ${duration}ms (${cacheKey})`);

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Erro ao buscar itens deletados por tipo:", error.message);
    return res.status(500).json({
      success: false,
      message: "Falha ao buscar itens deletados!",
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// PUT - RESTAURAR ITEM DELETADO (REVERTE SOFT DELETE)
// ════════════════════════════════════════════════════════════════════════════════

const RestoreDeletedItem = async (req, res) => {
  try {
    const { ITEMID, ITEMTYPE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    if (!ITEMID || !ITEMTYPE) {
      return res.status(400).json({
        success: false,
        message: "ID do item e tipo são obrigatórios!"
      });
    }

    console.log(`\n[RestoreDeletedItem] Restaurando ${ITEMTYPE} ID ${ITEMID}...`);
    const startTime = Date.now();

    let query = "";
    let params = [];
    let description = "";
    let itemInfo = null;

    // ─────────────────────────────────────────────────────────────────────────
    // RESTAURAR CONFIRMAÇÃO DE MATRÍCULA
    // ─────────────────────────────────────────────────────────────────────────
    if (ITEMTYPE === "enrollment_confirmation") {
      // Buscar info completa (todas as colunas) para auditoria
      const [info] = await ExecuteQuery(res,
        `SELECT ec.*, s.*
         FROM eduall_enrollment_confirmations ec
         LEFT JOIN eduall_students s ON s.ed_student_id = ec.ed_enrollment_confirmation_student
         WHERE ec.ed_enrollment_confirmation_id = ? AND ec.ed_enrollment_confirmation_institute_code = ?`,
        [ITEMID, instituteCode],
        true
      );
      itemInfo = info;

      query = `
        UPDATE eduall_enrollment_confirmations
        SET ed_enrollment_confirmation_deleted = 0,
            ed_enrollment_confirmation_deleted_at = NULL,
            ed_enrollment_confirmation_deleted_by = NULL
        WHERE ed_enrollment_confirmation_id = ?
          AND ed_enrollment_confirmation_institute_code = ?
      `;
      params = [ITEMID, instituteCode];
      description = `Restaurou confirmação de matrícula ${itemInfo?.ed_student_code} (ID ${ITEMID})`;

    } else if (ITEMTYPE === "fee_payment") {
      // Buscar info completa (todas as colunas) para auditoria
      const [info] = await ExecuteQuery(res,
        `SELECT fp.*, s.*
         FROM eduall_fees_payments fp
         LEFT JOIN eduall_students s ON s.ed_student_id = fp.ed_fee_payment_student
         WHERE fp.ed_fee_payment_id = ? AND fp.ed_fee_payment_institute_code = ?`,
        [ITEMID, instituteCode],
        true
      );
      itemInfo = info;

      query = `
        UPDATE eduall_fees_payments
        SET ed_fee_payment_deleted = 0
        WHERE ed_fee_payment_id = ?
          AND ed_fee_payment_institute_code = ?
      `;
      params = [ITEMID, instituteCode];
      description = `Restaurou pagamento de propinas ${itemInfo?.ed_student_code} (mês ${itemInfo?.ed_fee_payment_month}, ID ${ITEMID})`;

    } else if (ITEMTYPE === "service_payment") {
      // Buscar info completa (todas as colunas) para auditoria
      const [info] = await ExecuteQuery(res,
        `SELECT sp.*, s.*
         FROM eduall_service_payments sp
         LEFT JOIN eduall_students s ON s.ed_student_id = sp.ed_service_payment_student_code
         WHERE sp.ed_service_payment_id = ? AND sp.ed_service_payment_institute_code = ?`,
        [ITEMID, instituteCode],
        true
      );
      itemInfo = info;

      query = `
        UPDATE eduall_service_payments
        SET ed_service_payment_deleted = 0
        WHERE ed_service_payment_id = ?
          AND ed_service_payment_institute_code = ?
      `;
      params = [ITEMID, instituteCode];
      description = `Restaurou pagamento de serviço ${itemInfo?.ed_student_code} (ID ${ITEMID})`;

    } else if (ITEMTYPE === "confirmation_doc") {
      // Buscar info completa (todas as colunas) para auditoria
      const [info] = await ExecuteQuery(res,
        `SELECT ecd.*, s.*
         FROM eduall_enrollment_confirmation_docs ecd
         LEFT JOIN eduall_enrollment_confirmations ec ON ec.ed_enrollment_confirmation_id = ecd.ed_conf_doc_confirmation
         LEFT JOIN eduall_students s ON s.ed_student_id = ec.ed_enrollment_confirmation_student
         WHERE ecd.ed_conf_doc_id = ? AND ecd.ed_conf_doc_institute = ?`,
        [ITEMID, instituteCode],
        true
      );
      itemInfo = info;

      query = `
        UPDATE eduall_enrollment_confirmation_docs
        SET ed_conf_doc_deleted = 0
        WHERE ed_conf_doc_id = ?
          AND ed_conf_doc_institute = ?
      `;
      params = [ITEMID, instituteCode];
      description = `Restaurou documento "${itemInfo?.ed_conf_doc_name}" do aluno ${itemInfo?.ed_student_code} (ID ${ITEMID})`;

    } else {
      return res.status(400).json({
        success: false,
        message: "Tipo de item inválido! Use: enrollment_confirmation, fee_payment, service_payment, confirmation_doc"
      });
    }

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Não foi possível construir a query de restauração"
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // EXECUTAR RESTAURAÇÃO
    // ─────────────────────────────────────────────────────────────────────────
    const result = await ExecuteQuery(res, query, params, false, {
      db: `deleted_items_${ITEMTYPE}`,
      type: "update",
      data: req,
    });

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: `Nenhum item ${ITEMTYPE} encontrado com ID ${ITEMID}`
      });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REGISTAR AUDITORIA
    // ─────────────────────────────────────────────────────────────────────────
    await RegisterAuditAction({
      session: req.session,
      action: 4, // Ação customizada: restauração
      form: "Itens Deletados - Restauração",
      description: description,
    });

    console.log(`✅ ${ITEMTYPE} ID ${ITEMID} restaurado com sucesso!`);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RestoreDeletedItem demorou ${duration}ms`);

    // ─────────────────────────────────────────────────────────────────────────
    // INVALIDAR CACHE
    // ─────────────────────────────────────────────────────────────────────────
    await RefreshDeletedItemsCache(req, res, instituteCode);

    return res.status(200).json({
      success: true,
      message: `Item ${ITEMTYPE} ID ${ITEMID} restaurado com sucesso!`,
      restored: {
        item_id: ITEMID,
        item_type: ITEMTYPE,
        student_code: itemInfo?.ed_student_code || "desconhecido",
        student_name: itemInfo?.ed_student_name || "desconhecido",
        restored_at: new Date().toISOString(),
        restored_by: operator?.name || `Operador ${operatorId}`,
        full_item_data: itemInfo || null, // todas as colunas do item restaurado
      }
    });

  } catch (error) {
    console.error("❌ Erro ao restaurar item deletado:", error.message);
    return res.status(500).json({
      success: false,
      message: "Falha ao restaurar item deletado!",
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE PERMANENTEMENTE (HARD DELETE) - OPCIONAL PARA SEGURANÇA
// ════════════════════════════════════════════════════════════════════════════════

const PermanentlyDeleteItem = async (req, res) => {
  try {
    const { ITEMID, ITEMTYPE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    if (!ITEMID || !ITEMTYPE) {
      return res.status(400).json({
        success: false,
        message: "ID do item e tipo são obrigatórios!"
      });
    }

    console.log(`\n[PermanentlyDeleteItem] Eliminando PERMANENTEMENTE ${ITEMTYPE} ID ${ITEMID}...`);
    const startTime = Date.now();

    let query = "";
    let params = [];

    if (ITEMTYPE === "enrollment_confirmation") {
      query = `DELETE FROM eduall_enrollment_confirmations WHERE ed_enrollment_confirmation_id = ? AND ed_enrollment_confirmation_institute_code = ?`;
      params = [ITEMID, instituteCode];

    } else if (ITEMTYPE === "fee_payment") {
      query = `DELETE FROM eduall_fees_payments WHERE ed_fee_payment_id = ? AND ed_fee_payment_institute_code = ?`;
      params = [ITEMID, instituteCode];

    } else if (ITEMTYPE === "service_payment") {
      query = `DELETE FROM eduall_service_payments WHERE ed_service_payment_id = ? AND ed_service_payment_institute_code = ?`;
      params = [ITEMID, instituteCode];

    } else if (ITEMTYPE === "confirmation_doc") {
      query = `DELETE FROM eduall_enrollment_confirmation_docs WHERE ed_conf_doc_id = ? AND ed_conf_doc_institute = ?`;
      params = [ITEMID, instituteCode];

    } else {
      return res.status(400).json({
        success: false,
        message: "Tipo de item inválido!"
      });
    }

    const result = await ExecuteQuery(res, query, params, false, {
      db: `deleted_items_hard_delete`,
      type: "delete",
      data: req,
    });

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: `Nenhum item ${ITEMTYPE} encontrado com ID ${ITEMID}`
      });
    }

    await RegisterAuditAction({
      session: req.session,
      action: 5, // Ação customizada: hard delete
      form: "Itens Deletados - Eliminação Permanente",
      description: `Eliminou PERMANENTEMENTE ${ITEMTYPE} ID ${ITEMID}`,
    });

    console.log(`✅ ${ITEMTYPE} ID ${ITEMID} eliminado PERMANENTEMENTE!`);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> PermanentlyDeleteItem demorou ${duration}ms`);

    await RefreshDeletedItemsCache(req, res, instituteCode);

    return res.status(200).json({
      success: true,
      message: `Item ${ITEMTYPE} ID ${ITEMID} eliminado PERMANENTEMENTE!`,
      deleted: {
        item_id: ITEMID,
        item_type: ITEMTYPE,
        permanently_deleted_at: new Date().toISOString(),
      }
    });

  } catch (error) {
    console.error("❌ Erro ao eliminar item permanentemente:", error.message);
    return res.status(500).json({
      success: false,
      message: "Falha ao eliminar item permanentemente!",
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetAllDeletedItems,
  GetDeletedItemsByType,
  RestoreDeletedItem,
  PermanentlyDeleteItem,
};