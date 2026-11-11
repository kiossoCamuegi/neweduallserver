// CACHE-OPT v3 (aplicado por apply_cache_optimizations_v3.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");

const JOB_TITLE_CACHE_TTL = 3600; // lista global: iguais para todas as escolas
const { RegisterAuditAction } = require("./Auditory");

// 📘 Buscar todos os cargos
const GetJobTitles = async (req, res) => {
  try {
    const rows = await Cache.eduallWithCache(
      CacheKeys.jobTitle.list(),
      JOB_TITLE_CACHE_TTL,
      () => ExecuteQuery(
        res,
        `SELECT * FROM eduall_job_titles ORDER BY ed_job_title ASC`,
        [],
        true,
        { db: "eduall_job_titles", type: "select", data: req }
      )
    );

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao buscar cargos!",
      error: error.message,
    });
  }
};

// 📗 Buscar um cargo específico
const GetSingleJobTitle = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, msg: "ID inválido." });
    }
    const query = `SELECT * FROM eduall_job_titles WHERE ed_job_title_id = ?`;
    const PARAMS = [ID];

    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_job_titles",
      type: "select",
      data: req,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao buscar o cargo!",
      error: error.message,
    });
  }
};

// 🟢 Registrar novo cargo
const RegisterJobTitle = async (req, res) => {
  try {
    const { job_title } = req.body;
    const jobTitleLowerCase = job_title.trim().toLowerCase();

    // Verifica duplicidade
    const checkQuery = `
      SELECT * FROM eduall_job_titles 
      WHERE LOWER(ed_job_title) = ? AND ed_job_title_deleted = 0
    `;
    const checkParams = [jobTitleLowerCase];
    const existing = await ExecuteQuery(res, checkQuery, checkParams, true, {
      db: "eduall_job_titles",
      type: "select",
      data: req,
    });

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        msg: "Já existe um cargo com este nome!",
      });
    }

    // Inserir novo cargo
    const query = `
      INSERT INTO eduall_job_titles (ed_job_title)
      VALUES(?)
    `;
    const PARAMS = [job_title];
    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_job_titles",
      type: "insert",
      data: req,
    });

    await CacheKeys.safeInvalidate(() => [CacheKeys.jobTitle.list()]);

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 1, // registro
      form: "Cargos",
      description: `Registrou um novo cargo (${job_title})`,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao registrar o cargo!",
      error: error.message,
    });
  }
};

// 🟡 Atualizar cargo existente
const UpdateJobTitle = async (req, res) => {
  try {
    const { ID } = req.params;
    const { job_title } = req.body;
    const jobTitleLowerCase = job_title.trim().toLowerCase();

    // Verifica duplicidade
    const checkQuery = `
      SELECT * FROM eduall_job_titles 
      WHERE LOWER(ed_job_title) = ? 
      AND ed_job_title_deleted = 0 
      AND ed_job_title_id != ?
    `;
    const checkParams = [jobTitleLowerCase, ID];
    const existing = await ExecuteQuery(res, checkQuery, checkParams, true, {
      db: "eduall_job_titles",
      type: "select",
      data: req,
    });

    if (existing.length > 0) {
      return res.status(400).json({
        success: false,
        msg: "Já existe um cargo com este nome!",
      });
    }

    // Atualiza
    const query = `
      UPDATE eduall_job_titles 
      SET ed_job_title = ?
      WHERE ed_job_title_id = ? AND ed_job_title_deleted = 0
    `;
    const PARAMS = [job_title, ID];
    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_job_titles",
      type: "update",
      data: req,
    });

    await CacheKeys.safeInvalidate(() => [CacheKeys.jobTitle.list()]);

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 2, // atualização
      form: "Cargos",
      description: `Atualizou o cargo (${job_title}) com ID ${ID}`,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao atualizar o cargo!",
      error: error.message,
    });
  }
};

// 🔴 Eliminar cargo
const DeleteJobTitle = async (req, res) => {
  try {
    const { ID } = req.params;

    const query = `
      UPDATE eduall_job_titles 
      SET ed_job_title_deleted = 1
      WHERE ed_job_title_id = ?
    `;
    const PARAMS = [ID];
    const result = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_job_titles",
      type: "update",
      data: req,
    });

    await CacheKeys.safeInvalidate(() => [CacheKeys.jobTitle.list()]);

    // Auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 3, // eliminação
      form: "Cargos",
      description: `Eliminou o cargo com ID ${ID}`,
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      msg: "Falha ao eliminar o cargo!",
      error: error.message,
    });
  }
};

module.exports = {
  GetJobTitles,
  GetSingleJobTitle,
  RegisterJobTitle,
  UpdateJobTitle,
  DeleteJobTitle,
}; 
