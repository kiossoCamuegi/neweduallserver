const ExecuteQuery = require("../Functions/ExecuteQuery");
const multer = require("multer");
const path = require("path");

// 📌 1️⃣ Obter todos os pagamentos de licença
const GetLicencePayments = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_licence_service_payments`;
        const PARAMS = [];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_licence_service_payments", type: "select", data: req});
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar pagamentos de licença!", error: error.message });
    }
};

// 📌 2️⃣ Obter um único pagamento de licença por ID
const GetSingleLicencePayment = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_licence_service_payments WHERE ed_licence_service_payment_id  = ?`;
        const PARAMS = [ID];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_licence_service_payments", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar pagamento de licença!", error: error.message });
    }
};

// 📌 3️⃣ Registrar um novo pagamento de licença
const RegisterLicencePayment = async (req, res) => {
    try {
        const {
            ed_licence_service_payment_lcocode,
            ed_licence_service_payment_price,
            ed_licence_service_payment_amount,
            ed_licence_service_payment_reference,
            ed_licence_service_payment_status,
            ed_licence_service_payment_instituteCode,
            ed_licence_service_payment_code,
            ed_licence_service_payment_operator,
            ed_licence_service_payment_type // mensal, trimestral, semestral, anual
        } = req.body;

        const file = req.file ? "images/payments/" + req.file.filename : "";

        const insertQuery = `
            INSERT INTO eduall_licence_service_payments 
            (ed_licence_service_payment_lcocode, ed_licence_service_payment_price, ed_licence_service_payment_amount, 
             ed_licence_service_payment_date, ed_licence_service_payment_reference, ed_licence_service_payment_status, 
             ed_licence_service_payment_instituteCode, ed_licence_service_payment_code, ed_licence_service_payment_file, 
             ed_licence_service_payment_operator)
            VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?)
        `;

        const PARAMS = [
            ed_licence_service_payment_lcocode, ed_licence_service_payment_price, ed_licence_service_payment_amount,
            ed_licence_service_payment_reference, ed_licence_service_payment_status, ed_licence_service_payment_instituteCode,
            ed_licence_service_payment_code, file, ed_licence_service_payment_operator
        ];

        const insertResult = await ExecuteQuery(res, insertQuery, PARAMS, false, { db: "eduall_licence_service_payments", type: "insert", data: req });

        // 📌 Atualizar a data de vencimento da licença
        const periodMap = {
            "mensal": 1,
            "trimestral": 3,
            "semestral": 6,
            "anual": 12
        };

        const monthsToAdd = periodMap[ed_licence_service_payment_type] || 0;

        if (monthsToAdd > 0) {
            const updateQuery = `
                UPDATE eduall_institutes_licences
                SET ed_institute_licence_endDate = DATE_ADD(ed_institute_licence_endDate, INTERVAL ? MONTH)
                WHERE ed_institute_licence_code = ?
            `;
            const updateParams = [monthsToAdd, ed_licence_service_payment_code];
            await ExecuteQuery(res, updateQuery, updateParams, false, { db: "eduall_institutes_licences", type: "update", data: req });
        }

        res.status(200).json(insertResult);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar pagamento de licença!", error: error.message });
    }
};

// 📌 4️⃣ Excluir um pagamento de licença
const DeleteLicencePayment = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `DELETE FROM eduall_licence_service_payments WHERE ed_licence_service_payment_id = ?`;
        const PARAMS = [ID];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_licence_service_payments", type: "delete", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao excluir pagamento de licença!", error: error.message });
    }
};

// 📌 5️⃣ Atualizar um pagamento de licença
const UpdateLicencePayment = async (req, res) => {
    try {
        const { ID } = req.params;
        const {
            ed_licence_service_payment_price,
            ed_licence_service_payment_amount,
            ed_licence_service_payment_reference,
            ed_licence_service_payment_status
        } = req.body;

        let query, PARAMS;

        if (req.file) {
            query = `
                UPDATE eduall_licence_service_payments 
                SET ed_licence_service_payment_price = ?, ed_licence_service_payment_amount = ?, 
                    ed_licence_service_payment_reference = ?, ed_licence_service_payment_status = ?, 
                    ed_licence_service_payment_file = ? 
                WHERE ed_licence_service_payment_id = ?
            `;
            PARAMS = [
                ed_licence_service_payment_price, ed_licence_service_payment_amount, ed_licence_service_payment_reference,
                ed_licence_service_payment_status, "images/payments/" + req.file.filename, ID
            ];
        } else {
            query = `
                UPDATE eduall_licence_service_payments 
                SET ed_licence_service_payment_price = ?, ed_licence_service_payment_amount = ?, 
                    ed_licence_service_payment_reference = ?, ed_licence_service_payment_status = ? 
                WHERE ed_licence_service_payment_id = ?
            `;
            PARAMS = [ed_licence_service_payment_price, ed_licence_service_payment_amount, ed_licence_service_payment_reference, ed_licence_service_payment_status, ID];
        }

        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_licence_service_payments", type: "update", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao atualizar pagamento de licença!", error: error.message });
    }
};

// 📌 Configuração de upload de arquivos
const storage = multer.diskStorage({
    destination: path.join(__dirname, `./../images/payments/`),
    filename: (req, file, cb) => {
        cb(null, `eduall_file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`);
    }
});

const uploadPaymentFile = multer({ storage }).single("payment_file");

module.exports = { GetLicencePayments, GetSingleLicencePayment, RegisterLicencePayment, DeleteLicencePayment, UpdateLicencePayment, uploadPaymentFile };
