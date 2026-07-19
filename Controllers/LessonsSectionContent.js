const path = require("path");
const multer = require("multer");
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const cloudinary = require("cloudinary").v2;

// CONFIG CLOUDINARY
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || "",
  api_key: process.env.CLOUDINARY_KEY || "",
  api_secret: process.env.CLOUDINARY_SECRET || "",
});

// STORAGE EM MEMÓRIA + LIMITES
// 250 MB para vídeos
// 250 MB para vídeos
const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 250 * 1024 * 1024 // 250MB
  }
});

// 15 MB para ficheiros da aula
const filesUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 15 * 1024 * 1024 // 15MB
  }
});

// Função utilitária
const q = (db, type, req) => ({ db, type, data: req });

/* -----------------------------------------------------------
   0) GARANTIR ESTRUTURA (COLUNAS + TABELA FICHEIROS)
------------------------------------------------------------ */
async function EnsureStructure(req, res) {
  // Tabela de ficheiros da aula
  try {
    await ExecuteQuery(
      res,
      `
      CREATE TABLE IF NOT EXISTS eduall_lessons_files (
        id INT PRIMARY KEY AUTO_INCREMENT,
        lesson_code VARCHAR(200) NOT NULL,
        file_url TEXT NOT NULL,
        file_public_id VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      [],
      false
    );
  } catch (err) {
    console.log("Erro ao criar tabela eduall_lessons_files (ignorado):", err.message);
  }

  const alters = [
    `ALTER TABLE eduall_lessons_content 
      ADD COLUMN IF NOT EXISTS ed_lesson_content_instituteCode VARCHAR(200) NULL`,
    `ALTER TABLE eduall_lessons_content 
      ADD COLUMN IF NOT EXISTS ed_lesson_subtitle VARCHAR(255) NULL`,
    `ALTER TABLE eduall_lessons_content 
      ADD COLUMN IF NOT EXISTS ed_lesson_level INT DEFAULT 0`,
    `ALTER TABLE eduall_lessons_content 
      ADD COLUMN IF NOT EXISTS ed_lesson_datetime DATETIME NULL`,
    `ALTER TABLE eduall_lessons_content 
      ADD COLUMN IF NOT EXISTS ed_lesson_video_url TEXT NULL`,
    `ALTER TABLE eduall_lessons_content 
      ADD COLUMN IF NOT EXISTS ed_lesson_video_poster TEXT NULL`
  ];

  for (const sql of alters) {
    try {
      await ExecuteQuery(res, sql, [], false);
    } catch (err) {
      // Se a coluna já existir em algumas versões de MySQL, pode dar erro — ignoramos
      console.log("ALTER ignorado:", err.message);
    }
  }
}

/* -----------------------------------------------------------
   1) LISTAR A ÁRVORE
------------------------------------------------------------ */
const GetFullLessonTree = async (req, res) => {
  try {
    await EnsureStructure(req, res);

    const { CODE } = req.params;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const chapters = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_lessons_content
       WHERE ed_lesson_content_instituteCode=?
       AND ed_lesson_parent_type='none'
       AND ed_lesson_parent_code=?
       AND ed_lesson_content_deleted=0
       ORDER BY ed_lesson_content_position ASC`,
      [instituteCode, CODE],
      true,
      q("eduall_lessons_content", "select", req)
    );

    const sections = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_lessons_content
       WHERE ed_lesson_content_instituteCode=?
       AND ed_lesson_parent_type='chapter'
       AND ed_lesson_parent_code IN (
         SELECT ed_lesson_content_code FROM eduall_lessons_content
         WHERE ed_lesson_content_instituteCode=?
         AND ed_lesson_parent_type='none'
         AND ed_lesson_parent_code=?
       )
       AND ed_lesson_content_deleted=0
       ORDER BY ed_lesson_content_position ASC`,
      [instituteCode, instituteCode, CODE],
      true,
      q("eduall_lessons_content", "select", req)
    );

    const lessons = await ExecuteQuery(
      res,
      `SELECT * FROM eduall_lessons_content
       WHERE ed_lesson_content_instituteCode=?
       AND ed_lesson_parent_type='section'
       AND ed_lesson_content_deleted=0
       ORDER BY ed_lesson_content_position ASC`,
      [instituteCode],
      true,
      q("eduall_lessons_content", "select", req)
    );

    res.json({ chapters, sections, lessons });
  } catch (err) {
    console.log(err)
    res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------------------------
   2) REGISTAR CAPÍTULO / SECÇÃO / AULA
   (inclui subtítulo, nível, data/hora, vídeo)
------------------------------------------------------------ */
const RegisterLessonContent = async (req, res) => {
  try {
    await EnsureStructure(req, res);

    const io = req.app.get("io");

    const {
      lesson_code,
      lesson_title,
      lesson_description,
      lesson_subtitle,
      lesson_level,
      lesson_datetime,
      lesson_video_source,
      lesson_video_poster,
      parent_type,
      parent_code
    } = req.body;

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    const pos = await ExecuteQuery(
      res,
      `SELECT COALESCE(MAX(ed_lesson_content_position),0)+1 AS pos
       FROM eduall_lessons_content
       WHERE ed_lesson_parent_type=? 
       AND ed_lesson_parent_code=?
       AND ed_lesson_content_instituteCode=?`,
      [parent_type, parent_code, instituteCode],
      true,
      q("eduall_lessons_content", "select", req)
    );

    const nextPos = pos[0].pos;

    await ExecuteQuery(
      res,
      `INSERT INTO eduall_lessons_content (
        ed_lesson_content_code,
        ed_lesson_content_title,
        ed_lesson_content_description,
        ed_lesson_parent_type,
        ed_lesson_parent_code,
        ed_lesson_content_position,
        ed_lesson_content_instituteCode,
        ed_lesson_subtitle,
        ed_lesson_level,
        ed_lesson_datetime,
        ed_lesson_video_url,
        ed_lesson_video_poster
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        lesson_code,
        lesson_title,
        lesson_description,
        parent_type,
        parent_code,
        nextPos,
        instituteCode,
        lesson_subtitle || null,
        lesson_level || 0,
        lesson_datetime || null,
        lesson_video_source || null,
        lesson_video_poster || null
      ],
      false,
      q("eduall_lessons_content", "insert", req)
    );

    await RegisterAuditAction({
      session: req.session,
      action: 1,
      form: "Conteúdo das Aulas",
      description: `Criou novo conteúdo (${lesson_title}) no parent ${parent_code}, instituto ${instituteCode}`
    });

    io.emit("lesson_content_created");

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};
 
