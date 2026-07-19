 const axios = require('axios'); 
const fs = require('fs');
const path = require('path');  
const ExecuteQuery = require("./ExecuteQuery");
const nodeMailer = require("nodemailer");  
const { MailOptions } = require("./MailOptions");
const moment = require("moment");
 


const BODY = {
  document: {
    type: 'factura',  
    date: '2025-05-14',
    duedate: '2025-05-20',
    vref: 'XPTO001',
    serie: '2025',
    currency: 'AOA',
    exchange_rate: '0',
    observation: 'Nome do estudante : kiosso andre',
    retention: '6.5'
  },
  client: {
    name: 'Cliente Teste',
    nif: '123456789',
    email: 'cli@exemplo.com',
    city: 'Luanda',
    address: 'Rua Exemplo',
    postalcode: '',
    country: 'Angola'
  },
  items: [
    { itemcode: 'IT001', description: 'Produto A', price: '9500', quantity: '2', tax: '14', discount: '0' },
    { itemcode: 'IT003', description: 'Produto A', price: '6350', quantity: '1', tax: '14', discount: '10' },
  ]
};
 
// Configurações via variáveis de ambiente
const API_URL = "https://api.factplus.co.ao";
const API_KEY = "68239c81300471aeeb2e8354f279f8ba";  


 
async function FACTPLUS_GenerateDocumentBody(req, res, observation, items) {
    const registerDate = moment().format("YYYY-MM-DD");
  try {
    // 1. Buscar os dados da instituição logada
    const instituteQuery = `
      SELECT * FROM eduall_institutes 
      LEFT JOIN eduall_institutes_licences 
      ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_institutes.ed_institute_code 
      WHERE ed_institute_deleted = 0 AND ed_institute_code = ?`;
    const instituteParams = [req.session.user.eduall_user_session_curentinstitute];
    const instituteResult = await ExecuteQuery(res, instituteQuery, instituteParams, true, {
      db: "eduall_institutes",
      type: "select",
      data: req,
    });

    if (!instituteResult || instituteResult.length === 0) {
      return res.status(404).json({ success: false, message: "Instituição não encontrada." });
    }

    const institute = instituteResult[0];

    // 2. Buscar a moeda da escola
    const coinQuery = `SELECT * FROM eduall_coins WHERE ed_coin_deleted = 0 AND ed_coin_institute_code = ?`;
    const coinParams = [req.session.user.eduall_user_session_curentinstitute];
    const coinResult = await ExecuteQuery(res, coinQuery, coinParams, true, {
      db: "eduall_coins",
      type: "select",
      data: req,
    });

    if (!coinResult || coinResult.length === 0) {
      return res.status(404).json({ success: false, message: "Moeda da instituição não encontrada." });
    }

    const coin = coinResult[0];

    // 3. Montar o objeto BODY
    const BODY = {
      document: {
        type: "factura",
        date: registerDate,
        duedate: moment(registerDate).add(6, 'days').format("YYYY-MM-DD"),  
        vref: "XPTO001",
        serie: new Date(registerDate).getFullYear().toString(),
        currency: coin.ed_coin_code || "AOA",
        exchange_rate: "0",
        observation: observation,
        retention: coin.ed_coin_tax_value || "0",
      },
      client: {
        name: institute.ed_institute_name || "",
        nif: institute.ed_institute_nif || "",
        email: institute.ed_institute_email || "",
        city: institute.ed_institute_state || "",
        address: institute.ed_institute_address || "",
        postalcode: "",
        country: institute.ed_institute_country || "",
      },
      items: items || [],
    };

    return BODY;
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Erro ao gerar o corpo do documento!",
      error: error.message,
    });
  }
}


