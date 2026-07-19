 

const moment = require('moment');
const fs = require('fs').promises;  // ← MUDANÇA CRÍTICA: .promises para async
const path = require('path');
const ExecuteQuery = require('./ExecuteQuery');

// Diretório para guardar SAF-T (caminho absoluto, não relativo!)
const SAF_T_OUTPUT_DIR = path.resolve(__dirname, '../saf-t-reports');

// ─────────────────────────────────────────────────────────────────────────
// INICIALIZAÇÃO: Garantir que diretório existe
// ─────────────────────────────────────────────────────────────────────────

async function ensureSaftDirectory() {
  try {
    await fs.mkdir(SAF_T_OUTPUT_DIR, { recursive: true });
  } catch (err) {
    console.error(`❌ Erro ao criar diretório SAF-T: ${err.message}`);
  }
}

// Chamar isto no app.js durante startup
// ensureSaftDirectory();

// ─────────────────────────────────────────────────────────────────────────
// GERAÇÃO DO XML (idêntico ao original)
// ─────────────────────────────────────────────────────────────────────────

const generateXML = (paymentData, institutionData) => {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<SAFT>\n';
  xml += '  <Header style="background-color: purple; color: white;">\n';
  xml += `    <InstitutionName>${institutionData.ed_institute_name}</InstitutionName>\n`;
  xml += `    <InstitutionNIF>${institutionData.ed_institute_nif}</InstitutionNIF>\n`;
  xml += `    <InstitutionCountry>${institutionData.ed_institute_country}</InstitutionCountry>\n`;
  xml += '  </Header>\n';
  xml += '  <Payments>\n';

  paymentData.forEach((payment, index) => {
    let total = 0;
    let service = payment.service;
    let totalNotFormatted = 0;

    // Stripe styling based on index
    let stripeColor = index % 2 === 0 ? 'background-color: #e0b0d3;' : 'background-color: #f0d0e3;';

    if (payment.paymentid === 0) { // Fee Payment
      total = payment.ed_fee_payment_price * 1 - ((payment.ed_fee_payment_price * payment.ed_fee_payment_discount) / 100) + 
              (payment.ed_fee_payment_iva * 1 <= 0 ? 0 : (payment.ed_fee_payment_price * payment.ed_fee_payment_iva) / 100) + 
              (payment.ed_fee_payment_fineType * 1 === 1 ? payment.ed_fee_payment_fineValue * 1 : 
              (payment.ed_fee_payment_price * 1 * payment.ed_fee_payment_fineValue * 1) / 100);
      totalNotFormatted = total;
    }

    if (payment.paymentid === 1) { // Transport Payment
      total = payment.ed_transport_payment_price * 1 - ((payment.ed_transport_payment_price * payment.ed_transport_payment_discount) / 100) + 
              (payment.ed_transport_payment_iva * 1 <= 0 ? 0 : (payment.ed_transport_payment_price * payment.ed_transport_payment_iva) / 100) + 
              (payment.ed_transport_payment_fineType * 1 === 1 ? payment.ed_transport_payment_fineValue * 1 : 
              (payment.ed_transport_payment_price * 1 * payment.ed_transport_payment_fineValue * 1) / 100);
      totalNotFormatted = total;
    }

    if (payment.paymentid === 2) { // Service Payment
      total = (payment.ed_service_payment_amount * payment.ed_service_payment_price) - 
              ((payment.ed_service_payment_price * payment.ed_service_payment_amount * payment.ed_service_payment_discount) / 100);
      totalNotFormatted = total;
    }

    if (payment.paymentid === 3) { // Product Sale
      let totalPaid = 0;
      let totalProducts = 0;
      let totalDiscountValue = 0;
      let discountPercentage = payment.ed_product_sale_discount;
      let coinSymbol = payment.coin_symbol || ''; 

      payment.products.forEach((product) => {
        totalProducts += product.ed_sale_product_quantity;
        let productTotal = product.ed_sale_product_price * product.ed_sale_product_quantity;
        totalPaid += productTotal - (productTotal * discountPercentage / 100);
        totalDiscountValue += productTotal * discountPercentage / 100;
      });

      total = totalPaid;
      totalNotFormatted = total;
    }

    xml += `    <Payment style="${stripeColor}">\n`;
    xml += `      <InvoiceCode>${payment.invoiceCode}</InvoiceCode>\n`;
    xml += `      <Service>${service}</Service>\n`;
    xml += `      <Amount>${totalNotFormatted}</Amount>\n`;
    xml += `      <Date>${payment.paymentdate}</Date>\n`;
    xml += `      <PaymentType>${payment.paymenttype}</PaymentType>\n`;
    xml += '    </Payment>\n';
  });

  xml += '  </Payments>\n';
  xml += '</SAFT>\n';

  return xml;
};

