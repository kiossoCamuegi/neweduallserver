const express    = require("express");
const multer     = require("multer");
const path       = require("path");
const fs         = require("fs");
const fsPromises = require("fs").promises;  // ← NOVO: fs.promises para async
const cloudinary = require("cloudinary").v2;
const ExecuteQuery            = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");  
 
 
cloudinary.config({
  cloud_name: "dqkcchd89",
  api_key:    "12567722655778",
  api_secret: "Pxq8c897Qzy-DZIegIDA20Ucwqc",
});

// ── Garantir pasta 'images/referrals' (async, não bloqueia) ──────────────────
let referralsInitialized = false;
const ensureReferralsDir = async () => {
  if (referralsInitialized) return;
  try {
    await fsPromises.stat("images/referrals");
    referralsInitialized = true;
  } catch {
    try {
      await fsPromises.mkdir("images/referrals", { recursive: true });
      referralsInitialized = true;
    } catch (err) {
      console.warn('⚠️ Erro ao criar images/referrals:', err.message);
    }
  }
};

ensureReferralsDir().catch(err => console.error('Erro inicializar referrals:', err));

// ── Multer — pasta temporária ──────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: "images/referrals",
  filename: (req, file, cb) =>
    cb(null, `eduall_referral_${file.fieldname}_${Date.now()}_${Math.random().toString(36).slice(2)}${path.extname(file.originalname)}`),
});

const uploadReferralImages = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/"))
      return cb(new Error("Apenas imagens são permitidas."));
    cb(null, true);
  },
}).array("images", 6);

 
const calcEstimatedCommission = (size) => {
  const map = { small: 70000, medium: 120000, large: 180000, xlarge: 230000 };
  return map[size] ?? 70000;
};

