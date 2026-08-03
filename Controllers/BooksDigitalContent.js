const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const DIGITAL_CONTENT_CACHE_TTL = 3600; // 1 hora

const UPLOAD_DIR = "files/digital_contents";

// ─── Garantir que diretório existe ────────────────────────────────────────────
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log(`📁 Criado diretório: ${UPLOAD_DIR}`);
}

const CacheKeys = {
  list: (instituteCode) => `digitalContent:list:${instituteCode}`,
  single: (id, instituteCode) => `digitalContent:single:${id}:${instituteCode}`,
  all: () => "digitalContent:*",
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchDigitalContents = async (req, res, instituteCode) => {
  const query = `
    SELECT 
      dc.*,
      COALESCE(a.ed_library_author_name, '') as ed_library_author_name
    FROM eduall_library_digital_contents dc
    LEFT JOIN eduall_library_authors a 
      ON a.ed_library_author_id = dc.ed_digital_content_author
    WHERE dc.ed_digital_content_deleted = 0 
      AND dc.ed_digital_content_institute_code = ?
    ORDER BY dc.ed_digital_content_title ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_library_digital_contents",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshDigitalContentCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  try {
    await Cache.eduallClear(CacheKeys.all());
    console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

    const rows = await FetchDigitalContents(req, res, instituteCode);
    
    if (rows && rows.length > 0) {
      await Cache.eduallSet(CacheKeys.list(instituteCode), rows, DIGITAL_CONTENT_CACHE_TTL);
    }

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

    return rows;
  } catch (err) {
    console.error(`❌ Erro ao refrescar cache: ${err.message}`);
    return [];
  }
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateDigitalContentFields = (body) => {
  const errors = [];

  if (!body.content_title || body.content_title.trim() === "")
    errors.push("Título do conteúdo é obrigatório.");

  if (body.content_title && body.content_title.trim().length < 2)
    errors.push("Título do conteúdo deve ter pelo menos 2 caracteres.");

  if (!body.content_type || body.content_type.trim() === "")
    errors.push("Tipo de conteúdo é obrigatório.");

  if (!body.content_format || body.content_format.trim() === "")
    errors.push("Formato do conteúdo é obrigatório.");

  if (!body.content_language || body.content_language.trim() === "")
    errors.push("Idioma do conteúdo é obrigatório.");

  return errors;
};

// ─── GET todos os conteúdos digitais ──────────────────────────────────────────
const GetDigitalContents = async (req, res) => {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida ou instituição não identificada.",
      });
    }

    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    // Tentar obter do cache
    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null && Array.isArray(cached)) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetDigitalContents demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    // Se não estiver em cache, buscar da BD
    const rows = await FetchDigitalContents(req, res, instituteCode);
    
    if (rows && Array.isArray(rows)) {
      await Cache.eduallSet(cacheKey, rows, DIGITAL_CONTENT_CACHE_TTL);
    }

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetDigitalContents demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows || []);
  } catch (error) {
    console.error("❌ Erro em GetDigitalContents:", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao buscar conteúdos digitais!",
      error: error.message,
    });
  }
};

// ─── GET conteúdo digital individual ──────────────────────────────────────────
const GetSingleDigitalContent = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida ou instituição não identificada.",
      });
    }

    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null && Array.isArray(cached)) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleDigitalContent demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT 
        dc.*,
        COALESCE(a.ed_library_author_name, '') as ed_library_author_name
      FROM eduall_library_digital_contents dc
      LEFT JOIN eduall_library_authors a 
        ON a.ed_library_author_id = dc.ed_digital_content_author
      WHERE dc.ed_digital_content_deleted = 0 
        AND dc.ed_digital_content_id = ? 
        AND dc.ed_digital_content_institute_code = ?
    `;
    
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], true, {
      db: "eduall_library_digital_contents",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Conteúdo digital não encontrado.",
      });
    }

    await Cache.eduallSet(cacheKey, rows, DIGITAL_CONTENT_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleDigitalContent demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    console.error("❌ Erro em GetSingleDigitalContent:", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao buscar conteúdo digital!",
      error: error.message,
    });
  }
};

