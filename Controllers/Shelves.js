const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

/* ─────────────────────────────────────────────────────────────────────────
   ESTANTES (bookcases) — agrupador de prateleiras (racks)
───────────────────────────────────────────────────────────────────────── */

// ─── GET todas as estantes ─────────────────────────────────────────────────
const GetBookcases = async (req, res) => {
    try {
        const query = `SELECT * FROM eduall_library_bookcases 
      WHERE ed_library_bookcase_deleted = 0 AND ed_library_bookcase_institute_code = ? 
      ORDER BY ed_library_bookcase_order ASC, ed_library_bookcase_id ASC`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_bookcases", type: "select" });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter as estantes!", success: false, error: error.message });
    }
};

// ─── GET uma estante ────────────────────────────────────────────────────────
const GetSingleBookcase = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_library_bookcases 
      WHERE ed_library_bookcase_deleted = 0 AND ed_library_bookcase_id = ? AND ed_library_bookcase_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_bookcases", type: "select" });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter a estante!", success: false, error: error.message });
    }
};

// ─── POST criar estante (entra sempre no fim da lista) ─────────────────────
const RegisterBookcase = async (req, res) => {
    try {
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        const orderQuery = `SELECT COALESCE(MAX(ed_library_bookcase_order), -1) AS maxOrder 
      FROM eduall_library_bookcases 
      WHERE ed_library_bookcase_deleted = 0 AND ed_library_bookcase_institute_code = ?`;
        const orderResult = await ExecuteQuery(res, orderQuery, [instituteCode], true, { db: "eduall_library_bookcases", type: "select" });
        const nextOrder = (orderResult?.[0]?.maxOrder ?? -1) + 1;

        const query = `INSERT INTO eduall_library_bookcases
      (ed_library_bookcase_name, ed_library_bookcase_color, ed_library_bookcase_order, ed_library_bookcase_status, ed_library_bookcase_institute_code)
      VALUES (?, ?, ?, ?, ?)`;
        const PARAMS = [
            req.body.bookcase_name,
            req.body.bookcase_color || 'brown',
            nextOrder,
            req.body.bookcase_status ?? 1,
            instituteCode,
        ];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_bookcases", type: "insert", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 1, // Ação de registro
            form: "Estantes",
            description: `Registou uma nova estante (${req.body.bookcase_name})`,
        }).catch(() => null);

        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao registar a estante!", success: false, error: error.message });
    }
};

// ─── PUT atualizar estante (nome / cor / status) ────────────────────────────
const BookcaseUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { bookcase_name, bookcase_color, bookcase_status } = req.body;
        const query = `UPDATE eduall_library_bookcases SET 
        ed_library_bookcase_name = ?, 
        ed_library_bookcase_color = ?, 
        ed_library_bookcase_status = ? 
      WHERE ed_library_bookcase_deleted = 0 AND ed_library_bookcase_id = ? AND ed_library_bookcase_institute_code = ?`;
        const PARAMS = [bookcase_name, bookcase_color, bookcase_status, ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_bookcases", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2, // Ação de atualização
            form: "Estantes",
            description: `Atualizou a estante (${bookcase_name}) com ID ${ID}`,
        }).catch(() => null);

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao atualizar a estante!", success: false, error: error.message });
    }
};

// ─── DELETE estante (soft-delete) ───────────────────────────────────────────
// As prateleiras que pertenciam a esta estante NÃO são apagadas — ficam
// apenas "soltas" (ed_library_rack_bookcase_id = NULL), assim como os
// livros dessas prateleiras continuam intactos.
const BookcaseDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        const detachQuery = `UPDATE eduall_library_racks SET ed_library_rack_bookcase_id = NULL 
      WHERE ed_library_rack_bookcase_id = ? AND ed_library_rack_institute_code = ?`;
        await ExecuteQuery(res, detachQuery, [ID, instituteCode], false, { db: "eduall_library_racks", type: "update", data: req });

        const query = `UPDATE eduall_library_bookcases SET ed_library_bookcase_deleted = 1 
      WHERE ed_library_bookcase_deleted = 0 AND ed_library_bookcase_id = ? AND ed_library_bookcase_institute_code = ?`;
        const result = await ExecuteQuery(res, query, [ID, instituteCode], false, { db: "eduall_library_bookcases", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3, // Ação de eliminação
            form: "Estantes",
            description: `Eliminou a estante com ID ${ID} (prateleiras ficaram sem estante, nada foi apagado)`,
        }).catch(() => null);

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao eliminar a estante!", success: false, error: error.message });
    }
};

// ─── PUT reordenar estantes (arrastar de um lugar para o outro) ────────────
// Body esperado: { order: [{ id, order }, { id, order }, ...] }
const ReorderBookcases = async (req, res) => {
    try {
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;
        const { order } = req.body;

        if (!Array.isArray(order) || order.length === 0) {
            return res.status(400).json({ msg: "Lista de ordenação inválida!", success: false });
        }

        const query = `UPDATE eduall_library_bookcases SET ed_library_bookcase_order = ? 
      WHERE ed_library_bookcase_id = ? AND ed_library_bookcase_institute_code = ? AND ed_library_bookcase_deleted = 0`;

        for (const item of order) {
            await ExecuteQuery(res, query, [item.order, item.id, instituteCode], false, { db: "eduall_library_bookcases", type: "update", data: req });
        }

        await RegisterAuditAction({
            session: req.session,
            action: 2,
            form: "Estantes",
            description: `Reordenou ${order.length} estante(s)`,
        }).catch(() => null);

        res.status(200).json({ success: true, msg: "Estantes reordenadas com sucesso!" });
    } catch (error) {
        res.status(500).json({ msg: "Falha ao reordenar as estantes!", success: false, error: error.message });
    }
};

module.exports = {
    GetBookcases,
    GetSingleBookcase,
    RegisterBookcase,
    BookcaseUpdate,
    BookcaseDelete,
    ReorderBookcases,
};

/* ─────────────────────────────────────────────────────────────────────────
   SUGESTÃO DE ROTAS (ajusta ao teu padrão de router / nomes de ficheiro):

   GET    /api/edualllibrarybookcases/get                → GetBookcases
   GET    /api/eduallsinglelibrarybookcase/get/:ID        → GetSingleBookcase
   POST   /api/edualllibrarybookcaseregister/post         → RegisterBookcase
   PUT    /api/edualllibrarybookcaseupdate/update/:ID     → BookcaseUpdate
   DELETE /api/edualllibrarybookcasedelete/delete/:ID     → BookcaseDelete
   PUT    /api/edualllibrarybookcasesreorder/update       → ReorderBookcases
───────────────────────────────────────────────────────────────────────── */