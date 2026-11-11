// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const multer = require("multer");
const path = require("path");
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");  // Importa a função de auditoria
const { VENDUS_CreateInvoiceCodeAndDoc } = require("../Functions/VENDUS");

const generateSaleReference = () => {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < 500; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
};

 
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
      await _cacheClear(`products:${req.session.user.eduall_user_session_curentinstitute}:*`);  // CACHE-OPT: stock mudou -> lista de produtos em cache fica inválida
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


const DeleteSale = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_product_sales SET ed_product_sale_deleted = 1 WHERE ed_product_sale_id = ?`;
        const params = [ID];  
        await ExecuteQuery(res, query, params, false, { db: "eduall_product_sales", type: "update" });  

        const productQuery = `UPDATE eduall_sales_products SET ed_sale_product_deleted = 1 WHERE ed_sale_product_sale_reference = (SELECT ed_product_sale_reference FROM eduall_product_sales WHERE ed_product_sale_id = ?)`;
        await ExecuteQuery(res, productQuery, params, false, { db: "eduall_sales_products", type: "update" });

        // Registrar a ação de exclusão de venda na auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de exclusão
            form: "Vendas",
            description: `Excluiu a venda com ID ${ID}`,
        });

        console.log("Venda e produtos deletados com sucesso!")
        res.status(200).json({ msg: "Venda e produtos deletados com sucesso!" });
    } catch (error) {
        console.log( "Falha ao deletar a venda!", error)
        res.status(500).json({ msg: "Falha ao deletar a venda!", success: false, error: error.message });
    }
};


const GetSingleSale = async (req, res) => {
    try {
        const { sale_reference } = req.params;
        const query = `
            SELECT ps.ed_product_sale_id, ps.ed_product_sale_reference, ps.ed_product_sale_nif,
                   ps.ed_product_sale_payment_method, ps.ed_product_sale_discount, 
                   ps.ed_product_sale_description, ps.ed_product_sale_date,
                   ps.ed_product_sale_invoiceCode,  -- Adicionado o campo de invoiceCode
                   p.ed_product_name, p.ed_product_description, p.ed_product_picture,
                   sp.ed_sale_product_price, sp.ed_sale_product_quantity, 
                   sp.ed_sale_product_sale_reference, sp.ed_sale_product_product_id,
                   c.ed_coin_code
            FROM eduall_product_sales ps
            JOIN eduall_sales_products sp ON ps.ed_product_sale_reference = sp.ed_sale_product_sale_reference
            JOIN eduall_products p ON sp.ed_sale_product_product_id = p.ed_product_id
            LEFT JOIN eduall_coins c ON c.ed_coin_institute_code = ps.ed_product_sale_institute_code
            WHERE ps.ed_product_sale_reference = ? 
            AND ps.ed_product_sale_deleted = 0
        `;
        const PARAMS = [sale_reference];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_product_sales", type: "select" });

        if (result.length === 0) {
            return res.status(404).json({ msg: "Venda não encontrada!", success: false });
        }

        // Organizar os resultados em um objeto único com os produtos agrupados
        const sale = {
            ed_product_sale_id: result[0].ed_product_sale_id,
            ed_product_sale_reference: result[0].ed_product_sale_reference,
            ed_product_sale_nif: result[0].ed_product_sale_nif,
            ed_product_sale_payment_method: result[0].ed_product_sale_payment_method,
            ed_product_sale_discount: result[0].ed_product_sale_discount,
            ed_product_sale_description: result[0].ed_product_sale_description,
            ed_product_sale_date: result[0].ed_product_sale_date,
            ed_product_sale_invoiceCode: result[0].ed_product_sale_invoiceCode,  // Adicionado no objeto
            coin_symbol: result[0].ed_coin_code || '', // Pegando a moeda pelo instituto
            products: result.map(row => ({
                ed_product_name: row.ed_product_name,
                ed_product_description: row.ed_product_description,
                ed_product_picture: row.ed_product_picture,
                ed_sale_product_price: row.ed_sale_product_price,
                ed_sale_product_quantity: row.ed_sale_product_quantity,
                ed_sale_product_sale_reference: row.ed_sale_product_sale_reference,
                ed_sale_product_product_id: row.ed_sale_product_product_id
            }))
        }; 
        res.status(200).json(sale);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter a venda!", success: false, error: error.message });
    }
};


module.exports = { GetProductSales, RegisterSale, GetSingleSale, DeleteSale }; 
