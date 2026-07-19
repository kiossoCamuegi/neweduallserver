const ExecuteQuery = require("../Functions/ExecuteQuery");
const { io } = require("../server");
 
// 📌 1️⃣ Obter todos os gestores com seus clientes atribuídos
const GetManagersWithClients = async (req, res) => {
    try {
        // 🔹 Primeiro, buscamos todos os gestores
        const queryManagers = `
            SELECT mn_ed_id, mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, mn_ed_avatar 
            FROM manager_eduall_account
        `;
        const managers = await ExecuteQuery(res, queryManagers, [], true, { db: "manager_eduall_account", type: "select", data: req });

        // 🔹 Para cada gestor, buscamos os clientes atribuídos
        for (let manager of managers) {
            const queryClients = `
                SELECT eduall_institutes.ed_institute_id, eduall_institutes.ed_institute_name, eduall_institutes.ed_institute_email, eduall_institutes.ed_institute_phone1 
                FROM manager_eduall_manager_clients
                JOIN eduall_institutes ON eduall_institutes.ed_institute_id = manager_eduall_manager_clients.mn_ed_client_id
                WHERE manager_eduall_manager_clients.mn_ed_manager_id = ?
            `;
            manager.clients_array = await ExecuteQuery(res, queryClients, [manager.mn_ed_id], true, { db: "eduall_institutes", type: "select", data: req });
        }

        io.emit("updateManagersWithClients", managers); // 🔥 Atualiza clientes conectados via WebSockets
        res.status(200).json(managers);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar gestores com clientes!", error: error.message });
    }
};

 


// 📌 1️⃣ Obter todos os gestores
const GetManagers = async (req, res) => {
    try {
        const query = `SELECT * FROM manager_eduall_account ORDER BY mn_ed_name ASC`;
        const managers = await ExecuteQuery(res, query, [], true, { db: "manager_eduall_account", type: "select", data: req });

        io.emit("updateManagers", managers); // 🔥 Notifica clientes
        res.status(200).json(managers);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar gestores!", error: error.message });
    }
};

// 📌 2️⃣ Obter um gestor específico por ID
const GetManagerById = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM manager_eduall_account WHERE mn_ed_id = ?`;
        const managers = await ExecuteQuery(res, query, [ID], true, { db: "manager_eduall_account", type: "select", data: req });

        if (managers.length > 0) {
            res.status(200).json(managers[0]);
        } else {
            res.status(404).json({ message: "Gestor não encontrado!" });
        }
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar gestor!", error: error.message });
    }
};

// 📌 3️⃣ Criar um novo gestor
const CreateManager = async (req, res) => {
    try {
        const { mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status } = req.body;
        const avatar = req.file ? "images/managers/" + req.file.filename : "";

        const query = `INSERT INTO manager_eduall_account (mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, mn_ed_avatar) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const params = [mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, avatar];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_account", type: "insert", data: req });

        io.emit("managerCreated", { name: mn_ed_name });
        res.status(201).json({ success: true, message: "Gestor cadastrado com sucesso!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao criar gestor!", error: error.message });
    }
};

// 📌 4️⃣ Atualizar um gestor
const UpdateManager = async (req, res) => {
    try {
        const { ID } = req.params;
        const { mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status } = req.body;

        let query, params;

        if (req.file) {
            query = `UPDATE manager_eduall_account SET mn_ed_name = ?, mn_ed_email = ?, mn_ed_phone = ?, mn_ed_position = ?, mn_ed_profile_settings = ?, mn_ed_status = ?, mn_ed_avatar = ? WHERE mn_ed_id = ?`;
            params = [mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, "images/managers/" + req.file.filename, ID];
        } else {
            query = `UPDATE manager_eduall_account SET mn_ed_name = ?, mn_ed_email = ?, mn_ed_phone = ?, mn_ed_position = ?, mn_ed_profile_settings = ?, mn_ed_status = ? WHERE mn_ed_id = ?`;
            params = [mn_ed_name, mn_ed_email, mn_ed_phone, mn_ed_position, mn_ed_profile_settings, mn_ed_status, ID];
        }

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_account", type: "update", data: req });

        io.emit("managerUpdated", { manager_id: ID });
        res.status(200).json({ success: true, message: "Gestor atualizado!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao atualizar gestor!", error: error.message });
    }
};

// 📌 5️⃣ Deletar um gestor
const DeleteManager = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `DELETE FROM manager_eduall_account WHERE mn_ed_id = ?`;
        await ExecuteQuery(res, query, [ID], false, { db: "manager_eduall_account", type: "delete", data: req });

        io.emit("managerDeleted", { manager_id: ID });
        res.status(200).json({ success: true, message: "Gestor removido!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao excluir gestor!", error: error.message });
    }
};

module.exports = { GetManagers, GetManagerById, CreateManager, UpdateManager, DeleteManager , GetManagersWithClients}; 

 /*

 CREATE TABLE manager_eduall_manager_clients (
    mn_ed_id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mn_ed_manager_id INT(11) NOT NULL, -- ID do gestor de clientes
    mn_ed_client_id INT(11) NOT NULL, -- ID do cliente (instituto)
    mn_ed_description TEXT DEFAULT NULL, -- Detalhes adicionais da atribuição
    mn_ed_responsibility VARCHAR(255) DEFAULT NULL, -- Responsabilidade do gestor sobre o cliente
    mn_ed_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mn_ed_manager_id) REFERENCES manager_eduall_account(mn_ed_id) ON DELETE CASCADE,
    FOREIGN KEY (mn_ed_client_id) REFERENCES eduall_institutes(ed_institute_id) ON DELETE CASCADE
);


 */
 