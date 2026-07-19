// ════════════════════════════════════════════════════════════════════════════════
// 📄 MÓDULO DE FATURAÇÃO GERAL — INTEGRADO COM VENDUS
// ════════════════════════════════════════════════════════════════════════════════
//
// Este módulo permite emitir faturas para QUALQUER pessoa (não precisa de ser
// um aluno registado no sistema) com integração completa com Vendus.
//
// Padrão seguido:
// ✅ Mesma detecção de métodos de pagamento (getPaymentMethods, resolvePaymentMethod)
// ✅ Mesma integração Vendus (VENDUS_CreateInvoiceCodeAndDoc)
// ✅ Mesma construção de observações
// ✅ Mesma auditoria e logging
//
// ════════════════════════════════════════════════════════════════════════════════

const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const { 
  VENDUS_CreateInvoiceCodeAndDoc,
  getPaymentMethods,
  resolvePaymentMethod
} = require("../Functions/VENDUS");

// ════════════════════════════════════════════════════════════════════════════════
// 🔧 INICIALIZAÇÃO - CRIAR TABELAS SE NÃO EXISTIREM
// ════════════════════════════════════════════════════════════════════════════════

const InitializeInvoiceTables = async () => {
  console.log("\n[🔧 Inicialização] Verificando e criando tabelas de faturação...\n");

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // TABELA: eduall_invoices
    // ─────────────────────────────────────────────────────────────────────────
    const createInvoicesTable = `
      CREATE TABLE IF NOT EXISTS eduall_invoices (
        ed_invoice_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_invoice_code VARCHAR(50) NOT NULL UNIQUE,
        ed_invoice_client_name VARCHAR(150) NOT NULL,
        ed_invoice_client_nif VARCHAR(30) NULL,
        ed_invoice_client_phone VARCHAR(30) NULL,
        ed_invoice_client_address VARCHAR(255) NULL,
        ed_invoice_observations TEXT NULL,
        ed_invoice_payment_type TINYINT NOT NULL DEFAULT 0,
        ed_invoice_payment_bank VARCHAR(100) NULL,
        ed_invoice_payment_place VARCHAR(100) NULL,
        ed_invoice_payment_reference VARCHAR(100) NULL,
        ed_invoice_payment_receipt_number VARCHAR(100) NULL,
        ed_invoice_value_delivered DECIMAL(12,2) DEFAULT 0,
        ed_invoice_discount_percent DECIMAL(5,2) DEFAULT 0,
        ed_invoice_total DECIMAL(12,2) DEFAULT 0,
        ed_invoice_coin VARCHAR(10) DEFAULT 'Kz',
        ed_invoice_vendus_number VARCHAR(50) NULL,
        ed_invoice_vendus_id VARCHAR(100) NULL,
        ed_invoice_vendus_pdf VARCHAR(255) NULL,
        ed_invoice_operator_id INT NULL,
        ed_invoice_operator_name VARCHAR(150) NULL,
        ed_invoice_institute_code VARCHAR(150) NULL,
        ed_invoice_deleted TINYINT DEFAULT 0,
        ed_invoice_registerDate DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_code (ed_invoice_code),
        INDEX idx_institute (ed_invoice_institute_code),
        INDEX idx_deleted (ed_invoice_deleted),
        INDEX idx_vendus_number (ed_invoice_vendus_number)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `;

    await ExecuteQuery(null, createInvoicesTable, [], false);
    console.log("✅ Tabela `eduall_invoices` pronta");

    // ─────────────────────────────────────────────────────────────────────────
    // TABELA: eduall_invoice_items
    // ─────────────────────────────────────────────────────────────────────────
    const createItemsTable = `
      CREATE TABLE IF NOT EXISTS eduall_invoice_items (
        ed_invoice_item_id INT AUTO_INCREMENT PRIMARY KEY,
        ed_invoice_code VARCHAR(50) NOT NULL,
        ed_item_title VARCHAR(150) NOT NULL,
        ed_item_quantity INT DEFAULT 1,
        ed_item_unit_price DECIMAL(12,2) DEFAULT 0,
        ed_item_discount_percent DECIMAL(5,2) DEFAULT 0,
        ed_item_is_custom TINYINT DEFAULT 0,
        ed_invoice_item_institute_code VARCHAR(150) NULL,
        ed_invoice_item_deleted TINYINT DEFAULT 0,
        ed_invoice_item_registerDate DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ed_invoice_code) REFERENCES eduall_invoices(ed_invoice_code) ON DELETE CASCADE,
        INDEX idx_code (ed_invoice_code),
        INDEX idx_institute (ed_invoice_item_institute_code),
        INDEX idx_deleted (ed_invoice_item_deleted)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
    `;

    await ExecuteQuery(null, createItemsTable, [], false);
    console.log("✅ Tabela `eduall_invoice_items` pronta\n");

    return true;
  } catch (error) {
    console.error("❌ Erro ao inicializar tabelas de faturação:", error.message);
    throw error;
  }
};

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
 * Gera código único de fatura
 */
