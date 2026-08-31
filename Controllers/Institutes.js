const multer = require('multer');
const path = require('path');
const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database");
const { GetCurrentUserData } = require("./GetCurrentUserData");
const DeviceDetector = require('node-device-detector');
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require('./Auditory');
const cloudinary = require('cloudinary').v2;

// ── NOVO: Modelo de Processo de Matrícula configurável por escola ─────────
// Agora gerido diretamente dentro do InstituteUpdate (ver secção mais abaixo).
// Mantemos apenas o enum de valores válidos para validação.
const { ENROLLMENT_MODEL } = require("../Functions/EnrollmentModel");

// ── Proteção: descobre um valor default válido para o modelo de matrícula
// sem nunca cair em 'undefined' (o que estava a acontecer antes, porque
// ENROLLMENT_MODEL.actual não existe no módulo importado).
const ENROLLMENT_MODEL_VALUES = Object.values(ENROLLMENT_MODEL || {});
const DEFAULT_ENROLLMENT_MODEL =
  (ENROLLMENT_MODEL && typeof ENROLLMENT_MODEL.actual === "string" && ENROLLMENT_MODEL.actual)
    ? ENROLLMENT_MODEL.actual
    : (ENROLLMENT_MODEL_VALUES[0] || "padrao");

cloudinary.config({
  cloud_name:"dqkcchd89",
  api_key:"12567722655778",
  api_secret:"Pxq8c897Qzy-DZIegIDA20Ucwqc"
});


const InstituteDelete = async (req, res) => {
    try {
        // Implement logic here
    } catch (error) {
        return res.status(500).json({ msg: "Não foi possível concluir a operação neste momento !" });
    }
}

const InstituteUpdateLicence = async (req, res) => {
    try {
        // Implement logic here
    } catch (error) {
        return res.status(500).json({ msg: "Não foi possível concluir a operação neste momento !" });
    }
}

const GetCurentLicence = async (req, res) => {
    try {
        const query = 'SELECT * FROM eduall_institutes_licences WHERE ed_institute_licence_instituteCode = ?';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_institutes_licences", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar a licença atual!", error: error.message });
    }
}

const GetInstitutes = async (req, res) => {
    try {
        const query = 'SELECT * FROM eduall_customers_institutes WHERE ed_institute_deleted = 0';
        const PARAMS = [];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_customers_institutes", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar os institutos!", error: error.message });
    }
}

