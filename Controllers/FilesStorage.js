const multer = require('multer');
const path = require('path');
const ExecuteQuery = require("../Functions/ExecuteQuery");

const GetSpecificFiles = async (req, res) => {
    try {
        const { CODE } = req.params;
        const query = 'SELECT * FROM eduall_files WHERE ed_file_deleted = 0 AND ed_file_code = ?';
        const PARAMS = [CODE];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_files", type: "select", data: req });
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar arquivos específicos!", error: error.message });
    }
};

const RegisterFile = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_files(ed_file_name, ed_file_code, ed_file_size, ed_file_type, 
        ed_file_extension, ed_file_type_of_use, ed_file_institute_code) VALUES(?,?,?,?,?,?,?)`;
        const PARAMS = [req.file.path, req.body.file_code, req.body.file_size, req.body.file_type,
            req.body.file_extension, req.body.file_use, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_files", type: "insert", data: req });

        console.log("Ficheiro adicionado ao portal !!!")
        res.status(200).json(result);
    } catch (error) {
        console.log("error ao adicionar ficheiro = ", error)
        res.status(500).json({ success: false, message: "Falha ao registrar o arquivo!", error: error.message });
    }
};
 

const FileDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_files SET ed_file_deleted = 1
        WHERE ed_file_deleted = 0 AND ed_file_id = ? AND ed_file_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_fines", type: "update", data: req });
        res.status(200).json({ success: true, message: "Ficheiro deletado com sucesso!", data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao deletar a ficheiro !", error:error.message });
    }
};
 

const storage = multer.diskStorage({
    destination: 'assets',
    filename: (req, file, cb) => {
        return cb(null, `eduall_file_${file.fieldname}_${Date.now()}_${Math.random(1, 38939839398888002) + Math.random(100, 389398393993102)}_${path.extname(file.originalname)}`);
    }
});

const uploadFiles = multer({
    storage: storage
}).single('file_name');

module.exports = { GetSpecificFiles, RegisterFile, uploadFiles , FileDelete};
