const multer = require('multer');
const path = require('path');
const CheckInternet = require("../config/CheckInternet");
const { DB_SQLITE, DATABASE } = require("../config/Database");
const { GetCurrentUserData } = require("./GetCurrentUserData");
const DeviceDetector = require('node-device-detector');
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require('./Auditory');
const cloudinary = require('cloudinary').v2;


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
      institute_website, institute_bank1_name
    } = req.body;

    if (institute_iva * 1 !== 14) {
      return res.status(500).json({
        success: false,
        msg: "O IVA deve ser igual a 14 !",
      });
    }

 
    const checkColumn = `SELECT COUNT(*) AS exist 
                         FROM INFORMATION_SCHEMA.COLUMNS 
                         WHERE TABLE_SCHEMA = DATABASE() 
                           AND TABLE_NAME = 'eduall_institutes' 
                           AND COLUMN_NAME = 'ed_logo_urlcloudinary'`;

    const [colResult] = await ExecuteQuery(res, checkColumn, [], true);
    if (colResult && colResult.exist === 0) {
      const alterTable = `ALTER TABLE eduall_institutes 
                          ADD COLUMN ed_logo_urlcloudinary TEXT NULL 
                          AFTER ed_institute_logo`;
      await ExecuteQuery(res, alterTable, [], true);
      console.log("Coluna 'ed_logo_urlcloudinary' criada automaticamente.");
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

    // ============================
    // 3. Query de atualização
    // ============================
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
          ed_logo_urlcloudinary = ? 
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
          ed_institute_slogan = ?, ed_institute_docheader = ? 
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
          institute_docheader, req.session.user.eduall_user_session_curentinstitute
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
      description: `Atualizou os dados da instituição`,
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
   InstituteUpdate, InstituteUpdateLicence, uploadInstituteLogo, EduallSearchInstitutes
};
