// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");

const GetProviders = async (req, res) => {
    try {
        const _ck = `providers:${req.session.user.eduall_user_session_curentinstitute}:list`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const query = 'SELECT * FROM eduall_providers WHERE ed_provider_deleted = 0 AND ed_provider_institute_code = ?';
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute]; 
        const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_providers", type: "select", data: req });
        await _cacheSet(_ck, rows, 600);
        res.status(200).json(rows);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter os fornecedores!", success: false, error: error.message });
    }
};

const RegisterProvider = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_providers(ed_provider_title, ed_provider_phone, ed_provider_nif, ed_provider_website, ed_provider_address, 
        ed_provider_city, ed_provider_country, ed_provider_email, ed_provider_description, ed_provider_institute_code) 
        VALUES(?,?,?,?,?,?,?,?,?,?)`;
        const PARAMS = [req.body.provider_name, req.body.provider_phone, req.body.provider_nif, req.body.provider_website, req.body.provider_address,
            req.body.provider_city, req.body.provider_country, req.body.provider_email, req.body.provider_description, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_providers", type: "insert", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Fornecedores",
            description: `Registrou um novo fornecedor (${req.body.provider_name}) com o NIF ${req.body.provider_nif}`,
        });

        await _cacheClear(`providers:${req.session.user.eduall_user_session_curentinstitute}:*`, `products:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao registrar o fornecedor!", success: false, error: error.message });
    }
};

const GetSingleProvider = async (req, res) => {
    try {
        const _ck = `providers:${req.session.user.eduall_user_session_curentinstitute}:single:${req.params.ID}`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const { ID } = req.params;
        const query = 'SELECT * FROM eduall_providers WHERE ed_provider_deleted = 0 AND ed_provider_id = ? AND ed_provider_institute_code = ?';
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_providers", type: "select" });
        await _cacheSet(_ck, result, 600);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter o fornecedor!", success: false, error: error.message });
    }
};

const ProviderDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_providers SET ed_provider_deleted = 1 WHERE ed_provider_deleted = 0 AND ed_provider_id = ? AND ed_provider_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_providers", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Fornecedores",
            description: `Eliminou o fornecedor com ID ${ID}`,
        });

        await _cacheClear(`providers:${req.session.user.eduall_user_session_curentinstitute}:*`, `products:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao deletar o fornecedor!", success: false, error: error.message });
    }
};

const ProviderUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { provider_name, provider_phone, provider_nif, provider_website, provider_address, provider_city,
            provider_country, provider_email, provider_description } = req.body;
        const query = `UPDATE eduall_providers SET ed_provider_title = ?, ed_provider_phone = ?, ed_provider_nif = ?, ed_provider_website = ?,
        ed_provider_address = ?, ed_provider_city = ?, ed_provider_country = ?, ed_provider_email = ?, ed_provider_description = ?
        WHERE ed_provider_deleted = 0 AND ed_provider_id = ? AND ed_provider_institute_code = ?`;
        const PARAMS = [provider_name, provider_phone, provider_nif, provider_website, provider_address, provider_city,
            provider_country, provider_email, provider_description, ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_providers", type: "update", data: req });

        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Fornecedores",
            description: `Atualizou o fornecedor (${provider_name}) com o NIF ${provider_nif} e ID ${ID}`,
        });

        await _cacheClear(`providers:${req.session.user.eduall_user_session_curentinstitute}:*`, `products:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao atualizar o fornecedor!", success: false, error: error.message });
    }
};

module.exports = { GetProviders, RegisterProvider, GetSingleProvider, ProviderDelete, ProviderUpdate }; 
