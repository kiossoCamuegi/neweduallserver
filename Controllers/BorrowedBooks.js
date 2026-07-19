const { RegisterAuditAction } = require("./Auditory");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const Cache = require("../Functions/CacheRoutes");

const BORROWED_BOOK_CACHE_TTL = 3600;

const CacheKeys = {
  list: (instituteCode) => `borrowedBook:list:${instituteCode}`,
  single: (id, instituteCode) => `borrowedBook:single:${id}:${instituteCode}`,
  all: () => "borrowedBook:*",
};

// ─── Fetch base (sem cache) ────────────────────────────────────────────────────
const FetchBorrowedBooks = async (req, res, instituteCode) => {
  const borrowedBooksQuery = `
    SELECT * FROM eduall_library_borrowed_books
    LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_library_borrowed_books.ed_library_borrowed_book_usercode
    WHERE ed_library_borrowed_book_deleted = 0 
      AND ed_library_borrowed_book_institute_code = ?
    ORDER BY eduall_students.ed_student_name ASC
  `;

  const borrowedBooksRows = await ExecuteQuery(res, borrowedBooksQuery, [instituteCode], true, {
    db: "eduall_library_borrowed_books",
    type: "select",
    data: req,
  });

  const booksQuery = `
    SELECT * FROM eduall_library_books
    WHERE ed_library_book_deleted = 0 
      AND ed_library_book_institute_code = ?
  `;
  const booksRows = await ExecuteQuery(res, booksQuery, [instituteCode], true, {
    db: "eduall_library_books",
    type: "select",
    data: req,
  });

  return transformBorrowedBooks(borrowedBooksRows, booksRows);
};

// ─── Transformação de dados (empréstimos + livros) ────────────────────────────
const transformBorrowedBooks = (borrowedBooksRows, booksRows) => {
  const finalData = [];

  borrowedBooksRows.forEach((br) => {
    finalData.push({
      id: br.ed_library_borrowed_book_id,
      studentname: br.ed_student_name || "",
      studentpicture: br.ed_student_picture || "",
      studentid: br.ed_student_id,
      status: br.ed_library_borrowed_book_status,
      booksids: (br.ed_library_borrowed_book_code || "")
        .split(",")
        .map((code) => parseInt(code.trim(), 10))
        .filter((code) => !isNaN(code)),
      date: {
        registerDate: br.ed_library_borrowed_book_registerDate,
        devolutionDate: br.ed_library_borrowed_book_devolutionDate,
      },
      borrowed_books: [],
    });
  });

  finalData.forEach((fn) => {
    fn.booksids.forEach((cd) => {
      booksRows.forEach((book) => {
        if (book.ed_library_book_id * 1 === cd) {
          fn.borrowed_books.push({
            id: book.ed_library_book_id,
            title: book.ed_library_book_title,
            picture: book.ed_library_book_picture,
          });
        }
      });
    });
  });

  return finalData;
};

// ─── Refrescar cache (limpa tudo e repõe a lista) ─────────────────────────────
const RefreshBorrowedBookCache = async (req, res, instituteCode) => {
  const startTime = Date.now();

  await Cache.eduallClear(CacheKeys.all());
  console.log(`📦🧹 CACHE -> limpa para institute ${instituteCode}`);

  const rows = await FetchBorrowedBooks(req, res, instituteCode);
  await Cache.eduallSet(CacheKeys.list(instituteCode), rows, BORROWED_BOOK_CACHE_TTL);

  const duration = Date.now() - startTime;
  console.log(`🗄️🐢 BASE DE DADOS (lento) -> cache reposta em ${duration}ms para institute ${instituteCode}`);

  return rows;
};

// ─── Validações reutilizáveis ─────────────────────────────────────────────────
const ValidateBorrowedBookFields = (body) => {
  const errors = [];

  if (!body.borrow_book_student || body.borrow_book_student === "")
    errors.push("ID do aluno é obrigatório.");

  if (!body.borrow_book_data || body.borrow_book_data.trim() === "")
    errors.push("Código(s) do livro é obrigatório.");

  if (!body.borrow_book_devolution_date)
    errors.push("Data de devolução é obrigatória.");

  return errors;
};