// ─────────────────────────────────────────────────────────────────────────
// QUERIES (idênticas ao original, apenas renomeadas)
// ─────────────────────────────────────────────────────────────────────────

const GetTransportPayments = async (req) => {
  try {
    console.log('Buscando pagamentos de transporte...');
    const query = `SELECT * FROM eduall_transport_payments
    LEFT JOIN eduall_transport_passengers ON eduall_transport_passengers.ed_transport_passenger_id = eduall_transport_payments.ed_transport_payment_student
    LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_transport_passengers.ed_transport_passenger_code
    LEFT JOIN eduall_services ON eduall_services.ed_service_id = eduall_transport_payments.ed_transport_payment_service
    LEFT JOIN eduall_coins ON eduall_coins.ed_coin_id = eduall_services.ed_service_coin 
    WHERE eduall_transport_payments.ed_transport_payment_deleted = 0
    AND eduall_transport_payments.ed_transport_payment_institute_code = ? ORDER BY ed_transport_payment_registerDate DESC`;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(req, query, PARAMS, true, { db: "eduall_transport_payments", type: "select", data: req });
    console.log('✅ Pagamentos de transporte obtidos com sucesso!');
    return rows;
  } catch (err) {
    console.error("❌ Erro ao buscar pagamentos de transporte:", err);
    throw new Error("Falha ao obter os pagamentos de transporte: " + err.message);
  }
};

const GetServicePayments = async (req) => { 
  try {
    console.log('Buscando pagamentos de serviço...');
    const query = `SELECT * FROM eduall_service_payments 
    LEFT JOIN eduall_services ON ed_service_id = ed_service_payment_service
    LEFT JOIN eduall_students ON ed_student_id = ed_service_payment_student_code
    LEFT JOIN eduall_coins ON eduall_coins.ed_coin_id = eduall_services.ed_service_coin
    WHERE ed_service_payment_deleted = 0 AND ed_service_payment_institute_code = ?`;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(req, query, PARAMS, true, { db: "eduall_service_payments", type: "select", data: req });
    console.log('✅ Pagamentos de serviço obtidos com sucesso!');
    return rows;
  } catch (error) {
    console.error("❌ Erro ao buscar pagamentos de serviço:", error);
    throw new Error("Falha ao obter os pagamentos de serviço: " + error.message);
  }
};

const GetFeepayments = async (req) => {
  try {
    console.log('Buscando pagamentos de taxa...');
    const query = `SELECT * FROM eduall_fees_payments 
    LEFT JOIN eduall_students ON eduall_fees_payments.ed_fee_payment_student = eduall_students.ed_student_id
    LEFT JOIN eduall_services ON eduall_fees_payments.ed_fee_payment_service = eduall_services.ed_service_id
    LEFT JOIN eduall_coins ON eduall_coins.ed_coin_id = eduall_services.ed_service_coin 
    WHERE eduall_fees_payments.ed_fee_payment_deleted = 0 AND eduall_students.ed_student_deleted = 0 AND eduall_services.ed_service_deleted = 0
    AND eduall_fees_payments.ed_fee_payment_institute_code = ? ORDER BY ed_fee_payment_registerDate DESC`;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(req, query, PARAMS, true, { db: "eduall_fees_payments", type: "select", data: req });
    console.log('✅ Pagamentos de taxa obtidos com sucesso!');
    return rows;
  } catch (error) {
    console.error("❌ Erro ao buscar pagamentos de taxa:", error);
    throw new Error("Falha ao obter os pagamentos de taxa: " + error.message);
  }
};

