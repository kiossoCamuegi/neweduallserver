const multer = require("multer");
const path = require("path");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const { RegisterAuditAction } = require("./Auditory");

const CONTACT_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `contact:list:${instituteCode}`,
  single: (id, instituteCode) => `contact:single:${id}:${instituteCode}`,
  all: () => "contact:*",
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateContactFields = (body) => {
  const errors = [];

  if (!body.contact_name || body.contact_name.trim() === "")
    errors.push("Nome do contacto é obrigatório.");

  if (body.contact_name && body.contact_name.trim().length < 2)
    errors.push("Nome do contacto deve ter pelo menos 2 caracteres.");

  if (!body.contact_email || body.contact_email.trim() === "")
    errors.push("Email do contacto é obrigatório.");

  if (body.contact_email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(body.contact_email.trim()))
      errors.push("Email inválido.");
  }

  if (!body.contact_phone || body.contact_phone.trim() === "")
    errors.push("Telefone do contacto é obrigatório.");

  if (!body.contact_type || body.contact_type.trim() === "")
    errors.push("Tipo de contacto é obrigatório.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchContacts = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_contacts
    WHERE ed_contact_deleted = 0
      AND ed_contact_instituteCode = ?
    ORDER BY ed_contact_name ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_contacts",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshContactCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchContacts(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, CONTACT_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

  return rows;
};

/* ===================== GET OPERATIONS (COM CACHE) ===================== */

/**
 * GET ALL — Listar todos os contactos
 */
const GetContacts = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetContacts demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchContacts(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, CONTACT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetContacts demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar contactos!",
        error: error.message,
      });
  }
};

/**
 * GET SINGLE — Obter um contacto individual
 */
const GetSingleContact = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleContact demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_contacts
      WHERE ed_contact_deleted = 0
        AND ed_contact_id = ?
        AND ed_contact_instituteCode = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_contacts",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res
        .status(404)
        .json({ success: false, message: "Contacto não encontrado." });

    await Cache.eduallSet(cacheKey, rows, CONTACT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleContact demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar contacto!",
        error: error.message,
      });
  }
};

/* ===================== POST OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * POST — Registar contacto
 */
