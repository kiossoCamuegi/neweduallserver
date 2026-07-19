const ExecuteQuery = require("../Functions/ExecuteQuery");
const { io } = require("../server");

// 📌 Obter todas as tarefas (com subtarefas e comentários)
const GetTasks = async (req, res) => {
    try {
        const queryTasks = `SELECT * FROM manager_eduall_tasks`;
        const tasks = await ExecuteQuery(res, queryTasks, [], true, { db: "manager_eduall_tasks", type: "select", data: req });

        for (let task of tasks) {
            const querySubtasks = `SELECT * FROM manager_eduall_subtasks WHERE mn_ed_task_id = ?`;
            const queryComments = `SELECT * FROM manager_eduall_comments WHERE mn_ed_task_id = ?`;
            task.task_subtasks = await ExecuteQuery(res, querySubtasks, [task.mn_ed_task_id], true, { db: "manager_eduall_subtasks", type: "select", data: req });
            task.task_comments = await ExecuteQuery(res, queryComments, [task.mn_ed_task_id], true, { db: "manager_eduall_comments", type: "select", data: req });
        }

        io.emit("updateTasks", tasks); // 🔥 Atualiza clientes
        res.status(200).json(tasks);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar tarefas!", error: error.message });
    }
};
 

// 📌 Criar nova tarefa
const CreateTask = async (req, res) => {
    try {
        const { mn_ed_task_title, mn_ed_task_status, mn_ed_task_type, mn_ed_task_owner, mn_ed_task_description, mn_ed_task_subtitle, mn_ed_task_deadline } = req.body;

        const query = `INSERT INTO manager_eduall_tasks (mn_ed_task_title, mn_ed_task_status, mn_ed_task_type, mn_ed_task_owner, mn_ed_task_description, mn_ed_task_subtitle, mn_ed_task_deadline) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const params = [mn_ed_task_title, mn_ed_task_status, mn_ed_task_type, mn_ed_task_owner, mn_ed_task_description, mn_ed_task_subtitle, mn_ed_task_deadline];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_tasks", type: "insert", data: req });

        io.emit("taskCreated", { title: mn_ed_task_title });
        res.status(201).json({ success: true, message: "Tarefa criada com sucesso!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao criar tarefa!", error: error.message });
    }
};

const ExecuteQuery = require("../Functions/ExecuteQuery");
const { io } = require("../server");

// 📌 1️⃣ Obter todas as subtarefas de uma tarefa específica
const GetSubtasksByTaskId = async (req, res) => {
    try {
        const { taskId } = req.params;
        const subtasks = await ExecuteQuery(res, `SELECT * FROM manager_eduall_subtasks WHERE mn_ed_task_id = ?`, [taskId], true, { db: "manager_eduall_subtasks", type: "select", data: req });

        res.status(200).json(subtasks);
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar subtarefas!", error: error.message });
    }
};

// 📌 2️⃣ Obter uma única subtarefa por ID
const GetSubtaskById = async (req, res) => {
    try {
        const { subtaskId } = req.params;
        const subtasks = await ExecuteQuery(res, `SELECT * FROM manager_eduall_subtasks WHERE mn_ed_subtask_id = ?`, [subtaskId], true, { db: "manager_eduall_subtasks", type: "select", data: req });

        if (subtasks.length > 0) {
            res.status(200).json(subtasks[0]);
        } else {
            res.status(404).json({ message: "Subtarefa não encontrada!" });
        }
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar subtarefa!", error: error.message });
    }
};

// 📌 3️⃣ Criar uma nova subtarefa
const CreateSubtask = async (req, res) => {
    try {
        const { mn_ed_task_id, mn_ed_subtask_title, mn_ed_subtask_status, mn_ed_subtask_type, mn_ed_subtask_owner, mn_ed_subtask_description, mn_ed_subtask_deadline } = req.body;

        const query = `INSERT INTO manager_eduall_subtasks (mn_ed_task_id, mn_ed_subtask_title, mn_ed_subtask_status, mn_ed_subtask_type, mn_ed_subtask_owner, mn_ed_subtask_description, mn_ed_subtask_deadline) VALUES (?, ?, ?, ?, ?, ?, ?)`;
        const params = [mn_ed_task_id, mn_ed_subtask_title, mn_ed_subtask_status, mn_ed_subtask_type, mn_ed_subtask_owner, mn_ed_subtask_description, mn_ed_subtask_deadline];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_subtasks", type: "insert", data: req });

        io.emit("subtaskCreated", { task_id: mn_ed_task_id, title: mn_ed_subtask_title });
        res.status(201).json({ success: true, message: "Subtarefa criada com sucesso!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao criar subtarefa!", error: error.message });
    }
};

// 📌 4️⃣ Atualizar uma subtarefa por ID
const UpdateSubtask = async (req, res) => {
    try {
        const { subtaskId } = req.params;
        const { mn_ed_subtask_title, mn_ed_subtask_status, mn_ed_subtask_description, mn_ed_subtask_deadline } = req.body;

        const query = `UPDATE manager_eduall_subtasks SET mn_ed_subtask_title = ?, mn_ed_subtask_status = ?, mn_ed_subtask_description = ?, mn_ed_subtask_deadline = ? WHERE mn_ed_subtask_id = ?`;
        const params = [mn_ed_subtask_title, mn_ed_subtask_status, mn_ed_subtask_description, mn_ed_subtask_deadline, subtaskId];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_subtasks", type: "update", data: req });

        io.emit("subtaskUpdated", { subtask_id: subtaskId });
        res.status(200).json({ success: true, message: "Subtarefa atualizada!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao atualizar subtarefa!", error: error.message });
    }
};

// 📌 5️⃣ Deletar uma subtarefa por ID
const DeleteSubtask = async (req, res) => {
    try {
        const { subtaskId } = req.params;
        const query = `DELETE FROM manager_eduall_subtasks WHERE mn_ed_subtask_id = ?`;
        await ExecuteQuery(res, query, [subtaskId], false, { db: "manager_eduall_subtasks", type: "delete", data: req });

        io.emit("subtaskDeleted", { subtask_id: subtaskId });
        res.status(200).json({ success: true, message: "Subtarefa removida!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao excluir subtarefa!", error: error.message });
    }
};
 

// 📌 Criar comentário
const CreateComment = async (req, res) => {
    try {
        const { mn_ed_task_id, mn_ed_subtask_id, mn_ed_comment_description, mn_ed_comment_reaction } = req.body;
        const file = req.file ? "uploads/comments/" + req.file.filename : null;

        const query = `INSERT INTO manager_eduall_comments (mn_ed_task_id, mn_ed_subtask_id, mn_ed_comment_description, mn_ed_comment_reaction, mn_ed_comment_file) VALUES (?, ?, ?, ?, ?)`;
        const params = [mn_ed_task_id, mn_ed_subtask_id, mn_ed_comment_description, mn_ed_comment_reaction, file];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_comments", type: "insert", data: req });

        io.emit("commentAdded", { task_id: mn_ed_task_id, subtask_id: mn_ed_subtask_id });
        res.status(201).json({ success: true, message: "Comentário adicionado!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao adicionar comentário!", error: error.message });
    }
};

 
// 📌 2️⃣ Obter uma única tarefa por ID
const GetTaskById = async (req, res) => {
    try {
        const { ID } = req.params;
        const tasks = await ExecuteQuery(res, `SELECT * FROM manager_eduall_tasks WHERE mn_ed_task_id = ?`, [ID], true, { db: "manager_eduall_tasks", type: "select", data: req });

        if (tasks.length > 0) {
            tasks[0].task_subtasks = await ExecuteQuery(res, `SELECT * FROM manager_eduall_subtasks WHERE mn_ed_task_id = ?`, [ID], true, { db: "manager_eduall_subtasks", type: "select", data: req });
            tasks[0].task_comments = await ExecuteQuery(res, `SELECT * FROM manager_eduall_comments WHERE mn_ed_task_id = ?`, [ID], true, { db: "manager_eduall_comments", type: "select", data: req });
            res.status(200).json(tasks[0]);
        } else {
            res.status(404).json({ message: "Tarefa não encontrada!" });
        }
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar tarefa!", error: error.message });
    }
};

 
// 📌 4️⃣ Atualizar tarefa
const UpdateTask = async (req, res) => {
    try {
        const { ID } = req.params;
        const { mn_ed_task_title, mn_ed_task_status, mn_ed_task_description, mn_ed_task_deadline } = req.body;

        const query = `UPDATE manager_eduall_tasks SET mn_ed_task_title = ?, mn_ed_task_status = ?, mn_ed_task_description = ?, mn_ed_task_deadline = ? WHERE mn_ed_task_id = ?`;
        const params = [mn_ed_task_title, mn_ed_task_status, mn_ed_task_description, mn_ed_task_deadline, ID];

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_tasks", type: "update", data: req });

        io.emit("taskUpdated", { task_id: ID });
        res.status(200).json({ success: true, message: "Tarefa atualizada!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao atualizar tarefa!", error: error.message });
    }
};

// 📌 5️⃣ Deletar tarefa
const DeleteTask = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `DELETE FROM manager_eduall_tasks WHERE mn_ed_task_id = ?`;
        await ExecuteQuery(res, query, [ID], false, { db: "manager_eduall_tasks", type: "delete", data: req });

        io.emit("taskDeleted", { task_id: ID });
        res.status(200).json({ success: true, message: "Tarefa removida!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao excluir tarefa!", error: error.message });
    }
};


 
 

// 📌 3️⃣ Obter um comentário por ID
const GetCommentById = async (req, res) => {
    try {
        const { ID } = req.params;
        const comments = await ExecuteQuery(res, `SELECT * FROM manager_eduall_comments WHERE mn_ed_comment_id = ?`, [ID], true, { db: "manager_eduall_comments", type: "select", data: req });

        if (comments.length > 0) {
            res.status(200).json(comments[0]);
        } else {
            res.status(404).json({ message: "Comentário não encontrado!" });
        }
    } catch (error) {
        res.status(500).json({ message: "Erro ao buscar comentário!", error: error.message });
    }
};

// 📌 4️⃣ Atualizar um comentário por ID
const UpdateComment = async (req, res) => {
    try {
        const { ID } = req.params;
        const { mn_ed_comment_description, mn_ed_comment_reaction } = req.body;
        const file = req.file ? "uploads/comments/" + req.file.filename : null;

        let query, params;

        if (file) {
            query = `UPDATE manager_eduall_comments SET mn_ed_comment_description = ?, mn_ed_comment_reaction = ?, mn_ed_comment_file = ? WHERE mn_ed_comment_id = ?`;
            params = [mn_ed_comment_description, mn_ed_comment_reaction, file, ID];
        } else {
            query = `UPDATE manager_eduall_comments SET mn_ed_comment_description = ?, mn_ed_comment_reaction = ? WHERE mn_ed_comment_id = ?`;
            params = [mn_ed_comment_description, mn_ed_comment_reaction, ID];
        }

        await ExecuteQuery(res, query, params, false, { db: "manager_eduall_comments", type: "update", data: req });

        io.emit("commentUpdated", { comment_id: ID });
        res.status(200).json({ success: true, message: "Comentário atualizado!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao atualizar comentário!", error: error.message });
    }
};

// 📌 5️⃣ Deletar um comentário por ID
const DeleteComment = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `DELETE FROM manager_eduall_comments WHERE mn_ed_comment_id = ?`;
        await ExecuteQuery(res, query, [ID], false, { db: "manager_eduall_comments", type: "delete", data: req });

        io.emit("commentDeleted", { comment_id: ID });
        res.status(200).json({ success: true, message: "Comentário removido!" });
    } catch (error) {
        res.status(500).json({ message: "Erro ao excluir comentário!", error: error.message });
    }
};

 

/*

CREATE TABLE manager_eduall_tasks (
    mn_ed_task_id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mn_ed_task_title VARCHAR(255) NOT NULL,
    mn_ed_task_status ENUM('pendente', 'em andamento', 'concluído') NOT NULL DEFAULT 'pendente',
    mn_ed_task_type VARCHAR(100) NOT NULL,
    mn_ed_task_owner VARCHAR(255) NOT NULL,
    mn_ed_task_description TEXT NOT NULL,
    mn_ed_task_subtitle VARCHAR(255) DEFAULT NULL,
    mn_ed_task_deadline DATETIME NOT NULL,
    mn_ed_task_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    mn_ed_task_updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
);


CREATE TABLE manager_eduall_subtasks (
    mn_ed_subtask_id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mn_ed_task_id INT(11) NOT NULL, -- Relacionado à tarefa principal
    mn_ed_subtask_title VARCHAR(255) NOT NULL,
    mn_ed_subtask_status ENUM('pendente', 'em andamento', 'concluído') NOT NULL DEFAULT 'pendente',
    mn_ed_subtask_type VARCHAR(100) NOT NULL,
    mn_ed_subtask_owner VARCHAR(255) NOT NULL,
    mn_ed_subtask_description TEXT NOT NULL,
    mn_ed_subtask_deadline DATETIME NOT NULL,
    mn_ed_subtask_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    mn_ed_subtask_updated_at DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (mn_ed_task_id) REFERENCES manager_eduall_tasks(mn_ed_task_id) ON DELETE CASCADE
);



CREATE TABLE manager_eduall_comments (
    mn_ed_comment_id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
    mn_ed_task_id INT(11) DEFAULT NULL, -- Pode estar relacionado a uma tarefa
    mn_ed_subtask_id INT(11) DEFAULT NULL, -- Ou a uma subtarefa
    mn_ed_comment_description TEXT NOT NULL,
    mn_ed_comment_reaction VARCHAR(50) DEFAULT NULL,
    mn_ed_comment_file VARCHAR(255) DEFAULT NULL,
    mn_ed_comment_created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mn_ed_task_id) REFERENCES manager_eduall_tasks(mn_ed_task_id) ON DELETE CASCADE,
    FOREIGN KEY (mn_ed_subtask_id) REFERENCES manager_eduall_subtasks(mn_ed_subtask_id) ON DELETE CASCADE
);





*/