const validateReferralBody = (body) => {
  const errors = [];
  if (!body.referrer_name?.trim())     errors.push("Nome do indicador é obrigatório.");
  if (!body.referrer_phone?.trim())    errors.push("Telefone do indicador é obrigatório.");
  if (body.referrer_email && !/\S+@\S+\.\S+/.test(body.referrer_email))
                                       errors.push("Email inválido.");
  if (!body.institution_name?.trim())  errors.push("Nome da instituição é obrigatório.");
  if (!body.institution_type?.trim())  errors.push("Tipo de instituição é obrigatório.");
  if (!body.institution_level?.trim()) errors.push("Nível de ensino é obrigatório.");
  if (!body.institution_size?.trim())  errors.push("Tamanho da instituição é obrigatório.");
  if (!body.institution_state?.trim()) errors.push("Província/Cidade é obrigatória.");
  if (!body.meeting_date?.trim())      errors.push("Data da apresentação é obrigatória.");
  if (!body.meeting_time?.trim())      errors.push("Horário da apresentação é obrigatório.");
  return errors;
};

 
const RegisterReferral = (req, res) => {
  uploadReferralImages(req, res, async (uploadErr) => {
    if (uploadErr)
      return res.status(400).json({ success: false, message: uploadErr.message });

    const {
      referrer_name, referrer_phone, referrer_email,
      institution_name, institution_type, institution_level,
      institution_size, institution_public, institution_state,
      institution_contact, meeting_date, meeting_time, will_attend,
    } = req.body;

    const errors = validateReferralBody(req.body);
    if (errors.length > 0)
      return res.status(422).json({ success: false, errors });

    try {
      // Verificar duplicata activa
      const checkQuery = `
        SELECT ed_referral_id FROM eduall_referrals
        WHERE ed_referral_referrer_phone = ?
          AND ed_referral_institution_name = ?
          AND ed_referral_status NOT IN ('rejected', 'cancelled')
        LIMIT 1
      `;
      const exists = await ExecuteQuery(res, checkQuery,
        [referrer_phone.trim(), institution_name.trim()], true);

      if (exists.length > 0)
        return res.status(409).json({
          success: false,
          message: "Já existe uma recomendação activa para esta instituição com este contacto.",
        });

      // Upload Cloudinary
      const imageUrls = [];
      if (req.files?.length) {
        for (const file of req.files) {
          try {
            const result = await cloudinary.uploader.upload(file.path, {
              folder: "eduall_referrals",
            });
            imageUrls.push(result.secure_url);
          } catch (e) {
            console.warn("Cloudinary upload falhou:", file.path, e.message);
          } finally {
            fs.unlink(file.path, () => {});
          }
        }
      }

      const estimated_commission = calcEstimatedCommission(institution_size?.trim());

      const insertQuery = `
        INSERT INTO eduall_referrals (
          ed_referral_referrer_name,    ed_referral_referrer_phone,
          ed_referral_referrer_email,   ed_referral_institution_name,
          ed_referral_institution_type, ed_referral_institution_level,
          ed_referral_institution_size, ed_referral_institution_public,
          ed_referral_institution_state,ed_referral_institution_contact,
          ed_referral_meeting_date,     ed_referral_meeting_time,
          ed_referral_will_attend,      ed_referral_images,
          ed_referral_estimated_commission, ed_referral_status, ed_referral_created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending',NOW())
      `;

      const params = [
        referrer_name.trim(),
        referrer_phone.trim(),
        referrer_email?.trim() || null,
        institution_name.trim(),
        institution_type.trim(),
        institution_level.trim(),
        institution_size.trim(),
        institution_public?.trim() || null,
        institution_state.trim(),
        institution_contact?.trim() || null,
        meeting_date.trim(),
        meeting_time.trim(),
        will_attend === "true" || will_attend === true ? 1 : 0,
        JSON.stringify(imageUrls),
        estimated_commission,
      ];

      await ExecuteQuery(res, insertQuery, params, false, {
        db: "eduall_referrals", type: "insert", data: req,
      });

      await RegisterAuditAction({
        session: req.session,
        action: 1,
        form: "Programa de Recomendação",
        description: `Nova recomendação registada: ${institution_name} — indicado por ${referrer_name}`,
      });

      return res.status(201).json({
        success: true,
        message: "Recomendação registada com sucesso!",
        data: { referrer_name, institution_name, meeting_date, meeting_time, estimated_commission, images_uploaded: imageUrls.length },
      });

    } catch (error) {
      console.error("Referral register error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Lamentamos, não foi possível executar esta acção!",
        error: error.message,
      });
    }
  });
};

 
const GetAllReferrals = async (req, res) => {
  try {
    const query = `SELECT * FROM eduall_referrals ORDER BY ed_referral_created_at DESC`;
    const result = await ExecuteQuery(res, query, [], true, {
      db: "eduall_referrals", type: "select", data: req,
    });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Falha ao buscar recomendações!", error: error.message });
  }
};

 
const GetSingleReferral = async (req, res) => {
  try {
    const query = `SELECT * FROM eduall_referrals WHERE ed_referral_id = ? LIMIT 1`;
    const result = await ExecuteQuery(res, query, [req.params.ID], true, {
      db: "eduall_referrals", type: "select", data: req,
    });
    if (!result.length)
      return res.status(404).json({ success: false, message: "Recomendação não encontrada." });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: "Falha ao buscar a recomendação!", error: error.message });
  }
};


 
const UpdateReferralStatus = async (req, res) => {
  const { status } = req.body;
  const VALID = ["pending", "approved", "rejected", "paid", "cancelled"];
  if (!VALID.includes(status))
    return res.status(400).json({ success: false, message: "Status inválido." });

  try {
    const query = `
      UPDATE eduall_referrals
      SET ed_referral_status = ?, ed_referral_updated_at = NOW()
      WHERE ed_referral_id = ?
    `;
    await ExecuteQuery(res, query, [status, req.params.ID], false, {
      db: "eduall_referrals", type: "update", data: req,
    });

    await RegisterAuditAction({
      session: req.session,
      action: 2,
      form: "Programa de Recomendação",
      description: `Status da recomendação #${req.params.ID} alterado para "${status}"`,
    });

    return res.status(200).json({ success: true, message: `Status actualizado para "${status}" com sucesso.` });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lamentamos, não foi possível executar esta acção!", error: error.message });
  }
};


 
const DeleteReferral = async (req, res) => {
  try {
    const query = `
      UPDATE eduall_referrals
      SET ed_referral_status = 'cancelled', ed_referral_updated_at = NOW()
      WHERE ed_referral_id = ?
    `;
    await ExecuteQuery(res, query, [req.params.ID], false, {
      db: "eduall_referrals", type: "update", data: req,
    });
    return res.status(200).json({ success: true, message: "Recomendação cancelada com sucesso." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Lamentamos, não foi possível executar esta acção!", error: error.message });
  }
};


 
module.exports = { 
  RegisterReferral,
  GetAllReferrals,
  GetSingleReferral,
  UpdateReferralStatus,
  DeleteReferral,
};