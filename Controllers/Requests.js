// CACHE-OPT v6 (aplicado por apply_cache_optimizations_v6.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v6: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");

const GetRequests = async (req, res) => { 
    try {
        const _ck = `requests:${req.session.user.eduall_user_session_curentinstitute}:list`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const query = `SELECT * FROM eduall_requests 
        LEFT JOIN eduall_students ON eduall_students.ed_student_id = ed_request_made_by
        WHERE ed_request_deleted = 0 AND ed_request_institute_code = ?`; 
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
        await _cacheSet(_ck, rows, 120);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch requests!", error: error.message });
    }
};

const GetsingleRequest = async (req, res) => {
    try {
        const _ck = `requests:${req.session.user.eduall_user_session_curentinstitute}:single:${req.params.ID}`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const { ID } = req.params; 
        const query = `SELECT * FROM eduall_requests 
        WHERE ed_request_deleted = 0 AND ed_request_id = ? AND ed_request_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
        await _cacheSet(_ck, rows, 120);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch the request!", error: error.message });
    }
};

const GetsingleUserRequests = async (req, res) => {
    try {
        const _ck = `requests:${req.session.user.eduall_user_session_curentinstitute}:byUser:${req.params.USERCODE}`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const { USERCODE } = req.params; 
        const query = `SELECT * FROM eduall_requests 
        WHERE ed_request_deleted = 0 AND ed_request_made_by = ? AND ed_request_institute_code = ?`;
        const PARAMS = [USERCODE, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_requests", type: "select", data: req });
        await _cacheSet(_ck, rows, 120);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to fetch the user requests!", error: error.message });
    }
};

const RegisterRequest = async (req, res) => { 
    try {
        const query = `INSERT INTO eduall_requests(ed_request_type, ed_request_description, ed_request_made_by, ed_request_institute_code) 
        VALUES(?,?,?,?)`;
        const PARAMS = [req.body.request_type, req.body.request_description, req.body.request_made_by, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_requests", type: "insert", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Solicitações",
            description: `Registrou uma nova solicitação`,
        });

        await _cacheClear(`requests:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to register the request!", error: error.message });
    }
};

const RequestDelete = async (req, res) => {
    try {
        const { ID } = req.params; 
        const query = `UPDATE eduall_requests SET ed_request_deleted = 1 
        WHERE ed_request_deleted = 0 AND ed_request_id = ? AND ed_request_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_requests", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Solicitações",
            description: `Eliminou a solicitação com ID ${ID}`,
        });

        await _cacheClear(`requests:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete the request!", error: error.message });
    }
};

const RequestUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { request_type, request_description, request_status, request_made_by } = req.body; 
        const query = `UPDATE eduall_requests SET ed_request_type = ?, ed_request_description = ?, 
        ed_request_made_by = ?, ed_request_status = ? 
        WHERE ed_request_deleted = 0 AND ed_request_id = ? AND ed_request_institute_code = ?`;
        const PARAMS = [request_type, request_description, request_made_by, request_status, ID, req.session.user.eduall_user_session_curentinstitute];
        const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_requests", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Solicitações",
            description: `Atualizou a solicitação com ID ${ID}`,
        });

        await _cacheClear(`requests:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to update the request!", error: error.message });
    }
};

module.exports = { GetRequests, GetsingleRequest, GetsingleUserRequests, RegisterRequest, RequestDelete, RequestUpdate };

 