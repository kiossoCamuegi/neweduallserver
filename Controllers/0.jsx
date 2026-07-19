 
async function getOperatorData(res, userId) {
  if (!userId) return null;

  try {
    const query = `
      SELECT ed_user_account_id, ed_user_account_name
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
        name: operator.ed_user_account_name || "Operador Desconhecido"
      };
    }

    return null;
  } catch (error) {
    console.warn("Erro ao buscar dados do operador:", error.message);
    return null;
  }
}
 
// ════════════════════════════════════════════════════════════════════════════════
// 3. PAGAMENTO DE PROPINAS
// ════════════════════════════════════════════════════════════════════════════════

const GetFeepayments = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    const query = `
      SELECT 
        efp.*,
        st.ed_student_id,
        st.ed_student_name,
        st.ed_student_code,
        s.ed_service_id,
        s.ed_service_title,
        c.ed_coin_code,
        c.ed_coin_code,
        ua.ed_user_account_name AS operator_name,
        ua.ed_user_account_id AS operator_id,
        (
          SELECT JSON_ARRAYAGG(
            JSON_OBJECT(
              'id', ex.ed_fee_additional_id,
              'description', ex.description,
              'amount', ex.amount,
              'created_at', ex.created_at
            )
          )
          FROM eduall_fee_additional_items ex
          WHERE ex.invoice_code = efp.ed_fee_payment_invoiceCode
            AND ex.institute_code = efp.ed_fee_payment_institute_code
            AND COALESCE(ex.ed_fee_additional_deleted,0)=0
        ) AS extras
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
      WHERE efp.ed_fee_payment_deleted = 0
        AND efp.ed_fee_payment_institute_code = ?
      ORDER BY efp.ed_fee_payment_registerDate DESC
    `;

    const PARAMS = [institute, operatorId, institute];

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_fees_payments",
      type: "select",
      data: req
    });

    // Adicionar informação de operador
    const enrichedRows = rows.map(row => ({
      ...row,
      operator: operator?.name || "operator:null",
      operator_id: operator?.id || null
    }));

    res.status(200).json(enrichedRows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar os pagamentos de taxa!",
      error: error.message
    });
  }
};

const RegisterFeepayment = async (req, res) => {
  function computeItemTotals({ price, discountPct = 0, fineType = 0, fineValue = 0, applyIVA = false, instituteIVAPct = 0 }) {
    const discountAmount = discountPct > 0 ? (price * discountPct) / 100 : 0;
    const priceAfterDiscount = Math.max(0, price - discountAmount);
    const fineAmount = fineType * 1 === 1 ? fineValue * 1 : fineValue > 0 ? (priceAfterDiscount * fineValue) / 100 : 0;
    const ivaAmount = applyIVA ? (priceAfterDiscount * instituteIVAPct) / 100 : 0;
    const lineTotal = priceAfterDiscount + fineAmount + ivaAmount;
    return { discountAmount, fineAmount, ivaAmount, lineTotal, baseAfterDiscount: priceAfterDiscount };
  }

  function monthLabel(mdotY) {
    const m = String(mdotY).split(".")[0] * 1;
    const y = String(mdotY).split(".")[1] * 1;
    const N = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
    if (Number.isFinite(m) && Number.isFinite(y)) return `${N[m]} / ${y}`;
    return String(mdotY);
  }

  function sanitizeExtras(extras) {
    if (!Array.isArray(extras)) return [];
    return extras
      .map(e => ({
        name: String(e?.name || "").trim(),
        value: Number(String(e?.value ?? "").toString().replace(",", "."))
      }))
      .filter(e => e.name.length > 0 && Number.isFinite(e.value) && e.value > 0);
  }

  try {
    const sessionInstitute = req.session?.user?.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    if (!sessionInstitute) return res.status(401).json({ success: false, msg: "Sessão inválida." });

    const {
      studentId, academicYearId, paymentType,
      bankName = "", paymentPlace = "", bordereux = "",
      items = [], extraServices = []
    } = req.body || {};

    if (!studentId || !academicYearId || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ success: false, msg: "Dados incompletos." });
    }

    const addons = sanitizeExtras(extraServices);

    // 1) Student
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
    if (!student) return res.status(404).json({ success: false, msg: "Estudante não encontrado." });

    // 2) Verificar duplicados
    const months = [...new Set(items.map(i => i.month))];
    const placeholdersM = months.map(_ => "?").join(",");
    const dupSql = `
      SELECT ed_fee_payment_month AS month
      FROM eduall_fees_payments
      WHERE ed_fee_payment_institute_code = ?
        AND ed_fee_payment_student = ?
        AND ed_fee_payment_academic_year = ?
        AND ed_fee_payment_month IN (${placeholdersM})
        AND COALESCE(ed_fee_payment_deleted,0)=0
      GROUP BY ed_fee_payment_month
    `;
    const dupRows = await ExecuteQuery(res, dupSql, [sessionInstitute, studentId, academicYearId, ...months], true);
    if (dupRows?.length) {
      const paidLabels = dupRows.map(r => monthLabel(r.month));
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_MONTHS",
        msg: `Os seguintes meses já foram pagos: ${paidLabels.join(", ")}.`,
        monthsPaid: dupRows.map(r => String(r.month))
      });
    }

    // 3) IVA
    const ivaSql = `SELECT COALESCE(ed_institute_iva_value,0) AS iva, ed_institute_name FROM eduall_institutes WHERE ed_institute_code=? LIMIT 1`;
    const [ivaRow] = await ExecuteQuery(res, ivaSql, [sessionInstitute], true);
    const instituteIVAPct = ivaRow?.iva * 1 || 0;
    const instituteName = ivaRow?.ed_institute_name || "";

    // 4) Calcular
    const invoiceLines = [];
    const dbRows = [];
    let grandTotal = 0;

    for (const it of items) {
      const { serviceId, month, price, discountPct = 0, fineType = 0, fineValue = 0, applyIVA = 0 } = it;
      const calc = computeItemTotals({
        price: price * 1, discountPct, fineType, fineValue,
        applyIVA: !!applyIVA, instituteIVAPct
      });

      invoiceLines.push({
        itemcode: `EDSERV-${serviceId}`,
        title: `Propina ${monthLabel(month)}`,
        price: Number(calc.baseAfterDiscount.toFixed(2)),
        tax: applyIVA ? 1 : 0, discount: 0, quantity: "1"
      });

      if(calc.fineAmount > 0){
        invoiceLines.push({
          itemcode: "FINE001",
          title: "Multa por atraso",
          price: Number(calc.fineAmount.toFixed(2)),
          tax: 0, discount: 0, quantity: "1"
        });
      }

      grandTotal += calc.lineTotal;

      dbRows.push({
        studentId, serviceId, price: price * 1, month, discountPct, type: paymentType,
        bankName, academicYearId, place: paymentPlace, balance: Number(calc.lineTotal.toFixed(2)),
        bordereux, ivaPct: applyIVA ? instituteIVAPct : 0, fineType,
        fineValue: Number(calc.fineAmount.toFixed(2))
      });
    }

    if (addons.length) {
      addons.forEach((ex, idx) => {
        invoiceLines.push({
          itemcode: `EXTRA-${String(idx + 1).padStart(2, "0")}`,
          title: ex.name, price: Number(Number(ex.value).toFixed(2)),
          tax: 0, discount: 0, quantity: "1"
        });
        grandTotal += ex.value * 1;
      });
    }

    // 5) Observações
    const obsParts = [];
    obsParts.push(`Nº matrícula: ${student.ed_student_code || "-"}`);
    if (student.ed_class_title) obsParts.push(`Turma: ${student.ed_class_title}`);
    if (student.ed_classroom_title) obsParts.push(`Sala: ${student.ed_classroom_title}`);
    if (student.ed_course_title) obsParts.push(`Curso: ${student.ed_course_title}`);
    if (student.ed_academic_year_title) obsParts.push(`Ano letivo: ${student.ed_academic_year_title}`);
    if (instituteName) obsParts.push(`Instituição: ${instituteName}`);
    if (operator) obsParts.push(`Operador: ${operator.name}`);
    const obs = obsParts.join("\n");

    // 6) Cliente
    const customer = {
      name: student.ed_student_name || "",
      fiscal_id: student.ed_student_identityCard || "",
      address: student.ed_student_address || "",
      email: student.ed_student_email || ""
    };

    // 7) Criar fatura
    const vendus = await VENDUS_CreateInvoiceCodeAndDoc(req, customer, invoiceLines, paymentType, obs);
    if (!vendus?.number) {
      return res.status(500).json({ success: false, msg: "Falha ao criar fatura." });
    }

    // 8) Transação BD
    await ExecuteQuery(res, "START TRANSACTION", [], false);

    // 8.a) Inserir propinas COM operador
    const insertSql = `
      INSERT INTO eduall_fees_payments (
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
        ed_fee_payment_iva,
        ed_fee_payment_code,
        ed_fee_payment_fineType,
        ed_fee_payment_fineValue,
        ed_fee_payment_invoiceCode,
        ed_fee_payment_invoiceFile,
        ed_fee_payment_institute_code,
        ed_fee_payment_operator,
        ed_fee_payment_operator_id
      ) VALUES
      ${dbRows.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}
    `;
    const params = [];
    for (const r of dbRows) {
      params.push(
        r.studentId, r.serviceId, r.price, r.month, r.discountPct, r.type, r.bankName,
        r.academicYearId, r.place, r.balance, r.bordereux, r.ivaPct, null, r.fineType,
        r.fineValue, vendus.number, vendus.id, sessionInstitute,
        operator?.name || "operator:null",      // ← NOVO
        operator?.id || null                     // ← NOVO
      );
    }
    await ExecuteQuery(res, insertSql, params, false);

    // 8.b) Persistir extras
    if (addons.length) {
      try {
        const addSql = `
          INSERT INTO eduall_fee_additional_items
            (student_id, academic_year_id, description, amount, invoice_code, invoice_id, institute_code, operator, operator_id)
          VALUES
            ${addons.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}
        `;
        const addParams = [];
        addons.forEach(a => {
          addParams.push(
            studentId, academicYearId, a.name,
            Number(Number(a.value).toFixed(2)),
            vendus.number, vendus.id, sessionInstitute,
            operator?.name || "operator:null",  // ← NOVO
            operator?.id || null                 // ← NOVO
          );
        });
        await ExecuteQuery(res, addSql, addParams, false);
      } catch (auxErr) {
        console.warn("Persistência de extras ignorada:", auxErr?.message || auxErr);
      }
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Pagamentos de propinas (lote)",
      description: `[${operator?.name || "Desconhecido"}] Registrou ${dbRows.length} linha(s) + ${addons.length} extra(s) para aluno ${student.ed_student_code}. Fatura ${vendus.number}. Total: ${grandTotal.toFixed(2)}.`
    });

    await ExecuteQuery(res, "COMMIT", [], false);

    return res.status(200).json({
      success: true,
      invoice: vendus,
      inserted: dbRows.length,
      extrasInserted: addons.length,
      extras: addons,
      total: Number(grandTotal.toFixed(2)),
      operator: operator?.name || "operator:null"
    });
  } catch (err) {
    try { await ExecuteQuery(res, "ROLLBACK", [], false); } catch {}
    console.error("RegisterFeepayment error:", err);
    return res.status(500).json({ success: false, msg: "Erro no processamento.", error: String(err?.message || err) });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 4. VENDA DE PRODUTOS
// ════════════════════════════════════════════════════════════════════════════════

const GetProductSales = async (req, res) => {
  try {
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    const query = `
      SELECT 
        ps.*,
        p.ed_product_name,
        p.ed_product_description,
        p.ed_product_picture,
        sp.ed_sale_product_price,
        sp.ed_sale_product_quantity,
        sp.ed_sale_product_sale_reference,
        sp.ed_sale_product_product_id,
        c.ed_coin_code,
        ua.ed_user_account_name AS operator_name,
        ua.ed_user_account_id AS operator_id
      FROM eduall_product_sales ps
      JOIN eduall_sales_products sp ON ps.ed_product_sale_reference = sp.ed_sale_product_sale_reference
      JOIN eduall_products p ON sp.ed_sale_product_product_id = p.ed_product_id
      LEFT JOIN eduall_coins c ON c.ed_coin_institute_code = ps.ed_product_sale_institute_code
      LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = ? AND ua.ed_user_account_deleted = 0
      WHERE ps.ed_product_sale_institute_code = ?
        AND ps.ed_product_sale_deleted = 0
      ORDER BY ps.ed_product_sale_date DESC
    `;

    const PARAMS = [operatorId, req.session.user.eduall_user_session_curentinstitute];
    const result = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_product_sales",
      type: "select"
    });

    const sales = result.reduce((acc, row) => {
      let sale = acc.find(s => s.ed_product_sale_id === row.ed_product_sale_id);
      if (!sale) {
        sale = {
          ed_product_sale_id: row.ed_product_sale_id,
          ed_product_sale_reference: row.ed_product_sale_reference,
          ed_product_sale_nif: row.ed_product_sale_nif,
          ed_product_sale_invoiceFile: row.ed_product_sale_invoiceFile,
          ed_product_sale_payment_method: row.ed_product_sale_payment_method,
          ed_product_sale_discount: row.ed_product_sale_discount,
          ed_product_sale_description: row.ed_product_sale_description,
          ed_product_sale_date: row.ed_product_sale_date,
          ed_product_sale_invoiceCode: row.ed_product_sale_invoiceCode,
          coin_symbol: row.ed_coin_code || '',
          operator: operator?.name || "operator:null",
          operator_id: operator?.id || null,
          products: []
        };
        acc.push(sale);
      }

      sale.products.push({
        ed_product_name: row.ed_product_name,
        ed_product_description: row.ed_product_description,
        ed_product_picture: row.ed_product_picture,
        ed_sale_product_price: row.ed_sale_product_price,
        ed_sale_product_quantity: row.ed_sale_product_quantity,
        ed_sale_product_sale_reference: row.ed_sale_product_sale_reference,
        ed_sale_product_product_id: row.ed_sale_product_product_id
      });

      return acc;
    }, []);

    res.status(200).json(sales);
  } catch (error) {
    res.status(500).json({
      msg: "Falha ao obter os produtos da venda!",
      success: false,
      error: error.message
    });
  }
};

const RegisterSale = async (req, res) => {
  const { sale_nif, sale_payment_method, sale_discount, sale_description, product_to_sale } = req.body;

  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    const productIds = product_to_sale.map(p => p.product_id);

    if (!productIds.length) {
      return res.status(400).json({ msg: "Nenhum produto selecionado.", success: false });
    }

    const placeholders = productIds.map(() => '?').join(',');
    const fetchProductsQuery = `
      SELECT ed_product_id, ed_product_name, ed_product_sale_price, ed_product_stock_amount
      FROM eduall_products
      WHERE ed_product_id IN (${placeholders}) AND ed_product_deleted = 0 AND ed_product_institute_code = ?
    `;
    const fetchProductsParams = [...productIds, instituteCode];
    const dbProducts = await ExecuteQuery(res, fetchProductsQuery, fetchProductsParams, true);

    if (!dbProducts.length) {
      return res.status(404).json({ msg: "Nenhum dos produtos foi encontrado no sistema.", success: false });
    }

    const dbProductsMap = {};
    dbProducts.forEach(p => {
      dbProductsMap[p.ed_product_id] = p;
    });

    const Items = product_to_sale.map(prod => {
      const dbProduct = dbProductsMap[prod.product_id];
      return {
        itemcode: 'PROD-' + prod.product_id,
        title: dbProduct?.ed_product_name || 'Produto Desconhecido',
        price: dbProduct?.ed_product_sale_price || 0,
        quantity: prod.product_quantity,
        tax: false,
        discount: sale_discount || 0
      };
    });

    const customerfilterData = {
      name: "Consumidor Final",
      fiscal_id: sale_nif,
      address: "",
      email: ""
    };

    // Adicionar operador nas observações
    const obs = operator ? `Operador: ${operator.name}` : "operator:null";

    const invoiceData = await VENDUS_CreateInvoiceCodeAndDoc(
      req,
      customerfilterData,
      Items,
      sale_payment_method,
      obs
    );

    if (!invoiceData.number) {
      return res.status(500).json({
        success: false,
        msg: "Não foi possível gerar a fatura!",
        error: "Erro ao criar fatura!"
      });
    }

    const saleQuery = `
      INSERT INTO eduall_product_sales (
        ed_product_sale_reference,
        ed_product_sale_nif,
        ed_product_sale_payment_method,
        ed_product_sale_discount,
        ed_product_sale_description,
        ed_product_sale_date,
        ed_product_sale_invoiceCode,
        ed_product_sale_invoiceFile,
        ed_product_sale_institute_code,
        ed_product_sale_operator,
        ed_product_sale_operator_id
      ) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)
    `;

    const saleParams = [
      invoiceData.number,
      sale_nif,
      sale_payment_method,
      sale_discount,
      sale_description,
      invoiceData.number,
      invoiceData.id,
      instituteCode,
      operator?.name || "operator:null",    // ← NOVO
      operator?.id || null                   // ← NOVO
    ];

    await ExecuteQuery(res, saleQuery, saleParams, false);

    for (let prod of product_to_sale) {
      const dbProd = dbProductsMap[prod.product_id];

      if (!dbProd || dbProd.ed_product_stock_amount < prod.product_quantity) {
        return res.status(400).json({
          msg: `Estoque insuficiente para o produto ${prod.product_id}.`,
          success: false
        });
      }

      const insertSaleProductQuery = `
        INSERT INTO eduall_sales_products (
          ed_sale_product_sale_reference,
          ed_sale_product_product_id,
          ed_sale_product_price,
          ed_sale_product_quantity
        ) VALUES (?, ?, ?, ?)
      `;
      const insertSaleProductParams = [
        invoiceData.number,
        prod.product_id,
        dbProd.ed_product_sale_price,
        prod.product_quantity
      ];
      await ExecuteQuery(res, insertSaleProductQuery, insertSaleProductParams, false);

      const updateStockQuery = `
        UPDATE eduall_products
        SET ed_product_stock_amount = ed_product_stock_amount - ?
        WHERE ed_product_id = ? AND ed_product_institute_code = ?
      `;
      const updateStockParams = [prod.product_quantity, prod.product_id, instituteCode];
      await ExecuteQuery(res, updateStockQuery, updateStockParams, false);
    }

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Vendas de Produtos",
      description: `[${operator?.name || "Desconhecido"}] Registrou uma nova venda com a referência ${invoiceData.number}`
    });

    res.status(201).json({
      msg: "Venda registrada com sucesso!",
      success: true,
      invoice: invoiceData,
      operator: operator?.name || "operator:null"
    });

  } catch (error) {
    console.log(error.message);
    res.status(500).json({
      msg: "Falha ao registrar a venda!",
      success: false,
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 5. PAGAMENTO DE TRANSPORTE
// ════════════════════════════════════════════════════════════════════════════════

const GetTransportPayments = async (req, res) => {
  try {
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    const query = `
      SELECT 
        etp.*,
        etp2.ed_transport_passenger_id,
        etp2.ed_transport_passenger_code,
        st.ed_student_id,
        st.ed_student_name,
        st.ed_student_code,
        s.ed_service_id,
        s.ed_service_title,
        c.ed_coin_code,
        ua.ed_user_account_name AS operator_name,
        ua.ed_user_account_id AS operator_id
      FROM eduall_transport_payments etp
      LEFT JOIN eduall_transport_passengers etp2 ON etp2.ed_transport_passenger_id = etp.ed_transport_payment_student
      LEFT JOIN eduall_students st ON st.ed_student_id = etp2.ed_transport_passenger_code
      LEFT JOIN eduall_services s ON s.ed_service_id = etp.ed_transport_payment_service
      LEFT JOIN eduall_coins c ON c.ed_coin_id = s.ed_service_coin
      LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = ? AND ua.ed_user_account_deleted = 0
      WHERE etp.ed_transport_payment_deleted = 0
        AND etp.ed_transport_payment_institute_code = ?
      ORDER BY etp.ed_transport_payment_registerDate DESC
    `;

    const PARAMS = [operatorId, req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_transport_payments",
      type: "select",
      data: req
    });

    const enrichedRows = rows.map(row => ({
      ...row,
      operator: operator?.name || "operator:null",
      operator_id: operator?.id || null
    }));

    res.status(200).json(enrichedRows);
  } catch (err) {
    res.status(400).json({ status: 300, success: false, msg: err.message });
  }
};

const RegisterTransportPayments = async (req, res) => {
  try {
    const sessionInstitute = req.session.user.eduall_user_session_curentinstitute;
    const operatorId = req.session?.user?.eduall_user_session_ID;
    const operator = await getOperatorData(res, operatorId);

    // Itens da fatura
    const Items = [
      {
        itemcode: 'EDTRANS-' + req.body.transportpayment_servicecode,
        title: 'Pag. transporte - ' + FACTPLUS_decodificarMesEAno(req.body.transportpayment_months),
        price: req.body.transportpayment_price,
        tax: req.body.transportpayment_iva * 1 > 0,
        discount: req.body.transportpayment_discount
      }
    ];

    if (req.body.transportpayment_fineValue * 1 !== 0) {
      Items.push({
        itemcode: 'FINE001',
        title: 'Multa por atraso no transporte',
        price: req.body.transportpayment_fineValue,
        quantity: '1',
        tax: false,
        discount: '0'
      });
    }

    // Buscar dados do estudante
    const CLIENT_DATA = await getSingleStudentByInstitute(
      sessionInstitute,
      req.session.user.eduall_user_session_curentinstitute_type,
      req.body.student_code
    );

    if (CLIENT_DATA.length === 0) {
      return res.status(500).json({ success: false, msg: "Estudante não encontrado!" });
    }

    let classInfo = null;
    if (CLIENT_DATA[0].ed_student_class) {
      const queryClass = `
        SELECT eduall_class.*, 
               eduall_classrooms.ed_classroom_title, 
               eduall_courses.ed_course_title, 
               eduall_academic_year.ed_academic_year_title,
               eduall_institutes.ed_institute_name
        FROM eduall_class
        LEFT JOIN eduall_classrooms ON eduall_classrooms.ed_classroom_id = eduall_class.ed_class_room
        LEFT JOIN eduall_courses ON eduall_courses.ed_course_id = eduall_class.ed_class_course
        LEFT JOIN eduall_academic_year ON eduall_academic_year.ed_academic_year_id = eduall_class.ed_class_year
        LEFT JOIN eduall_institutes ON eduall_institutes.ed_institute_code = eduall_class.ed_class_institute_code
        WHERE eduall_class.ed_class_deleted = 0 
          AND eduall_class.ed_class_id = ? 
          AND eduall_class.ed_class_institute_code = ?
          AND eduall_academic_year.ed_academic_year_deleted = 0
          AND eduall_courses.ed_course_deleted = 0
          AND eduall_classrooms.ed_classroom_deleted = 0
          AND eduall_institutes.ed_institute_deleted = 0
      `;
      const paramsClass = [CLIENT_DATA[0].ed_student_class, sessionInstitute];
      const classRows = await ExecuteQuery(null, queryClass, paramsClass, true);
      if (classRows.length > 0) classInfo = classRows[0];
    }

    // Observações
    const obsParts = [];
    obsParts.push(` `);
    if (classInfo?.ed_class_title) obsParts.push(`Turma: ${classInfo.ed_class_title}`);
    if (CLIENT_DATA[0]?.ed_student_code) obsParts.push(`Nº matrícula: ${CLIENT_DATA[0].ed_student_code}`);
    if (classInfo?.ed_classroom_title) obsParts.push(`Sala: ${classInfo.ed_classroom_title}`);
    if (classInfo?.ed_course_title) obsParts.push(`Curso: ${classInfo.ed_course_title}`);
    if (classInfo?.ed_academic_year_title) obsParts.push(`Ano lectivo: ${classInfo.ed_academic_year_title}`);
    if (classInfo?.ed_institute_name) obsParts.push(`Nome da instituição: ${classInfo.ed_institute_name}`);
    if (operator) obsParts.push(`Operador: ${operator.name}`);
    obsParts.push(``);

    const obs = obsParts.join("\n");

    const customerfilterData = {
      name: CLIENT_DATA[0].ed_student_name,
      fiscal_id: CLIENT_DATA[0].ed_student_identityCard,
      address: CLIENT_DATA[0].ed_student_address,
      email: CLIENT_DATA[0].ed_student_email
    };

    const invoiceData = await VENDUS_CreateInvoiceCodeAndDoc(
      req,
      customerfilterData,
      Items,
      req.body.transportpayment_type,
      obs
    );

    if (!invoiceData.number) {
      return res.status(500).json({
        success: false,
        msg: "Lamentamos, mas não foi possível gerar a fatura!",
        error: "Erro criando fatura!"
      });
    }

    const query = `
      INSERT INTO eduall_transport_payments(
        ed_transport_payment_student,
        ed_transport_payment_service,
        ed_transport_payment_price,
        ed_transport_payment_month,
        ed_transport_payment_discount,
        ed_transport_payment_type,
        ed_transport_payment_bank,
        ed_transport_payment_academic_year,
        ed_transport_payment_place,
        ed_transport_payment_balance,
        ed_transport_payment_bordereux,
        ed_transport_payment_iva,
        ed_transport_payment_code,
        ed_transport_payment_fineType,
        ed_transport_payment_fineValue,
        ed_transport_payment_invoiceCode,
        ed_transport_payment_invoiceFile,
        ed_transport_payment_institute_code,
        ed_transport_payment_operator,
        ed_transport_payment_operator_id
      )
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `;

    const PARAMS = [
      req.body.transportpayment_student_code,
      req.body.transportpayment_servicecode,
      req.body.transportpayment_price,
      req.body.transportpayment_months,
      req.body.transportpayment_discount,
      req.body.transportpayment_type,
      req.body.transportpayment_bank,
      req.body.transportpayment_academic_year,
      req.body.transportpayment_place,
      req.body.transportpayment_balance,
      req.body.transportpayment_bordereux_number,
      req.body.transportpayment_iva,
      req.body.transportpayment_code,
      req.body.transportpayment_fineType,
      req.body.transportpayment_fineValue,
      invoiceData.number,
      invoiceData.id,
      sessionInstitute,
      operator?.name || "operator:null",    // ← NOVO
      operator?.id || null                   // ← NOVO
    ];

    const QueryResult = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_transport_payments",
      type: "insert",
      data: req
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Pagamentos de Transporte",
      description: `[${operator?.name || "Desconhecido"}] Registrou novo pagamento de transporte para aluno ${req.body.transportpayment_student_code}, valor ${req.body.transportpayment_price}`
    });

    res.status(200).json({
      ...QueryResult,
      operator: operator?.name || "operator:null"
    });

  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Falha ao registrar o pagamento de transporte!",
      error: error.message
    });
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetServicePayments,
  RegisterServicePayment,
  GetFeepayments,
  RegisterFeepayment,
  GetProductSales,
  RegisterSale,
  GetTransportPayments,
  RegisterTransportPayments,
  getOperatorData  // Export helper para uso em outros controllers se necessário
};