const GetProductSales = async (req) => {
  try {
    console.log('Buscando vendas de produtos...');
    const query = `
      SELECT ps.ed_product_sale_id, ps.ed_product_sale_reference, ps.ed_product_sale_nif,
             ps.ed_product_sale_payment_method, ps.ed_product_sale_discount, 
             ps.ed_product_sale_description, ps.ed_product_sale_date,
             ps.ed_product_sale_invoiceCode, 
             p.ed_product_name, p.ed_product_description, p.ed_product_picture,
             sp.ed_sale_product_price, sp.ed_sale_product_quantity, 
             sp.ed_sale_product_sale_reference, sp.ed_sale_product_product_id,
             c.ed_coin_code
      FROM eduall_product_sales ps
      JOIN eduall_sales_products sp ON ps.ed_product_sale_reference = sp.ed_sale_product_sale_reference
      JOIN eduall_products p ON sp.ed_sale_product_product_id = p.ed_product_id
      LEFT JOIN eduall_coins c ON c.ed_coin_institute_code = ps.ed_product_sale_institute_code
      WHERE ps.ed_product_sale_institute_code = ?
      AND ps.ed_product_sale_deleted = 0
    `;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const result = await ExecuteQuery(req, query, PARAMS, true, { db: "eduall_product_sales", type: "select" });

    // Organizar os resultados em um array de vendas, com os produtos agrupados
    const sales = result.reduce((acc, row) => {
      let sale = acc.find(s => s.ed_product_sale_id === row.ed_product_sale_id);
      
      if (!sale) {
        sale = {
          ed_product_sale_id: row.ed_product_sale_id,
          ed_product_sale_reference: row.ed_product_sale_reference,
          ed_product_sale_nif: row.ed_product_sale_nif,
          ed_product_sale_payment_method: row.ed_product_sale_payment_method,
          ed_product_sale_discount: row.ed_product_sale_discount,
          ed_product_sale_description: row.ed_product_sale_description,
          ed_product_sale_date: row.ed_product_sale_date,
          ed_product_sale_invoiceCode: row.ed_product_sale_invoiceCode,
          products: [],
          coin_symbol: row.ed_coin_code
        };
        acc.push(sale);
      }
      
      sale.products.push({
        ed_product_name: row.ed_product_name,
        ed_product_description: row.ed_product_description,
        ed_product_picture: row.ed_product_picture,
        ed_sale_product_price: row.ed_sale_product_price,
        ed_sale_product_quantity: row.ed_sale_product_quantity,
      });
      
      return acc;
    }, []);

    console.log('✅ Vendas de produtos obtidas com sucesso!');
    return sales;
  } catch (error) {
    console.error("❌ Erro ao buscar vendas de produtos:", error);
    throw new Error("Falha ao obter as vendas de produtos: " + error.message);
  }
};

const GetInstitutionData = async (req) => {
  try {
    console.log('Buscando dados da instituição...');
    const query = `SELECT ed_institute_name, ed_institute_nif, ed_institute_country
    FROM eduall_institutes
    WHERE ed_institute_code = ?`;
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(req, query, PARAMS, true, { db: "eduall_institutes", type: "select", data: req });
    
    console.log('✅ Dados da instituição obtidos com sucesso!');
    return rows[0];
  } catch (error) {
    console.error("❌ Erro ao buscar dados da instituição:", error);
    throw new Error("Falha ao obter os dados da instituição: " + error.message);
  }
};

// ─────────────────────────────────────────────────────────────────────────
// GERAÇÃO DO SAF-T (REFATORADA PARA ASYNC)
// ─────────────────────────────────────────────────────────────────────────

/**
 * ✅ MUDANÇA CRÍTICA:
 * - Antes: fs.writeFileSync('saf-t.xml', xml) bloqueava event loop
 * - Depois: await fs.writeFile(...) não bloqueia, nodemon não detecta mudança
 */
const generateSAFT = async (req, res) => {
  try {
    console.log('Iniciando geração do SAF-T...');
    
    // Garantir que diretório existe
    await ensureSaftDirectory();

    const institutionData = await GetInstitutionData(req);

    const feePayments = await GetFeepayments(req);
    const transportPayments = await GetTransportPayments(req);
    const servicePayments = await GetServicePayments(req);
    const productSales = await GetProductSales(req);

    const paymentData = [
      ...feePayments.map(item => ({ ...item, paymentid: 0 })),
      ...transportPayments.map(item => ({ ...item, paymentid: 1 })),
      ...servicePayments.map(item => ({ ...item, paymentid: 2 })),
      ...productSales.map(item => ({ ...item, paymentid: 3 }))
    ];

    const xml = generateXML(paymentData, institutionData);

    // ✅ AGORA ASSÍNCRONO: não bloqueia o event loop
    // Usar timestamp para evitar conflitos de ficheiros
    const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const filename = `saf-t_${instituteCode}_${timestamp}.xml`;
    const filepath = path.join(SAF_T_OUTPUT_DIR, filename);

    await fs.writeFile(filepath, xml, 'utf8');
    console.log(`✅ SAF-T gerado com sucesso! Ficheiro: ${filename}`);

    res.status(200).json({
      ok: true,
      message: 'SAF-T gerado com sucesso!',
      filename: filename,
      filepath: filepath,
      timestamp: timestamp
    });
  } catch (error) {
    console.error("❌ Erro ao gerar o SAF-T:", error);
    res.status(500).json({
      ok: false,
      error: 'Erro ao gerar o SAF-T: ' + error.message
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────
// EXPORTAÇÃO
// ─────────────────────────────────────────────────────────────────────────

module.exports = {
  generateSAFT,
  GetFeepayments,
  GetTransportPayments,
  GetServicePayments,
  GetProductSales,
  GetInstitutionData,
  ensureSaftDirectory,  // ← NOVO: exported para chamar no startup
}; 