// ─── POST registar conteúdo digital ───────────────────────────────────────────
const RegisterDigitalContent = async (req, res) => {
  try {
    const {
      content_title,
      content_type,
      content_author,
      content_format,
      content_access_url,
      content_license,
      content_publication_date,
      content_language,
      content_file_size,
      content_description,
    } = req.body;

    // Validações
    const errors = ValidateDigitalContentFields(req.body);
    if (errors.length > 0) {
      return res.status(422).json({
        success: false,
        msg: errors.join(" "),
        errors,
      });
    }

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida ou instituição não identificada.",
      });
    }

    // Verificar nome único dentro do instituto
    const checkQuery = `
      SELECT ed_digital_content_id FROM eduall_library_digital_contents
      WHERE ed_digital_content_deleted = 0
        AND LOWER(TRIM(ed_digital_content_title)) = LOWER(TRIM(?))
        AND ed_digital_content_institute_code = ?
    `;
    
    const existing = await ExecuteQuery(res, checkQuery, [content_title.trim(), instituteCode], true, {
      db: "eduall_library_digital_contents",
      type: "select",
      data: req,
    });
    
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        msg: `Já existe um conteúdo digital com o título "${content_title.trim()}".`,
      });
    }

    const filePath = req.file ? `${UPLOAD_DIR}/${req.file.filename}` : null;

    const query = `
      INSERT INTO eduall_library_digital_contents (
        ed_digital_content_title,
        ed_digital_content_type,
        ed_digital_content_author,
        ed_digital_content_format,
        ed_digital_content_access_url,
        ed_digital_content_license,
        ed_digital_content_publication_date,
        ed_digital_content_language,
        ed_digital_content_file_size,
        ed_digital_content_description,
        ed_digital_content_file_path,
        ed_digital_content_institute_code,
        ed_digital_content_created_at,
        ed_digital_content_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)
    `;

    const PARAMS = [
      content_title.trim(),
      content_type.trim(),
      content_author || null,
      content_format.trim(),
      content_access_url ? content_access_url.trim() : null,
      content_license ? content_license.trim() : 'free',
      content_publication_date || null,
      content_language.trim(),
      content_file_size || null,
      content_description ? content_description.trim() : null,
      filePath,
      instituteCode,
    ];

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_digital_contents",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Conteúdos Digitais",
      description: `Registou o conteúdo digital "${content_title.trim()}"`,
    });

    console.log(`✅ RegisterDigitalContent: conteúdo "${content_title.trim()}" registado com sucesso`);
    
    // Refrescar cache para que a lista updated imediatamente
    await RefreshDigitalContentCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Conteúdo digital registado com sucesso!",
      data: result,
    });
  } catch (error) {
    console.error("❌ Erro em RegisterDigitalContent:", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao registar conteúdo digital!",
      error: error.message,
    });
  }
};