// ─── GET todos os empréstimos ─────────────────────────────────────────────────
const GetBorrowedBooks = async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.list(instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetBorrowedBooks demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const rows = await FetchBorrowedBooks(req, res, instituteCode);
    await Cache.eduallSet(cacheKey, rows, BORROWED_BOOK_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetBorrowedBooks demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar empréstimos de livros!",
        error: error.message,
      });
  }
};

// ─── GET empréstimo individual ────────────────────────────────────────────────
const GetSingleBorrowedBook = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const cacheKey = CacheKeys.single(ID, instituteCode);
    const startTime = Date.now();

    const cached = await Cache.eduallGet(cacheKey);
    if (cached !== null) {
      const duration = Date.now() - startTime;
      console.log(`📦⚡ CACHE (rápido) -> GetSingleBorrowedBook demorou ${duration}ms (${cacheKey})`);
      return res.status(200).json(cached);
    }

    const query = `
      SELECT * FROM eduall_library_borrowed_books
      LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_library_borrowed_books.ed_library_borrowed_book_usercode
      WHERE ed_library_borrowed_book_deleted = 0 
        AND ed_library_borrowed_book_id = ? 
        AND ed_library_borrowed_book_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];
    const rows = await ExecuteQuery(res, query, PARAMS, true, {
      db: "eduall_library_borrowed_books",
      type: "select",
      data: req,
    });

    if (!rows || rows.length === 0)
      return res.status(404).json({ success: false, message: "Empréstimo de livro não encontrado." });

    await Cache.eduallSet(cacheKey, rows, BORROWED_BOOK_CACHE_TTL);

    const duration = Date.now() - startTime;
    console.log(`🗄️🐢 BASE DE DADOS (lento) -> GetSingleBorrowedBook demorou ${duration}ms (${cacheKey})`);

    res.status(200).json(rows);
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao buscar empréstimo de livro!",
        error: error.message,
      });
  }
};

// ─── POST registar empréstimo ──────────────────────────────────────────────────
const RegisterBorrowedBook = async (req, res) => {
  try {
    const {
      borrow_book_student,
      borrow_book_data,
      borrow_book_devolution_date,
    } = req.body;

    // Validações
    const errors = ValidateBorrowedBookFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Verificar se o aluno existe e pertence ao instituto
    const checkStudentQuery = `
      SELECT ed_student_id FROM eduall_students
      WHERE ed_student_deleted = 0
        AND ed_student_id = ?
        AND ed_student_institute_code = ?
    `;
    const studentCheck = await ExecuteQuery(
      res,
      checkStudentQuery,
      [borrow_book_student, instituteCode],
      true,
      { db: "eduall_students", type: "select", data: req }
    );
    if (!studentCheck || studentCheck.length === 0)
      return res
        .status(404)
        .json({ success: false, msg: "Aluno não encontrado ou não pertence à instituição." });

    const query = `
      INSERT INTO eduall_library_borrowed_books (
        ed_library_borrowed_book_usercode,
        ed_library_borrowed_book_code,
        ed_library_borrowed_book_devolutionDate,
        ed_library_borrowed_book_institute_code
      ) VALUES (?, ?, ?, ?)
    `;
    const PARAMS = [
      borrow_book_student,
      borrow_book_data.trim(),
      borrow_book_devolution_date,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_borrowed_books",
      type: "insert",
      data: req,
    });

    // Registrar auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Empréstimo de livro",
      description: `Registou empréstimo de livro para aluno ID ${borrow_book_student}`,
    });

    console.log(
      `🗄️🐢 BASE DE DADOS (lento) -> RegisterBorrowedBook: empréstimo registado para aluno ${borrow_book_student}`
    );
    await RefreshBorrowedBookCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Empréstimo de livro registado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao registar empréstimo de livro!",
        error: error.message,
      });
  }
};

// ─── PUT atualizar empréstimo ──────────────────────────────────────────────────
const BorrowedBookUpdate = async (req, res) => {
  try {
    const { ID } = req.params;
    const {
      borrow_book_student,
      borrow_book_data,
      borrow_book_status,
    } = req.body;

    // Validações
    const errors = ValidateBorrowedBookFields(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, msg: errors.join(" "), errors });

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar que o empréstimo existe
    const checkQuery = `
      SELECT ed_library_borrowed_book_id FROM eduall_library_borrowed_books
      WHERE ed_library_borrowed_book_deleted = 0
        AND ed_library_borrowed_book_id = ?
        AND ed_library_borrowed_book_institute_code = ?
    `;
    const found = await ExecuteQuery(
      res,
      checkQuery,
      [ID, instituteCode],
      true,
      { db: "eduall_library_borrowed_books", type: "select", data: req }
    );
    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Empréstimo de livro não encontrado ou já foi removido.",
        });

    // Verificar se o aluno existe
    const checkStudentQuery = `
      SELECT ed_student_id FROM eduall_students
      WHERE ed_student_deleted = 0
        AND ed_student_id = ?
        AND ed_student_institute_code = ?
    `;
    const studentCheck = await ExecuteQuery(
      res,
      checkStudentQuery,
      [borrow_book_student, instituteCode],
      true,
      { db: "eduall_students", type: "select", data: req }
    );
    if (!studentCheck || studentCheck.length === 0)
      return res
        .status(404)
        .json({ success: false, msg: "Aluno não encontrado ou não pertence à instituição." });

    const query = `
      UPDATE eduall_library_borrowed_books 
      SET ed_library_borrowed_book_usercode = ?,
          ed_library_borrowed_book_code = ?,
          ed_library_borrowed_book_status = ?
      WHERE ed_library_borrowed_book_deleted = 0 
        AND ed_library_borrowed_book_id = ? 
        AND ed_library_borrowed_book_institute_code = ?
    `;
    const PARAMS = [
      borrow_book_student,
      borrow_book_data.trim(),
      borrow_book_status || 0,
      ID,
      instituteCode,
    ];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_borrowed_books",
      type: "update",
      data: req,
    });

    // Registrar auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Empréstimo de livro",
      description: `Atualizou empréstimo de livro ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> BorrowedBookUpdate: registo ${ID} atualizado`);
    await RefreshBorrowedBookCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Empréstimo de livro atualizado com sucesso!",
      data: rows,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao atualizar empréstimo de livro!",
        error: error.message,
      });
  }
};

// ─── DELETE (soft-delete) empréstimo ───────────────────────────────────────────
const BorrowedBookDelete = async (req, res) => {
  try {
    const { ID } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    // Confirmar existência antes de apagar
    const checkQuery = `
      SELECT ed_library_borrowed_book_id FROM eduall_library_borrowed_books
      WHERE ed_library_borrowed_book_deleted = 0
        AND ed_library_borrowed_book_id = ?
        AND ed_library_borrowed_book_institute_code = ?
    `;
    const found = await ExecuteQuery(
      res,
      checkQuery,
      [ID, instituteCode],
      true,
      { db: "eduall_library_borrowed_books", type: "select", data: req }
    );
    if (!found || found.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          msg: "Empréstimo de livro não encontrado ou já foi removido.",
        });

    const query = `
      UPDATE eduall_library_borrowed_books 
      SET ed_library_borrowed_book_deleted = 1
      WHERE ed_library_borrowed_book_deleted = 0 
        AND ed_library_borrowed_book_id = ? 
        AND ed_library_borrowed_book_institute_code = ?
    `;
    const PARAMS = [ID, instituteCode];

    const rows = await ExecuteQuery(res, query, PARAMS, false, {
      db: "eduall_library_borrowed_books",
      type: "update",
      data: req,
    });

    // Registrar auditoria
    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Empréstimo de livro",
      description: `Removeu empréstimo de livro ID ${ID}`,
    });

    console.log(`🗄️🐢 BASE DE DADOS (lento) -> BorrowedBookDelete: registo ${ID} eliminado`);
    await RefreshBorrowedBookCache(req, res, instituteCode);

    res.status(200).json({
      success: true,
      message: "Empréstimo de livro removido com sucesso!",
      data: rows,
    });
  } catch (error) {
    res
      .status(500)
      .json({
        success: false,
        message: "Falha ao remover empréstimo de livro!",
        error: error.message,
      });
  }
};

module.exports = {
  GetBorrowedBooks,
  GetSingleBorrowedBook,
  RegisterBorrowedBook,
  BorrowedBookDelete,
  BorrowedBookUpdate,
};