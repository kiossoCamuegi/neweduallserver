// CACHE-OPT v6 (aplicado por apply_cache_optimizations_v6.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v6: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");

const GetPublishers = async (req, res) => {
    try {
        const _ck = `publishers:${req.session.user.eduall_user_session_curentinstitute}:list`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const query = 'SELECT * FROM eduall_library_publishers WHERE ed_library_publisher_deleted = 0 AND ed_library_publisher_institute_code = ?';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_publishers", type: "select", data: req });
        await _cacheSet(_ck, result, 600);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar os editores!", error: error.message });
    }
};

const GetSinglePublisher = async (req, res) => {
    try {
        const _ck = `publishers:${req.session.user.eduall_user_session_curentinstitute}:single:${req.params.ID}`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_library_publishers WHERE ed_library_publisher_deleted = 0 AND ed_library_publisher_id = ? AND ed_library_publisher_institute_code = ?';
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_publishers", type: "select", data: req });
        await _cacheSet(_ck, result, 600);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar o editor!", error: error.message });
    }
};

const RegisterPublisher = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_library_publishers(ed_library_publisher_name, ed_library_publisher_status, ed_library_publisher_institute_code)
        VALUES(?,?,?)`;
        const PARAMS = [req.body.publisher_name, req.body.publisher_status, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_publishers", type: "insert", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Editores",
            description: `Registrou um novo editor: ${req.body.publisher_name}`,
        });

        await _cacheClear(`publishers:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao registrar o editor!", error: error.message });
    }
};

const PublisherDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_library_publishers SET ed_library_publisher_deleted = 1 WHERE ed_library_publisher_deleted = 0 AND ed_library_publisher_id = ? AND ed_library_publisher_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_publishers", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Editores",
            description: `Eliminou o editor com ID ${ID}`,
        });

        await _cacheClear(`publishers:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao deletar o editor!", error: error.message });
    }
};

const PublisherUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { publisher_name, publisher_status } = req.body;
        const query = `UPDATE eduall_library_publishers SET ed_library_publisher_name = ?, ed_library_publisher_status = ?
        WHERE ed_library_publisher_deleted = 0 AND ed_library_publisher_id = ? AND ed_library_publisher_institute_code = ?`;
        const PARAMS = [publisher_name, publisher_status, ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_publishers", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Editores",
            description: `Atualizou o editor (${publisher_name}) com ID ${ID}`,
        });

        await _cacheClear(`publishers:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao atualizar o editor!", error: error.message });
    }
};

module.exports = { GetPublishers, GetSinglePublisher, RegisterPublisher, PublisherDelete, PublisherUpdate }; 