function generateInvoiceCode() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 1000);
  return `INV-${timestamp}-${random}`;
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
// GET - LISTAR FATURAS (com itens agregados via JSON_ARRAYAGG)
// ════════════════════════════════════════════════════════════════════════════════

const GetInvoices = async (req, res) => {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[GetInvoices] Listando faturas do instituto ${instituteCode}...`);
    const startTime = Date.now();

    const query = `
      SELECT
        inv.*,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', it.ed_invoice_item_id,
              'title', it.ed_item_title,
              'quantity', it.ed_item_quantity,
              'unit_price', it.ed_item_unit_price,
              'discount', it.ed_item_discount_percent,
              'is_custom', it.ed_item_is_custom,
              'total', (it.ed_item_unit_price * it.ed_item_quantity) - 
                       ((it.ed_item_unit_price * it.ed_item_quantity * it.ed_item_discount_percent) / 100)
            )
          )
          FROM eduall_invoice_items it
          WHERE it.ed_invoice_code COLLATE utf8mb4_general_ci
              = inv.ed_invoice_code COLLATE utf8mb4_general_ci
            AND COALESCE(it.ed_invoice_item_deleted, 0) = 0
        ) AS items
      FROM eduall_invoices inv
      WHERE COALESCE(inv.ed_invoice_deleted, 0) = 0
        AND inv.ed_invoice_institute_code = ?
      ORDER BY inv.ed_invoice_registerDate DESC
    `;

    const rows = await ExecuteQuery(null, query, [instituteCode], true, {
      db: "eduall_invoices",
      type: "select",
      data: req,
    });

    const duration = Date.now() - startTime;
    console.log(`Encontradas ${rows?.length || 0} faturas (${duration}ms)\n`);

    const safeData = JSON.parse(JSON.stringify(rows || []));

    return res.status(200).json({
      success: true,
      data: safeData,
      count: safeData.length,
    });
  } catch (error) {
    console.error(`[GetInvoices] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: "Erro ao buscar faturas",
      error: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET - FATURA ÚNICA (para preview/edição)
// ════════════════════════════════════════════════════════════════════════════════

const GetSingleInvoice = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[GetSingleInvoice] Buscando fatura ID ${ID}...`);
    const startTime = Date.now();

    const query = `
      SELECT
        inv.*,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', it.ed_invoice_item_id,
              'title', it.ed_item_title,
              'quantity', it.ed_item_quantity,
              'unit_price', it.ed_item_unit_price,
              'discount', it.ed_item_discount_percent,
              'is_custom', it.ed_item_is_custom,
              'total', (it.ed_item_unit_price * it.ed_item_quantity) - 
                       ((it.ed_item_unit_price * it.ed_item_quantity * it.ed_item_discount_percent) / 100)
            )
          )
          FROM eduall_invoice_items it
          WHERE it.ed_invoice_code COLLATE utf8mb4_general_ci
              = inv.ed_invoice_code COLLATE utf8mb4_general_ci
            AND COALESCE(it.ed_invoice_item_deleted, 0) = 0
        ) AS items
      FROM eduall_invoices inv
      WHERE COALESCE(inv.ed_invoice_deleted, 0) = 0
        AND inv.ed_invoice_id = ?
        AND inv.ed_invoice_institute_code = ?
      LIMIT 1
    `;

    const rows = await ExecuteQuery(null, query, [ID, instituteCode], true, {
      db: "eduall_invoices",
      type: "select",
      data: req,
    });

    const duration = Date.now() - startTime;
    console.log(`Fatura encontrada (${duration}ms)\n`);

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Fatura não encontrada.",
      });
    }

    const safeData = JSON.parse(JSON.stringify(rows[0]));

    return res.status(200).json({
      success: true,
      data: safeData,
    });
  } catch (error) {
    console.error(`[GetSingleInvoice] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// POST - REGISTAR NOVA FATURA (COM INTEGRAÇÃO VENDUS)