const RegisterContact = async (req, res) => {
  try {
    const {
      contact_name,
      contact_email,
      contact_phone,
      contact_address,
      contact_avatar,
      contact_type,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateContactFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Verificar email único dentro do instituto
    const checkQuery = `
      SELECT ed_contact_id FROM eduall_contacts
      WHERE ed_contact_deleted = 0
        AND LOWER(TRIM(ed_contact_email)) = LOWER(TRIM(?))
        AND ed_contact_instituteCode = ?
    `;
    const existing = await ExecuteQuery(
      res,
      checkQuery,
      [contact_email.trim(), instituteCode],
      true,
      { db: "eduall_contacts", type: "select", data: req }
    );

    if (existing && existing.length > 0)
      return res.status(409).json({
        success: false,
        msg: `Já existe um contacto com o email "${contact_email.trim()}".`,
      });

    const picturePath = req.file
      ? "images/contacts/" + req.file.filename
      : "";

    const query = `
      INSERT INTO eduall_contacts (
        ed_contact_name,
        ed_contact_email,
        ed_contact_phone,
        ed_contact_address,
        ed_contact_avatar,
        ed_contact_type,
        ed_contact_picture,
        ed_contact_instituteCode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const PARAMS = [
      contact_name.trim(),
      contact_email.trim(),
      contact_phone.trim(),
      contact_address ? contact_address.trim() : null,
      contact_avatar || null,
      contact_type.trim(),
      picturePath,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_contacts",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Contactos",
      description: `Registrou contacto (${contact_name.trim()}) com email ${contact_email.trim()}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterContact: contacto "${contact_name.trim()}" registado`
    );
    await RefreshContactCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Contacto registado com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao registar contacto!",
        error: error.message,
      });
  }
};

/* ===================== PUT OPERATIONS (COM VALIDAÇÃO E CACHE REFRESH) ===================== */

/**
 * PUT — Atualizar contacto
 */
const ContactUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      contact_name,
      contact_email,
      contact_phone,
      contact_address,
      contact_avatar,
      contact_type,
    } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Validações
    const errors = ValidateContactFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    // Confirmar que o contacto existe
    const checkExistQuery = `
      SELECT ed_contact_id FROM eduall_contacts
      WHERE ed_contact_deleted = 0
        AND ed_contact_id = ?
        AND ed_contact_instituteCode = ?
    `;
    const found = await ExecuteQuery(res, checkExistQuery, [ID, instituteCode], true, {
      db: "eduall_contacts",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Contacto não encontrado ou já foi removido.",
        });

    // Verificar email único (excluindo o próprio contacto)
    const checkEmailQuery = `
      SELECT ed_contact_id FROM eduall_contacts
      WHERE ed_contact_deleted = 0
        AND LOWER(TRIM(ed_contact_email)) = LOWER(TRIM(?))
        AND ed_contact_instituteCode = ?
        AND ed_contact_id != ?
    `;
    const existingEmail = await ExecuteQuery(
      res,
      checkEmailQuery,
      [contact_email.trim(), instituteCode, ID],
      true,
      { db: "eduall_contacts", type: "select", data: req }
    );

    if (existingEmail && existingEmail.length > 0)
      return res.status(409).json({
        success: false,
        msg: `Já existe outro contacto com o email "${contact_email.trim()}".`,
      });

    // Preparar imagem (atualizar só se foi enviada uma nova)
    let setPicture = "";
    const pictureParams = [];
    if (req.file) {
      const picturePath = "images/contacts/" + req.file.filename;
      setPicture = ", ed_contact_picture = ?";
      pictureParams.push(picturePath);
    }

    const query = `
      UPDATE eduall_contacts SET
        ed_contact_name = ?,
        ed_contact_email = ?,
        ed_contact_phone = ?,
        ed_contact_address = ?,
        ed_contact_avatar = ?,
        ed_contact_type = ?
        ${setPicture}
      WHERE ed_contact_deleted = 0
        AND ed_contact_id = ?
        AND ed_contact_instituteCode = ?
    `;
    const PARAMS = [
      contact_name.trim(),
      contact_email.trim(),
      contact_phone.trim(),
      contact_address ? contact_address.trim() : null,
      contact_avatar || null,
      contact_type.trim(),
      ...pictureParams,
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_contacts",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Contactos",
      description: `Atualizou contacto (${contact_name.trim()}) com ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ContactUpdate: contacto ${ID} atualizado`);
    await RefreshContactCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Contacto atualizado com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao atualizar contacto!",
        error: error.message,
      });
  }
};

/* ===================== DELETE OPERATIONS (COM CACHE REFRESH) ===================== */

/**
 * DELETE (soft-delete) — Eliminar contacto
 */
const ContactDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_contact_name FROM eduall_contacts
      WHERE ed_contact_deleted = 0
        AND ed_contact_id = ?
        AND ed_contact_instituteCode = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_contacts",
      type: "select",
      data: req,
    });

    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Contacto não encontrado ou já foi removido.",
        });

    const contactName = found[0].ed_contact_name;

    const query = `
      UPDATE eduall_contacts
      SET ed_contact_deleted = 1
      WHERE ed_contact_deleted = 0
        AND ed_contact_id = ?
        AND ed_contact_instituteCode = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_contacts",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Contactos",
      description: `Eliminou contacto "${contactName}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> ContactDelete: contacto ${ID} eliminado`);
    await RefreshContactCache(req, res, instituteCode);

    res
      .status(200)
      .json({ success: true, message: "Contacto eliminado com sucesso!", data: rows });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao eliminar contacto!",
        error: error.message,
      });
  }
};

/* ===================== MULTER CONFIGURATION ===================== */

const storage = multer.diskStorage({
  destination: path.join(__dirname, `./../images/contacts/`),
  filename: (req, file, cb) => {
    return cb(
      null,
      `eduall_file_${file.fieldname}_${Date.now()}_${Math.random().toString().slice(2, 11)}_${path.extname(file.originalname)}`
    );
  },
});

const uploadContactPicture = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Tipo de ficheiro não permitido. Use JPEG, PNG, GIF ou WebP."
        )
      );
    }
  },
}).single(`contact_picture`);

module.exports = {
  GetContacts,
  GetSingleContact,
  RegisterContact,
  ContactDelete,
  ContactUpdate,
  uploadContactPicture,
};