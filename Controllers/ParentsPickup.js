// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const axios = require("axios");
// CACHE-OPT v5: ALTER TABLE / information_schema só uma vez por processo (antes: em cada pedido)
let _portariaColReady = false;
let _parentIdCardColReady = false;

/**
 * ============================================================
 * BUSCAR ENCARREGADO/RESPONSÁVEL POR NÚMERO DE DOCUMENTO
 * ou por número de matrícula do aluno
 * ============================================================
 */

/**
 * SearchStudent — pesquisa alunos pelo nome ou matrícula para o react-select.
 * Retorna SEMPRE o aluno independentemente de ter ou não responsáveis.
 * O(1) query — resultado paginado a 20 registos para dropdown
 */
const SearchStudent = async (req, res) => {
    try {
        const { search } = req.query;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        if (!search || search.trim().length < 1) {
            return res.status(200).json({ success: true, data: [] });
        }

        const term = `%${search.trim()}%`;
        const query = `
            SELECT
                s.ed_student_id,
                s.ed_student_name,
                s.ed_student_code,
                s.ed_student_picture,
                c.ed_class_title,
                ci.ed_cicle_title
            FROM eduall_students s
            LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class AND c.ed_class_deleted = 0
            LEFT JOIN eduall_cicles ci ON ci.ed_cicle_id = c.ed_class_cicle AND ci.ed_cicle_deleted = 0
            WHERE s.ed_student_deleted = 0
              AND s.ed_student_institute_code = ?
              AND (
                LOWER(s.ed_student_name) LIKE LOWER(?)
                OR s.ed_student_code LIKE ?
              )
            ORDER BY s.ed_student_name ASC
            LIMIT 20
        `;
        const rows = await ExecuteQuery(res, query, [instituteCode, term, term], true, {
            db: "eduall_students", type: "select", data: req
        });

        return res.status(200).json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * GetStudentForPortaria — devolve dados completos de um aluno pelo ID.
 * Garante que o aluno aparece mesmo sem responsáveis (sem INNER JOIN).
 * O(1)
 */
const GetStudentForPortaria = async (req, res) => {
    try {
        const { STUDENTID } = req.params;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        const query = `
            SELECT
                s.ed_student_id,
                s.ed_student_name,
                s.ed_student_code,
                s.ed_student_picture,
                s.ed_student_identityCard,
                c.ed_class_title,
                ci.ed_cicle_title
            FROM eduall_students s
            LEFT JOIN eduall_class c ON c.ed_class_id = s.ed_student_class AND c.ed_class_deleted = 0
            LEFT JOIN eduall_cicles ci ON ci.ed_cicle_id = c.ed_class_cicle AND ci.ed_cicle_deleted = 0
            WHERE s.ed_student_deleted = 0
              AND s.ed_student_id = ?
              AND s.ed_student_institute_code = ?
            LIMIT 1
        `;
        const rows = await ExecuteQuery(res, query, [STUDENTID, instituteCode], true, {
            db: "eduall_students", type: "select", data: req
        });

        if (!rows.length) {
            return res.status(404).json({ success: false, msg: "Aluno não encontrado." });
        }
        return res.status(200).json({ success: true, data: rows[0] });
    } catch (error) {
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * SearchResponsavel — pesquisa por BI do encarregado.
 * Para pesquisa de alunos usa-se SearchStudent + GetStudentForPortaria.
 */
const SearchResponsavel = async (req, res) => {
    try {
        const { search, type } = req.query;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        if (!search || search.trim() === "") {
            return res.status(400).json({ success: false, msg: "Parâmetro de pesquisa inválido." });
        }

        const term = search.trim().toLowerCase();
        let rows = [];

        if (type === "parent_id") {
            // Pesquisa pelo número de BI do encarregado
            const query = `
                SELECT
                    p.ed_parent_id,
                    p.ed_parent_name,
                    p.ed_parent_phone,
                    p.ed_parent_picture,
                    p.ed_parent_degree_of_kinship,
                    p.ed_parent_gender,
                    p.ed_parent_email,
                    p.ed_parent_address,
                    p.ed_parent_job,
                    pk.ed_parentkid_student AS ed_student_id,
                    s.ed_student_name,
                    s.ed_student_code,
                    s.ed_student_picture AS student_picture
                FROM eduall_parents p
                INNER JOIN eduall_parents_kids pk ON pk.ed_parentkid_parent = p.ed_parent_id
                INNER JOIN eduall_students s ON s.ed_student_id = pk.ed_parentkid_student
                WHERE p.ed_parent_deleted = 0
                  AND pk.ed_parentkid_deleted = 0
                  AND s.ed_student_deleted = 0
                  AND p.ed_parent_institute_code = ?
                  AND LOWER(p.ed_parent_identityCard) = ?
                ORDER BY p.ed_parent_name ASC
            `;
            rows = await ExecuteQuery(res, query, [instituteCode, term], true, {
                db: "eduall_parents", type: "select", data: req
            });

        } else {
            // Pesquisa automática pelo BI do encarregado ou nome
            const query = `
                SELECT
                    p.ed_parent_id,
                    p.ed_parent_name,
                    p.ed_parent_phone,
                    p.ed_parent_picture,
                    p.ed_parent_degree_of_kinship,
                    p.ed_parent_gender,
                    p.ed_parent_email,
                    p.ed_parent_address,
                    p.ed_parent_job,
                    pk.ed_parentkid_student AS ed_student_id,
                    s.ed_student_name,
                    s.ed_student_code,
                    s.ed_student_picture AS student_picture
                FROM eduall_parents p
                INNER JOIN eduall_parents_kids pk ON pk.ed_parentkid_parent = p.ed_parent_id
                INNER JOIN eduall_students s ON s.ed_student_id = pk.ed_parentkid_student
                WHERE p.ed_parent_deleted = 0
                  AND pk.ed_parentkid_deleted = 0
                  AND s.ed_student_deleted = 0
                  AND p.ed_parent_institute_code = ?
                  AND (
                    LOWER(p.ed_parent_identityCard) = ?
                    OR LOWER(p.ed_parent_name) LIKE ?
                  )
                ORDER BY p.ed_parent_name ASC
            `;
            const like = `%${term}%`;
            rows = await ExecuteQuery(res, query, [instituteCode, term, like], true, {
                db: "eduall_parents", type: "select", data: req
            });
        }

        return res.status(200).json({ success: true, data: rows, found: rows.length > 0 });

    } catch (error) {
        console.error("Erro em SearchResponsavel:", error.message);
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * ============================================================
 * BUSCAR OUTROS ENCARREGADOS DE UM ALUNO ESPECÍFICO
 * ============================================================
 */
const GetAllResponsaveisByStudent = async (req, res) => {
    try {
        const _ck = `parents:${req.session.user.eduall_user_session_curentinstitute}:byStudent:${req.params.STUDENTID}`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json({ success: true, data: _hit });
        const { STUDENTID } = req.params;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        const query = `
            SELECT 
                p.ed_parent_id,
                p.ed_parent_name,
                p.ed_parent_phone,
                p.ed_parent_picture,
                p.ed_parent_degree_of_kinship,
                p.ed_parent_gender,
                p.ed_parent_email
            FROM eduall_parents p
            INNER JOIN eduall_parents_kids pk ON pk.ed_parentkid_parent = p.ed_parent_id
            WHERE p.ed_parent_deleted = 0
              AND pk.ed_parentkid_deleted = 0
              AND pk.ed_parentkid_student = ?
              AND p.ed_parent_institute_code = ?
            ORDER BY p.ed_parent_name ASC
        `;
        const rows = await ExecuteQuery(res, query, [STUDENTID, instituteCode], true, {
            db: "eduall_parents", type: "select", data: req
        });

        await _cacheSet(_ck, rows, 120);
        return res.status(200).json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * ============================================================
 * BUSCAR HISTÓRICO DE FREQUÊNCIA DE UM ALUNO NA PORTARIA
 *
 * FIX: Removed LEFT JOIN on eduall_users — that table lives in a
 * different DB schema and causes a cross-schema error at runtime.
 * registered_by_name is now stored directly in the frequencia row
 * at insert time (see RegistrarFrequencia below).
 * ============================================================
 */
const GetFrequenciaHistorico = async (req, res) => {
    try {
        const { STUDENTID } = req.params;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        // ── Ensure column exists before we SELECT it ─────────────────────────
        // MySQL 8+: IF NOT EXISTS silently skips if already present.
        // MySQL < 8: the ALTER will throw "Duplicate column" — we swallow it.
        if (!_portariaColReady) {
        await ExecuteQuery(res,
            `ALTER TABLE eduall_portaria_frequencia
             ADD COLUMN IF NOT EXISTS ed_portaria_freq_registered_by_name VARCHAR(120) DEFAULT NULL`,
            [], false
        ).catch(() => {});
        _portariaColReady = true;
        }

        const query = `
            SELECT 
                pf.ed_portaria_freq_id,
                pf.ed_portaria_freq_type,
                pf.ed_portaria_freq_date,
                pf.ed_portaria_freq_responsavel_name,
                pf.ed_portaria_freq_responsavel_note,
                pf.ed_portaria_freq_sms_sent,
                pf.ed_portaria_freq_registered_by,
                COALESCE(pf.ed_portaria_freq_registered_by_name, CONCAT('User #', pf.ed_portaria_freq_registered_by)) AS registered_by_name,
                s.ed_student_name,
                s.ed_student_code,
                p.ed_parent_name,
                p.ed_parent_degree_of_kinship
            FROM eduall_portaria_frequencia pf
            LEFT JOIN eduall_students s ON s.ed_student_id = pf.ed_portaria_freq_student
            LEFT JOIN eduall_parents p ON p.ed_parent_id = pf.ed_portaria_freq_parent
            WHERE pf.ed_portaria_freq_institute_code = ?
              AND pf.ed_portaria_freq_student = ?
            ORDER BY pf.ed_portaria_freq_date DESC
            LIMIT 100
        `;
        const rows = await ExecuteQuery(res, query, [instituteCode, STUDENTID], true, {
            db: "eduall_portaria_frequencia", type: "select", data: req
        });

        return res.status(200).json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * ============================================================
 * REGISTRAR ENTRADA OU SAÍDA DO ALUNO
 * Opcionalmente envia SMS aos encarregados.
 *
 * FIX: Now also stores the user's display name in
 * ed_portaria_freq_registered_by_name so GetFrequenciaHistorico
 * never needs to JOIN eduall_users (which is in a different schema).
 * ============================================================
 */
const RegistrarFrequencia = async (req, res) => {
    try {
        const {
            student_id,
            parent_id,             // pode ser null se pessoa não registada
            freq_type,             // 0 = chegada, 1 = saída
            send_sms,              // boolean
            responsavel_name,      // nome livre (se não registado)
            responsavel_note,      // observação adicional
            sms_not_authorized     // boolean — enviar aviso de não autorizado
        } = req.body;

        const instituteCode = req.session.user.eduall_user_session_curentinstitute;
        const userId        = req.session.user.eduall_user_id;
        // Store the name at write-time so reads never need to cross schemas
        const userName      = req.session.user.eduall_user_name || String(userId);
        const now           = new Date();

        if (!student_id) {
            return res.status(400).json({ success: false, msg: "ID do aluno é obrigatório." });
        }

        // ── Garantir coluna ed_portaria_freq_registered_by_name existe ──
        // Safe no-op if column already exists (MySQL 8+)
        if (!_portariaColReady) {
        await ExecuteQuery(res,
            `ALTER TABLE eduall_portaria_frequencia
             ADD COLUMN IF NOT EXISTS ed_portaria_freq_registered_by_name VARCHAR(120) DEFAULT NULL`,
            [], false
        ).catch(() => {
            // MySQL < 8 doesn't support IF NOT EXISTS — fall back to column check
        });

        // Fallback for MySQL < 8
        const colCheck = await ExecuteQuery(res,
            `SELECT COUNT(*) AS cnt
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'eduall_portaria_frequencia'
                AND COLUMN_NAME  = 'ed_portaria_freq_registered_by_name'`,
            [], true
        ).catch(() => [{ cnt: 1 }]);

        if ((colCheck[0]?.cnt ?? 0) === 0) {
            await ExecuteQuery(res,
                `ALTER TABLE eduall_portaria_frequencia
                 ADD COLUMN ed_portaria_freq_registered_by_name VARCHAR(120) DEFAULT NULL`,
                [], false
            ).catch(() => {});
        }
        _portariaColReady = true;
        }

        // ── Inserir registo de frequência ────────────────────────────────
        const insertQuery = `
            INSERT INTO eduall_portaria_frequencia (
                ed_portaria_freq_student,
                ed_portaria_freq_parent,
                ed_portaria_freq_type,
                ed_portaria_freq_date,
                ed_portaria_freq_responsavel_name,
                ed_portaria_freq_responsavel_note,
                ed_portaria_freq_sms_sent,
                ed_portaria_freq_registered_by,
                ed_portaria_freq_registered_by_name,
                ed_portaria_freq_institute_code
            ) VALUES (?, ?, ?, NOW(), ?, ?, 0, ?, ?, ?)
        `;
        const insertResult = await ExecuteQuery(res, insertQuery, [
            student_id,
            parent_id || null,
            freq_type ?? 1,
            responsavel_name || null,
            responsavel_note || null,
            userId,
            userName,
            instituteCode
        ], false, { db: "eduall_portaria_frequencia", type: "insert", data: req });

        const freqId = insertResult.insertId;

        // ── Enviar SMS se solicitado ──────────────────────────────────────
        let smsSentCount = 0;
        let smsError = null;

        if (send_sms) {
            try {
                // Buscar créditos SMS
                const creditRows = await ExecuteQuery(res,
                    `SELECT ed_sms_credit_total FROM eduall_sms_credits WHERE ed_sms_credit_institute_code = ?`,
                    [instituteCode], true, { db: "eduall_sms_credits", type: "select", data: req }
                );

                const credits = creditRows.length > 0 ? creditRows[0].ed_sms_credit_total * 1 : 0;

                if (credits > 0) {
                    // Buscar todos os encarregados do aluno para enviar SMS
                    const parentsQuery = `
                        SELECT p.ed_parent_name, p.ed_parent_phone, s.ed_student_name
                        FROM eduall_parents p
                        INNER JOIN eduall_parents_kids pk ON pk.ed_parentkid_parent = p.ed_parent_id
                        INNER JOIN eduall_students s ON s.ed_student_id = pk.ed_parentkid_student
                        WHERE pk.ed_parentkid_deleted = 0
                          AND p.ed_parent_deleted = 0
                          AND pk.ed_parentkid_student = ?
                          AND p.ed_parent_institute_code = ?
                        LIMIT 5
                    `;
                    const parents = await ExecuteQuery(res, parentsQuery, [student_id, instituteCode], true, {
                        db: "eduall_parents", type: "select", data: req
                    });

                    const dateStr    = now.toLocaleDateString("pt-PT");
                    const timeStr    = now.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
                    const actionLabel = freq_type * 1 === 0 ? "entregou na escola" : "retirou da escola";
                    const person     = responsavel_name || "Pessoa não identificada";

                    for (const parent of parents) {
                        const phone = (parent.ed_parent_phone || "").replace(/\s+/g, "");
                        if (!/^9\d{8}$/.test(phone)) continue;

                        let message;
                        if (sms_not_authorized) {
                            message = `ALERTA: ${person} tentou retirar o seu educando ${parent.ed_student_name} em ${dateStr} as ${timeStr}. Esta pessoa nao consta como responsavel. Contacte a instituicao.`;
                        } else {
                            message = `Informamos que ${person} ${actionLabel} o seu educando ${parent.ed_student_name} em ${dateStr} as ${timeStr}.`;
                        }

                        try {
                            const { status } = await axios.post("https://www.telcosms.co.ao/send_message", {
                                message: {
                                    api_key_app: "prdd0cf231ad82fcfa9c4c8654742",
                                    phone_number: phone,
                                    message_body: message
                                }
                            }, { headers: { "Content-Type": "application/json" } });

                            if (status === 200 || status === 201) {
                                smsSentCount++;
                                // Inserir registo SMS
                                await ExecuteQuery(res,
                                    `INSERT INTO eduall_sms_records(ed_sms_record_message, ed_sms_sent_to, ed_sms_record_sent_usertype, ed_sms_sent_contactid, ed_sms_record_status, ed_sms_record_instituteCode)
                                     VALUES (?, ?, 2, ?, 0, ?)`,
                                    [message, phone, parent.ed_parent_id || 0, instituteCode], false,
                                    { db: "eduall_sms_records", type: "insert", data: req }
                                );
                                // Deduzir créditos
                                const parts = Math.ceil(message.length / 160);
                                await ExecuteQuery(res,
                                    `UPDATE eduall_sms_credits SET ed_sms_credit_total = ed_sms_credit_total - ?
                                     WHERE ed_sms_credit_institute_code = ? AND ed_sms_credit_total >= ?`,
                                    [parts, instituteCode, parts], false,
                                    { db: "eduall_sms_credits", type: "update", data: req }
                                );
                            }
                        } catch (smsErr) {
                            console.warn("Falha ao enviar SMS para:", phone, smsErr.message);
                        }
                    }

                    // Atualizar flag sms_sent no registo
                    if (smsSentCount > 0) {
                        await ExecuteQuery(res,
                            `UPDATE eduall_portaria_frequencia SET ed_portaria_freq_sms_sent = 1 WHERE ed_portaria_freq_id = ?`,
                            [freqId], false, { db: "eduall_portaria_frequencia", type: "update", data: req }
                        );
                    }
                } else {
                    smsError = "Créditos SMS insuficientes. Registo efectuado sem envio de SMS.";
                }
            } catch (smsErr) {
                smsError = "Erro ao processar SMS: " + smsErr.message;
            }
        }

        return res.status(201).json({
            success: true,
            msg: "Frequência registada com sucesso!",
            freq_id: freqId,
            sms_sent: smsSentCount,
            sms_error: smsError
        });

    } catch (error) {
        console.error("Erro em RegistrarFrequencia:", error.message);
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * ============================================================
 * REGISTRAR RESPONSÁVEL NÃO CADASTRADO (acesso autorizado por telefone)
 * ============================================================
 */
const RegistrarResponsavelTemporario = async (req, res) => {
    try {
        const {
            responsavel_name,
            student_ids,    // array de IDs dos alunos
            freq_type,
            note
        } = req.body;

        const instituteCode = req.session.user.eduall_user_session_curentinstitute;
        const userId        = req.session.user.eduall_user_id;
        const userName      = req.session.user.eduall_user_name || String(userId);

        if (!responsavel_name || !student_ids || student_ids.length === 0) {
            return res.status(400).json({ success: false, msg: "Nome do responsável e alunos são obrigatórios." });
        }

        const results = [];
        for (const sid of student_ids) {
            const r = await ExecuteQuery(res,
                `INSERT INTO eduall_portaria_frequencia (
                    ed_portaria_freq_student, ed_portaria_freq_parent, ed_portaria_freq_type,
                    ed_portaria_freq_date, ed_portaria_freq_responsavel_name,
                    ed_portaria_freq_responsavel_note, ed_portaria_freq_sms_sent,
                    ed_portaria_freq_registered_by, ed_portaria_freq_registered_by_name,
                    ed_portaria_freq_institute_code
                ) VALUES (?, NULL, ?, NOW(), ?, ?, 0, ?, ?, ?)`,
                [sid, freq_type ?? 1, responsavel_name, note || null, userId, userName, instituteCode],
                false, { db: "eduall_portaria_frequencia", type: "insert", data: req }
            );
            results.push(r.insertId);
        }

        return res.status(201).json({
            success: true,
            msg: "Registo de acesso temporário efectuado.",
            ids: results
        });
    } catch (error) {
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * ============================================================
 * LISTAR TODOS OS REGISTOS DE PORTARIA DO DIA (ou intervalo)
 *
 * FIX: Removed LEFT JOIN on eduall_users for the same cross-schema
 * reason. Uses the stored ed_portaria_freq_registered_by_name column.
 * ============================================================
 */
const GetFrequenciaGeral = async (req, res) => {
    try {
        const { date_from, date_to } = req.query;
        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        const from = date_from || new Date().toISOString().slice(0, 10);
        const to   = date_to   || new Date().toISOString().slice(0, 10);

        const query = `
            SELECT 
                pf.ed_portaria_freq_id,
                pf.ed_portaria_freq_type,
                pf.ed_portaria_freq_date,
                pf.ed_portaria_freq_responsavel_name,
                pf.ed_portaria_freq_responsavel_note,
                pf.ed_portaria_freq_sms_sent,
                pf.ed_portaria_freq_registered_by_name AS registered_by_name,
                s.ed_student_name,
                s.ed_student_code,
                s.ed_student_picture,
                p.ed_parent_name,
                p.ed_parent_degree_of_kinship,
                p.ed_parent_phone
            FROM eduall_portaria_frequencia pf
            LEFT JOIN eduall_students s ON s.ed_student_id = pf.ed_portaria_freq_student
            LEFT JOIN eduall_parents p ON p.ed_parent_id = pf.ed_portaria_freq_parent
            WHERE pf.ed_portaria_freq_institute_code = ?
              AND DATE(pf.ed_portaria_freq_date) BETWEEN ? AND ?
            ORDER BY pf.ed_portaria_freq_date DESC
        `;
        const rows = await ExecuteQuery(res, query, [instituteCode, from, to], true, {
            db: "eduall_portaria_frequencia", type: "select", data: req
        });

        return res.status(200).json({ success: true, data: rows });
    } catch (error) {
        return res.status(500).json({ success: false, msg: error.message });
    }
};

/**
 * ============================================================
 * REGISTRAR RESPONSÁVEL DIRECTAMENTE NA PORTARIA
 * Endpoint próprio — não depende do eduallparentregisterapi.
 * Cria o encarregado + associação ao aluno numa só chamada.
 * Aceita multipart/form-data para upload de foto.
 *
 * Body fields:
 *   parent_name        (required)
 *   parent_identityCard (required)
 *   parent_phone        (optional)
 *   parent_degree_of_kinship (optional, default 0)
 *   parent_email        (optional)
 *   parent_gender       (optional, default 0)
 *   student_id          (required) — aluno a associar
 *   parent_picture      (optional, file upload via multer)
 *
 * O(1) — 2 INSERT queries
 * ============================================================
 */
const RegisterResponsavelPortaria = async (req, res) => {
    try {
        const {
            parent_name,
            parent_identityCard,
            parent_phone,
            parent_degree_of_kinship,
            parent_email,
            parent_gender,
            student_id,
        } = req.body;

        const instituteCode = req.session.user.eduall_user_session_curentinstitute;

        if (!parent_name || !parent_name.trim()) {
            return res.status(400).json({ success: false, msg: "Nome do responsável é obrigatório." });
        }
        if (!parent_identityCard || !parent_identityCard.trim()) {
            return res.status(400).json({ success: false, msg: "Documento de identificação é obrigatório." });
        }
        if (!student_id) {
            return res.status(400).json({ success: false, msg: "ID do aluno é obrigatório." });
        }

        // ── Garantir que colunas existem (safe — IF NOT EXISTS) ─
        if (!_parentIdCardColReady) {
        await ExecuteQuery(res,
            `ALTER TABLE eduall_parents
             ADD COLUMN IF NOT EXISTS ed_parent_identityCard VARCHAR(50) DEFAULT NULL`,
            [], false
        ).catch(() => {});

        // Fallback para MySQL < 8 que não suporta IF NOT EXISTS em ALTER
        const colCheck = await ExecuteQuery(res,
            `SELECT COUNT(*) AS cnt
               FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'eduall_parents'
                AND COLUMN_NAME  = 'ed_parent_identityCard'`,
            [], true
        ).catch(() => [{ cnt: 1 }]);

        if ((colCheck[0]?.cnt ?? 0) === 0) {
            await ExecuteQuery(res,
                `ALTER TABLE eduall_parents
                 ADD COLUMN ed_parent_identityCard VARCHAR(50) DEFAULT NULL`,
                [], false
            );
        }
        _parentIdCardColReady = true;
        }

        // ── INSERT encarregado ──────────────────────────────────
        const insertParentQuery = `
            INSERT INTO eduall_parents (
                ed_parent_name,
                ed_parent_identityCard,
                ed_parent_phone,
                ed_parent_degree_of_kinship,
                ed_parent_email,
                ed_parent_gender,
                ed_parent_picture,
                ed_parent_students_code,
                ed_parent_phone2,
                ed_parent_job,
                ed_parent_address,
                ed_parent_nacionality,
                ed_parent_institute_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', ?)
        `;
        const picturePath = req.file ? `images/parents/${req.file.filename}` : '';

        const parentResult = await ExecuteQuery(res, insertParentQuery, [
            parent_name.trim(),
            parent_identityCard.trim(),
            parent_phone  ?? '',
            parent_degree_of_kinship ?? 0,
            parent_email  ?? '',
            parent_gender ?? 0,
            picturePath,
            String(student_id),
            instituteCode,
        ], false, { db: "eduall_parents", type: "insert", data: req });

        const parentId = parentResult.insertId;
        if (!parentId) {
            return res.status(500).json({ success: false, msg: "Erro ao criar o encarregado." });
        }

        // ── Verificar se associação já existe ──────────────────
        const checkRows = await ExecuteQuery(res,
            `SELECT ed_parentkid_id FROM eduall_parents_kids
             WHERE ed_parentkid_deleted = 0
               AND ed_parentkid_parent  = ?
               AND ed_parentkid_student = ?
               AND ed_parentkid_institute_code = ?`,
            [parentId, student_id, instituteCode], true,
            { db: "eduall_parents_kids", type: "select", data: req }
        );

        if (!checkRows.length) {
            // ── INSERT associação encarregado ↔ aluno ──────────
            await ExecuteQuery(res,
                `INSERT INTO eduall_parents_kids
                    (ed_parentkid_parent, ed_parentkid_student, ed_parentkid_institute_code)
                 VALUES (?, ?, ?)`,
                [parentId, student_id, instituteCode], false,
                { db: "eduall_parents_kids", type: "insert", data: req }
            );
        }

        await _cacheClear(`parents:${req.session.user.eduall_user_session_curentinstitute}:*`);
        return res.status(201).json({
            success: true,
            msg: `Responsável "${parent_name.trim()}" registado e associado ao aluno.`,
            parent_id: parentId,
        });

    } catch (error) {
        console.error("Erro em RegisterResponsavelPortaria:", error.message);
        return res.status(500).json({ success: false, msg: error.message });
    }
};

// ── Multer config exclusivo da portaria ──────────────────────────────────────
const multer = require("multer");
const path   = require("path");

const _portariaStorage = multer.diskStorage({
    destination: "images/parents",
    filename: (req, file, cb) => {
        const uid = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
        cb(null, `eduall_portaria_resp_${uid}${path.extname(file.originalname)}`);
    },
});

const uploadResponsavelPortaria = multer({
    storage: _portariaStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp/;
        cb(null, allowed.test(path.extname(file.originalname).toLowerCase()));
    },
}).single("parent_picture");

module.exports = {
    SearchResponsavel,
    SearchStudent,
    GetStudentForPortaria,
    GetAllResponsaveisByStudent,
    GetFrequenciaHistorico,
    RegistrarFrequencia,
    RegistrarResponsavelTemporario,
    GetFrequenciaGeral,
    RegisterResponsavelPortaria,
    uploadResponsavelPortaria,
};