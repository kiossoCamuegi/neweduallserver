'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
//  Controller — Movimentação RFID
//  Regista entradas/saídas detectadas por antenas RFID, confirma devoluções
//  automáticas, audita percursos de exemplares e gere anomalias.
//
//  Tabela de utilizadores correcta: eduall_user_accounts
//    nome  → ed_user_account_name
//    id    → ed_user_account_id
// ═══════════════════════════════════════════════════════════════════════════════

const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery             = require("../Functions/ExecuteQuery");

/* ─────────────────────────────────────────
   HELPER — institute code from session
───────────────────────────────────────── */
const inst = req => req.session.user.eduall_user_session_curentinstitute;
const uid  = req => req.session.user.eduall_user_id;

/* ─────────────────────────────────────────
   FRAGMENTO SQL reutilizável — JOIN users
   Usa a tabela correcta: eduall_user_accounts
───────────────────────────────────────── */
const USER_JOIN = `
  LEFT JOIN eduall_user_accounts u
         ON u.ed_user_account_id = rm.ed_rfid_movement_user_id`;

const USER_NAME_COL = `u.ed_user_account_name AS ed_rfid_movement_user_name`;

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Todos os eventos RFID (com filtros opcionais)
//  Query params: antenna_id, event_type, exemplar_code, date_from, date_to,
//                limit (default 100), offset (default 0)
// ─────────────────────────────────────────────────────────────────────────────
const GetRFIDMovements = async (req, res) => {
  try {
    const institute = inst(req);
    const {
      antenna_id,
      event_type,
      exemplar_code,
      date_from,
      date_to,
      limit  = 100,
      offset = 0,
    } = req.query;

    let where    = `WHERE rm.ed_rfid_movement_deleted = 0
                      AND rm.ed_rfid_movement_institute_code = ?`;
    const PARAMS = [institute];

    if (antenna_id)    { where += " AND rm.ed_rfid_movement_antenna_id = ?";                          PARAMS.push(antenna_id); }
    if (event_type)    { where += " AND rm.ed_rfid_movement_event_type = ?";                          PARAMS.push(event_type); }
    if (exemplar_code) { where += " AND (ex.ed_exemplar_code LIKE ? OR ex.ed_exemplar_rfid LIKE ?)"; PARAMS.push(`%${exemplar_code}%`, `%${exemplar_code}%`); }
    if (date_from)     { where += " AND rm.ed_rfid_movement_detected_at >= ?";                        PARAMS.push(date_from); }
    if (date_to)       { where += " AND rm.ed_rfid_movement_detected_at <= ?";                        PARAMS.push(`${date_to} 23:59:59`); }

    PARAMS.push(Number(limit), Number(offset));

    const query = `
      SELECT
        rm.*,
        ex.ed_exemplar_code,
        ex.ed_exemplar_barcode,
        ex.ed_exemplar_status,
        ex.ed_exemplar_condition,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        ant.ed_rfid_antenna_name,
        ant.ed_rfid_antenna_zone,
        ant.ed_rfid_antenna_floor,
        ${USER_NAME_COL}
      FROM eduall_library_rfid_movements rm
      LEFT JOIN eduall_library_exemplares ex  ON ex.ed_exemplar_id       = rm.ed_rfid_movement_exemplar_id
      LEFT JOIN eduall_library_books b        ON b.ed_library_book_id    = ex.ed_exemplar_book_id
      LEFT JOIN eduall_library_rfid_antennas ant ON ant.ed_rfid_antenna_id = rm.ed_rfid_movement_antenna_id
      ${USER_JOIN}
      ${where}
      ORDER BY rm.ed_rfid_movement_detected_at DESC
      LIMIT ? OFFSET ?`;

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_rfid_movements", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar movimentos RFID!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — KPIs de movimentos do dia
// ─────────────────────────────────────────────────────────────────────────────
const GetRFIDMovementsKpis = async (req, res) => {
  try {
    const institute  = inst(req);
    const targetDate = req.query.date || new Date().toISOString().slice(0, 10);

    const query = `
      SELECT
        COUNT(*)                                                                   AS total_today,
        SUM(CASE WHEN ed_rfid_movement_event_type = 'saida'     THEN 1 ELSE 0 END) AS total_saidas,
        SUM(CASE WHEN ed_rfid_movement_event_type = 'entrada'   THEN 1 ELSE 0 END) AS total_entradas,
        SUM(CASE WHEN ed_rfid_movement_event_type = 'recolhido' THEN 1 ELSE 0 END) AS total_recolhidos,
        SUM(CASE WHEN ed_rfid_movement_event_type = 'anomalia'  THEN 1 ELSE 0 END) AS total_anomalias,
        SUM(CASE WHEN ed_rfid_movement_auto_return = 1          THEN 1 ELSE 0 END) AS total_auto_returns,
        COUNT(DISTINCT ed_rfid_movement_exemplar_id)                               AS exemplares_distintos
      FROM eduall_library_rfid_movements
      WHERE ed_rfid_movement_deleted = 0
        AND ed_rfid_movement_institute_code = ?
        AND DATE(ed_rfid_movement_detected_at) = ?`;

    const rows = await ExecuteQuery(res, query, [institute, targetDate], true, {
      db: "eduall_library_rfid_movements", type: "select", data: req,
    });
    res.status(200).json(rows[0] ?? {});
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar KPIs RFID!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Histórico de movimentos de um exemplar
// ─────────────────────────────────────────────────────────────────────────────
const GetMovementsByExemplar = async (req, res) => {
  try {
    const { EXEMPLAR_ID } = req.params;
    const institute       = inst(req);

    const query = `
      SELECT
        rm.*,
        ant.ed_rfid_antenna_name,
        ant.ed_rfid_antenna_zone,
        ant.ed_rfid_antenna_floor,
        ${USER_NAME_COL}
      FROM eduall_library_rfid_movements rm
      LEFT JOIN eduall_library_rfid_antennas ant ON ant.ed_rfid_antenna_id = rm.ed_rfid_movement_antenna_id
      ${USER_JOIN}
      WHERE rm.ed_rfid_movement_deleted = 0
        AND rm.ed_rfid_movement_exemplar_id = ?
        AND rm.ed_rfid_movement_institute_code = ?
      ORDER BY rm.ed_rfid_movement_detected_at DESC`;

    const rows = await ExecuteQuery(res, query, [EXEMPLAR_ID, institute], true, {
      db: "eduall_library_rfid_movements", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar histórico do exemplar!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Todas as antenas RFID
// ─────────────────────────────────────────────────────────────────────────────
const GetAntennas = async (req, res) => {
  try {
    const rows = await ExecuteQuery(res,
      `SELECT * FROM eduall_library_rfid_antennas
       WHERE ed_rfid_antenna_deleted = 0
         AND ed_rfid_antenna_institute_code = ?
       ORDER BY ed_rfid_antenna_name ASC`,
      [inst(req)], true,
      { db: "eduall_library_rfid_antennas", type: "select", data: req });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar antenas!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Anomalias activas
// ─────────────────────────────────────────────────────────────────────────────
const GetActiveAnomalies = async (req, res) => {
  try {
    const query = `
      SELECT
        rm.*,
        ex.ed_exemplar_code,
        ex.ed_exemplar_status,
        b.ed_library_book_title,
        b.ed_library_book_picture,
        ant.ed_rfid_antenna_name,
        ant.ed_rfid_antenna_zone
      FROM eduall_library_rfid_movements rm
      LEFT JOIN eduall_library_exemplares ex     ON ex.ed_exemplar_id       = rm.ed_rfid_movement_exemplar_id
      LEFT JOIN eduall_library_books b           ON b.ed_library_book_id    = ex.ed_exemplar_book_id
      LEFT JOIN eduall_library_rfid_antennas ant ON ant.ed_rfid_antenna_id  = rm.ed_rfid_movement_antenna_id
      WHERE rm.ed_rfid_movement_deleted = 0
        AND rm.ed_rfid_movement_institute_code = ?
        AND rm.ed_rfid_movement_event_type = 'anomalia'
        AND rm.ed_rfid_movement_resolved = 0
      ORDER BY rm.ed_rfid_movement_detected_at DESC`;

    const rows = await ExecuteQuery(res, query, [inst(req)], true, {
      db: "eduall_library_rfid_movements", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar anomalias!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Registar evento RFID (manual ou via antena)
//  Body: rfid_code | exemplar_id, antenna_id, event_type, notes, auto_return
// ─────────────────────────────────────────────────────────────────────────────
const RegisterRFIDEvent = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);
    const {
      rfid_code,
      exemplar_id,
      antenna_id,
      event_type,
      notes,
      auto_return = false,
    } = req.body;

    if (!event_type) {
      return res.status(400).json({ success: false, message: "Tipo de evento é obrigatório!" });
    }

    // ── Resolver exemplar pelo RFID code se não vier exemplar_id ─────────
    let resolvedId   = exemplar_id;

    if (!resolvedId && rfid_code) {
      const found = await ExecuteQuery(res,
        `SELECT ed_exemplar_id FROM eduall_library_exemplares
          WHERE ed_exemplar_rfid = ?
            AND ed_exemplar_deleted = 0
            AND ed_exemplar_institute_code = ?
          LIMIT 1`,
        [rfid_code.trim(), institute], true,
        { db: "eduall_library_exemplares", type: "select", data: req });

      if (!found.length) {
        return res.status(404).json({ success: false, message: "Exemplar não encontrado para este código RFID!" });
      }
      resolvedId = found[0].ed_exemplar_id;
    }

    if (!resolvedId) {
      return res.status(400).json({ success: false, message: "Exemplar ou código RFID é obrigatório!" });
    }

    // ── Detectar anomalia: saída sem empréstimo activo ────────────────────
    let isAnomaly = event_type === "anomalia";
    let finalType = event_type;
    let autoReturned = false;

    if (event_type === "saida") {
      const active = await ExecuteQuery(res,
        `SELECT ed_loan_id FROM eduall_library_loans
          WHERE ed_loan_exemplar_id = ?
            AND ed_loan_status = 'em_curso'
            AND ed_loan_deleted = 0
          LIMIT 1`,
        [resolvedId], true,
        { db: "eduall_library_loans", type: "select", data: req });

      if (!active.length) { isAnomaly = true; finalType = "anomalia"; }
    }

    // ── Devolução automática via RFID ─────────────────────────────────────
    if (event_type === "entrada" && auto_return) {
      const active = await ExecuteQuery(res,
        `SELECT ed_loan_id FROM eduall_library_loans
          WHERE ed_loan_exemplar_id = ?
            AND ed_loan_status IN ('em_curso','atrasado')
            AND ed_loan_deleted = 0
          LIMIT 1`,
        [resolvedId], true,
        { db: "eduall_library_loans", type: "select", data: req });

      if (active.length) {
        // Fechar empréstimo + atualizar exemplar em paralelo
        await Promise.all([
          ExecuteQuery(res,
            `UPDATE eduall_library_loans
                SET ed_loan_status = 'devolvido',
                    ed_loan_return_date = NOW(),
                    ed_loan_auto_returned = 1
              WHERE ed_loan_id = ?`,
            [active[0].ed_loan_id], false,
            { db: "eduall_library_loans", type: "update", data: req }),

          ExecuteQuery(res,
            `UPDATE eduall_library_exemplares
                SET ed_exemplar_status = 'disponivel'
              WHERE ed_exemplar_id = ?`,
            [resolvedId], false,
            { db: "eduall_library_exemplares", type: "update", data: req }),
        ]);
        autoReturned = true;
      }
    }

    // ── Actualizar estado do exemplar (saída / recolhido) ─────────────────
    if (!isAnomaly) {
      const statusMap = { saida: "emprestado", recolhido: "disponivel" };
      if (statusMap[event_type]) {
        await ExecuteQuery(res,
          `UPDATE eduall_library_exemplares SET ed_exemplar_status = ? WHERE ed_exemplar_id = ?`,
          [statusMap[event_type], resolvedId], false,
          { db: "eduall_library_exemplares", type: "update", data: req });
      }
    }

    // ── Inserir registo de movimento ──────────────────────────────────────
    const result = await ExecuteQuery(res,
      `INSERT INTO eduall_library_rfid_movements (
         ed_rfid_movement_exemplar_id, ed_rfid_movement_antenna_id,
         ed_rfid_movement_event_type,  ed_rfid_movement_user_id,
         ed_rfid_movement_auto_return, ed_rfid_movement_is_anomaly,
         ed_rfid_movement_resolved,    ed_rfid_movement_notes,
         ed_rfid_movement_detected_at, ed_rfid_movement_institute_code
       ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, NOW(), ?)`,
      [
        resolvedId,
        antenna_id   || null,
        finalType,
        userId       || null,
        autoReturned ? 1 : 0,
        isAnomaly    ? 1 : 0,
        notes        || null,
        institute,
      ], false,
      { db: "eduall_library_rfid_movements", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session, action: 1,
      form:        "Movimentação RFID",
      description: `Registou evento "${finalType}" para exemplar ID ${resolvedId}${autoReturned ? " (devolução automática)" : ""}${isAnomaly ? " ⚠ ANOMALIA" : ""}`,
    });

    res.status(200).json({
      ...result,
      event_type:    finalType,
      is_anomaly:    isAnomaly,
      auto_returned: autoReturned,
      exemplar_id:   resolvedId,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registar evento RFID!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Batch scan (múltiplos RFIDs de uma vez)
//  Body: { events: [{rfid_code, antenna_id?, event_type?}], antenna_id?, event_type? }
//
//  Performance: resolve todos os RFID codes numa única query IN(...)
//               e faz batch INSERT para todos os movimentos válidos
// ─────────────────────────────────────────────────────────────────────────────
const RegisterRFIDBatch = async (req, res) => {
  try {
    const institute = inst(req);
    const userId    = uid(req);
    const { events, antenna_id, event_type } = req.body;

    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, message: "Lista de eventos é obrigatória!" });
    }

    // ── 1. Resolver todos os RFID codes de uma vez (1 query IN) ──────────
    const codes = [...new Set(events.map(e => e.rfid_code?.trim()).filter(Boolean))];

    if (!codes.length) {
      return res.status(400).json({ success: false, message: "Nenhum código RFID válido na lista!" });
    }

    const ph      = codes.map(() => "?").join(", ");
    const found   = await ExecuteQuery(res,
      `SELECT ed_exemplar_id, ed_exemplar_code, ed_exemplar_rfid
         FROM eduall_library_exemplares
        WHERE ed_exemplar_rfid IN (${ph})
          AND ed_exemplar_deleted = 0
          AND ed_exemplar_institute_code = ?`,
      [...codes, institute], true,
      { db: "eduall_library_exemplares", type: "select", data: req });

    // Mapa rfid_code → exemplar
    const exemplarMap = new Map(found.map(r => [r.ed_exemplar_rfid, r]));

    // ── 2. Separar válidos e erros ────────────────────────────────────────
    const results    = [];
    const errors     = [];
    const insertRows = []; // para batch INSERT

    for (const ev of events) {
      const code = ev.rfid_code?.trim();
      if (!code) { errors.push({ rfid_code: code, error: "Código vazio" }); continue; }

      const exemplar = exemplarMap.get(code);
      if (!exemplar)  { errors.push({ rfid_code: code, error: "Exemplar não encontrado" }); continue; }

      const evType = ev.event_type || event_type || "recolhido";
      const antId  = ev.antenna_id || antenna_id || null;

      insertRows.push([exemplar.ed_exemplar_id, antId, evType, userId || null, 0, 0, institute]);
      results.push({ rfid_code: code, exemplar_code: exemplar.ed_exemplar_code, event_type: evType });
    }

    // ── 3. Batch INSERT ───────────────────────────────────────────────────
    if (insertRows.length) {
      const valuePH  = insertRows.map(() => "(?, ?, ?, ?, ?, ?, NOW(), ?)").join(", ");
      const flatVals = insertRows.flat();

      await ExecuteQuery(res,
        `INSERT INTO eduall_library_rfid_movements
           (ed_rfid_movement_exemplar_id, ed_rfid_movement_antenna_id,
            ed_rfid_movement_event_type,  ed_rfid_movement_user_id,
            ed_rfid_movement_auto_return, ed_rfid_movement_is_anomaly,
            ed_rfid_movement_detected_at, ed_rfid_movement_institute_code)
         VALUES ${valuePH}`,
        flatVals, false,
        { db: "eduall_library_rfid_movements", type: "insert", data: req });

      // ── 4. Actualizar exemplares "recolhido" em batch ──────────────────
      const recolhidoIds = results
        .filter(r => r.event_type === "recolhido")
        .map(r => exemplarMap.get(r.rfid_code)?.ed_exemplar_id)
        .filter(Boolean);

      if (recolhidoIds.length) {
        const rph = recolhidoIds.map(() => "?").join(", ");
        await ExecuteQuery(res,
          `UPDATE eduall_library_exemplares SET ed_exemplar_status = 'disponivel'
            WHERE ed_exemplar_id IN (${rph})`,
          recolhidoIds, false,
          { db: "eduall_library_exemplares", type: "update", data: req });
      }
    }

    await RegisterAuditAction({
      session: req.session, action: 1,
      form:        "Movimentação RFID",
      description: `Batch scan: ${results.length} eventos registados, ${errors.length} erros`,
    });

    res.status(200).json({
      success:      true,
      processed:    results.length,
      errors_count: errors.length,
      results,
      errors,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha no batch RFID!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Resolver anomalia
// ─────────────────────────────────────────────────────────────────────────────
const ResolveAnomaly = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    const rows = await ExecuteQuery(res,
      `UPDATE eduall_library_rfid_movements
          SET ed_rfid_movement_resolved            = 1,
              ed_rfid_movement_resolved_at         = NOW(),
              ed_rfid_movement_resolution_notes    = ?
        WHERE ed_rfid_movement_id                  = ?
          AND ed_rfid_movement_institute_code      = ?
          AND ed_rfid_movement_deleted             = 0`,
      [req.body.resolution_notes || null, ID, institute], false,
      { db: "eduall_library_rfid_movements", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: "Movimentação RFID",
      description: `Resolveu anomalia ID ${ID}`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao resolver anomalia!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Registar antena RFID
// ─────────────────────────────────────────────────────────────────────────────
const RegisterAntenna = async (req, res) => {
  try {
    const institute = inst(req);
    const { antenna_name, antenna_zone, antenna_floor, antenna_ip, antenna_mac, antenna_type, antenna_notes } = req.body;

    if (!antenna_name) {
      return res.status(400).json({ success: false, message: "Nome da antena é obrigatório!" });
    }

    const rows = await ExecuteQuery(res,
      `INSERT INTO eduall_library_rfid_antennas (
         ed_rfid_antenna_name,  ed_rfid_antenna_zone,   ed_rfid_antenna_floor,
         ed_rfid_antenna_ip,    ed_rfid_antenna_mac,    ed_rfid_antenna_type,
         ed_rfid_antenna_status,ed_rfid_antenna_notes,  ed_rfid_antenna_institute_code
       ) VALUES (?, ?, ?, ?, ?, ?, 'activa', ?, ?)`,
      [antenna_name, antenna_zone || null, antenna_floor || null, antenna_ip || null,
       antenna_mac || null, antenna_type || "gate", antenna_notes || null, institute],
      false, { db: "eduall_library_rfid_antennas", type: "insert", data: req });

    await RegisterAuditAction({
      session: req.session, action: 1,
      form: "Antena RFID",
      description: `Registou antena "${antenna_name}"`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registar antena!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Actualizar antena RFID
// ─────────────────────────────────────────────────────────────────────────────
const UpdateAntenna = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);
    const { antenna_name, antenna_zone, antenna_floor, antenna_ip, antenna_mac,
            antenna_type, antenna_status, antenna_notes } = req.body;

    const rows = await ExecuteQuery(res,
      `UPDATE eduall_library_rfid_antennas SET
         ed_rfid_antenna_name   = ?,
         ed_rfid_antenna_zone   = ?,
         ed_rfid_antenna_floor  = ?,
         ed_rfid_antenna_ip     = ?,
         ed_rfid_antenna_mac    = ?,
         ed_rfid_antenna_type   = ?,
         ed_rfid_antenna_status = ?,
         ed_rfid_antenna_notes  = ?
       WHERE ed_rfid_antenna_id             = ?
         AND ed_rfid_antenna_institute_code = ?
         AND ed_rfid_antenna_deleted        = 0`,
      [antenna_name, antenna_zone || null, antenna_floor || null, antenna_ip || null,
       antenna_mac || null, antenna_type || "gate", antenna_status || "activa",
       antenna_notes || null, ID, institute],
      false, { db: "eduall_library_rfid_antennas", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session, action: 2,
      form: "Antena RFID",
      description: `Actualizou antena ID ${ID}`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao actualizar antena!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Soft-delete antena
// ─────────────────────────────────────────────────────────────────────────────
const DeleteAntenna = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    const rows = await ExecuteQuery(res,
      `UPDATE eduall_library_rfid_antennas
          SET ed_rfid_antenna_deleted = 1
        WHERE ed_rfid_antenna_id             = ?
          AND ed_rfid_antenna_institute_code = ?`,
      [ID, institute], false,
      { db: "eduall_library_rfid_antennas", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session, action: 3,
      form: "Antena RFID",
      description: `Removeu antena ID ${ID}`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao remover antena!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Soft-delete de movimento
// ─────────────────────────────────────────────────────────────────────────────
const DeleteRFIDMovement = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = inst(req);

    const rows = await ExecuteQuery(res,
      `UPDATE eduall_library_rfid_movements
          SET ed_rfid_movement_deleted = 1
        WHERE ed_rfid_movement_id             = ?
          AND ed_rfid_movement_institute_code = ?`,
      [ID, institute], false,
      { db: "eduall_library_rfid_movements", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session, action: 3,
      form: "Movimentação RFID",
      description: `Removeu movimento RFID ID ${ID}`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao remover movimento!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  GetRFIDMovements,
  GetRFIDMovementsKpis,
  GetMovementsByExemplar,
  GetAntennas,
  GetActiveAnomalies,
  RegisterRFIDEvent,
  RegisterRFIDBatch,
  ResolveAnomaly,
  RegisterAntenna,
  UpdateAntenna,
  DeleteAntenna,
  DeleteRFIDMovement,
};

// ─────────────────────────────────────────────────────────────────────────────
//  ROUTES — adicionar ao ficheiro de rotas principal
// ─────────────────────────────────────────────────────────────────────────────
//
//  const {
//    GetRFIDMovements, GetRFIDMovementsKpis, GetMovementsByExemplar,
//    GetAntennas, GetActiveAnomalies, RegisterRFIDEvent, RegisterRFIDBatch,
//    ResolveAnomaly, RegisterAntenna, UpdateAntenna, DeleteAntenna,
//    DeleteRFIDMovement,
//  } = require("./LibRFIDMovementController"); 
//
//  // — Movimentos RFID —
//  router.get ('/edualllibraryRFIDmovements/get',               VerifyToken, GetRFIDMovements);
//  router.get ('/edualllibraryRFIDmovements/kpis',              VerifyToken, GetRFIDMovementsKpis);
//  router.get ('/edualllibraryRFIDmovements/exemplar/:EXEMPLAR_ID', VerifyToken, GetMovementsByExemplar);
//  router.get ('/edualllibraryRFIDmovements/anomalies',         VerifyToken, GetActiveAnomalies);
//  router.post('/edualllibraryRFIDmovements/register',          VerifyToken, RegisterRFIDEvent);
//  router.post('/edualllibraryRFIDmovements/batch',             VerifyToken, RegisterRFIDBatch);
//  router.put ('/edualllibraryRFIDmovements/resolve/:ID',       VerifyToken, ResolveAnomaly);
//  router.put ('/edualllibraryRFIDmovements/delete/:ID',        VerifyToken, DeleteRFIDMovement);
//
//  // — Antenas RFID —
//  router.get ('/edualllibraryRFIDantennas/get',                VerifyToken, GetAntennas);
//  router.post('/edualllibraryRFIDantennas/register',           VerifyToken, RegisterAntenna);
//  router.put ('/edualllibraryRFIDantennas/update/:ID',         VerifyToken, UpdateAntenna);
//  router.put ('/edualllibraryRFIDantennas/delete/:ID',         VerifyToken, DeleteAntenna);

// ─────────────────────────────────────────────────────────────────────────────
//  TABELA SQL — eduall_library_rfid_movements
// ─────────────────────────────────────────────────────────────────────────────
//
//  CREATE TABLE `eduall_library_rfid_movements` (
//    `ed_rfid_movement_id`               INT          NOT NULL AUTO_INCREMENT,
//    `ed_rfid_movement_exemplar_id`      INT          NOT NULL,
//    `ed_rfid_movement_antenna_id`       INT          DEFAULT NULL,
//    `ed_rfid_movement_event_type`       ENUM(
//                                          'entrada','saida','recolhido','anomalia'
//                                        ) NOT NULL DEFAULT 'entrada',
//    `ed_rfid_movement_user_id`          INT          DEFAULT NULL,
//    `ed_rfid_movement_auto_return`      TINYINT(1)   NOT NULL DEFAULT 0,
//    `ed_rfid_movement_is_anomaly`       TINYINT(1)   NOT NULL DEFAULT 0,
//    `ed_rfid_movement_resolved`         TINYINT(1)   NOT NULL DEFAULT 0,
//    `ed_rfid_movement_resolved_at`      DATETIME     DEFAULT NULL,
//    `ed_rfid_movement_resolution_notes` TEXT         DEFAULT NULL,
//    `ed_rfid_movement_notes`            TEXT         DEFAULT NULL,
//    `ed_rfid_movement_detected_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
//    `ed_rfid_movement_deleted`          TINYINT(1)   NOT NULL DEFAULT 0,
//    `ed_rfid_movement_institute_code`   VARCHAR(20)  NOT NULL,
//    PRIMARY KEY (`ed_rfid_movement_id`),
//    INDEX `idx_rfid_mov_exemplar`  (`ed_rfid_movement_exemplar_id`),
//    INDEX `idx_rfid_mov_antenna`   (`ed_rfid_movement_antenna_id`),
//    INDEX `idx_rfid_mov_detected`  (`ed_rfid_movement_detected_at`),
//    INDEX `idx_rfid_mov_institute` (`ed_rfid_movement_institute_code`),
//    INDEX `idx_rfid_mov_anomaly`   (`ed_rfid_movement_is_anomaly`, `ed_rfid_movement_resolved`)
//  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
//
// ─────────────────────────────────────────────────────────────────────────────
//  TABELA SQL — eduall_library_rfid_antennas
// ─────────────────────────────────────────────────────────────────────────────
//
//  CREATE TABLE `eduall_library_rfid_antennas` (
//    `ed_rfid_antenna_id`               INT         NOT NULL AUTO_INCREMENT,
//    `ed_rfid_antenna_name`             VARCHAR(100) NOT NULL,
//    `ed_rfid_antenna_zone`             VARCHAR(100) DEFAULT NULL,
//    `ed_rfid_antenna_floor`            VARCHAR(20)  DEFAULT NULL,
//    `ed_rfid_antenna_ip`               VARCHAR(45)  DEFAULT NULL,
//    `ed_rfid_antenna_mac`              VARCHAR(17)  DEFAULT NULL,
//    `ed_rfid_antenna_type`             ENUM('gate','shelf','desk','mobile')
//                                                   NOT NULL DEFAULT 'gate',
//    `ed_rfid_antenna_status`           ENUM('activa','inactiva','erro')
//                                                   NOT NULL DEFAULT 'activa',
//    `ed_rfid_antenna_notes`            TEXT         DEFAULT NULL,
//    `ed_rfid_antenna_deleted`          TINYINT(1)   NOT NULL DEFAULT 0,
//    `ed_rfid_antenna_institute_code`   VARCHAR(20)  NOT NULL,
//    PRIMARY KEY (`ed_rfid_antenna_id`),
//    INDEX `idx_rfid_ant_institute` (`ed_rfid_antenna_institute_code`)
//  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;