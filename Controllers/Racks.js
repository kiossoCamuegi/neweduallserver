const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* ─────────────────────────────────────────────────────────────────────────
   PRATELEIRAS (racks) — pertencem a uma estante (bookcase), têm posição
   dentro dela e uma capacidade máxima de livros.
───────────────────────────────────────────────────────────────────────── */

// ─── GET todas as prateleiras (opcionalmente filtradas por ?bookcase_id=) ──
const GetRacks = async (req, res) => {
    try {
        const { bookcase_id } = req.query;
        let query = `SELECT * FROM eduall_library_racks 
      WHERE ed_library_rack_deleted = 0 AND ed_library_rack_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];

        if (bookcase_id !== undefined) {
            if (bookcase_id === 'null') {
                query += ` AND ed_library_rack_bookcase_id IS NULL`;
            } else {
                query += ` AND ed_library_rack_bookcase_id = ?`;
                PARAMS.push(bookcase_id);
            }
        }

        query += ` ORDER BY ed_library_rack_bookcase_id ASC, ed_library_rack_order ASC, ed_library_rack_name ASC`;

        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_racks", type: "select" });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter a prateleira !", success: false, error: error.message });
    }
};

const GetSingleRack = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_library_racks WHERE ed_library_rack_deleted = 0 AND ed_library_rack_id = ? AND ed_library_rack_institute_code = ?';
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_racks", type: "select" });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter a prateleira!", success: false, error: error.message });
    }
};

// ─── POST criar prateleira (já nasce dentro de uma estante, no fim dela) ────
// Body esperado: { rack_name, rack_status, rack_bookcase_id?, rack_capacity? }
const RegisterRack = async (req, res) => {
    try {
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;
        const bookcaseId = req.body.rack_bookcase_id ?? null;

        const orderQuery = `SELECT COALESCE(MAX(ed_library_rack_order), -1) AS maxOrder 
      FROM eduall_library_racks 
      WHERE ed_library_rack_deleted = 0 AND ed_library_rack_institute_code = ? 
      AND ed_library_rack_bookcase_id ${bookcaseId === null ? 'IS NULL' : '= ?'}`;
        const orderParams = bookcaseId === null ? [instituteCode] : [instituteCode, bookcaseId];
        const orderResult = await ExecuteQuery(res, orderQuery, orderParams, true, { db: "eduall_library_racks", type: "select" });
        const nextOrder = (orderResult?.[0]?.maxOrder ?? -1) + 1;

        const query = `INSERT INTO eduall_library_racks
      (ed_library_rack_name, ed_library_rack_bookcase_id, ed_library_rack_order, ed_library_rack_capacity, ed_library_rack_status, ed_library_rack_institute_code)
      VALUES (?, ?, ?, ?, ?, ?)`;
        const PARAMS = [
            req.body.rack_name,
            bookcaseId,
            nextOrder,
            req.body.rack_capacity || 20,
            req.body.rack_status,
            instituteCode,
        ];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_racks", type: "insert", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Prateleiras",
            description: `Registrou uma nova prateleira (${req.body.rack_name}) com o status ${req.body.rack_status}`,
        }).catch(() => null);

        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao registrar a prateleira!", success: false, error: error.message });
    }
};

// ─── DELETE prateleira (soft-delete) ────────────────────────────────────────
// Os livros que estavam nesta prateleira NÃO são apagados — ficam "soltos"
// (ed_library_book_rack = NULL) até seres movidos para outra prateleira.
const RackDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        const detachQuery = `UPDATE eduall_library_books SET ed_library_book_rack = NULL 
      WHERE ed_library_book_rack = ? AND ed_library_book_institute_code = ?`;
        await ExecuteQuery(res, detachQuery, [ID, instituteCode], false, { db: "eduall_library_books", type: "update", data: req });

        const query = `UPDATE eduall_library_racks SET ed_library_rack_deleted = 1 WHERE ed_library_rack_deleted = 0 AND ed_library_rack_id = ? AND ed_library_rack_institute_code = ?`;
        const PARAMS = [ID, instituteCode];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_racks", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Prateleiras",
            description: `Eliminou a prateleira com ID ${ID} (livros ficaram sem prateleira, nada foi apagado)`,
        }).catch(() => null);

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao deletar a prateleira!", success: false, error: error.message });
    }
};

// ─── PUT atualizar prateleira (nome / status / capacidade) ─────────────────
const RackUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { rack_name, rack_status, rack_capacity } = req.body;
        const query = `UPDATE eduall_library_racks SET 
        ed_library_rack_name = ?, 
        ed_library_rack_status = ?, 
        ed_library_rack_capacity = ? 
      WHERE ed_library_rack_deleted = 0 AND ed_library_rack_id = ? AND ed_library_rack_institute_code = ?`;
        const PARAMS = [rack_name, rack_status, rack_capacity || 20, ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_racks", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Prateleiras",
            description: `Atualizou a prateleira (${rack_name}) com o status ${rack_status} e ID ${ID}`,
        }).catch(() => null);

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao atualizar a prateleira !", success: false, error: error.message });
    }
};

// ─── PUT reordenar prateleiras dentro da MESMA estante ─────────────────────
// Body esperado: { order: [{ id, order }, { id, order }, ...] }
const ReorderRacks = async (req, res) => {
    try {
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;
        const { order } = req.body;

        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ msg: "Lista de ordenação inválida!", success: false });
        }

        const query = `UPDATE eduall_library_racks SET ed_library_rack_order = ? 
      WHERE ed_library_rack_id = ? AND ed_library_rack_institute_code = ? AND ed_library_rack_deleted = 0`;

        for (const item of order) {
            await ExecuteQuery(res, query, [item.order, item.id, instituteCode], false, { db: "eduall_library_racks", type: "update", data: req });
        }

        await RegisterAuditAction({
            session: req.session,
            action: 2,
            form: "Prateleiras",
            description: `Reordenou ${order.length} prateleira(s)`,
        }).catch(() => null);

        res.status(200).json({ success: true, msg: "Prateleiras reordenadas com sucesso!" });
    } catch (error) {
        res.status(500).json({ msg: "Falha ao reordenar as prateleiras!", success: false, error: error.message });
    }
};

// ─── PUT mover prateleira para OUTRA estante ────────────────────────────────
// Body esperado: { bookcase_id: number|null, order?: number }
// Se "order" não vier, a prateleira entra no fim da estante de destino.
// bookcase_id = null move a prateleira para "sem estante".
const MoveRack = async (req, res) => {
    try {
        const { ID } = req.params;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;
        const targetBookcaseId = req.body.bookcase_id ?? null;
        let targetOrder = req.body.order;

        if (targetOrder === undefined || targetOrder === null) {
            const orderQuery = `SELECT COALESCE(MAX(ed_library_rack_order), -1) AS maxOrder 
        FROM eduall_library_racks 
        WHERE ed_library_rack_deleted = 0 AND ed_library_rack_institute_code = ? 
        AND ed_library_rack_bookcase_id ${targetBookcaseId === null ? 'IS NULL' : '= ?'}`;
            const orderParams = targetBookcaseId === null ? [instituteCode] : [instituteCode, targetBookcaseId];
            const orderResult = await ExecuteQuery(res, orderQuery, orderParams, true, { db: "eduall_library_racks", type: "select" });
            targetOrder = (orderResult?.[0]?.maxOrder ?? -1) + 1;
        }

        const query = `UPDATE eduall_library_racks SET ed_library_rack_bookcase_id = ?, ed_library_rack_order = ? 
      WHERE ed_library_rack_deleted = 0 AND ed_library_rack_id = ? AND ed_library_rack_institute_code = ?`;
        const PARAMS = [targetBookcaseId, targetOrder, ID, instituteCode];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_racks", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,
            form: "Prateleiras",
            description: `Moveu a prateleira ID ${ID} para a estante ${targetBookcaseId ?? 'nenhuma'}`,
        }).catch(() => null);

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao mover a prateleira!", success: false, error: error.message });
    }
};

module.exports = {
    GetRacks,
    GetSingleRack,
    RegisterRack,
    RackDelete,
    RackUpdate,
    ReorderRacks,
    MoveRack,
};

/* ─────────────────────────────────────────────────────────────────────────
   SUGESTÃO DE ROTAS (ajusta ao teu padrão de router / nomes de ficheiro):

   GET    /api/edualllibraryracks/get?bookcase_id=1   → GetRacks
   GET    /api/eduallsinglelibraryrack/get/:ID        → GetSingleRack
   POST   /api/edualllibraryrackregister/post         → RegisterRack
   PUT    /api/edualllibraryrackupdate/update/:ID     → RackUpdate
   DELETE /api/edualllibraryrackdelete/delete/:ID     → RackDelete
   PUT    /api/edualllibraryracksreorder/update       → ReorderRacks
   PUT    /api/edualllibraryrackmove/update/:ID       → MoveRack
───────────────────────────────────────────────────────────────────────── */