/* -----------------------------------------------------------
   4) DELETE (LÓGICO)
------------------------------------------------------------ */
const DeleteLessonContent = async (req, res) => {
  try {
    await EnsureStructure(req, res);

    const io = req.app.get("io");
    const { ID } = req.params;

    await ExecuteQuery(
      res,
      `UPDATE eduall_lessons_content
       SET ed_lesson_content_deleted = 1
       WHERE ed_lesson_content_id = ?`,
      [ID],
      false,
      q("eduall_lessons_content", "delete", req)
    );

    await RegisterAuditAction({
      session: req.session,
      action: 3,
      form: "Conteúdo das Aulas",
      description: `Eliminou conteúdo ID ${ID}`
    });

    io.emit("lesson_content_deleted", { id: ID });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------------------------
   5) MOVER ENTRE PARENT TYPES
------------------------------------------------------------ */
const MoveLessonContent = async (req, res) => {
  try {
    await EnsureStructure(req, res);

    const io = req.app.get("io");
    const { ID } = req.params;
    const { new_parent_type, new_parent_code } = req.body;

    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    await ExecuteQuery(
      res,
      `UPDATE eduall_lessons_content
       SET ed_lesson_content_position = ed_lesson_content_position - 1
       WHERE ed_lesson_content_position > (
         SELECT pos FROM (
           SELECT ed_lesson_content_position AS pos
           FROM eduall_lessons_content 
           WHERE ed_lesson_content_id=? AND ed_lesson_content_instituteCode=?
         ) AS tmp
       )
       AND ed_lesson_parent_type = (
         SELECT t FROM (
           SELECT ed_lesson_parent_type AS t
           FROM eduall_lessons_content WHERE ed_lesson_content_id=? AND ed_lesson_content_instituteCode=?
         ) AS tmp
       )
       AND ed_lesson_parent_code = (
         SELECT c FROM (
           SELECT ed_lesson_parent_code AS c
           FROM eduall_lessons_content WHERE ed_lesson_content_id=? AND ed_lesson_content_instituteCode=?
         ) AS tmp
       )
       AND ed_lesson_content_instituteCode=?`,
      [ID, instituteCode, ID, instituteCode, ID, instituteCode, instituteCode],
      false,
      q("eduall_lessons_content", "update", req)
    );

    const pos = await ExecuteQuery(
      res,
      `SELECT COALESCE(MAX(ed_lesson_content_position),0)+1 AS pos
       FROM eduall_lessons_content
       WHERE ed_lesson_content_instituteCode=?
       AND ed_lesson_parent_type=? 
       AND ed_lesson_parent_code=?`,
      [instituteCode, new_parent_type, new_parent_code],
      true,
      q("eduall_lessons_content", "select", req)
    );

    const nextPos = pos[0].pos;

    await ExecuteQuery(
      res,
      `UPDATE eduall_lessons_content
       SET ed_lesson_parent_type=?, 
           ed_lesson_parent_code=?, 
           ed_lesson_content_position=?,
           ed_lesson_content_instituteCode=?
       WHERE ed_lesson_content_id=?`,
      [new_parent_type, new_parent_code, nextPos, instituteCode, ID],
      false,
      q("eduall_lessons_content", "update", req)
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Conteúdo das Aulas",
      description: `Moveu conteúdo ID ${ID} para ${new_parent_type} (${new_parent_code}), Instituto ${instituteCode}`
    });

    io.emit("lesson_content_moved");

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------------------------
   6) REORDENAR
------------------------------------------------------------ */
const ReorderLessonContent = async (req, res) => {
  try {
    await EnsureStructure(req, res);

    const io = req.app.get("io");
    const { parent_type, parent_code } = req.params;
    const { items } = req.body;
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;

    for (const item of items) {
      await ExecuteQuery(
        res,
        `UPDATE eduall_lessons_content
         SET ed_lesson_content_position=?,
             ed_lesson_content_instituteCode=?
         WHERE ed_lesson_content_id=?`,
        [item.position, instituteCode, item.id],
        false,
        q("eduall_lessons_content", "update", req)
      );
    }

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Conteúdo das Aulas",
      description: `Reordenou conteúdo no parent ${parent_code} Instituto ${instituteCode}`
    });

    io.emit("lesson_content_reordered", { parent_code });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/* -----------------------------------------------------------
   7) REGISTAR FICHEIROS DA AULA NA NOVA TABELA
   Rota sugerida: POST /eduallfilesregister/post
   Body:
     {
       "lesson_code": "...",
       "files": [
         { "url": "https://...", "public_id": "cloudinary-id" },
         ...
       ]
     }
------------------------------------------------------------ */
const RegisterLessonFiles = async (req, res) => {
  try {
    await EnsureStructure(req, res);

    const { lesson_code } = req.body;
    const files = req.files; // agora vêm do multer

    if (!lesson_code) {
      return res.status(400).json({ error: "lesson_code é obrigatório" });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "Nenhum ficheiro enviado." });
    }

    const uploadedFiles = [];

    // Upload de cada ficheiro
    for (const file of files) {
      const uploadResult = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          {
            resource_type: "auto",
            folder: "lesson_files",
          },
          (err, result) => {
            if (err) return reject(err);
            resolve(result);
          }
        ).end(file.buffer);
      });

      uploadedFiles.push(uploadResult);

      // salvar no DB
      await ExecuteQuery(
        res,
        `
        INSERT INTO eduall_lessons_files (lesson_code, file_url, file_public_id)
        VALUES (?, ?, ?)
        `,
        [lesson_code, uploadResult.secure_url, uploadResult.public_id],
        false,
        q("eduall_lessons_files", "insert", req)
      );
    }

    res.json({
      success: true,
      saved: uploadedFiles.length,
      files: uploadedFiles.map((f) => ({
        url: f.secure_url,
        public_id: f.public_id,
      })),
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};


/* -----------------------------------------------------------
   8) UPLOADS (mantidos como estão — locais)
   Se quiser, pode depois migrar isto para Cloudinary.
------------------------------------------------------------ */
const videoStorage = multer.diskStorage({
  destination: path.join(__dirname, "../assets/videos/lessonvideos"),
  filename: (req, file, cb) => {
    cb(
      null,
      "v_" + Date.now() + "_" + Math.random() + path.extname(file.originalname)
    );
  },
});

const posterStorage = multer.diskStorage({
  destination: path.join(__dirname, "../assets/images/lessonvideoposters"),
  filename: (req, file, cb) => {
    cb(
      null,
      "p_" + Date.now() + "_" + Math.random() + path.extname(file.originalname)
    );
  },
});
 
/* -----------------------------------------------------------
   9) MARCAR AULA COMO DADA / NÃO DADA
------------------------------------------------------------ */
const MarkLessonContentDone = async (req, res) => {
  try {
    await EnsureStructure(req, res);

    const io = req.app.get("io");
    const { ID } = req.params;
    const { done } = req.body;  // 1 ou 0

    await ExecuteQuery(
      res,
      `UPDATE eduall_lessons_content
       SET ed_lesson_content_done=?
       WHERE ed_lesson_content_id=?`,
      [done, ID],
      false,
      q("eduall_lessons_content", "update", req)
    );

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Conteúdo das Aulas",
      description: `Aula ${ID} marcada como ${done ? "dada" : "não dada"}`
    });

    io.emit("lesson_content_updated", { id: ID });

    res.json({ success: true, id: ID, done });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


/* -----------------------------------------------------------
   UPLOAD DE VÍDEO PARA CLOUDINARY (MAX 250MB) 
------------------------------------------------------------ */
const UploadLessonVideo = (req, res) => {
  videoUpload.single("video_file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "O vídeo excede 250MB."
        });
      }
      console.log(err);
      return res.status(500).json({ error: "Erro no upload do vídeo." });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Nenhum ficheiro de vídeo enviado."
      });
    }

    const allowedVideoTypes = ["video/mp4", "video/mov", "video/webm", "video/mkv"];
    if (!allowedVideoTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: "Tipo de vídeo inválido. Use MP4, MOV, WEBM ou MKV."
      });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "video",
        folder: "lesson_videos",
        chunk_size: 6000000,
        eager_async: true
      },
      (error, result) => {
        if (error) {
          console.log(error);
          return res.status(500).json({
            error: "Erro ao enviar vídeo para o Cloudinary."
          });
        }

        return res.json({
          success: true,
          url: result.secure_url,
          public_id: result.public_id,
          duration: result.duration,
          bytes: result.bytes
        });
      }
    );

    uploadStream.end(Buffer.from(req.file.buffer));
  });
};


