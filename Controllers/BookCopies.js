// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
// ═══════════════════════════════════════════════════════════════════════════════
//  Controller — Exemplares (Cópias Físicas de Livros)
//  Suporta: código de barras, QR Code e RFID (únicos por exemplar)
// ═══════════════════════════════════════════════════════════════════════════════

const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery             = require("../Functions/ExecuteQuery");
const Cache                    = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const QRCode                   = require("qrcode");   // npm install qrcode
const crypto                   = require("crypto");   // nativo do Node — sem dependência externa

const EXEMPLAR_CACHE_TTL = 600; // estado (disponível/emprestado) muda com frequência

// ─────────────────────────────────────────────────────────────────────────────
//  Nota: GetExemplarByScan (leitura no balcão de empréstimo) NÃO é cacheado
//  de propósito — o estado (disponível/emprestado) muda com frequência e uma
//  leitura desatualizada poderia levar a emprestar um exemplar já emprestado.
// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
//  Helper — Gerador de UUID v4 em JS puro
// ─────────────────────────────────────────────────────────────────────────────
function generateUUID() {
  // Usa crypto nativo do Node quando disponível (Node >= 14.17)
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback manual (RFC4122 v4)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Fetch base (sem cache) — lista completa de exemplares
// ─────────────────────────────────────────────────────────────────────────────
const FetchExemplares = async (req, res, instituteCode) => {
  const query = `
    SELECT
      ex.*,
      b.ed_library_book_title,
      b.ed_library_book_subtitle,
      b.ed_library_book_picture,
      b.ed_library_book_classification,
      rack.ed_library_rack_name,
      rack.ed_library_rack_status AS ed_library_rack_status
    FROM eduall_library_exemplares ex
    LEFT JOIN eduall_library_books b
           ON b.ed_library_book_id = ex.ed_exemplar_book_id
    LEFT JOIN eduall_library_racks rack
           ON rack.ed_library_rack_id = ex.ed_exemplar_rack_id
          AND rack.ed_library_rack_deleted = 0
    WHERE ex.ed_exemplar_deleted = 0
      AND ex.ed_exemplar_institute_code = ?
    ORDER BY ex.ed_exemplar_code ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_library_exemplares", type: "select", data: req,
  });
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Todos os Exemplares
// ─────────────────────────────────────────────────────────────────────────────
const GetExemplares = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.exemplar.list(instituteCode),
      EXEMPLAR_CACHE_TTL,
      () => FetchExemplares(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar exemplares!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Exemplares de um Livro específico
// ─────────────────────────────────────────────────────────────────────────────
const GetExemplaresByBook = async (req, res) => {
  try {
    const { BOOK_ID } = req.params;
    if (CacheKeys.parseId(BOOK_ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        ex.*,
        b.ed_library_book_title,
        rack.ed_library_rack_name
      FROM eduall_library_exemplares ex
      LEFT JOIN eduall_library_books b
             ON b.ed_library_book_id = ex.ed_exemplar_book_id
      LEFT JOIN eduall_library_racks rack
             ON rack.ed_library_rack_id = ex.ed_exemplar_rack_id
            AND rack.ed_library_rack_deleted = 0
      WHERE ex.ed_exemplar_deleted = 0
        AND ex.ed_exemplar_book_id = ?
        AND ex.ed_exemplar_institute_code = ?
      ORDER BY ex.ed_exemplar_code ASC
    `;
    const PARAMS = [BOOK_ID, instituteCode];
    const rows   = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_exemplares", type: "select", data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar exemplares do livro!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Exemplar único por ID
// ─────────────────────────────────────────────────────────────────────────────
const GetSingleExemplar = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      SELECT
        ex.*,
        b.ed_library_book_title,
        b.ed_library_book_subtitle,
        b.ed_library_book_picture,
        rack.ed_library_rack_name
      FROM eduall_library_exemplares ex
      LEFT JOIN eduall_library_books b
             ON b.ed_library_book_id = ex.ed_exemplar_book_id
      LEFT JOIN eduall_library_racks rack
             ON rack.ed_library_rack_id = ex.ed_exemplar_rack_id
            AND rack.ed_library_rack_deleted = 0
      WHERE ex.ed_exemplar_deleted = 0
        AND ex.ed_exemplar_id = ?
        AND ex.ed_exemplar_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows   = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_exemplares", type: "select", data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar exemplar!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Buscar exemplar por RFID / código de barras / QR token (scan)
//  Usado no balcão de empréstimo para leitura rápida
//  ⚠️ SEM CACHE — o estado do exemplar (disponível/emprestado) precisa estar
//  sempre atualizado em tempo real.
// ─────────────────────────────────────────────────────────────────────────────
const GetExemplarByScan = async (req, res) => {
  try {
    const { code } = req.params;
    const query = `
      SELECT
        ex.*,
        b.ed_library_book_title,
        b.ed_library_book_subtitle,
        b.ed_library_book_picture,
        b.ed_library_book_classification,
        rack.ed_library_rack_name
      FROM eduall_library_exemplares ex
      LEFT JOIN eduall_library_books b
             ON b.ed_library_book_id = ex.ed_exemplar_book_id
      LEFT JOIN eduall_library_racks rack
             ON rack.ed_library_rack_id = ex.ed_exemplar_rack_id
            AND rack.ed_library_rack_deleted = 0
      WHERE ex.ed_exemplar_deleted = 0
        AND ex.ed_exemplar_institute_code = ?
        AND (
              ex.ed_exemplar_barcode  = ?
          OR  ex.ed_exemplar_rfid     = ?
          OR  ex.ed_exemplar_qr_token = ?
        )
      LIMIT 1
    `;
    const PARAMS = [
      req.session.user.eduall_user_session_curentinstitute,
      code, code, code,
    ];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_exemplares", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao identificar exemplar!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  POST — Registar novo Exemplar
//  Gera código interno (EX-XXXXX), QR token único e valida unicidade RFID/barcode
// ─────────────────────────────────────────────────────────────────────────────
const RegisterExemplar = async (req, res) => {
  try {
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const {
      exemplar_book_id,
      exemplar_barcode,
      exemplar_rfid,
      exemplar_rack_id,
      exemplar_condition,
      exemplar_acquisition_date,
      exemplar_acquisition_price,
      exemplar_notes,
      exemplar_status,
    } = req.body;

    // ── Validar unicidade do código de barras ─────────────────────────────
    if (exemplar_barcode) {
      const dupBarcode = await ExecuteQuery(res,
        `SELECT ed_exemplar_id FROM eduall_library_exemplares
          WHERE ed_exemplar_barcode = ? AND ed_exemplar_deleted = 0`,
        [exemplar_barcode], true,
        { db: "eduall_library_exemplares", type: "select", data: req }
      );
      if (dupBarcode.length > 0) {
        return res.status(409).json({ success: false, message: "Código de barras já está atribuído a outro exemplar!" });
      }
    }

    // ── Validar unicidade do RFID ─────────────────────────────────────────
    if (exemplar_rfid) {
      const dupRfid = await ExecuteQuery(res,
        `SELECT ed_exemplar_id FROM eduall_library_exemplares
          WHERE ed_exemplar_rfid = ? AND ed_exemplar_deleted = 0`,
        [exemplar_rfid], true,
        { db: "eduall_library_exemplares", type: "select", data: req }
      );
      if (dupRfid.length > 0) {
        return res.status(409).json({ success: false, message: "Código RFID já está atribuído a outro exemplar!" });
      }
    }

    // ── Gerar código interno sequencial (EX-00001, EX-00002 …) ───────────
    const lastRow = await ExecuteQuery(res,
      `SELECT ed_exemplar_code FROM eduall_library_exemplares
        WHERE ed_exemplar_institute_code = ?
        ORDER BY ed_exemplar_id DESC LIMIT 1`,
      [institute], true,
      { db: "eduall_library_exemplares", type: "select", data: req }
    );

    let nextNum = 1;
    if (lastRow.length > 0) {
      const match = lastRow[0].ed_exemplar_code?.match(/\d+$/);
      if (match) nextNum = parseInt(match[0]) + 1;
    }
    const exemplar_code = `EX-${String(nextNum).padStart(5, "0")}`;

    // ── Gerar QR token único (UUID v4 em JS puro) + imagem base64 ─────────
    const qr_token = generateUUID();
    const qr_image = await QRCode.toDataURL(qr_token, { width: 256 });

    // ── Inserir ───────────────────────────────────────────────────────────
    const query = `
      INSERT INTO eduall_library_exemplares (
        ed_exemplar_code,
        ed_exemplar_book_id,
        ed_exemplar_barcode,
        ed_exemplar_rfid,
        ed_exemplar_qr_token,
        ed_exemplar_qr_image,
        ed_exemplar_rack_id,
        ed_exemplar_condition,
        ed_exemplar_acquisition_date,
        ed_exemplar_acquisition_price,
        ed_exemplar_notes,
        ed_exemplar_status,
        ed_exemplar_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      exemplar_code,
      exemplar_book_id,
      exemplar_barcode            || null,
      exemplar_rfid               || null,
      qr_token,
      qr_image,
      exemplar_rack_id            || null,
      exemplar_condition          || "bom",
      exemplar_acquisition_date   || null,
      exemplar_acquisition_price  || null,
      exemplar_notes              || null,
      exemplar_status             || "disponivel",
      institute,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_exemplares", type: "insert", data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      1,
      form:        "Exemplar",
      description: `Registou o exemplar "${exemplar_code}" para o livro ID ${exemplar_book_id}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterExemplar: exemplar "${exemplar_code}" registado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.exemplar.list(institute), CacheKeys.borrowedBook.list(institute)]);

    res.status(200).json({ ...rows, exemplar_code, qr_token, qr_image });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registar exemplar!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Actualizar Exemplar
// ─────────────────────────────────────────────────────────────────────────────
const UpdateExemplar = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const {
      exemplar_book_id,
      exemplar_barcode,
      exemplar_rfid,
      exemplar_rack_id,
      exemplar_condition,
      exemplar_acquisition_date,
      exemplar_acquisition_price,
      exemplar_notes,
      exemplar_status,
    } = req.body;

    // ── Unicidade barcode (excluindo o próprio) ───────────────────────────
    if (exemplar_barcode) {
      const dupBarcode = await ExecuteQuery(res,
        `SELECT ed_exemplar_id FROM eduall_library_exemplares
          WHERE ed_exemplar_barcode = ? AND ed_exemplar_deleted = 0 AND ed_exemplar_id != ?`,
        [exemplar_barcode, ID], true,
        { db: "eduall_library_exemplares", type: "select", data: req }
      );
      if (dupBarcode.length > 0) {
        return res.status(409).json({ success: false, message: "Código de barras já está atribuído a outro exemplar!" });
      }
    }

    // ── Unicidade RFID (excluindo o próprio) ──────────────────────────────
    if (exemplar_rfid) {
      const dupRfid = await ExecuteQuery(res,
        `SELECT ed_exemplar_id FROM eduall_library_exemplares
          WHERE ed_exemplar_rfid = ? AND ed_exemplar_deleted = 0 AND ed_exemplar_id != ?`,
        [exemplar_rfid, ID], true,
        { db: "eduall_library_exemplares", type: "select", data: req }
      );
      if (dupRfid.length > 0) {
        return res.status(409).json({ success: false, message: "Código RFID já está atribuído a outro exemplar!" });
      }
    }

    const query = `
      UPDATE eduall_library_exemplares SET
        ed_exemplar_book_id            = ?,
        ed_exemplar_barcode            = ?,
        ed_exemplar_rfid               = ?,
        ed_exemplar_rack_id            = ?,
        ed_exemplar_condition          = ?,
        ed_exemplar_acquisition_date   = ?,
        ed_exemplar_acquisition_price  = ?,
        ed_exemplar_notes              = ?,
        ed_exemplar_status             = ?
      WHERE ed_exemplar_deleted = 0
        AND ed_exemplar_id = ?
        AND ed_exemplar_institute_code = ?
    `;
    const PARAMS = [
      exemplar_book_id,
      exemplar_barcode            || null,
      exemplar_rfid               || null,
      exemplar_rack_id            || null,
      exemplar_condition,
      exemplar_acquisition_date   || null,
      exemplar_acquisition_price  || null,
      exemplar_notes              || null,
      exemplar_status,
      ID,
      institute,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_exemplares", type: "update", data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Exemplar",
      description: `Actualizou o exemplar ID ${ID} — estado: ${exemplar_status}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> UpdateExemplar: registo ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.exemplar.list(institute), CacheKeys.borrowedBook.list(institute)]);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao actualizar exemplar!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Atribuir / Actualizar RFID de um Exemplar
// ─────────────────────────────────────────────────────────────────────────────
const AssignRFID = async (req, res) => {
  try {
    const { ID }    = req.params;
    const { rfid }  = req.body;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    if (!rfid || rfid.trim().length < 3) {
      return res.status(400).json({ success: false, message: "Código RFID inválido!" });
    }

    const dup = await ExecuteQuery(res,
      `SELECT ed_exemplar_id FROM eduall_library_exemplares
        WHERE ed_exemplar_rfid = ? AND ed_exemplar_deleted = 0 AND ed_exemplar_id != ?`,
      [rfid.trim(), ID], true,
      { db: "eduall_library_exemplares", type: "select", data: req }
    );
    if (dup.length > 0) {
      return res.status(409).json({ success: false, message: "Código RFID já atribuído a outro exemplar!" });
    }

    const query = `
      UPDATE eduall_library_exemplares
         SET ed_exemplar_rfid = ?
       WHERE ed_exemplar_deleted = 0
         AND ed_exemplar_id = ?
         AND ed_exemplar_institute_code = ?
    `;
    const rows = await ExecuteQuery(res, query, [rfid.trim(), ID, institute], false, {
      db: "eduall_library_exemplares", type: "update", data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Exemplar",
      description: `Atribuiu RFID "${rfid.trim()}" ao exemplar ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AssignRFID: exemplar ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.exemplar.list(institute), CacheKeys.borrowedBook.list(institute)]);

    res.status(200).json({ ...rows, msg: "RFID atribuído com sucesso!" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao atribuir RFID!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  PUT — Soft-delete de Exemplar
// ─────────────────────────────────────────────────────────────────────────────
const DeleteExemplar = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const query = `
      UPDATE eduall_library_exemplares
         SET ed_exemplar_deleted = 1
       WHERE ed_exemplar_deleted = 0
         AND ed_exemplar_id = ?
         AND ed_exemplar_institute_code = ?
    `;
    const rows = await ExecuteQuery(res, query, [ID, institute], false, {
      db: "eduall_library_exemplares", type: "update", data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      3,
      form:        "Exemplar",
      description: `Removeu o exemplar com ID "${ID}"`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> DeleteExemplar: registo ${ID} eliminado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.exemplar.list(institute), CacheKeys.borrowedBook.list(institute)]);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao remover exemplar!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Regenerar QR Code de um Exemplar existente
// ─────────────────────────────────────────────────────────────────────────────
const RegenerateQR = async (req, res) => {
  try {
    const { ID }    = req.params;
    const institute = req.session.user.eduall_user_session_curentinstitute;

    const newToken = generateUUID();
    const newImage = await QRCode.toDataURL(newToken, { width: 256 });

    const query = `
      UPDATE eduall_library_exemplares
         SET ed_exemplar_qr_token = ?,
             ed_exemplar_qr_image = ?
       WHERE ed_exemplar_deleted = 0
         AND ed_exemplar_id = ?
         AND ed_exemplar_institute_code = ?
    `;
    await ExecuteQuery(res, query, [newToken, newImage, ID, institute], false, {
      db: "eduall_library_exemplares", type: "update", data: req,
    });

    await RegisterAuditAction({
      session:     req.session,
      action:      2,
      form:        "Exemplar",
      description: `Regenerou QR Code do exemplar ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegenerateQR: exemplar ${ID} atualizado`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.exemplar.list(institute), CacheKeys.borrowedBook.list(institute)]);

    res.status(200).json({ success: true, qr_token: newToken, qr_image: newImage });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao regenerar QR Code!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
//  GET — Gerar código RFID único (helper para o frontend)
//  ⚠️ SEM CACHE — precisa verificar sempre a existência mais atual na BD.
// ─────────────────────────────────────────────────────────────────────────────
const GenerateRFID = async (req, res) => {
  try {
    let rfid, exists;
    let attempts = 0;

    do {
      rfid = `RFID-${Date.now()}-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const rows = await ExecuteQuery(res,
        `SELECT ed_exemplar_id FROM eduall_library_exemplares
          WHERE ed_exemplar_rfid = ? AND ed_exemplar_deleted = 0`,
        [rfid], true,
        { db: "eduall_library_exemplares", type: "select", data: req }
      );
      exists = rows.length > 0;
      attempts++;
    } while (exists && attempts < 5);

    if (exists) {
      return res.status(500).json({ success: false, message: "Não foi possível gerar RFID único." });
    }

    res.status(200).json({ success: true, code: rfid });
  } catch (error) {
    res.status(500).json({ success: false, message: "Erro ao gerar RFID!", error: error.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  GetExemplares,
  GetExemplaresByBook,
  GetSingleExemplar,
  GetExemplarByScan,
  RegisterExemplar,
  UpdateExemplar,
  AssignRFID,
  DeleteExemplar,
  RegenerateQR,
  GenerateRFID,
  generateUUID, // exportado caso seja necessário noutros controllers
};