const FACTPLUS_registerAndNotifyIfNeeded = async (reference, req, res) => {
  try {
    // 1. Criar tabela caso não exista
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS factplus_documents_tracker (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reference VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await ExecuteQuery(res, createTableQuery, [], false, {
      db: "eduall_files",
      type: "insert",
      data: req
    });

    // 2. Inserir nova referência
    const insertQuery = `INSERT INTO factplus_documents_tracker(reference) VALUES (?)`;
    await ExecuteQuery(res, insertQuery, [reference.data], false, {
      db: "eduall_files",
      type: "insert",
      data: req
    });

    // 3. Contar o total de faturas
    const countQuery = `SELECT COUNT(*) as total FROM factplus_documents_tracker`;
    const countResult = await ExecuteQuery(res, countQuery, [], true, {
      db: "eduall_files",
      type: "select",
      data: req
    });

    const totalFaturas = countResult[0]?.total || 0;

    // 4. Se chegou a 300 ou mais, enviar email e deletar tudo
    if (totalFaturas >= 300) {
      const transporter = nodeMailer.createTransport(MailOptions());

      await transporter.sendMail({
        from: "noreply@eduall.site",
        to: ["kiossocamuegi@gmail.com", "kiossoandre.@exportech.com"],
        subject: "ALERTA: Limite de faturas FACTPLUS atingido",
        html: `
          <p>Olá,</p>
          <p>O número de faturas criadas no sistema FACTPLUS atingiu o limite de <strong>300 registros</strong>.</p>
          <p>Para evitar que o banco de dados da API fique sobrecarregado, os registros devem <strong>apagados</strong>.</p>
          <br>
          <p>Mensagem automática do sistema Eduall.</p>
        `
      });

      // 5. Apagar todos os registros
      const deleteQuery = `DELETE FROM factplus_documents_tracker`;
      await ExecuteQuery(res, deleteQuery, [], false, {
        db: "eduall_files",
        type: "delete",
        data: req
      });
    }

  } catch (error) {
    console.error("Erro ao registrar fatura ou enviar alerta:", error.message);
  }
};
 

async function FACTPLUS_createDocumentFunction(data, req, res) {
  try {
    // 1. Criar documento
    const payloadCreate = { apicall: 'CREATE', apikey: API_KEY, ...data };
    const createResp = await axios.post(API_URL, payloadCreate, {
      headers: { 'Content-Type': 'application/json' }
    });

    const reference = createResp.data;
    if (!reference) throw new Error('Referência não retornada');

    // 2. Alterar para "sent"
    await axios.post(API_URL, {
      apicall: 'ALTER',
      apikey: API_KEY,
      document: { reference, type: data.document.type, status: 'sent' }
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    // 3. Obter link do PDF
    const pdfUrl = `https://app.factplus.co.ao/pdf/invoices/${reference.data}`;
    const tempFilePath = path.join(__dirname, `${reference}.pdf`);

    const now = new Date();
    const fileCode = `${reference.data}_${now.getMinutes()}${now.getSeconds()}${Math.floor(Math.random() * 1000)}`;
    const finalFilePath = path.join(__dirname, '..', 'assets', `${fileCode}.pdf`);

    // 4. Fazer download do PDF para caminho temporário
    const fileResponse = await axios.get(pdfUrl, { responseType: 'stream' });

    console.log("file result = ", fileResponse.data)
    const tempWriter = fs.createWriteStream(tempFilePath);
    await new Promise((resolve, reject) => {
      fileResponse.data.pipe(tempWriter);
      tempWriter.on('finish', resolve);
      tempWriter.on('error', reject);
    });

    // 5. Mover o PDF para a pasta 'assets'
    fs.renameSync(tempFilePath, finalFilePath);

    // 6. Preparar dados do ficheiro
    const stats = fs.statSync(finalFilePath);
    const fileSizeInBytes = stats.size; 

    // 7. Registrar no banco de dados
    const query = `INSERT INTO eduall_files (
      ed_file_name, ed_file_code, ed_file_size, ed_file_type,
      ed_file_extension, ed_file_type_of_use, ed_file_institute_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`;

    const PARAMS = [
      finalFilePath,
      fileCode,
      fileSizeInBytes,
      'application/pdf',
      '.pdf',
      'fatura',
      req.session.user.eduall_user_session_curentinstitute
    ];

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_files",
      type: "insert",
      data: req
    });


    // 8. registara o historico de faturas
    await FACTPLUS_registerAndNotifyIfNeeded(reference, req, res);

    console.log("code = ", finalFilePath)

    // 9. Retornar resultado
    return {
      success: true,
      msg: 'Fatura criada e registada com sucesso',
      reference,
      link_pdf: pdfUrl,
      fileCode:finalFilePath,
      register_result: result
    };

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao criar fatura ou registrar ficheiro",
      error: error.message
    });
  }
}


const FACTPLUS_getPdfLink = async (req, res) => {
  try {
    const { reference, type } = req.body;
    if (!reference || !type) return res.status(400).json({ msg: 'reference e type são obrigatórios' });
    const resp = await axios.post(API_URL, { apicall: 'VIEW', apikey: API_KEY, document: { reference, type } }, { headers: { 'Content-Type': 'application/json' } });
    const link = resp.data;
    if (!link) return res.status(404).json({ msg: 'Link PDF não encontrado' });
    return res.json({linkpdf:"https://app.factplus.co.ao/pdf/invoices/"+reference});
  } catch (err) {
    return res.status(500).json({ msg: 'Erro obter link PDF', error: err.message });
  }
};


 
function FACTPLUS_decodificarMesEAno(codigo) {
  const codigoStr = String(codigo); 
  const [mesStr, ano] = codigoStr.split(".");

  if (!mesStr || !ano) {
    return "Formato de código inválido";
  }

  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  const mesIndex = parseInt(mesStr);

  if (isNaN(mesIndex) || mesIndex < 0 || mesIndex > 11) {
    return "Código inválido";
  }

  return `${meses[mesIndex]} de ${ano}`;
}



  function FACTPLUS_formatarPreco(valor) {
    return Number(valor).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }
  
 
module.exports = {FACTPLUS_createDocumentFunction, FACTPLUS_getPdfLink, 
FACTPLUS_GenerateDocumentBody, FACTPLUS_decodificarMesEAno, FACTPLUS_formatarPreco};

 

  