// ════════════════════════════════════════════════════════════════════════════════

const RegisterInvoice = async (req, res) => {
  const timerLabel = `RegisterInvoice_${Date.now()}`;
  console.time(timerLabel);

  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log("\n" + "═".repeat(90));
    console.log("REGISTAR NOVA FATURA - COM INTEGRAÇÃO VENDUS");
    console.log("═".repeat(90));
    console.log(`Instituto: ${instituteCode}`);
    console.log(`Operador: ID ${operatorId}\n`);

    const {
      client_name,
      client_nif,
      client_phone,
      client_address,
      observations,
      payment_type,
      payment_bank,
      payment_place,
      payment_reference,
      payment_receipt_number,
      value_delivered,
      discount_percent,
      coin,
      items,
    } = req.body;

    // ─── VALIDAÇÕES OBRIGATÓRIAS ────────────────────────────────────────────
    console.log("[1] Validando dados obrigatórios...");

    if (!client_name || client_name.trim() === "") {
      console.error("❌ Nome do cliente é obrigatório");
      return res.status(400).json({
        success: false,
        msg: "Nome do cliente é obrigatório",
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      console.error("❌ Adicione pelo menos um item");
      return res.status(400).json({
        success: false,
        msg: "Adicione pelo menos um item à fatura",
      });
    }

    if (payment_type === undefined || payment_type === null || payment_type === "") {
      console.error("❌ Método de pagamento é obrigatório");
      return res.status(400).json({
        success: false,
        msg: "Método de pagamento é obrigatório",
      });
    }

    console.log(`✅ Dados obrigatórios validados`);
    console.log(`👤 Cliente: ${client_name}`);

    // ─── VALIDAR CAMPOS COMPLEMENTARES POR MÉTODO ──────────────────────────
    console.log("\n[2] Validando campos complementares do pagamento...");

    if ((payment_type === 1 || payment_type === 2) && !payment_reference?.toString().trim()) {
      console.error("❌ Borderô/referência obrigatório");
      return res.status(400).json({
        success: false,
        msg: "Número de borderô/referência é obrigatório para este método",
      });
    }

    if (payment_type === 3 && !payment_receipt_number?.toString().trim()) {
      console.error("❌ Número de comprovativo TPA obrigatório");
      return res.status(400).json({
        success: false,
        msg: "Número de comprovativo TPA é obrigatório",
      });
    }

    console.log(`✅ Campos de pagamento validados`);

    // ─── RESOLVER MÉTODO DE PAGAMENTO (PADRÃO VENDUS) ──────────────────────
    console.log("\n[3] Resolvendo método de pagamento...");

    const paymentMethods = await getPaymentMethods(req);
    if (!paymentMethods || paymentMethods.length === 0) {
      console.error("❌ Nenhum método de pagamento configurado!");
      return res.status(400).json({
        success: false,
        msg: "Nenhum método de pagamento configurado no sistema!",
        error: "NO_PAYMENT_METHODS"
      });
    }

    const selectedPaymentMethod = resolvePaymentMethod(Number(payment_type), paymentMethods);
    if (!selectedPaymentMethod) {
      console.error(`❌ Método de pagamento inválido: ${payment_type}`);
      return res.status(400).json({
        success: false,
        msg: "Método de pagamento inválido!",
        error: "INVALID_PAYMENT_METHOD"
      });
    }

    console.log(`✅ Método: ${selectedPaymentMethod.name} (ID Vendus: ${selectedPaymentMethod.vendus_id})`);

    const needsBordereau = requiresBordereau(selectedPaymentMethod.name);
    if (needsBordereau && !payment_reference) {
      console.error("❌ Borderô obrigatório para este método");
      return res.status(400).json({
        success: false,
        msg: `O método "${selectedPaymentMethod.name}" requer número de borderô/referência.`,
      });
    }

    // ─── CALCULAR TOTAL ────────────────────────────────────────────────────
    console.log("\n[4] Calculando totais...");

    let totalValue = 0;
    const validatedItems = [];

    for (const item of items) {
      const qty = parseFloat(item.quantity || 1);
      const price = parseFloat(item.unit_price || 0);
      const discount = parseFloat(item.discount || 0);

      if (!isValidPrice(price)) {
        console.error(`❌ Preço inválido para item: ${item.title}`);
        return res.status(400).json({
          success: false,
          msg: `Preço inválido para o item "${item.title}"`,
        });
      }

      const subtotal = qty * price - (qty * price * discount) / 100;
      totalValue += subtotal;

      validatedItems.push({
        title: item.title || "Item sem título",
        quantity: qty,
        unit_price: price,
        discount: discount,
        subtotal: subtotal,
        is_custom: item.is_custom || 0,
      });

      console.log(`  ✅ ${item.title} | Qtd: ${qty} | Preço: ${formatCurrency(price)} | Total: ${formatCurrency(subtotal)}`);
    }

    const globalDiscount = parseFloat(discount_percent || 0);
    totalValue = totalValue - (totalValue * globalDiscount) / 100;

    console.log(`\n💵 TOTAL FINAL: ${formatCurrency(totalValue)}`);

    // ─── OBTER NOME DO OPERADOR ────────────────────────────────────────────
    console.log("\n[5] Obtendo dados do operador...");

    const [operatorUser] = await ExecuteQuery(
      null,
      `SELECT ed_user_account_name FROM eduall_user_accounts 
       WHERE ed_user_account_id = ? AND COALESCE(ed_user_account_deleted,0)=0 LIMIT 1`,
      [operatorId],
      true
    );

    const operatorName = operatorUser?.ed_user_account_name || `Operador ${operatorId}`;
    console.log(`✅ Operador: ${operatorName}`);

    // ─── PREPARAR DADOS PARA VENDUS ────────────────────────────────────────
    console.log("\n[6] Preparando dados para Vendus...");

    const customer = {
      name: client_name || "",
      fiscal_id: client_nif || "",
      address: client_address || "",
      email: "",
    };

    const invoiceLines = validatedItems.map((item, idx) => ({
      itemcode: `INVITEM-${idx + 1}`,
      title: item.title,
      price: Number(item.unit_price.toFixed(2)),
      tax: 0,
      discount: item.discount,
      quantity: String(item.quantity),
    }));

    // ─── CONSTRUIR OBSERVAÇÕES (SIMILAR A SERVICEPAYMENTS) ──────────────── 
    console.log("\n[7] Construindo observações...");

    const obsParts = [];
    obsParts.push(`Tipo: Fatura Geral`);
    obsParts.push(`Cliente: ${client_name}`);
    if (client_nif) obsParts.push(`NIF: ${client_nif}`);
    if (client_phone) obsParts.push(`Telefone: ${client_phone}`);
    if (client_address) obsParts.push(`Endereço: ${client_address}`);
    obsParts.push(`Forma de pagamento: ${selectedPaymentMethod.name}`);
    if (payment_bank) obsParts.push(`Banco: ${payment_bank}`);
    if (payment_place) obsParts.push(`Local: ${payment_place}`);
    if (payment_reference) obsParts.push(`Referência/Borderô: ${payment_reference}`);
    if (payment_receipt_number) obsParts.push(`Nº Comprovativo TPA: ${payment_receipt_number}`);
    if (value_delivered) obsParts.push(`Valor entregue: ${formatCurrency(parseFloat(value_delivered))}`);
    if (globalDiscount) obsParts.push(`Desconto global: ${globalDiscount}%`);
    obsParts.push(`Itens: ${validatedItems.map(i => i.title).join(", ")}`);
    if (observations) obsParts.push(`Observações: ${observations}`);
    obsParts.push(`Operador: ${operatorName}`);

    const obs = obsParts.join("\n");

    console.log("Observações construídas:");
    obsParts.forEach((part, idx) => {
      console.log(`  ${idx + 1}. ${part}`);
    });











    // ─── CRIAR FATURA NO VENDUS ───────────────────────────────────────────
    console.log("\n[8] Criando fatura no Vendus...");
    const startVendusTime = Date.now();

    let vendus;
    try {
      vendus = await VENDUS_CreateInvoiceCodeAndDoc(
        req,
        customer,
        invoiceLines,
        Number(payment_type),
        obs
      );
    } catch (vendusErr) {
      console.error(`❌ [VENDUS] ERRO:`, vendusErr.message || vendusErr);
      return res.status(500).json({
        success: false,
        msg: "Falha ao criar fatura Vendus. Fatura NÃO foi registada.",
        vendusError: vendusErr.message || String(vendusErr),
      });
    }

    if (!vendus || !vendus.number || !vendus.id) {
      console.error(`❌ [VENDUS] Resposta inválida:`, JSON.stringify(vendus));
      return res.status(500).json({
        success: false,
        msg: "Resposta Vendus inválida. Fatura NÃO foi registada.",
      });
    }

    const vendusTime = Date.now() - startVendusTime;
    console.log(`✅ [VENDUS] Fatura criada com sucesso!`);
    console.log(`   Número: ${vendus.number}`);
    console.log(`   ID: ${vendus.id}`);
    console.log(`   Valor: ${formatCurrency(totalValue)}`);
    console.log(`   PDF: ${vendus.output}`);
    console.log(`   Tempo: ${vendusTime}ms`);

    // ─── GERAR CÓDIGO E INSERIR FATURA NA BD ──────────────────────────────
    console.log("\n[9] Inserindo fatura na BD...");

    const invoiceCode = generateInvoiceCode();

    const insertInvoiceQuery = `
      INSERT INTO eduall_invoices (
        ed_invoice_code,
        ed_invoice_client_name,
        ed_invoice_client_nif,
        ed_invoice_client_phone,
        ed_invoice_client_address,
        ed_invoice_observations,
        ed_invoice_payment_type,
        ed_invoice_payment_bank,
        ed_invoice_payment_place,
        ed_invoice_payment_reference,
        ed_invoice_payment_receipt_number,
        ed_invoice_value_delivered,
        ed_invoice_discount_percent,
        ed_invoice_total,
        ed_invoice_coin,
        ed_invoice_vendus_number,
        ed_invoice_vendus_id,
        ed_invoice_vendus_pdf,
        ed_invoice_operator_id,
        ed_invoice_operator_name,
        ed_invoice_institute_code,
        ed_invoice_registerDate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    const insertInvoiceParams = [
      invoiceCode,
      client_name.trim(),
      client_nif || null,
      client_phone || null,
      client_address || null,
      observations || null,
      selectedPaymentMethod.vendus_id,
      payment_bank || null,
      payment_place || null,
      payment_reference || null,
      payment_receipt_number || null,
      value_delivered || 0,
      globalDiscount,
      totalValue,
      coin || "Kz",
      vendus.number,
      vendus.id,
      vendus.output || null,
      operatorId,
      operatorName,
      instituteCode,
    ];

    await ExecuteQuery(null, insertInvoiceQuery, insertInvoiceParams, false, {
      db: "eduall_invoices",
      type: "insert",
      data: req,
    });

    console.log(`✅ Fatura criada: ${invoiceCode}`);

    // ─── INSERIR ITENS ──────────────────────────────────────────────────────
    console.log("\n[10] Inserindo itens da fatura...");

    for (const item of validatedItems) {
      const itemQuery = `
        INSERT INTO eduall_invoice_items (
          ed_invoice_code,
          ed_item_title,
          ed_item_quantity,
          ed_item_unit_price,
          ed_item_discount_percent,
          ed_item_is_custom,
          ed_invoice_item_institute_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      const itemParams = [
        invoiceCode,
        item.title,
        item.quantity,
        item.unit_price,
        item.discount,
        item.is_custom,
        instituteCode,
      ];

      await ExecuteQuery(null, itemQuery, itemParams, false, {
        db: "eduall_invoice_items",
        type: "insert",
        data: req,
      });
    }

    console.log(`✅ ${validatedItems.length} item(ns) registado(s)`);

    // ─── REGISTAR AUDITORIA ──────────────────────────────────────────────
    console.log("\n[11] Registando auditoria...");

    let auditDesc = `[ID ${operatorId}] Emitiu fatura ${invoiceCode} para ${client_name}. `;
    auditDesc += `Método: ${selectedPaymentMethod.name}. `;
    auditDesc += `Fatura Vendus: ${vendus.number}. `;
    auditDesc += `Total: ${formatCurrency(totalValue)}. `;
    auditDesc += `Items: ${validatedItems.length}`;

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Faturação",
      description: auditDesc,
    });

    console.log(`✅ Auditoria registada`);
    console.log("═".repeat(90) + "\n");

    try {
      console.timeEnd(timerLabel);
    } catch (e) {
      // Ignore
    }

    return res.status(200).json({
      success: true,
      message: "Fatura emitida com sucesso!",
      invoice: {
        id: invoiceCode,
        code: invoiceCode,
        client_name,
        total_value: Number(totalValue.toFixed(2)),
        item_count: validatedItems.length,
        payment_type: selectedPaymentMethod.vendus_id,
        payment_method: selectedPaymentMethod.name,
        coin: coin || "Kz",
        items: validatedItems,
        vendus: {
          number: vendus.number,
          id: vendus.id,
          output: vendus.output,
          source: vendus.source,
          ownKey: vendus.ownKey,
          warning: vendus.warning,
        },
        operator: {
          id: operatorId,
          name: operatorName,
        },
      },
    });
  } catch (error) {
    console.error(`\n❌ [RegisterInvoice] Erro:`, error.message);
    console.error(`Stack:`, error.stack);
    console.log("═".repeat(90) + "\n");

    try {
      console.timeEnd(timerLabel);
    } catch (e) {
      // Ignore
    }

    return res.status(500).json({
      success: false,
      msg: "Erro ao registar fatura",
      error: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// PUT - ATUALIZAR FATURA
// ════════════════════════════════════════════════════════════════════════════════

const InvoiceUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[InvoiceUpdate] Atualizando fatura ${ID}...`);
    const startTime = Date.now();

    const {
      client_name,
      client_nif,
      client_phone,
      client_address,
      observations,
      payment_bank,
      payment_place,
      payment_reference,
      payment_receipt_number,
    } = req.body;

    const updateFields = [];
    const updateParams = [];

    if (client_name) {
      updateFields.push("ed_invoice_client_name = ?");
      updateParams.push(client_name);
    }
    if (client_nif !== undefined) {
      updateFields.push("ed_invoice_client_nif = ?");
      updateParams.push(client_nif || null);
    }
    if (client_phone !== undefined) {
      updateFields.push("ed_invoice_client_phone = ?");
      updateParams.push(client_phone || null);
    }
    if (client_address !== undefined) {
      updateFields.push("ed_invoice_client_address = ?");
      updateParams.push(client_address || null);
    }
    if (observations !== undefined) {
      updateFields.push("ed_invoice_observations = ?");
      updateParams.push(observations || null);
    }
    if (payment_bank !== undefined) {
      updateFields.push("ed_invoice_payment_bank = ?");
      updateParams.push(payment_bank || null);
    }
    if (payment_place !== undefined) {
      updateFields.push("ed_invoice_payment_place = ?");
      updateParams.push(payment_place || null);
    }
    if (payment_reference !== undefined) {
      updateFields.push("ed_invoice_payment_reference = ?");
      updateParams.push(payment_reference || null);
    }
    if (payment_receipt_number !== undefined) {
      updateFields.push("ed_invoice_payment_receipt_number = ?");
      updateParams.push(payment_receipt_number || null);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        msg: "Nenhum campo para atualizar",
      });
    }

    updateParams.push(ID);
    updateParams.push(instituteCode);

    const query = `
      UPDATE eduall_invoices
      SET ${updateFields.join(", ")}
      WHERE ed_invoice_id = ?
        AND ed_invoice_institute_code = ?
        AND COALESCE(ed_invoice_deleted, 0) = 0
    `;

    await ExecuteQuery(null, query, updateParams, false, {
      db: "eduall_invoices",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Faturação",
      description: `[ID ${operatorId}] Atualizou fatura ID ${ID}`,
    });

    const duration = Date.now() - startTime;
    console.log(`Fatura atualizada (${duration}ms)\n`);

    return res.status(200).json({
      success: true,
      msg: "Fatura atualizada com sucesso!",
    });
  } catch (error) {
    console.error(`[InvoiceUpdate] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// DELETE - ELIMINAR FATURA (soft-delete com integridade dos itens)
// ════════════════════════════════════════════════════════════════════════════════

const InvoiceDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[InvoiceDelete] Eliminando fatura ${ID}...`);
    const startTime = Date.now();

    // ─── OBTER CÓDIGO DA FATURA ANTES DE ELIMINAR ─────────────────────────
    const [invoice] = await ExecuteQuery(
      null,
      `SELECT ed_invoice_code, ed_invoice_vendus_number FROM eduall_invoices
       WHERE ed_invoice_id = ? 
         AND ed_invoice_institute_code = ?
         AND COALESCE(ed_invoice_deleted, 0) = 0
       LIMIT 1`,
      [ID, instituteCode],
      true
    );

    if (!invoice) {
      console.error(`Fatura ${ID} não encontrada`);
      return res.status(404).json({
        success: false,
        msg: "Fatura não encontrada",
      });
    }

    const invoiceCode = invoice.ed_invoice_code;
    const vendusNumber = invoice.ed_invoice_vendus_number;

    // ─── SOFT-DELETE DO CABEÇALHO ───────────────────────────────────────────
    await ExecuteQuery(
      null,
      `UPDATE eduall_invoices 
       SET ed_invoice_deleted = 1
       WHERE ed_invoice_id = ? AND ed_invoice_institute_code = ?`,
      [ID, instituteCode],
      false,
      { db: "eduall_invoices", type: "update", data: req }
    );

    console.log(`✅ Cabeçalho deletado`);

    // ─── SOFT-DELETE DOS ITENS ──────────────────────────────────────────────
    await ExecuteQuery(
      null,
      `UPDATE eduall_invoice_items 
       SET ed_invoice_item_deleted = 1
       WHERE ed_invoice_code = ? COLLATE utf8mb4_general_ci
         AND ed_invoice_item_institute_code = ?`,
      [invoiceCode, instituteCode],
      false,
      { db: "eduall_invoice_items", type: "update", data: req }
    );

    console.log(`✅ Itens deletados`);

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Faturação",
      description: `[ID ${operatorId}] Eliminou fatura ID ${ID} (código: ${invoiceCode}, Vendus: ${vendusNumber})`,
    });

    const duration = Date.now() - startTime;
    console.log(`Fatura eliminada (${duration}ms)\n`);

    return res.status(200).json({
      success: true,
      msg: "Fatura e itens eliminados com sucesso!",
    });
  } catch (error) {
    console.error(`[InvoiceDelete] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET - BUSCAR FATURA POR CÓDIGO
// ════════════════════════════════════════════════════════════════════════════════

const GetInvoiceByCode = async (req, res) => {
  try {
    const { CODE } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[GetInvoiceByCode] Buscando fatura ${CODE}...`);

    const query = `
      SELECT
        inv.*,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', it.ed_invoice_item_id,
              'title', it.ed_item_title,
              'quantity', it.ed_item_quantity,
              'unit_price', it.ed_item_unit_price,
              'discount', it.ed_item_discount_percent,
              'is_custom', it.ed_item_is_custom,
              'total', (it.ed_item_unit_price * it.ed_item_quantity) - 
                       ((it.ed_item_unit_price * it.ed_item_quantity * it.ed_item_discount_percent) / 100)
            )
          )
          FROM eduall_invoice_items it
          WHERE it.ed_invoice_code COLLATE utf8mb4_general_ci
              = inv.ed_invoice_code COLLATE utf8mb4_general_ci
            AND COALESCE(it.ed_invoice_item_deleted, 0) = 0
        ) AS items
      FROM eduall_invoices inv
      WHERE COALESCE(inv.ed_invoice_deleted, 0) = 0
        AND inv.ed_invoice_code = ? COLLATE utf8mb4_general_ci
        AND inv.ed_invoice_institute_code = ?
      LIMIT 1
    `;

    const rows = await ExecuteQuery(null, query, [CODE, instituteCode], true, {
      db: "eduall_invoices",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Fatura não encontrada",
      });
    }

    const safeData = JSON.parse(JSON.stringify(rows[0]));

    return res.status(200).json({
      success: true,
      data: safeData,
    });
  } catch (error) {
    console.error(`[GetInvoiceByCode] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// GET - BUSCAR FATURA POR NÚMERO VENDUS
// ════════════════════════════════════════════════════════════════════════════════

const GetInvoiceByVendusNumber = async (req, res) => {
  try {
    const { VENDUS_NUMBER } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({ success: false, msg: "Sessão inválida." });
    }

    console.log(`\n[GetInvoiceByVendusNumber] Buscando fatura Vendus ${VENDUS_NUMBER}...`);

    const query = `
      SELECT
        inv.*,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', it.ed_invoice_item_id,
              'title', it.ed_item_title,
              'quantity', it.ed_item_quantity,
              'unit_price', it.ed_item_unit_price,
              'discount', it.ed_item_discount_percent,
              'total', (it.ed_item_unit_price * it.ed_item_quantity) - 
                       ((it.ed_item_unit_price * it.ed_item_quantity * it.ed_item_discount_percent) / 100)
            )
          )
          FROM eduall_invoice_items it
          WHERE it.ed_invoice_code COLLATE utf8mb4_general_ci
              = inv.ed_invoice_code COLLATE utf8mb4_general_ci
            AND COALESCE(it.ed_invoice_item_deleted, 0) = 0
        ) AS items
      FROM eduall_invoices inv
      WHERE COALESCE(inv.ed_invoice_deleted, 0) = 0
        AND inv.ed_invoice_vendus_number = ?
        AND inv.ed_invoice_institute_code = ?
      LIMIT 1
    `;

    const rows = await ExecuteQuery(null, query, [VENDUS_NUMBER, instituteCode], true, {
      db: "eduall_invoices",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Fatura não encontrada",
      });
    }

    const safeData = JSON.parse(JSON.stringify(rows[0]));

    return res.status(200).json({
      success: true,
      data: safeData,
    });
  } catch (error) {
    console.error(`[GetInvoiceByVendusNumber] Erro:`, error.message);
    return res.status(500).json({
      success: false,
      msg: error.message,
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════


(async () => {
    try {
        await InitializeInvoiceTables();
    } catch (err) {
        console.error(err);
    }
})();


module.exports = {
  // Inicialização
  InitializeInvoiceTables,
  
  // Endpoints
  GetInvoices,
  GetSingleInvoice,
  GetInvoiceByCode,
  GetInvoiceByVendusNumber,
  RegisterInvoice,
  InvoiceUpdate,
  InvoiceDelete,
  
  // Helpers
  formatCurrency,
  isValidPrice,
  generateInvoiceCode,
  requiresBordereau,
};