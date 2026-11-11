// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");
const CacheKeys = require("../Functions/CacheKeys");
const multer = require("multer");
const path = require("path");
const cloudinary = require("cloudinary").v2;

require("dotenv").config();

// ─── Cloudinary Configuration ─────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || "",
  api_key: process.env.CLOUDINARY_KEY || "",
  api_secret: process.env.CLOUDINARY_SECRET || "",
});

const BOOK_CACHE_TTL = 3600;

// ─── Upload para Cloudinary (staging) ──────────────────────────────────────────
/**
 * Faz upload de capa de livro para Cloudinary no folder de staging
 * @param {Object} file - Multer file object (com .buffer)
 * @param {String} instituteCode - Código do instituto
 * @param {String} bookTitle - Título do livro (para metadata)
 * @returns {Promise<Object>} { url, public_id, width, height }
 */
async function uploadBookCoverToCloudinary(file, instituteCode, bookTitle) {
  if (!process.env.CLOUDINARY_NAME || !process.env.CLOUDINARY_KEY) {
    throw new Error("Cloudinary não configurado. Verifica .env: CLOUDINARY_NAME, CLOUDINARY_KEY, CLOUDINARY_SECRET");
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: `eduall/library/staging/${instituteCode}/covers`,
        resource_type: "auto",
        public_id: `book_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        // Eager transformations para otimizar imagens
        eager: [
          { width: 300, height: 450, crop: "fill", quality: "auto", fetch_format: "auto" }, // thumbnail
          { width: 800, height: 1200, crop: "fill", quality: "auto", fetch_format: "auto" }, // medium
        ],
        tags: ["eduall", "library", "book-cover", instituteCode, bookTitle],
      },
      (err, result) => {
        if (err) return reject(err);
        resolve({
          url: result?.secure_url || result?.url,
          public_id: result?.public_id,
          width: result?.width,
          height: result?.height,
          cloudinaryId: result?.public_id, // para posterior deleção se necessário
        });
      }
    );
    stream.end(file.buffer);
  });
}

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchBooks = async (req, res, instituteCode) => {
  const query = `SELECT * FROM eduall_library_books  WHERE ed_library_book_deleted = 0 AND ed_library_book_institute_code = ?   
    ORDER BY ed_library_book_rack ASC, ed_library_book_order ASC, ed_library_book_title ASC`;

  return ExecuteQuery(res, query, [instituteCode], true, {
    db: "eduall_library_books",
    type: "select",
    data: req,
  });
};

// ─── GET todos os livros ──────────────────────────────────────────────────────
const GetBooks = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const rows = await Cache.eduallWithCache(
      CacheKeys.book.list(instituteCode),
      BOOK_CACHE_TTL,
      () => FetchBooks(req, res, instituteCode)
    );

    res.status(200).json(rows);
  } catch (error) {
    console.error("[GetBooks]", error.message);
    res.status(500).json({ success: false, message: "Falha ao buscar livros!", error: error.message });
  }
};

// ─── GET livro individual ─────────────────────────────────────────────────────
const GetSingleBook = async (req, res) => {
  try {
    const { ID } = req.params;
    if (CacheKeys.parseId(ID) === null) {
      return res.status(400).json({ success: false, message: "ID inválido." });
    }
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const query = 'SELECT * FROM eduall_library_books WHERE ed_library_book_deleted = 0 AND ed_library_book_id = ? AND ed_library_book_institute_code = ?';
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_library_books", type: "select", data: req });

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, message: "Livro não encontrado." });

    res.status(200).json(rows);
  } catch (error) {
    console.error("[GetSingleBook]", error.message);
    res.status(500).json({ success: false, message: "Falha ao buscar livro!", error: error.message });
  }
};

// ─── POST registar livro (com Cloudinary) ─────────────────────────────────────
const RegisterBook = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const {
      book_title,
      book_type,
      book_publisher,
      book_colection,
      book_place_of_publication,
      book_classification,
      book_copy,
      book_subtitle,
      book_author,
      book_subject,
      book_price,
      book_year,
      book_acquisition_date,
      book_acquisition_type,
      book_provider,
      book_pages,
      book_rack,
      book_description,
    } = req.body;

    let pictureUrl = "";

    // Upload de capa para Cloudinary se arquivo foi enviado
    if (req.file) {
      try {
        console.log(`☁️  Uploadando capa para Cloudinary: "${book_title}"...`);
        const cloudinaryResult = await uploadBookCoverToCloudinary(
          req.file,
          instituteCode,
          book_title
        );
        pictureUrl = cloudinaryResult.url;
        console.log(`☁️  ✅ Capa enviada com sucesso: ${cloudinaryResult.public_id}`);
      } catch (uploadErr) {
        console.error(`☁️  ❌ Erro ao upload para Cloudinary:`, uploadErr.message);
        return res.status(500).json({
          success: false,
          message: "Erro ao fazer upload da capa para Cloudinary.",
          error: uploadErr.message,
        });
      }
    }

    // Nova entrada de livro entra sempre no fim da prateleira (maior ordem + 1)
    let bookOrder = 0;
    if (book_rack) {
      const orderQuery = `SELECT COALESCE(MAX(ed_library_book_order), -1) AS maxOrder 
        FROM eduall_library_books 
        WHERE ed_library_book_deleted = 0 AND ed_library_book_institute_code = ? AND ed_library_book_rack = ?`;
      const orderResult = await ExecuteQuery(res, orderQuery, [instituteCode, book_rack], true, { db: "eduall_library_books", type: "select" });
      bookOrder = (orderResult?.[0]?.maxOrder ?? -1) + 1;
    }

    // Insert no banco de dados com URL do Cloudinary
    const query = `INSERT INTO eduall_library_books(
      ed_library_book_title, ed_library_book_type, ed_library_book_publisher, ed_library_book_colection, 
      ed_library_book_place_of_publication, ed_library_book_classification, ed_library_book_copy, 
      ed_library_book_subtitle, ed_library_book_author, ed_library_book_subject,
      ed_library_book_price, ed_library_book_year, ed_library_book_acquisition_date, ed_library_book_acquisition_type, 
      ed_library_book_provider, ed_library_book_pages, ed_library_book_rack, ed_library_book_order, ed_library_book_notes, 
      ed_library_book_picture, ed_library_book_institute_code
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    const PARAMS = [
      book_title,
      book_type,
      book_publisher,
      book_colection,
      book_place_of_publication,
      book_classification,
      book_copy,
      book_subtitle,
      book_author,
      book_subject,
      book_price,
      book_year,
      book_acquisition_date,
      book_acquisition_type,
      book_provider,
      book_pages,
      book_rack,
      bookOrder,
      book_description,
      pictureUrl, // URL do Cloudinary em vez de path local
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_books",
      type: "insert",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 1, // Ação de registro
      form: "Livro",
      description: `Registou o livro "${book_title}" (capa em Cloudinary)`,
    }).catch(() => null);

    console.log(`✅ RegisterBook: livro "${book_title}" registado com capa no Cloudinary`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.book.list(instituteCode), CacheKeys.exemplar.list(instituteCode), CacheKeys.borrowedBook.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Livro registado com sucesso!",
      data: rows,
      pictureUrl,
    });
  } catch (error) {
    console.error("[RegisterBook]", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao registar livro!",
      error: error.message,
    });
  }
};

