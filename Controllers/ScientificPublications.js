const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const multer = require("multer");
const path = require("path");

// ─── GET ALL ──────────────────────────────────────────────────────────────────
const GetScientificPublications = async (req, res) => {
  try {
    const query = `
      SELECT * FROM eduall_library_scientific_publications
      LEFT JOIN eduall_library_authors
        ON eduall_library_authors.ed_library_author_id = ed_sci_pub_author_id
      WHERE ed_sci_pub_deleted = 0
        AND ed_sci_pub_institute_code = ?
      ORDER BY ed_sci_pub_title ASC`;

    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_scientific_publications", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar publicações científicas!",
      error: error.message,
    });
  }
};

// ─── GET SINGLE ───────────────────────────────────────────────────────────────
const GetSingleScientificPublication = async (req, res) => {
  try {
    const { ID } = req.params;
    const query = `
      SELECT * FROM eduall_library_scientific_publications
      LEFT JOIN eduall_library_authors
        ON eduall_library_authors.ed_library_author_id = ed_sci_pub_author_id
      WHERE ed_sci_pub_deleted = 0
        AND ed_sci_pub_id = ?
        AND ed_sci_pub_institute_code = ?`;

    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_scientific_publications", type: "select", data: req,
    });
    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao buscar publicação científica!",
      error: error.message,
    });
  }
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────
const RegisterScientificPublication = async (req, res) => {
  try {
    const query = `
      INSERT INTO eduall_library_scientific_publications (
        ed_sci_pub_title,
        ed_sci_pub_type,
        ed_sci_pub_author_id,
        ed_sci_pub_doi,
        ed_sci_pub_journal,
        ed_sci_pub_volume,
        ed_sci_pub_pages,
        ed_sci_pub_year,
        ed_sci_pub_keywords,
        ed_sci_pub_abstract,
        ed_sci_pub_access_url,
        ed_sci_pub_language,
        ed_sci_pub_file_path,
        ed_sci_pub_institute_code
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const PARAMS = [
      req.body.pub_title,
      req.body.pub_type,
      req.body.pub_author_id,
      req.body.pub_doi,
      req.body.pub_journal,
      req.body.pub_volume,
      req.body.pub_pages,
      req.body.pub_year,
      req.body.pub_keywords,
      req.body.pub_abstract,
      req.body.pub_access_url,
      req.body.pub_language,
      req.file?.path ?? "",
      req.session.user.eduall_user_session_curentinstitute,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_scientific_publications", type: "insert", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Publicações Científicas",
      description: `Registou a publicação científica "${req.body.pub_title}"`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao registar publicação científica!",
      error: error.message,
    });
  }
};

// ─── DELETE (soft) ────────────────────────────────────────────────────────────
const ScientificPublicationDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const query = `
      UPDATE eduall_library_scientific_publications
      SET ed_sci_pub_deleted = 1
      WHERE ed_sci_pub_deleted = 0
        AND ed_sci_pub_id = ?
        AND ed_sci_pub_institute_code = ?`;

    const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_scientific_publications", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Publicações Científicas",
      description: `Removeu a publicação científica com ID "${ID}"`,
    });

    res.status(200).json(rows);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Falha ao remover publicação científica!",
      error: error.message,
    });
  }
};

// ─── UPDATE (suporta substituição de ficheiro) ────────────────────────────────
const ScientificPublicationUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      pub_title, pub_type, pub_author_id, pub_doi,
      pub_journal, pub_volume, pub_pages, pub_year,
      pub_keywords, pub_abstract, pub_access_url, pub_language,
    } = req.body;

    // Se chegou um novo ficheiro via multer, actualiza também o file_path
    const query = `
      UPDATE eduall_library_scientific_publications SET
        ed_sci_pub_title       = ?,
        ed_sci_pub_type        = ?,
        ed_sci_pub_author_id   = ?,
        ed_sci_pub_doi         = ?,
        ed_sci_pub_journal     = ?,
        ed_sci_pub_volume      = ?,
        ed_sci_pub_pages       = ?,
        ed_sci_pub_year        = ?,
        ed_sci_pub_keywords    = ?,
        ed_sci_pub_abstract    = ?,
        ed_sci_pub_access_url  = ?,
        ed_sci_pub_language    = ?
        ${req.file?.path ? ", ed_sci_pub_file_path = ?" : ""}
      WHERE ed_sci_pub_deleted = 0
        AND ed_sci_pub_id = ?
        AND ed_sci_pub_institute_code = ?`;

    const PARAMS = [
      pub_title, pub_type, pub_author_id, pub_doi,
      pub_journal, pub_volume, pub_pages, pub_year,
      pub_keywords, pub_abstract, pub_access_url, pub_language,
      ...(req.file?.path ? [req.file.path] : []),
      ID, req.session.user.eduall_user_session_curentinstitute,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_scientific_publications", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Publicações Científicas",
      description: `Atualizou a publicação científica "${pub_title}" (ID: ${ID})`,
    });

    res.status(200).json(rows);
  } catch (error) {
    console.log(error);
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar publicação científica!",
      error: error.message,
    });
  }
};

// ─── MULTER — aceita PDF, EPUB, DOCX ─────────────────────────────────────────
const storage = multer.diskStorage({
  destination: "files/scientific_publications",
  filename: (req, file, cb) => {
    const unique = `eduall_sci_${file.fieldname}_${Date.now()}_${Math.random().toString().slice(2)}`;
    return cb(null, unique + path.extname(file.originalname));
  },
});

const uploadScientificPublicationFile = multer({ storage }).single("pub_file");

module.exports = {
  GetScientificPublications,
  GetSingleScientificPublication,
  RegisterScientificPublication,
  ScientificPublicationDelete,
  ScientificPublicationUpdate,
  uploadScientificPublicationFile,
};