/* -----------------------------------------------------------
   UPLOAD DE POSTER (IMAGEM) PARA CLOUDINARY 
------------------------------------------------------------ */
const UploadLessonVideoPoster = (req, res) => {
  filesUpload.single("poster_file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          error: "A imagem do poster excede 15MB."
        });
      }
      console.log(err);
      return res.status(500).json({ error: "Erro no upload do poster." });
    }

    if (!req.file) {
      return res.status(400).json({
        error: "Nenhum ficheiro de poster enviado."
      });
    }

    // Validar imagem
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({
        error: "O poster deve ser uma imagem (JPG, PNG, WEBP)."
      });
    }

    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "lesson_posters",
        transformation: [
          { quality: "auto" },
          { fetch_format: "auto" }
        ]
      },
      (error, result) => {
        if (error) {
          console.log(error);
          return res.status(500).json({
            error: "Erro ao enviar poster para o Cloudinary."
          });
        }

        return res.json({
          success: true,
          url: result.secure_url,
          public_id: result.public_id,
          bytes: result.bytes
        });
      }
    );

    uploadStream.end(Buffer.from(req.file.buffer));
  });
};


 

// -----------------------------------------------------
// PUT: Atualizar conteúdo da aula 
// -----------------------------------------------------
const UpdateLessonContent = async (req, res) => {
  try {
    const io = req.app.get("io");
    const { ID } = req.params;

    const {
      lesson_title,
      lesson_description,
      lesson_subtitle,
      lesson_level,
      lesson_datetime,
      lesson_section,
      lesson_class,
      lesson_video_source,    // URL já vinda do Cloudinary
      lesson_video_poster     // URL já vinda do Cloudinary
    } = req.body;

    const instituteCode =
      req.session?.user?.eduall_user_session_curentinstitute || null;

    await ExecuteQuery(
      res,
      `
      UPDATE eduall_lessons_content
      SET 
        ed_lesson_content_title         = ?,
        ed_lesson_content_description   = ?,
        ed_lesson_content_subtitle      = ?,
        ed_lesson_content_level         = ?,
        ed_lesson_content_datetime      = ?,
        ed_lesson_content_section       = ?,
        ed_lesson_content_class         = ?,
        ed_lesson_content_instituteCode = ?,

        -- 🚀 usa as colunas reais agora:
        ed_lesson_video_url             = COALESCE(?, ed_lesson_video_url),
        ed_lesson_video_poster          = COALESCE(?, ed_lesson_video_poster)

      WHERE ed_lesson_content_id = ?
      `,
      [
        lesson_title,
        lesson_description,
        lesson_subtitle,
        lesson_level,
        lesson_datetime,
        lesson_section,
        lesson_class,
        instituteCode,

        lesson_video_source,      // se não vier, mantém o valor antigo
        lesson_video_poster,

        ID
      ],
      false
    );

    io.emit("lesson_content_updated", { id: ID });

    res.json({
      success: true,
      updated_video: !!lesson_video_source,
      updated_poster: !!lesson_video_poster
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
};




// -----------------------------------------------------
// GET: Obter aula por ID
// GET /edualllessoncontent/get/:ID
// -----------------------------------------------------
const GetLessonContentById = async (req, res) => {
  try {
    const { ID } = req.params;

    const data = await ExecuteQuery(
      res,
      `
      SELECT * FROM eduall_lessons_content
      WHERE ed_lesson_content_id = ?
        AND ed_lesson_content_deleted = 0
      `,
      [ID],
      true,
      q("eduall_lessons_content", "select", req)
    );

    res.json(data[0] || null);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  GetFullLessonTree,
  RegisterLessonContent,
  UpdateLessonContent,
  DeleteLessonContent,
  MoveLessonContent,
  ReorderLessonContent,
  UploadLessonVideo,
  GetLessonContentById,
  UploadLessonVideoPoster,
  MarkLessonContentDone,
  RegisterLessonFiles
};