// ─── DELETE (soft-delete) livro ────────────────────────────────────────────────
const BookDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Opcional: Buscar o livro para obter public_id do Cloudinary e deletar a imagem
    const getQuery = `SELECT ed_library_book_picture FROM eduall_library_books 
                      WHERE ed_library_book_deleted = 0 AND ed_library_book_id = ? AND ed_library_book_institute_code = ?`;
    const getResult = await ExecuteQuery(res, getQuery, [ID, instituteCode], true, {
      db: "eduall_library_books",
      type: "select",
      data: req,
    });

    // Se houver capa no Cloudinary, pode-se deletar a imagem também (opcional)
    // Por agora, apenas soft-delete o registo
    if (getResult && getResult[0]?.ed_library_book_picture) {
      console.log(
        `📸 Nota: Capa em Cloudinary ${getResult[0].ed_library_book_picture} — podes deletá-la manualmente se necessário`
      );
    }

    const query = `UPDATE eduall_library_books SET ed_library_book_deleted = 1
      WHERE ed_library_book_deleted = 0 AND ed_library_book_id = ? AND ed_library_book_institute_code = ?`;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_books",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 3, // Ação de deleção
      form: "Livro",
      description: `Deletou o livro com ID "${ID}"`,
    }).catch(() => null);

    console.log(`✅ BookDelete: registo ${ID} eliminado (capa permanece no Cloudinary para backup)`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.book.list(instituteCode), CacheKeys.exemplar.list(instituteCode), CacheKeys.borrowedBook.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Livro removido com sucesso!",
      data: rows,
    });
  } catch (error) {
    console.error("[BookDelete]", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao remover livro!",
      error: error.message,
    });
  }
};

