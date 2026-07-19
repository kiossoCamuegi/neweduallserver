const multer = require("multer");
const path = require("path");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { io } = require("../server"); // Importa o WebSocket do servidor

// 📌 1️⃣ Obter todos os gestores de conta
const GetManagers = async (req, res) => {
    try {
        const query = `SELECT * FROM manager_eduall_account ORDER BY mn_ed_name ASC`;
        const rows = await ExecuteQuery(res, query, [], true, { db: "manager_eduall_account", type: "select", data: req });

        io.emit("updateManagers", rows); // 🔥 Emite evento para atualizar lista de gestores
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar gestores!", error: error.message });
    }
};

// 📌 2️⃣ Obter um único gestor de conta
const GetSingleManager = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM manager_eduall_account WHERE mn_ed_id = ?`;
        const PARAMS = [ID];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "manager_eduall_account", type: "select", data: req });

        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar gestor!", error: error.message });
    }
};

// 📌 3️⃣ Registrar um novo gestor de conta
const RegisterManager = async (req, res) => {
    try {
        const { mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status } = req.body;

        const avatarPath = req.file ? "images/managers/" + req.file.filename : "";

        const query = `
            INSERT INTO manager_eduall_manager_account_manager 
            (mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, mn_ed_avatar) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const PARAMS = [mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, avatarPath];

        await ExecuteQuery(res, query, PARAMS, false, { db: "manager_eduall_account", type: "insert", data: req });

        io.emit("managerAdded", { mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_status, mn_ed_avatar: avatarPath }); // 🔥 Notifica clientes

        res.status(200).json({ success: true, message: "Gestor cadastrado com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar gestor!", error: error.message });
    }
};

// 📌 4️⃣ Excluir um gestor de conta
const DeleteManager = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `DELETE FROM manager_eduall_account WHERE mn_ed_id = ?`;
        const PARAMS = [ID];
        await ExecuteQuery(res, query, PARAMS, false, { db: "manager_eduall_account", type: "delete", data: req });

        io.emit("managerDeleted", { mn_ed_id: ID }); // 🔥 Notifica clientes sobre a remoção

        res.status(200).json({ success: true, message: "Gestor removido com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao excluir gestor!", error: error.message });
    }
};

// 📌 5️⃣ Atualizar dados de um gestor de conta
const UpdateManager = async (req, res) => {
    try {
        const { ID } = req.params;
        const { mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status } = req.body;

        let query, PARAMS;

        if (req.file) {
            query = `
                UPDATE manager_eduall_account 
                SET mn_ed_name = ?, mn_ed_email = ?, mn_ed_phone = ?, mn_ed_position = ?, 
                    mn_ed_profile_settings = ?, mn_ed_status = ?, mn_ed_avatar = ? 
                WHERE mn_ed_id = ?
            `;
            PARAMS = [
                mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, 
                "images/managers/" + req.file.filename, ID
            ];
        } else {
            query = `
                UPDATE manager_eduall_account 
                SET mn_ed_name = ?, mn_ed_email = ?, mn_ed_phone = ?, mn_ed_position = ?, 
                    mn_ed_profile_settings = ?, mn_ed_status = ? 
                WHERE mn_ed_id = ?
            `;
            PARAMS = [mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, ID];
        }

        await ExecuteQuery(res, query, PARAMS, false, { db: "manager_eduall_account", type: "update", data: req });

        io.emit("managerUpdated", { mn_ed_id: ID, mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_status }); // 🔥 Notifica clientes sobre a atualização

        res.status(200).json({ success: true, message: "Gestor atualizado com sucesso!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao atualizar gestor!", error: error.message });
    }
};

// 📌 Configuração de upload de arquivos
const storage = multer.diskStorage({
    destination: path.join(__dirname, `./../images/managers/`),
    filename: (req, file, cb) => {
        cb(null, `eduall_manager_${Date.now()}_${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`);
    }
});

const uploadManagerPicture = multer({ storage }).single("manager_avatar");

module.exports = { GetManagers, GetSingleManager, RegisterManager, DeleteManager, UpdateManager, uploadManagerPicture };


/*
CREATE TABLE manager_eduall_account (
    mn_ed_id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mn_ed_name VARCHAR(255) NOT NULL,
    mn_ed_email VARCHAR(255) NOT NULL UNIQUE,
    mn_ed_phone VARCHAR(50) NOT NULL,
    mn_ed_position VARCHAR(100) NOT NULL, -- Cargo (ex: Supervisor, Administrador, etc.)
    mn_ed_profile_settings TEXT NOT NULL, -- JSON com permissões
    mn_ed_status ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
    mn_ed_avatar VARCHAR(255) DEFAULT NULL, -- Caminho para a imagem de perfil
    mn_ed_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    mn_ed_updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
);



*/