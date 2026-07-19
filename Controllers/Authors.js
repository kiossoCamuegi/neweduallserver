const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const path = require("path");
const fs = require("fs").promises;  // ← MUDANÇA: .promises para async

const AUTHOR_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `author:list:${instituteCode}`,
  single: (id, instituteCode) => `author:single:${id}:${instituteCode}`,
  all: () => "author:*",
};

// ─── Utilitário: guardar ficheiro de imagem ───────────────────────────────────
const saveAuthorPicture = async (file) => {  // ← MUDANÇA: async
  if (!file) return null;
  const uploadDir = path.join(__dirname, "../uploads/authors");
  
  // Verificar se diretório existe, se não, criar
  try {
    await fs.stat(uploadDir);  // ← MUDANÇA: await fs.stat
  } catch {
    await fs.mkdir(uploadDir, { recursive: true });  // ← MUDANÇA: await fs.mkdir
  }
  
  const ext = path.extname(file.originalname) || ".jpg";
  const fileName = `author_${Date.now()}${ext}`;
  const filePath = path.join(uploadDir, fileName);
  await fs.writeFile(filePath, file.buffer);  // ← MUDANÇA: await fs.writeFile
  return `uploads/authors/${fileName}`;
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const validateAuthorFields = (body) => {
  const errors = [];

  if (!body.author_name || body.author_name.trim() === "")
    errors.push("Nome completo é obrigatório.");

  if (body.author_name && body.author_name.trim().length < 2)
    errors.push("Nome completo deve ter pelo menos 2 caracteres.");

  if (body.author_birthdate) {
    const date = new Date(body.author_birthdate);
    if (isNaN(date.getTime())) errors.push("Data de nascimento inválida.");
    if (date > new Date()) errors.push("Data de nascimento não pode ser no futuro.");
  }

  if (body.author_status === undefined || body.author_status === null || body.author_status === "")
    errors.push("Estado é obrigatório.");

  return errors;
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchAuthors = async (req, res, instituteCode) => {
  const query = `
    SELECT * FROM eduall_library_authors
    WHERE ed_library_author_deleted = 0
      AND ed_library_author_institute_code = ?
    ORDER BY ed_library_author_name ASC
  `;
  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_library_authors",
    type: "select",
    data: req,
  });
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshAuthorCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchAuthors(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, AUTHOR_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

  return rows;
};

// ─── GET todos os autores ─────────────────────────────────────────────────────
const GetAuthors = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetAuthors demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchAuthors(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, AUTHOR_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetAuthors demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar autores!", error: error.message });
  }
};

// ─── GET autor individual ─────────────────────────────────────────────────────
const GetSingleAuthor = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleAuthor demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
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

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, message: "Autor não encontrado." });

    await Cache.eduallSet(cacheKey, rows, AUTHOR_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleAuthor demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao buscar o autor!", error: error.message });
  }
};

// ─── POST registar autor ──────────────────────────────────────────────────────
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

    // Validações
    const errors = validateAuthorFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar nome único dentro do instituto
    const checkQuery = `
      SELECT ed_library_author_id FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND LOWER(TRIM(ed_library_author_name)) = LOWER(TRIM(?))
        AND ed_library_author_institute_code = ?
    `;
    const existing = await ExecuteQuery(res, checkQuery, [author_name.trim(), instituteCode], true, {
      db: "eduall_library_authors", type: "select", data: req,
    });
    if (existing && existing.length > 0)
      return res.status(409).json({ success: false, msg: `Já existe um autor com o nome "${author_name.trim()}".` });

    // Guardar imagem se enviada
    const picturePath = req.file ? await saveAuthorPicture(req.file) : null;  // ← MUDANÇA: await

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
      db: "eduall_library_authors", type: "insert", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Autor",
      description: `Registou o autor "${author_name.trim()}"`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> RegisterAuthor: autor "${author_name.trim()}" registado`);
    await RefreshAuthorCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Autor registado com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao registar autor!", error: error.message });
  }
};

// ─── PUT atualizar autor ──────────────────────────────────────────────────────
const AuthorUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      author_name,
      author_pseudonym,
      author_nationality,
      author_birthdate,
      author_biography,
      author_status,
    } = req.body;

    // Validações
    const errors = validateAuthorFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar nome único (excluindo o próprio registo)
    const checkQuery = `
      SELECT ed_library_author_id FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND LOWER(TRIM(ed_library_author_name)) = LOWER(TRIM(?))
        AND ed_library_author_institute_code = ?
        AND ed_library_author_id != ?
    `;
    const existing = await ExecuteQuery(res, checkQuery, [author_name.trim(), instituteCode, ID], true, {
      db: "eduall_library_authors", type: "select", data: req,
    });
    if (existing && existing.length > 0)
      return res.status(409).json({ success: false, msg: `Já existe outro autor com o nome "${author_name.trim()}".` });

    // Imagem: atualizar só se foi enviada uma nova
    let setPicture = "";
    const pictureParams = [];
    if (req.file) {
      const picturePath = await saveAuthorPicture(req.file);  // ← MUDANÇA: await
      setPicture = ", ed_library_author_picture = ?";
      pictureParams.push(picturePath);
    }

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
      db: "eduall_library_authors", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Autor",
      description: `Atualizou o autor "${author_name.trim()}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AuthorUpdate: registo ${ID} atualizado`);
    await RefreshAuthorCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Autor atualizado com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao actualizar autor!", error: error.message });
  }
};

// ─── DELETE (soft-delete) autor ───────────────────────────────────────────────
const AuthorDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_library_author_name FROM eduall_library_authors
      WHERE ed_library_author_deleted = 0
        AND ed_library_author_id = ?
        AND ed_library_author_institute_code = ?
    `;
    const found = await ExecuteQuery(res, checkQuery, [ID, instituteCode], true, {
      db: "eduall_library_authors", type: "select", data: req,
    });
    if (!found || found.length === 0)
      return res.status(404).json({ success: false, msg: "Autor não encontrado ou já foi removido." });

    const authorName = found[0].ed_library_author_name;

    const query = `
      UPDATE eduall_library_authors
      SET ed_library_author_deleted = 1
      WHERE ed_library_author_deleted = 0
        AND ed_library_author_id = ?
        AND ed_library_author_institute_code = ?
    `;
    const rows = await ExecuteQuery(res, query, [ID, instituteCode], false, {
      db: "eduall_library_authors", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Autor",
      description: `Removeu o autor "${authorName}" (ID: ${ID})`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> AuthorDelete: registo ${ID} eliminado`);
    await RefreshAuthorCache(req, res, instituteCode);

    res.status(200).json({ success: true, message: "Autor removido com sucesso!", data: rows });
  } catch (error) {
    res.status(500).json({ success: false, message: "Falha ao remover autor!", error: error.message });
  }
};

module.exports = { GetAuthors, GetSingleAuthor, RegisterAuthor, AuthorDelete, AuthorUpdate };