// ─── PUT atualizar livro (com Cloudinary) ─────────────────────────────────────
const BookUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const {
      book_title,
      book_type,
      book_publisher,
      book_colection,
      book_place_of_publication,
      book_classification,
      book_copy,
      book_subtitle,
      book_author,
      book_subject,
      book_price,
      book_year,
      book_acquisition_date,
      book_acquisition_type,
      book_provider,
      book_pages,
      book_rack,
      book_description,
    } = req.body;

    let pictureUrl = null;

    // Se nova capa foi enviada, upload para Cloudinary
    if (req.file) {
      try {
        console.log(`☁️  Atualizando capa no Cloudinary: "${book_title}"...`);
        const cloudinaryResult = await uploadBookCoverToCloudinary(
          req.file,
          instituteCode,
          book_title
        );
        pictureUrl = cloudinaryResult.url;
        console.log(`☁️  ✅ Nova capa enviada: ${cloudinaryResult.public_id}`);
      } catch (uploadErr) {
        console.error(`☁️  ❌ Erro ao upload para Cloudinary:`, uploadErr.message);
        return res.status(500).json({
          success: false,
          message: "Erro ao fazer upload da capa para Cloudinary.",
          error: uploadErr.message,
        });
      }
    }

    // Update query — com ou sem nova capa
    let query, PARAMS;

    if (pictureUrl) {
      // Atualiza com nova capa
      query = `UPDATE eduall_library_books SET 
        ed_library_book_title = ?, 
        ed_library_book_type = ?, 
        ed_library_book_publisher = ?, 
        ed_library_book_colection = ?, 
        ed_library_book_place_of_publication = ?, 
        ed_library_book_classification = ?, 
        ed_library_book_copy = ?, 
        ed_library_book_subtitle = ?, 
        ed_library_book_author = ?, 
        ed_library_book_subject = ?, 
        ed_library_book_price = ?, 
        ed_library_book_year = ?, 
        ed_library_book_acquisition_date = ?, 
        ed_library_book_acquisition_type = ?, 
        ed_library_book_provider = ?, 
        ed_library_book_pages = ?, 
        ed_library_book_rack = ?, 
        ed_library_book_notes = ?, 
        ed_library_book_picture = ? 
        WHERE ed_library_book_deleted = 0 AND ed_library_book_id = ? 
        AND ed_library_book_institute_code = ?`;

      PARAMS = [
        book_title,
        book_type,
        book_publisher,
        book_colection,
        book_place_of_publication,
        book_classification,
        book_copy,
        book_subtitle,
        book_author,
        book_subject,
        book_price,
        book_year,
        book_acquisition_date,
        book_acquisition_type,
        book_provider,
        book_pages,
        book_rack,
        book_description,
        pictureUrl, // Nova capa
        ID,
        instituteCode,
      ];
    } else {
      // Atualiza sem tocar na capa existente
      query = `UPDATE eduall_library_books SET 
        ed_library_book_title = ?, 
        ed_library_book_type = ?, 
        ed_library_book_publisher = ?, 
        ed_library_book_colection = ?, 
        ed_library_book_place_of_publication = ?, 
        ed_library_book_classification = ?, 
        ed_library_book_copy = ?, 
        ed_library_book_subtitle = ?, 
        ed_library_book_author = ?, 
        ed_library_book_subject = ?, 
        ed_library_book_price = ?, 
        ed_library_book_year = ?, 
        ed_library_book_acquisition_date = ?, 
        ed_library_book_acquisition_type = ?, 
        ed_library_book_provider = ?, 
        ed_library_book_pages = ?, 
        ed_library_book_rack = ?, 
        ed_library_book_notes = ? 
        WHERE ed_library_book_deleted = 0 AND ed_library_book_id = ? 
        AND ed_library_book_institute_code = ?`;

      PARAMS = [
        book_title,
        book_type,
        book_publisher,
        book_colection,
        book_place_of_publication,
        book_classification,
        book_copy,
        book_subtitle,
        book_author,
        book_subject,
        book_price,
        book_year,
        book_acquisition_date,
        book_acquisition_type,
        book_provider,
        book_pages,
        book_rack,
        book_description,
        ID,
        instituteCode,
      ];
    }

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_books",
      type: "update",
      data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2, // Ação de atualização
      form: "Livro",
      description: `Atualizou o livro "${book_title}" (ID: ${ID})${pictureUrl ? " — nova capa enviada" : ""}`,
    }).catch(() => null);

    console.log(
      `✅ BookUpdate: registo ${ID} atualizado${pictureUrl ? " com nova capa no Cloudinary" : ""}`
    );
    await CacheKeys.safeInvalidate(() => [CacheKeys.book.list(instituteCode), CacheKeys.exemplar.list(instituteCode), CacheKeys.borrowedBook.list(instituteCode)]);

    res.status(200).json({
      success: true,
      message: "Livro atualizado com sucesso!",
      data: rows,
      ...(pictureUrl && { pictureUrl }),
    });
  } catch (error) {
    console.error("[BookUpdate]", error.message);
    res.status(500).json({
      success: false,
      message: "Falha ao atualizar livro!",
      error: error.message,
    });
  }
};