// ─── PUT atualizar conteúdo digital ───────────────────────────────────────────
const DigitalContentUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      content_title,
      content_type,
      content_author,
      content_format,
      content_access_url,
      content_license,
      content_publication_date,
      content_language,
      content_file_size,
      content_description,
    } = req.body;

    // Validações
    const errors = ValidateDigitalContentFields(req.body);
    if (errors.length > 0) {
      return res.status(422).json({
        success: false,
        msg: errors.join(" "),
        errors,
      });
    }

    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    
    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida ou instituição não identificada.",
      });
    }

    // Verificar nome único (excluindo o próprio registo)
    const checkQuery = `
      SELECT ed_digital_content_id FROM eduall_library_digital_contents
      WHERE ed_digital_content_deleted = 0
        AND LOWER(TRIM(ed_digital_content_title)) = LOWER(TRIM(?))
        AND ed_digital_content_institute_code = ?
        AND ed_digital_content_id != ?
    `;
    
    const existing = await ExecuteQuery(res, checkQuery, [content_title.trim(), instituteCode, ID], true, {
      db: "eduall_library_digital_contents",
      type: "select",
      data: req,
    });
    
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        msg: `Já existe outro conteúdo digital com o título "${content_title.trim()}".`,
      });
    }

    // Preparar SQL dinamicamente baseado se há ficheiro novo
    let setFile = "";
    const fileParams = [];
    
    if (req.file?.filename) {
      const filePath = `${UPLOAD_DIR}/${req.file.filename}`;
      setFile = ", ed_digital_content_file_path = ?";
      fileParams.push(filePath);
    }

    const query = `
      UPDATE eduall_library_digital_contents SET
        ed_digital_content_title = ?,
        ed_digital_content_type = ?,
        ed_digital_content_author = ?,
        ed_digital_content_format = ?,
        ed_digital_content_access_url = ?,
        ed_digital_content_license = ?,
        ed_digital_content_publication_date = ?,
        ed_digital_content_language = ?,
        ed_digital_content_file_size = ?,
        ed_digital_content_description = ?
        ${setFile}
      WHERE ed_digital_content_deleted = 0 
        AND ed_digital_content_id = ? 
        AND ed_digital_content_institute_code = ?
    `;

    const PARAMS = [
      content_title.trim(),
      content_type.trim(),
      content_author || null,
      content_format.trim(),
      content_access_url ? content_access_url.trim() : null,
      content_license ? content_license.trim() : 'free',
      content_publication_date || null,
      content_language.trim(),
      content_file_size || null,
      content_description ? content_description.trim() : null,
      ...fileParams,
      ID,
      instituteCode,
    ];

    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_digital_contents",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Conteúdos Digitais",
      description: `Atualizou o conteúdo digital "${content_title.trim()}" (ID: ${ID})`,
    });

    console.log(`✅ DigitalContentUpdate: registo ${ID} atualizado com sucesso`);
    
    // Refrescar cache
    await RefreshDigitalContentCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Conteúdo digital atualizado com sucesso!",
      data: result,
    });
  } catch (error) {
    console.error("❌ Erro em DigitalContentUpdate:", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar conteúdo digital!",
      error: error.message,
    });
  }
};

// ─── DELETE (soft-delete) conteúdo digital ────────────────────────────────────
const DigitalContentDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      return res.status(401).json({
        success: false,
        message: "Sessão inválida ou instituição não identificada.",
      });
    }

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_digital_content_title FROM eduall_library_digital_contents
      WHERE ed_digital_content_deleted = 0
        AND ed_digital_content_id = ?
        AND ed_digital_content_institute_code = ?
    `;
    
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_library_digital_contents",
      type: "select",
      data: req,
    });
    
    if (!found || found.length === 0) {
      return res.status(404).json({
        success: false,
        msg: "Conteúdo digital não encontrado ou já foi removido.",
      });
    }

    const contentTitle = found[0].ed_digital_content_title;

    const query = `
      UPDATE eduall_library_digital_contents 
      SET ed_digital_content_deleted = 1
      WHERE ed_digital_content_deleted = 0 
        AND ed_digital_content_id = ? 
        AND ed_digital_content_institute_code = ?
    `;
    
    const result = await ExecuteQuery(res, query, [ID, instituteCode], false, {
      db: "eduall_library_digital_contents",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Conteúdos Digitais",
      description: `Removeu o conteúdo digital "${contentTitle}" (ID: ${ID})`,
    });

    console.log(`✅ DigitalContentDelete: registo ${ID} eliminado com sucesso`);
    
    // Refrescar cache
    await RefreshDigitalContentCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Conteúdo digital removido com sucesso!",
      data: result,
    });
  } catch (error) {
    console.error("❌ Erro em DigitalContentDelete:", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao remover conteúdo digital!",
      error: error.message,
    });
  }
};

// ─── MULTER configuração ──────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Garantir que o diretório existe
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Gerar nome único para evitar conflitos
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const basename = path.parse(file.originalname).name.replace(/\s+/g, '_');
    const ext = path.extname(file.originalname);
    cb(null, `eduall_digital_${uniqueSuffix}_${basename}${ext}`);
  },
});

// Filtro para tipos de ficheiro permitidos
const fileFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'audio/mpeg',
    'video/mp4',
    'application/epub+zip',
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Tipo de ficheiro não permitido: ${file.mimetype}`), false);
  }
};

const uploadDigitalContentFile = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
}).single('content_file');

module.exports = {
  GetDigitalContents,
  GetSingleDigitalContent,
  RegisterDigitalContent,
  DigitalContentDelete,
  DigitalContentUpdate,
  uploadDigitalContentFile,
};