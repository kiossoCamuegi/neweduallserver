const ExecuteQuery = require("../Functions/ExecuteQuery");
const { io } = require("../server");

// 📌 1️⃣ Obter todas as reclamações de clientes
const GetComplains = async (req, res) => {
    try {
        const query = `SELECT * FROM manager_eduall_customers_complains ORDER BY mn_ed_complain_date DESC`;
        const complains = await ExecuteQuery(res, query, [], true, { db: "manager_eduall_customers_complains", type: "select", data: req });

        io.emit("updateComplains", complains); // 🔥 Atualiza todos os clientes conectados
        res.status(200).json(complains);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar reclamações!", error: error.message });
    }
};

// 📌 2️⃣ Obter uma reclamação específica por ID
const GetComplainById = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM manager_eduall_customers_complains WHERE mn_ed_complain_id = ?`;
        const complains = await ExecuteQuery(res, query, [ID], true, { db: "manager_eduall_customers_complains", type: "select", data: req });

        if (complains.length > 0) {
            res.status(200).json(complains[0]);
        } else {
            res.status(404).json({ message: "Reclamação não encontrada!" });
        }
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar reclamação!", error: error.message });
    }
};

// 📌 3️⃣ Criar uma nova reclamação
const CreateComplain = async (req, res) => {
    try {
        const { mn_ed_customer_id, mn_ed_complain_description, mn_ed_complain_status } = req.body;

        const query = `INSERT INTO manager_eduall_customers_complains (mn_ed_customer_id, mn_ed_complain_description, mn_ed_complain_status) VALUES (?, ?, ?)`;
        const params = [mn_ed_customer_id, mn_ed_complain_description, mn_ed_complain_status];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_customers_complains", type: "insert", data: req });

        io.emit("complainCreated", { customer_id: mn_ed_customer_id, description: mn_ed_complain_description });
        res.status(201).json({ success: true, message: "Reclamação registrada com sucesso!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao registrar reclamação!", error: error.message });
    }
};

// 📌 4️⃣ Atualizar uma reclamação por ID
const UpdateComplain = async (req, res) => {
    try {
        const { ID } = req.params;
        const { mn_ed_complain_description, mn_ed_complain_status } = req.body;

        const query = `UPDATE manager_eduall_customers_complains SET mn_ed_complain_description = ?, mn_ed_complain_status = ? WHERE mn_ed_complain_id = ?`;
        const params = [mn_ed_complain_description, mn_ed_complain_status, ID];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_customers_complains", type: "update", data: req });

        io.emit("complainUpdated", { complain_id: ID });
        res.status(200).json({ success: true, message: "Reclamação atualizada!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao atualizar reclamação!", error: error.message });
    }
};

// 📌 5️⃣ Deletar uma reclamação por ID
const DeleteComplain = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `DELETE FROM manager_eduall_customers_complains WHERE mn_ed_complain_id = ?`;
        await ExecuteQuery(res, query, [ID], false, { db: "manager_eduall_customers_complains", type: "delete", data: req });

        io.emit("complainDeleted", { complain_id: ID });
        res.status(200).json({ success: true, message: "Reclamação removida!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao excluir reclamação!", error: error.message });
    }
};

module.exports = { GetComplains, GetComplainById, CreateComplain, UpdateComplain, DeleteComplain };







/*


CREATE TABLE manager_eduall_customers_complains (
    mn_ed_complain_id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mn_ed_customer_id INT(11) NOT NULL, -- ID do cliente que fez a reclamação
    mn_ed_complain_description TEXT NOT NULL,
    mn_ed_complain_status ENUM('pendente', 'em análise', 'resolvido') NOT NULL DEFAULT 'pendente',
    mn_ed_complain_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mn_ed_customer_id) REFERENCES manager_eduall_customers(mn_ed_customer_id) ON DELETE CASCADE
);


*/