// ─── PUT mover livro para OUTRA prateleira (drag & drop entre estantes) ───────
// Body esperado: { rack_id: number|null, order?: number }
// Se "order" não vier, o livro entra no fim da prateleira de destino.
// rack_id = null tira o livro de qualquer prateleira ("solto").
const MoveBook = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const targetRackId = req.body.rack_id ?? null;
    let targetOrder = req.body.order;

    if (targetOrder === undefined || targetOrder === null) {
      const orderQuery = `SELECT COALESCE(MAX(ed_library_book_order), -1) AS maxOrder 
        FROM eduall_library_books 
        WHERE ed_library_book_deleted = 0 AND ed_library_book_institute_code = ? 
        AND ed_library_book_rack ${targetRackId === null ? 'IS NULL' : '= ?'}`;
      const orderParams = targetRackId === null ? [instituteCode] : [instituteCode, targetRackId];
      const orderResult = await ExecuteQuery(res, orderQuery, orderParams, true, { db: "eduall_library_books", type: "select" });
      targetOrder = (orderResult?.[0]?.maxOrder ?? -1) + 1;
    }

    const query = `UPDATE eduall_library_books SET ed_library_book_rack = ?, ed_library_book_order = ? 
      WHERE ed_library_book_deleted = 0 AND ed_library_book_id = ? AND ed_library_book_institute_code = ?`;
    const PARAMS = [targetRackId, targetOrder, ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_library_books", type: "update", data: req });

    await RegisterAuditAction({
      session: req.session,
      action: 2, // Ação de atualização
      form: "Livro",
      description: `Moveu o livro ID ${ID} para a prateleira ${targetRackId ?? 'nenhuma'}`,
    }).catch(() => null);

    console.log(`✅ MoveBook: livro ${ID} movido para prateleira ${targetRackId ?? 'nenhuma'}`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.book.list(instituteCode), CacheKeys.exemplar.list(instituteCode), CacheKeys.borrowedBook.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Livro movido com sucesso!", data: rows });
  } catch (error) {
    console.error("[MoveBook]", error.message);
    res.status(500).json({ success: false, message: "Falha ao mover o livro!", error: error.message });
  }
};

// ─── PUT reordenar livros dentro da MESMA prateleira ──────────────────────────
// Body esperado: { order: [{ id, order }, { id, order }, ...] }
const ReorderBooks = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const { order } = req.body;

    if (!Array.isArray(order) || order.length === 0) {
      return res.status(400).json({ success: false, message: "Lista de ordenação inválida!" });
    }

    const query = `UPDATE eduall_library_books SET ed_library_book_order = ? 
      WHERE ed_library_book_id = ? AND ed_library_book_institute_code = ? AND ed_library_book_deleted = 0`;

    for (const item of order) {
      await ExecuteQuery(res, query, [item.order, item.id, instituteCode], false, { db: "eduall_library_books", type: "update", data: req });
    }

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Livro",
      description: `Reordenou ${order.length} livro(s)`,
    }).catch(() => null);

    console.log(`✅ ReorderBooks: ${order.length} livro(s) reordenados`);
    await CacheKeys.safeInvalidate(() => [CacheKeys.book.list(instituteCode), CacheKeys.exemplar.list(instituteCode), CacheKeys.borrowedBook.list(instituteCode)]);

    res.status(200).json({ success: true, message: "Livros reordenados com sucesso!" });
  } catch (error) {
    console.error("[ReorderBooks]", error.message);
    res.status(500).json({ success: false, message: "Falha ao reordenar os livros!", error: error.message });
  }
};

// ─── Multer: Upload de ficheiro em memória (buffer) ─────────────────────────────
// Sem diskStorage — o ficheiro fica em memória e é enviado direto para Cloudinary
const uploadBookCover = multer({
  storage: multer.memoryStorage(), // Fica em memória, não em disco
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB limit
  fileFilter: (req, file, cb) => {
    // Aceita apenas imagens
    if (file.mimetype.startsWith("image/")) {
      return cb(null, true);
    }
    cb(new Error("Apenas ficheiros de imagem são permitidos."));
  },
}).single("book_cover");

module.exports = {
  GetBooks,
  GetSingleBook,
  RegisterBook,
  BookDelete,
  BookUpdate,
  MoveBook,
  ReorderBooks,
  uploadBookCover,
  uploadBookCoverToCloudinary, // Exporta função para uso em outros lugares se necessário
};

/* ─────────────────────────────────────────────────────────────────────────
   SUGESTÃO DE ROTAS NOVAS (ajusta ao teu padrão de router):

   PUT /api/edualllibrarybookmove/update/:ID    → MoveBook
   PUT /api/edualllibrarybooksreorder/update    → ReorderBooks
───────────────────────────────────────────────────────────────────────── */