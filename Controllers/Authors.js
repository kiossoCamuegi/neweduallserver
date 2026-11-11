// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                         AUTHOR CONTROLLER                                ║
 * ║                  Módulo de Gestão de Autores da Biblioteca               ║
 * ║                                                                           ║
 * ║  Features:                                                               ║
 * ║  ✓ CRUD completo (Create, Read, Update, Delete)                        ║
 * ║  ✓ Cache inteligente com TTL                                            ║
 * ║  ✓ Logs coloridos estruturados                                          ║
 * ║  ✓ Tratamento robusto de erros                                          ║
 * ║  ✓ Validações frontend + backend                                        ║
 * ║  ✓ Upload de imagens com fallback                                       ║
 * ║  ✓ Soft-delete (não apaga, apenas marca)                                ║
 * ║  ✓ Auditoria automática                                                 ║
 * ║  ✓ Multi-tenant (por institute)                                         ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */

const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const path = require("path");
const fs = require("fs").promises;

// ─── CONFIGURAÇÕES GLOBAIS ────────────────────────────────────────────────────
const AUTHOR_CACHE_TTL = 3600; // 1 hora

// ─── CORES PARA CONSOLE ───────────────────────────────────────────────────────
const COLORS = {
  RED: "\x1b[31m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  CYAN: "\x1b[36m",
  MAGENTA: "\x1b[35m",
  RESET: "\x1b[0m",
  BOLD: "\x1b[1m",
};

/**
 * ─── LOGGER ESTRUTURADO ───────────────────────────────────────────────────
 * Logs coloridos e organizados por tipo
 */
const log = {
  success: (msg) => 
    console.log(`${COLORS.GREEN}✓ ${msg}${COLORS.RESET}`),
  
  error: (msg, error) => 
    console.error(
      `${COLORS.RED}✗ ERRO: ${msg}${COLORS.RESET}`,
      error?.message || ""
    ),
  
  warning: (msg) => 
    console.warn(`${COLORS.YELLOW}⚠ ${msg}${COLORS.RESET}`),
  
  info: (msg) => 
    console.log(`${COLORS.CYAN}ℹ ${msg}${COLORS.RESET}`),
  
  db: (msg) => 
    console.log(`${COLORS.MAGENTA}🗄️  ${msg}${COLORS.RESET}`),
  
  cache: (msg) => 
    console.log(`${COLORS.BOLD}${COLORS.CYAN}📦 ${msg}${COLORS.RESET}`),
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── FUNÇÕES UTILITÁRIAS ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Guardar ficheiro de imagem do autor
 * @param {Object} file - Arquivo enviado por Multer
 * @returns {Promise<string|null>} Caminho relativo do arquivo ou null
 */
const saveAuthorPicture = async (file) => {
  if (!file) return null;

  const uploadDir = path.join(__dirname, "../uploads/authors");

  try {
    // Verificar se diretório existe
    try {
      await fs.stat(uploadDir);
      log.info(`Diretório de uploads já existe: ${uploadDir}`);
    } catch (err) {
      // Se erro é "não existe", criar
      if (err.code === "ENOENT") {
        log.warning(`Criando diretório: ${uploadDir}`);
        await fs.mkdir(uploadDir, { recursive: true });
        log.success(`Diretório criado com sucesso`);
      } else {
        // Re-throw outros erros (permissões, etc)
        throw err;
      }
    }

    // Gerar nome único para arquivo
    const ext = path.extname(file.originalname) || ".jpg";
    const fileName = `author_${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, fileName);

    // Escrever arquivo
    await fs.writeFile(filePath, file.buffer);
    const relativePath = `uploads/authors/${fileName}`;

    log.success(`Imagem guardada: ${fileName} (${file.size} bytes)`);
    return relativePath;
  } catch (error) {
    log.error(`Falha ao guardar imagem de autor`, error);
    throw new Error(`Não foi possível guardar a imagem: ${error.message}`);
  }
};

/**
 * Validar campos obrigatórios do autor
 * @param {Object} body - Dados do formulário
 * @returns {Array<string>} Array de mensagens de erro (vazio = válido)
 */
const validateAuthorFields = (body) => {
  const errors = [];

  // ✓ Nome - obrigatório e mínimo 2 caracteres
  if (!body.author_name || body.author_name.trim() === "") {
    errors.push("Nome completo é obrigatório.");
  } else if (body.author_name.trim().length < 2) {
    errors.push("Nome completo deve ter pelo menos 2 caracteres.");
  }

  // ✓ Data de Nascimento - validar se preenchida
  if (body.author_birthdate) {
    const date = new Date(body.author_birthdate);
    if (isNaN(date.getTime())) {
      errors.push("Data de nascimento inválida.");
    }
    if (date > new Date()) {
      errors.push("Data de nascimento não pode ser no futuro.");
    }
  }

  // ✓ Estado - obrigatório
  if (
    body.author_status === undefined ||
    body.author_status === null ||
    body.author_status === ""
  ) {
    errors.push("Estado é obrigatório.");
  }

  return errors;
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── FUNÇÕES DE BANCO DE DADOS ────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Buscar todos os autores do instituto (sem cache)
 * @param {Object} req - Request do Express
 * @param {Object} res - Response do Express
 * @param {string} instituteCode - Código do instituto
 * @returns {Promise<Array>} Lista de autores
 */
const FetchAuthors = async (req, res, instituteCode) => {
  try {
    const query = `
      SELECT * FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND ed_library_author_institute_code = ?
      ORDER BY ed_library_author_name ASC
    `;

    const rows = await ExecuteQuery(res, query, [instituteCode], true, {
      db: "eduall_library_authors",
      type: "select",
      data: req,
    });

    if (!rows) {
      log.error("FetchAuthors retornou null/undefined");
      return [];
    }

    log.success(`Buscadas ${rows.length} autores do instituto ${instituteCode}`);
    return rows;
  } catch (error) {
    log.error("Erro ao buscar autores", error);
    throw error; // não devolver [] (seria guardado em cache)
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CONTROLADORES (ROTAS) ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/authors
 * Listar todos os autores com cache
 */
const GetAuthors = async (req, res) => {
  try {
    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      log.error("Sessão inválida: instituteCode não encontrado");
      return res.status(401).json({
        success: false,
        message: "Sessão inválida. Por favor, faça login novamente.",
      });
    }

    const rows = await Cache.eduallWithCache(
      CacheKeys.author.list(instituteCode),
      AUTHOR_CACHE_TTL,
      () => FetchAuthors(req, res, instituteCode)
    );

    res.status(200).json(rows || []);
  } catch (error) {
    log.error("Erro ao buscar autores", error);
    res.status(500).json({
      success: false,
      message: "Falha ao buscar autores!",
      error: error.message,
    });
  }
};

/**
 * GET /api/author/:ID
 * Obter um autor específico
 */
const GetSingleAuthor = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute;

    if (!instituteCode) {
      log.error("Sessão inválida ao buscar autor individual");
      return res.status(401).json({
        success: false,
        message: "Sessão inválida.",
      });
    }

    if (!ID) {
      log.warning("ID de autor não fornecido");
      return res.status(400).json({
        success: false,
        message: "ID do autor é obrigatório.",
      });
    }

    const query = `
      SELECT * FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND ed_library_author_id = ?
        AND ed_library_author_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_authors",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0) {
      log.warning(`Autor ${ID} não encontrado`);
      return res.status(404).json({
        success: false,
        message: "Autor não encontrado.",
      });
    }

    res.status(200).json(rows);
  } catch (error) {
    log.error("Erro ao buscar autor individual", error);
    res.status(500).json({
      success: false,
      message: "Falha ao buscar o autor!",
      error: error.message,
    });
  }
};

/**
 * POST /api/author
 * Registar novo autor
 */
const RegisterAuthor = async (req, res) => {
  try {
    const {
      author_name,
      author_pseudonym,
      author_nationality,
      author_birthdate,
      author_biography,
      author_status,
    } = req.body;

    // ✓ Validar campos
    console.log("kiosso", req.body)
    const errors = validateAuthorFields(req.body);
    if (errors.length > 0) {
      log.warning(`Validação falhou: ${errors.join(" | ")}`);
      return res.status(422).json({
        success: false,
        msg: errors.join(" "),
        errors,
      });
    }

    // ✓ Validar sessão
    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      log.error("Sessão inválida ao registar autor");
      return res.status(401).json({
        success: false,
        message: "Sessão inválida.",
      });
    }

    // ✓ Verificar nome único dentro do instituto
    const checkQuery = `
      SELECT ed_library_author_id FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND LOWER(TRIM(ed_library_author_name)) = LOWER(TRIM(?))
        AND ed_library_author_institute_code = ?
    `;

    const existing = await ExecuteQuery(
      res,
      checkQuery,
      [author_name.trim(), instituteCode],
      true,
      {
        db: "eduall_library_authors",
        type: "select",
        data: req,
      }
    );

    if (existing && existing.length > 0) {
      log.warning(
        `Duplicado: Autor "${author_name.trim()}" já existe`
      );
      return res.status(409).json({
        success: false,
        msg: `Já existe um autor com o nome "${author_name.trim()}".`,
      });
    }

    // ✓ Guardar imagem se enviada
    let picturePath = null;
    if (req.file) {
      try {
        picturePath = await saveAuthorPicture(req.file);
      } catch (imgError) {
        log.error(
          "Falha ao guardar imagem, continuando sem imagem",
          imgError
        );
        // Continua sem imagem em vez de falhar
      }
    }

    // ✓ Inserir na BD
    const query = `
      INSERT INTO eduall_library_authors (
        ed_library_author_name,
        ed_library_author_pseudonym,
        ed_library_author_nationality,
        ed_library_author_birthdate,
        ed_library_author_biography,
        ed_library_author_picture,
        ed_library_author_status,
        ed_library_author_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const PARAMS = [
      author_name.trim(),
      author_pseudonym ? author_pseudonym.trim() : null,
      author_nationality ? author_nationality.trim() : null,
      author_birthdate || null,
      author_biography ? author_biography.trim() : null,
      picturePath,
      author_status,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_authors",
      type: "insert",
      data: req,
    });

    if (!rows) {
      log.error("Erro: ExecuteQuery retornou null ao inserir autor");
      return res.status(500).json({
        success: false,
        message: "Falha ao registar autor na base de dados!",
      });
    }

    // ✓ Registar auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Autor",
      description: `Registou o autor "${author_name.trim()}"`,
    }).catch((err) => log.error("Erro ao registar auditoria", err));

    log.success(`Autor "${author_name.trim()}" registado com sucesso`);

    // ✓ Refrescar cache
    await CacheKeys.safeInvalidate(() => [CacheKeys.author.list(instituteCode), CacheKeys.digitalContent.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Autor registado com sucesso!",
      data: rows,
    });
  } catch (error) {
    log.error("Erro ao registar autor", error);
    res.status(500).json({
      success: false,
      message: "Falha ao registar autor!",
      error: error.message,
    });
  }
};

/**
 * PUT /api/author/:ID
 * Atualizar autor existente
 */
const AuthorUpdate = async (req, res) => {
  try {
    const { ID } = req.params;

    if (!ID) {
      log.warning("ID não fornecido na atualização de autor");
      return res.status(400).json({
        success: false,
        message: "ID do autor é obrigatório.",
      });
    }

    const {
      author_name,
      author_pseudonym,
      author_nationality,
      author_birthdate,
      author_biography,
      author_status,
    } = req.body;

    // ✓ Validar campos
    const errors = validateAuthorFields(req.body);
    if (errors.length > 0) {
      log.warning(`Validação falhou na atualização: ${errors.join(" | ")}`);
      return res.status(422).json({
        success: false,
        msg: errors.join(" "),
        errors,
      });
    }

    // ✓ Validar sessão
    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      log.error("Sessão inválida ao atualizar autor");
      return res.status(401).json({
        success: false,
        message: "Sessão inválida.",
      });
    }

    // ✓ Verificar nome único (excluindo o próprio registo)
    const checkQuery = `
      SELECT ed_library_author_id FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND LOWER(TRIM(ed_library_author_name)) = LOWER(TRIM(?))
        AND ed_library_author_institute_code = ?
        AND ed_library_author_id != ?
    `;

    const existing = await ExecuteQuery(
      res,
      checkQuery,
      [author_name.trim(), instituteCode, ID],
      true,
      {
        db: "eduall_library_authors",
        type: "select",
        data: req,
      }
    );

    if (existing && existing.length > 0) {
      log.warning(
        `Duplicado: Outro autor já tem o nome "${author_name.trim()}"`
      );
      return res.status(409).json({
        success: false,
        msg: `Já existe outro autor com o nome "${author_name.trim()}".`,
      });
    }

    // ✓ Atualizar imagem se enviada
    let setPicture = "";
    const pictureParams = [];

    if (req.file) {
      try {
        const picturePath = await saveAuthorPicture(req.file);
        setPicture = ", ed_library_author_picture = ?";
        pictureParams.push(picturePath);
      } catch (imgError) {
        log.error(
          "Falha ao guardar nova imagem, continuando sem atualizar imagem",
          imgError
        );
      }
    }

    // ✓ Atualizar na BD
    const query = `
      UPDATE eduall_library_authors SET
        ed_library_author_name        = ?,
        ed_library_author_pseudonym   = ?,
        ed_library_author_nationality = ?,
        ed_library_author_birthdate   = ?,
        ed_library_author_biography   = ?,
        ed_library_author_status      = ?
        ${setPicture}
      WHERE ed_library_author_deleted = 0
        AND ed_library_author_id = ?
        AND ed_library_author_institute_code = ?
    `;

    const PARAMS = [
      author_name.trim(),
      author_pseudonym ? author_pseudonym.trim() : null,
      author_nationality ? author_nationality.trim() : null,
      author_birthdate || null,
      author_biography ? author_biography.trim() : null,
      author_status,
      ...pictureParams,
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_authors",
      type: "update",
      data: req,
    });

    if (!rows) {
      log.error("Erro: ExecuteQuery retornou null ao atualizar autor");
      return res.status(500).json({
        success: false,
        message: "Falha ao atualizar autor na base de dados!",
      });
    }

    // ✓ Registar auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Autor",
      description: `Atualizou o autor "${author_name.trim()}" (ID: ${ID})`,
    }).catch((err) => log.error("Erro ao registar auditoria", err));

    log.success(`Autor ${ID} atualizado: "${author_name.trim()}"`);

    // ✓ Refrescar cache
    await CacheKeys.safeInvalidate(() => [CacheKeys.author.list(instituteCode), CacheKeys.digitalContent.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Autor atualizado com sucesso!",
      data: rows,
    });
  } catch (error) {
    log.error("Erro ao atualizar autor", error);
    res.status(500).json({
      success: false,
      message: "Falha ao actualizar autor!",
      error: error.message,
    });
  }
};

/**
 * DELETE /api/author/:ID
 * Eliminar autor (soft-delete)
 */
const AuthorDelete = async (req, res) => {
  try {
    const { ID } = req.params;

    if (!ID) {
      log.warning("ID não fornecido na eliminação de autor");
      return res.status(400).json({
        success: false,
        message: "ID do autor é obrigatório.",
      });
    }

    // ✓ Validar sessão
    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) {
      log.error("Sessão inválida ao eliminar autor");
      return res.status(401).json({
        success: false,
        message: "Sessão inválida.",
      });
    }

    // ✓ Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_library_author_name FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND ed_library_author_id = ?
        AND ed_library_author_institute_code = ?
    `;

    const found = await ExecuteQuery(
      res,
      checkQuery,
      [ID, instituteCode],
      true,
      {
        db: "eduall_library_authors",
        type: "select",
        data: req,
      }
    );

    if (!found || found.length === 0) {
      log.warning(`Tentativa de eliminar autor inexistente: ${ID}`);
      return res.status(404).json({
        success: false,
        msg: "Autor não encontrado ou já foi removido.",
      });
    }

    const authorName = found[0].ed_library_author_name;

    // ✓ Soft-delete (apenas marcar como deletado)
    const query = `
      UPDATE eduall_library_authors
      SET ed_library_author_deleted = 1
      WHERE ed_library_author_deleted = 0
        AND ed_library_author_id = ?
        AND ed_library_author_institute_code = ?
    `;

    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, {
      db: "eduall_library_authors",
      type: "update",
      data: req,
    });

    if (!rows) {
      log.error("Erro: ExecuteQuery retornou null ao eliminar autor");
      return res.status(500).json({
        success: false,
        message: "Falha ao eliminar autor na base de dados!",
      });
    }

    // ✓ Registar auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Autor",
      description: `Removeu o autor "${authorName}" (ID: ${ID})`,
    }).catch((err) => log.error("Erro ao registar auditoria", err));

    log.success(`Autor ${ID} eliminado: "${authorName}"`);

    // ✓ Refrescar cache
    await CacheKeys.safeInvalidate(() => [CacheKeys.author.list(instituteCode), CacheKeys.digitalContent.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Autor removido com sucesso!",
      data: rows,
    });
  } catch (error) {
    log.error("Erro ao eliminar autor", error);
    res.status(500).json({
      success: false,
      message: "Falha ao remover autor!",
      error: error.message,
    });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ─── EXPORTS ───────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  GetAuthors,
  GetSingleAuthor,
  RegisterAuthor,
  AuthorDelete,
  AuthorUpdate,
};
 