const EduallSearchInstitutes = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_institutes WHERE
            ed_institute_deleted = 0 AND 
            (ed_institute_name LIKE ? OR ed_institute_website LIKE ? OR ed_institute_email LIKE ?)`;
        const PARAMS = [`${req.params.TEXT.toLowerCase()}%`, `${req.params.TEXT.toLowerCase()}%`, `${req.params.TEXT.toLowerCase()}%`];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_institutes", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar institutos!", error: error.message });
    }
}

const GetAllRegisteredInstitutes = async (req, res) => {
    try {
        const query = 'SELECT * FROM eduall_customers_institutes ORDER BY ed_institute_id ASC';
        const PARAMS = [];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_customers_institutes", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar todos os institutos registrados!", error: error.message });
    }
}

const GetSingleInstitute = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_institutes WHERE ed_institute_deleted = 0 AND ed_institute_id = ?';
        const PARAMS = [ID];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_institutes", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar o instituto!", error: error.message });
    }
}

const GetSingleInstituteByCode = async (req, res) => {
    try {
        const { CODE } = req.params;
        const query = 'SELECT * FROM eduall_institutes WHERE ed_institute_deleted = 0 AND ed_institute_code = ?';
        const PARAMS = [CODE];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_institutes", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar o instituto pelo código!", error: error.message });
    }
}

const GetCurrentInstituteByCode = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_institutes 
            LEFT JOIN eduall_institutes_licences ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_institutes.ed_institute_code 
            WHERE ed_institute_deleted = 0 AND ed_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_institutes", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar o instituto atual!", error: error.message });
    }
}

const RegisterInstitute = async (req, res) => {
    try {
        const { institute_name, institute_principal, institute_pedagogical_director, institute_state, institute_country, institute_address, institute_nif, institute_phone1, institute_email, institute_status, institute_type, institute_description, institute_code } = req.body;
        const query = `INSERT INTO eduall_manager_customers(ed_institute_name, ed_institute_principal,ed_institute_pedagogical_director,ed_institute_state, ed_institute_status, ed_institute_country,
            ed_institute_address, ed_institute_nif, ed_institute_phone1, ed_institute_email, ed_institute_type, ed_institute_code, ed_institute_description) 
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?, ?)`;
        const PARAMS = [institute_name, institute_principal,institute_pedagogical_director, institute_state, institute_status, institute_country, institute_address, institute_nif, institute_phone1, institute_email, institute_type, institute_code, institute_description];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_manager_customers", type: "insert", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar o instituto!", error: error.message });
    }
}
 



const InstituteUpdate = async (req, res) => {
  try {
    const {
      institute_name, institute_principal, institute_linkedin, institute_facebook,
      institute_instagram, institute_slogan, institute_docheader, institute_youtube,
      institute_country, institute_address, institute_nif, institute_phone1,
      institute_bank2_account_number, institute_phone2, institute_email,
      institute_state, institute_pedagogical_director, institute_bank1_account_number,
      institute_bank2_name, institute_bank1_recipient, institute_iva,
      institute_language, institute_bank2_recipient, institute_type,
      institute_website, institute_bank1_name,
      // ── NOVO: Modelo de Processo de Matrícula ──
      institute_enrollment_model
    } = req.body;

    if (institute_iva * 1 !== 14) {
      return res.status(500).json({
        success: false,
        msg: "O IVA deve ser igual a 14 !",
      });
    }

    // ── Valida o modelo de matrícula, se enviado ──
    // Campo opcional: se não vier no body, mantém o valor já gravado (não altera).
    const enrollmentModelProvided = typeof institute_enrollment_model !== "undefined" && institute_enrollment_model !== null && institute_enrollment_model !== "";
    if (enrollmentModelProvided && ENROLLMENT_MODEL_VALUES.length && !ENROLLMENT_MODEL_VALUES.includes(institute_enrollment_model)) {
      return res.status(400).json({
        success: false,
        msg: `Modelo de matrícula inválido. Valores aceites: ${ENROLLMENT_MODEL_VALUES.join(", ")}`,
      });
    }

    // ============================
    // 1. Migração: coluna do logo Cloudinary
    // ============================
    const checkColumn = `SELECT COUNT(*) AS exist 
                         FROM INFORMATION_SCHEMA.COLUMNS 
                         WHERE TABLE_SCHEMA = DATABASE() 
                           AND TABLE_NAME = 'eduall_institutes' 
                           AND COLUMN_NAME = 'ed_logo_urlcloudinary'`;

    const [colResult] = await ExecuteQuery(res, checkColumn, [], true);
    if (colResult && colResult.exist === 0) {
      try {
        const alterTable = `ALTER TABLE eduall_institutes 
                            ADD COLUMN ed_logo_urlcloudinary TEXT NULL 
                            AFTER ed_institute_logo`;
        await ExecuteQuery(res, alterTable, [], true);
        console.log("Coluna 'ed_logo_urlcloudinary' criada automaticamente.");
      } catch (alterErr) {
        console.error("⚠️ Não foi possível criar 'ed_logo_urlcloudinary':", alterErr.message);
      }
    }

    // ============================
    // 2. Migração: coluna do modelo de matrícula
    // ============================
    // IMPORTANTE: usamos TEXT (não VARCHAR) porque a tabela eduall_institutes
    // já está perto/no limite de 65535 bytes por linha (limite físico do InnoDB
    // para colunas não-BLOB). Colunas TEXT/BLOB não contam da mesma forma nesse
    // limite fixo, tal como já acontece com 'ed_logo_urlcloudinary' acima.
    // TEXT/BLOB não aceitam DEFAULT literal em MySQL, por isso o valor default
    // é aplicado via UPDATE logo a seguir, apenas nas linhas que ainda estão a NULL.
    const checkEnrollmentModelColumn = `SELECT COUNT(*) AS exist 
                         FROM INFORMATION_SCHEMA.COLUMNS 
                         WHERE TABLE_SCHEMA = DATABASE() 
                           AND TABLE_NAME = 'eduall_institutes' 
                           AND COLUMN_NAME = 'ed_institute_enrollment_model'`;

    const [enrollmentColResult] = await ExecuteQuery(res, checkEnrollmentModelColumn, [], true);
    if (enrollmentColResult && enrollmentColResult.exist === 0) {
      try {
        const alterEnrollmentTable = `ALTER TABLE eduall_institutes 
                            ADD COLUMN ed_institute_enrollment_model TEXT NULL 
                            AFTER ed_logo_urlcloudinary`;
        await ExecuteQuery(res, alterEnrollmentTable, [], true);
        console.log("Coluna 'ed_institute_enrollment_model' criada automaticamente (TEXT).");

        // Backfill: define o valor default só onde ainda está NULL
        const backfillQuery = `UPDATE eduall_institutes 
                                SET ed_institute_enrollment_model = ? 
                                WHERE ed_institute_enrollment_model IS NULL`;
        await ExecuteQuery(res, backfillQuery, [DEFAULT_ENROLLMENT_MODEL], true);
        console.log(`Backfill de 'ed_institute_enrollment_model' com valor default '${DEFAULT_ENROLLMENT_MODEL}' concluído.`);
      } catch (alterErr) {
        // Não deixamos isto derrubar o pedido inteiro: registamos o erro e seguimos,
        // já que a coluna pode não existir ainda mas o resto do UPDATE pode falhar
        // de forma isolada mais abaixo (nesse caso o catch geral trata).
        console.error("⚠️ Não foi possível criar/preencher 'ed_institute_enrollment_model':", alterErr.message);
      }
    }

    let cloudinaryUrl = null;
    if (req.file) {
      try {
        const uploadResult = await cloudinary.uploader.upload(req.file.path, {
          folder: "eduall_images",
        });
        cloudinaryUrl = uploadResult.secure_url;
      } catch (err) {
        console.error("⚠️ Erro ao enviar imagem para o Cloudinary:", err.message);
      }
    }

    // Valor a gravar para o modelo de matrícula: usa o enviado, ou mantém o
    // comportamento anterior de não tocar na coluna se não foi enviado.
    const enrollmentModelToSave = enrollmentModelProvided ? institute_enrollment_model : null;

    // ============================
    // 3. Query de atualização
    // ============================
    // Nota: o modelo de matrícula só é incluído no SET se tiver sido enviado
    // no body, para não sobrescrever o valor existente com NULL/undefined.
    const query = req.file
      ? `UPDATE eduall_institutes SET 
          ed_institute_name = ?, ed_institute_state = ?, ed_institute_principal = ?, 
          ed_institute_pedagogical_director = ?, ed_institute_linkedin = ?, 
          ed_institute_facebook = ?, ed_institute_instagram = ?, ed_institute_youtube = ?, 
          ed_institute_country = ?, ed_institute_address = ?, ed_institute_nif = ?, 
          ed_institute_phone1 = ?, ed_institute_phone2 = ?, ed_institute_email = ?, 
          ed_institute_bank1 = ?, ed_institute_bank1_account_number = ?, 
          ed_institute_bank1_recipient = ?, ed_institute_bank2 = ?, 
          ed_institute_bank2_account_number = ?, ed_institute_bank2_recipient = ?, 
          ed_institute_iva_value = ?, ed_institute_language = ?, ed_institute_website = ?, 
          ed_institute_slogan = ?, ed_institute_docheader = ?, ed_institute_logo = ?, 
          ed_logo_urlcloudinary = ?${enrollmentModelProvided ? ", ed_institute_enrollment_model = ?" : ""} 
        WHERE ed_institute_deleted = 0 AND ed_institute_code = ?`
      : `UPDATE eduall_institutes SET 
          ed_institute_name = ?, ed_institute_state = ?, ed_institute_principal = ?, 
          ed_institute_pedagogical_director = ?, ed_institute_linkedin = ?, 
          ed_institute_facebook = ?, ed_institute_instagram = ?, ed_institute_youtube = ?, 
          ed_institute_country = ?, ed_institute_address = ?, ed_institute_nif = ?, 
          ed_institute_phone1 = ?, ed_institute_phone2 = ?, ed_institute_email = ?, 
          ed_institute_bank1 = ?, ed_institute_bank1_account_number = ?, 
          ed_institute_bank1_recipient = ?, ed_institute_bank2 = ?, 
          ed_institute_bank2_account_number = ?, ed_institute_bank2_recipient = ?, 
          ed_institute_iva_value = ?, ed_institute_language = ?, ed_institute_website = ?, 
          ed_institute_slogan = ?, ed_institute_docheader = ?${enrollmentModelProvided ? ", ed_institute_enrollment_model = ?" : ""} 
        WHERE ed_institute_deleted = 0 AND ed_institute_code = ?`;

    const PARAMS = req.file
      ? [
          institute_name, institute_state, institute_principal,
          institute_pedagogical_director, institute_linkedin, institute_facebook,
          institute_instagram, institute_youtube, institute_country, institute_address,
          institute_nif, institute_phone1, institute_phone2, institute_email,
          institute_bank1_name, institute_bank1_account_number, institute_bank1_recipient,
          institute_bank2_name, institute_bank2_account_number, institute_bank2_recipient,
          institute_iva, institute_language, institute_website, institute_slogan,
          institute_docheader, req.file.path, cloudinaryUrl,
          ...(enrollmentModelProvided ? [enrollmentModelToSave] : []),
          req.session.user.eduall_user_session_curentinstitute
        ]
      : [
          institute_name, institute_state, institute_principal,
          institute_pedagogical_director, institute_linkedin, institute_facebook,
          institute_instagram, institute_youtube, institute_country, institute_address,
          institute_nif, institute_phone1, institute_phone2, institute_email,
          institute_bank1_name, institute_bank1_account_number, institute_bank1_recipient,
          institute_bank2_name, institute_bank2_account_number, institute_bank2_recipient,
          institute_iva, institute_language, institute_website, institute_slogan,
          institute_docheader,
          ...(enrollmentModelProvided ? [enrollmentModelToSave] : []),
          req.session.user.eduall_user_session_curentinstitute
        ];

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_institutes",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Instituição",
      description: enrollmentModelProvided
        ? `Atualizou os dados da instituição (modelo de matrícula: "${institute_enrollment_model}")`
        : `Atualizou os dados da instituição`,
    });

    res.status(200).json(result);
  } catch (error) {
    console.log(error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar o instituto!",
      error: error.message,
    });
  }
};


const storage = multer.diskStorage({
   destination: 'images/logos',
   filename: (req, file, cb) => {
      return cb(null, `eduall_file_${file.fieldname}_${Date.now()}_${Math.random(1, 389398393993100012002)}_${path.extname(file.originalname)}`)
   }
});

const uploadInstituteLogo = multer({
   storage: storage
}).single('institute_logo');

module.exports = {
   GetInstitutes, GetSingleInstituteByCode, GetCurentLicence, GetAllRegisteredInstitutes,
   GetCurrentInstituteByCode, GetSingleInstitute, RegisterInstitute, InstituteDelete,
   InstituteUpdate, InstituteUpdateLicence, uploadInstituteLogo, EduallSearchInstitutes,
};