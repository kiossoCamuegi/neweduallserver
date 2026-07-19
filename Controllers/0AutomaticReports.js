 'use strict';

const express  = require("express");
const cron     = require("node-cron");
const moment   = require("moment");
const axios    = require("axios");
const nodemailer = require("nodemailer");

// ─── Cloudinary ───────────────────────────────────────────────────────────────
const cloudinary = require("cloudinary").v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME || "",
  api_key:    process.env.CLOUDINARY_KEY  || "",
  api_secret: process.env.CLOUDINARY_SECRET || "",
});

const ExecuteQuery          = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

moment.locale("pt");

// ═══════════════════════════════════════════════════════════════════════════════
//  GLOBAL SAFETY NET
//  Impede que um UnhandledRejection derrube o processo inteiro
//  (era o crash do ENOTFOUND que via nos logs)
// ═══════════════════════════════════════════════════════════════════════════════
process.on("unhandledRejection", (reason) => {
  const msg = reason?.message || String(reason || "");
  // Suprime erros de rede esperados no cron (DB offline, DNS falha)
  const networkNoise = ["ENOTFOUND","EADDRNOTAVAIL","ECONNREFUSED","ETIMEDOUT","ECONNRESET"];
  if (networkNoise.some(c => msg.includes(c))) return;
  console.error("[AutoReports] UnhandledRejection:", msg);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════
function sTrim(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randCode(len = 40) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function safeJsonParse(str, fallback = null) {
  try {
    if (!str) return fallback;
    return typeof str === "string" ? JSON.parse(str) : str;
  } catch { return fallback; }
}

function truncate(s, max = 5000) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function fmtDT(dt) {
  return moment(dt).format("DD [de] MMMM [de] YYYY [às] HH:mm");
}

function normalizePhoneAO(phone) {
  const p = String(phone || "").replace(/\s+/g, "").replace(/[^\d]/g, "");
  if (/^9\d{8}$/.test(p)) return p;
  if (/^2449\d{8}$/.test(p)) return p.slice(3);
  const raw = String(phone || "").replace(/\s+/g, "");
  if (/^\+2449\d{8}$/.test(raw)) return raw.slice(4);
  return null;
}

function computeHost(req) {
  const proto = (req.headers["x-forwarded-proto"] || req.protocol || "http").toString().split(",")[0].trim();
  const host  = (req.headers["x-forwarded-host"] || req.get("host") || "").toString().split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

class AppError extends Error {
  constructor(code, userMessage, details = null) {
    super(userMessage);
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.details = details;
  }
}

// ─── Gemini ───────────────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// ─── Playwright ───────────────────────────────────────────────────────────────
let playwright = null;
try { playwright = require("playwright"); } catch (_) { playwright = null; }

// ─── Branding ─────────────────────────────────────────────────────────────────
const BRAND = {
  name:           "Eduall",
  website:        "www.eduall.ao",
  main:           "#1e3a5f",
  accent:         "#2563eb",
  green:          "#166534",
  greenLight:     "#dcfce7",
  red:            "#991b1b",
  redLight:       "#fee2e2",
  yellow:         "#92400e",
  yellowLight:    "#fef3c7",
  gray:           "#64748b",
  line:           "#e2e8f0",
  soft:           "#f8fafc",
  logoFallback:   "https://ik.imagekit.io/zks5iegia/eduall-logo%20(2).png",
  avatarFallback: "https://ik.imagekit.io/zks5iegia/default-avatar-icon-of-social-media-user-vector.jpg",
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SQL TABLES
// ═══════════════════════════════════════════════════════════════════════════════
const SQL_REPORTS = `
CREATE TABLE IF NOT EXISTS eduall_automatic_reports (
  ed_auto_report_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_auto_report_code           VARCHAR(80) NOT NULL,
  ed_auto_report_institute_code VARCHAR(120) NOT NULL,
  ed_auto_report_target_type    ENUM('student','guardian','employee','custom') NOT NULL DEFAULT 'student',
  ed_auto_report_target_id      BIGINT NULL,
  ed_auto_report_target_name    VARCHAR(200) NULL,
  ed_auto_report_email          VARCHAR(180) NULL,
  ed_auto_report_phone          VARCHAR(40) NULL,
  ed_auto_report_whatsapp       VARCHAR(40) NULL,
  ed_auto_report_send_sms       TINYINT(1) NOT NULL DEFAULT 0,
  ed_auto_report_send_email     TINYINT(1) NOT NULL DEFAULT 0,
  ed_auto_report_send_whatsapp  TINYINT(1) NOT NULL DEFAULT 0,
  ed_auto_report_type           VARCHAR(80) NOT NULL,
  ed_auto_report_payload        JSON NULL,
  ed_auto_report_description    TEXT NULL,
  ed_auto_report_schedule_type  ENUM('once','recurring') NOT NULL DEFAULT 'once',
  ed_auto_report_scheduled_at   DATETIME NULL,
  ed_auto_report_cron_expr      VARCHAR(100) NULL,
  ed_auto_report_timezone       VARCHAR(60) NULL DEFAULT 'Africa/Luanda',
  ed_auto_report_status         ENUM('active','paused','cancelled') NOT NULL DEFAULT 'active',
  ed_auto_report_last_run_at    DATETIME NULL,
  ed_auto_report_last_result    ENUM('ok','fail','none') NOT NULL DEFAULT 'none',
  ed_auto_report_last_error_code     VARCHAR(80) NULL,
  ed_auto_report_last_error_user_msg VARCHAR(600) NULL,
  ed_auto_report_last_error_at       DATETIME NULL,
  ed_auto_report_lock_until     DATETIME NULL,
  ed_auto_report_locked_by      VARCHAR(80) NULL,
  ed_auto_report_created_by     BIGINT NULL,
  ed_auto_report_created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_auto_report_updated_at     DATETIME NULL,
  ed_auto_report_deleted        TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uq_auto_report_code (ed_auto_report_code),
  INDEX idx_auto_report_inst   (ed_auto_report_institute_code),
  INDEX idx_auto_report_status (ed_auto_report_status, ed_auto_report_deleted),
  INDEX idx_auto_report_sched  (ed_auto_report_schedule_type, ed_auto_report_scheduled_at),
  INDEX idx_auto_report_lock   (ed_auto_report_lock_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

const SQL_LOGS = `
CREATE TABLE IF NOT EXISTS eduall_automatic_reports_logs (
  ed_auto_log_id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_auto_log_institute_code VARCHAR(120) NOT NULL,
  ed_auto_log_report_code   VARCHAR(80) NOT NULL,
  ed_auto_log_report_id     BIGINT NOT NULL,
  ed_auto_log_sent_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ed_auto_log_channel       ENUM('sms','email','whatsapp','pdf','system') NOT NULL,
  ed_auto_log_to            VARCHAR(200) NULL,
  ed_auto_log_status        ENUM('ok','fail') NOT NULL,
  ed_auto_log_error_code    VARCHAR(80) NULL,
  ed_auto_log_error_tech    TEXT NULL,
  ed_auto_log_error_user_msg VARCHAR(600) NULL,
  ed_auto_log_payload       JSON NULL,
  INDEX idx_auto_log_inst   (ed_auto_log_institute_code),
  INDEX idx_auto_log_report (ed_auto_log_report_id),
  INDEX idx_auto_log_status (ed_auto_log_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;

async function ensureTables(fakeRes, fakeReq) {
  await ExecuteQuery(fakeRes, SQL_REPORTS, [], false, { db: "eduall_automatic_reports",      type: "ddl", data: fakeReq });
  await ExecuteQuery(fakeRes, SQL_LOGS,    [], false, { db: "eduall_automatic_reports_logs", type: "ddl", data: fakeReq });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CLOUDINARY
// ═══════════════════════════════════════════════════════════════════════════════
async function uploadPdfToCloudinary(buffer, { institute_code, report_code, student_id }) {
  if (!process.env.CLOUDINARY_NAME || !process.env.CLOUDINARY_KEY || !process.env.CLOUDINARY_SECRET)
    throw new AppError("CLOUDINARY_NOT_CONFIGURED", "Cloudinary não configurado.");

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder:      `eduall/reports/${String(institute_code || "unknown")}`,
        public_id:   `student_${student_id || "x"}_${report_code || randCode(10)}`,
        resource_type: "raw",
        format:      "pdf",
        overwrite:   true,
      },
      (err, result) => {
        if (err) return reject(new AppError("CLOUDINARY_UPLOAD_FAIL", "Falha ao carregar PDF.", { err: err.message }));
        resolve({ url: result?.secure_url || result?.url || "", public_id: result?.public_id, bytes: result?.bytes });
      }
    );
    stream.end(buffer);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  QUERIES DE DADOS
// ═══════════════════════════════════════════════════════════════════════════════
async function getInstitute(res, req, institute_code) {
  const rows = await ExecuteQuery(res, `
    SELECT ed_institute_code, ed_institute_name, ed_institute_country,
           ed_institute_address, ed_institute_phone1, ed_institute_phone2,
           ed_institute_email, ed_institute_website, ed_institute_slogan,
           ed_institute_logo, ed_logo_urlcloudinary
    FROM eduall_institutes
    WHERE ed_institute_deleted = 0 AND ed_institute_code = ?
    LIMIT 1`, [institute_code], true, { db: "eduall_institutes", type: "select", data: req });
  return rows?.[0] || null;
}

async function getStudentCoreWithClass(res, req, { student_id, institute_code }) {
  const rows = await ExecuteQuery(res, `
    SELECT s.ed_student_id, s.ed_student_code, s.ed_student_name, s.ed_student_gender,
           s.ed_student_birthday, s.ed_student_picture, s.ed_student_identityCard,
           s.ed_student_nacionality, s.ed_student_address, s.ed_student_email,
           s.ed_student_class,
           c.ed_class_id, c.ed_class_title, c.ed_class_year, c.ed_class_course,
           c.ed_class_academic_level, c.ed_class_cicle, c.ed_class_room, c.ed_class_faculty,
           room.ed_classroom_title, cr.ed_course_title, y.ed_academic_year_title,
           lvl.ed_academic_level_title, cic.ed_cicle_title, fac.ed_faculty_title
    FROM eduall_students s
    LEFT JOIN eduall_class       c    ON c.ed_class_id          = s.ed_student_class            AND COALESCE(c.ed_class_deleted,0)=0
    LEFT JOIN eduall_classrooms  room ON room.ed_classroom_id   = c.ed_class_room               AND COALESCE(room.ed_classroom_deleted,0)=0
    LEFT JOIN eduall_courses      cr  ON cr.ed_course_id        = c.ed_class_course             AND COALESCE(cr.ed_course_deleted,0)=0
    LEFT JOIN eduall_academic_year y  ON y.ed_academic_year_id  = c.ed_class_year               AND COALESCE(y.ed_academic_year_deleted,0)=0
    LEFT JOIN eduall_academic_level lvl ON lvl.ed_academic_level_id = c.ed_class_academic_level AND COALESCE(lvl.ed_academic_level_deleted,0)=0
    LEFT JOIN eduall_cicles       cic ON cic.ed_cicle_id        = c.ed_class_cicle              AND COALESCE(cic.ed_cicle_deleted,0)=0
    LEFT JOIN eduall_faculty      fac ON fac.ed_faculty_id      = c.ed_class_faculty            AND COALESCE(fac.ed_faculty_deleted,0)=0
    WHERE COALESCE(s.ed_student_deleted,0) = 0
      AND s.ed_student_id = ? AND s.ed_student_institute_code = ?
    LIMIT 1`, [student_id, institute_code], true, { db: "eduall_students", type: "select", data: req });
  return rows?.[0] || null;
}

async function getStudentAttendance(res, req, { student_id, class_id, institute_code }) {
  const rows = await ExecuteQuery(res, `
    SELECT * FROM eduall_student_attendence
    LEFT JOIN eduall_students ON eduall_students.ed_student_id = eduall_student_attendence.ed_student_attd_student_code
    LEFT JOIN eduall_timing   ON eduall_timing.ed_timing_id    = eduall_student_attendence.ed_student_attd_timing
    LEFT JOIN eduall_subjects ON eduall_subjects.ed_subject_id = eduall_student_attendence.ed_student_attd_subject
    WHERE ed_student_attd_student_code = ? AND ed_student_attd_class = ? AND ed_student_attd_institute_code = ?`,
    [student_id, class_id, institute_code], true, { db: "eduall_student_attendence", type: "select", data: req });

  const total   = rows.length;
  const present = rows.filter(r => Number(r.ed_student_attd_status) === 1).length;
  const absent  = rows.filter(r => Number(r.ed_student_attd_status) === 0).length;
  const late    = rows.filter(r => Number(r.ed_student_attd_status) === 2).length;
  return { total, present, absent, late, records: rows };
}

async function getStudentBehavior(res, req, { student_id, institute_code }) {
  return ExecuteQuery(res, `
    SELECT b.*, e.ed_employee_name, u.ed_user_account_name
    FROM eduall_student_behavior b
    LEFT JOIN eduall_employees     e ON e.ed_employee_id      = b.ed_student_behavior_employeeCode
    LEFT JOIN eduall_user_accounts u ON u.ed_user_account_id  = b.ed_student_behavior_user
    WHERE b.ed_student_behavior_deleted = 0
      AND b.ed_student_behavior_Studentcode = ?
      AND b.ed_student_behavior_instituteCode = ?
    ORDER BY b.ed_student_behavior_id DESC LIMIT 120`,
    [student_id, institute_code], true, { db: "eduall_student_behavior", type: "select", data: req });
}

async function getStudentSuspensions(res, req, { student_id, institute_code }) {
  return ExecuteQuery(res, `
    SELECT * FROM eduall_suspensions
    WHERE ed_susp_deleted = 0 AND ed_susp_student_id = ? AND ed_susp_institute_code = ?
    ORDER BY ed_susp_created_at DESC LIMIT 100`,
    [student_id, institute_code], true, { db: "eduall_suspensions", type: "select", data: req });
}

async function getStudentRfidLogs(res, req, { student_id, institute_code }) {
  return ExecuteQuery(res, `
    SELECT * FROM eduall_rfid_logs
    WHERE ed_rfidlog_institute_code = ? AND ed_rfidlog_type = 'student' AND ed_rfidlog_student_id = ?
    ORDER BY ed_rfidlog_timestamp DESC LIMIT 80`,
    [institute_code, student_id], true, { db: "eduall_rfid_logs", type: "select", data: req });
}

async function getStudentSemesterNotes(res, req, { student_id, class_id, semester, institute_code }) {
  const classRows = await ExecuteQuery(res,
    `SELECT ed_class_subjects FROM eduall_class WHERE ed_class_id = ? AND ed_class_deleted = 0 LIMIT 1`,
    [class_id], true, { db: "eduall_class", type: "select", data: req });

  const raw = classRows?.[0]?.ed_class_subjects || "";
  const subjectIds = raw.split(",").map(x => Number(String(x).trim())).filter(x => x > 0);
  if (!subjectIds.length) return [];

  const [subjects, notes] = await Promise.all([
    ExecuteQuery(res, `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_deleted = 0 AND ed_subject_id IN (${subjectIds.join(",")})`, [], true, { db: "eduall_subjects", type: "select", data: req }),
    ExecuteQuery(res, `SELECT * FROM eduall_semester_notes WHERE ed_semester_note_studentcode = ? AND ed_semester_note_class = ? AND (ed_semester_note_semester = ? OR ed_semester_note_semester = 0) AND (ed_semester_note_institute_code = ? OR ed_semester_note_institute_code = 1) AND ed_semester_note_deleted = 0`,
      [student_id, class_id, Number(semester || 0), institute_code], true, { db: "eduall_semester_notes", type: "select", data: req }),
  ]);

  return subjects.map(sub => {
    const n   = notes.find(x => Number(x.ed_semester_note_subject) === Number(sub.ed_subject_id));
    const p1  = n ? Number(n.ed_semester_note_p1)   || 0 : 0;
    const p2  = n ? Number(n.ed_semester_note_p2)   || 0 : 0;
    const exam= n ? Number(n.ed_semester_note_exam) || 0 : 0;
    const special = n ? Number(n.ed_semester_note_specialexam) || 0 : 0;
    const md  = (p1 + p2) / 2;
    const final = md > 13 ? md : exam > 0 ? Math.round((md + exam) / 2) : special > 0 ? special : md;
    return { subject_id: sub.ed_subject_id, subject_name: sub.ed_subject_title, p1, p2, exam, specialexam: special, md: Math.round(md * 100) / 100, final, status: Number(final) >= 10 ? "Aprovado" : "Reprovado" };
  });
}

async function getStudentQuarterNotes(res, req, { student_id, class_id, institute_code }) {
  const classRes = await ExecuteQuery(res,
    `SELECT ed_class_subjects FROM eduall_class WHERE ed_class_id = ? AND ed_class_deleted = 0 LIMIT 1`,
    [class_id], true, { db: "eduall_class", type: "select", data: req });

  const rawSubs = classRes?.[0]?.ed_class_subjects || "";
  const subjectIds = rawSubs.split(",").map(x => Number(String(x).trim())).filter(x => x > 0);
  const subMap = new Map();

  if (subjectIds.length) {
    const subs = await ExecuteQuery(res, `SELECT ed_subject_id, ed_subject_title FROM eduall_subjects WHERE ed_subject_id IN (${subjectIds.map(() => "?").join(",")}) AND ed_subject_deleted = 0`,
      subjectIds, true, { db: "eduall_subjects", type: "select", data: req });
    subs.forEach(s => subMap.set(s.ed_subject_id, s.ed_subject_title));
  }

  const results = {};
  for (const qrt of [1, 2, 3]) {
    let rows = [];
    if (subjectIds.length) {
      rows = await ExecuteQuery(res, `
        SELECT q.* FROM eduall_quarterly_notes q
        WHERE q.ed_quarter_note_deleted = 0 AND q.ed_quarter_note_institute_code = ?
          AND q.ed_quarter_note_class = ? AND q.ed_quarter_note_studentcode = ?
          AND q.ed_quarter_note_quarter = ?
          AND q.ed_quarter_note_subject IN (${subjectIds.map(() => "?").join(",")})`,
        [institute_code, class_id, student_id, qrt, ...subjectIds], true, { db: "eduall_quarterly_notes", type: "select", data: req });
    }
    const bySubject = new Map();
    for (const item of rows) {
      const mac = Number(item.ed_quarter_note_mac || 0);
      const npp = Number(item.ed_quarter_note_npp || 0);
      const npt = Number(item.ed_quarter_note_npt || 0);
      const mt  = Math.round(((mac + npp + npt) / 3) * 100) / 100;
      bySubject.set(Number(item.ed_quarter_note_subject), { quarter: qrt, subject_id: Number(item.ed_quarter_note_subject), subject_name: subMap.get(Number(item.ed_quarter_note_subject)) || "", mac, npp, npt, mt, status: mt >= 10 ? "Aprovado" : "Reprovado" });
    }
    results[`quarter_${qrt}`] = subjectIds.map(sid => bySubject.get(Number(sid)) || { quarter: qrt, subject_id: Number(sid), subject_name: subMap.get(Number(sid)) || "", mac: null, npp: null, npt: null, mt: null, status: "Não lançado" });
  }

  const [exam, featured] = await Promise.all([
    ExecuteQuery(res, `SELECT n.ed_student_exam_score as exam_note, n.ed_student_exam_subject as subject_id, sub.ed_subject_title as subject_name FROM eduall_student_exam_notes n LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = n.ed_student_exam_subject AND sub.ed_subject_deleted = 0 WHERE n.ed_student_exam_deleted = 0 AND n.ed_student_exam_institute_code = ? AND n.ed_student_exam_class = ? AND n.ed_student_exam_studentCode = ? ORDER BY n.ed_student_exam_subject ASC`,
      [institute_code, class_id, student_id], true, { db: "eduall_student_exam_notes", type: "select", data: req }),
    ExecuteQuery(res, `SELECT n.ed_student_featured_note_score as featured_note, n.ed_student_featured_note_subject as subject_id, sub.ed_subject_title as subject_name FROM eduall_student_featured_notes n LEFT JOIN eduall_subjects sub ON sub.ed_subject_id = n.ed_student_featured_note_subject AND sub.ed_subject_deleted = 0 WHERE n.ed_student_featured_note_deleted = 0 AND n.ed_student_featured_note_institute_code = ? AND n.ed_student_featured_note_class = ? AND n.ed_student_featured_note_studentCode = ? ORDER BY n.ed_student_featured_note_subject ASC`,
      [institute_code, class_id, student_id], true, { db: "eduall_student_featured_notes", type: "select", data: req }),
  ]);

  return { quarters: results, exams: exam, featured };
}

function computeFeeLine(item) {
  const price       = Number(item.ed_fee_payment_price    || 0);
  const discountPct = Number(item.ed_fee_payment_discount || 0);
  const ivaPct      = Number(item.ed_fee_payment_iva      || 0);
  const fineType    = Number(item.ed_fee_payment_fineType || 0);
  const fineValue   = Number(item.ed_fee_payment_fineValue|| 0);
  const afterDiscount = price - (price * discountPct) / 100;
  const base        = ivaPct > 0 ? afterDiscount / (1 + ivaPct / 100) : afterDiscount;
  const ivaAmount   = afterDiscount - base;
  const fineAmount  = fineType === 1 ? fineValue : (base * fineValue) / 100;
  const total       = afterDiscount + fineAmount;
  return { base: r2(base), ivaAmount: r2(ivaAmount), fineAmount: r2(fineAmount), total: r2(total), afterDiscount: r2(afterDiscount) };
}
function r2(n) { return Math.round(n * 100) / 100; }

async function getStudentFeePayments(res, req, { student_id, institute_code }) {
  const rows = await ExecuteQuery(res, `
    SELECT fp.*, s.ed_student_name, s.ed_student_code, s.ed_student_picture,
           sv.ed_service_title, c.ed_coin_code,
           (SELECT JSON_ARRAYAGG(JSON_OBJECT('id',ex.ed_fee_additional_id,'description',ex.description,'amount',ex.amount,'created_at',ex.created_at))
            FROM eduall_fee_additional_items ex
            WHERE ex.invoice_code = fp.ed_fee_payment_invoiceCode AND ex.institute_code = fp.ed_fee_payment_institute_code AND COALESCE(ex.ed_fee_additional_deleted,0)=0) AS extras
    FROM eduall_fees_payments fp
    LEFT JOIN eduall_students s  ON fp.ed_fee_payment_student  = s.ed_student_id AND s.ed_student_deleted = 0
    LEFT JOIN eduall_services sv ON fp.ed_fee_payment_service  = sv.ed_service_id AND sv.ed_service_deleted = 0
    LEFT JOIN eduall_coins c     ON c.ed_coin_institute_code   = ?
    WHERE fp.ed_fee_payment_deleted = 0 AND fp.ed_fee_payment_institute_code = ? AND fp.ed_fee_payment_student = ?
    ORDER BY fp.ed_fee_payment_registerDate DESC LIMIT 400`,
    [institute_code, institute_code, student_id], true, { db: "eduall_fees_payments", type: "select", data: req });

  return (rows || []).map(it => {
    const calc = computeFeeLine(it);
    const extrasArr  = it.extras ? safeJsonParse(it.extras, []) : [];
    const extrasTotal = Array.isArray(extrasArr) ? extrasArr.reduce((s, ex) => s + (Number(ex.amount) || 0), 0) : 0;
    return { ...it, registerDateFmt: it.ed_fee_payment_registerDate ? moment(it.ed_fee_payment_registerDate).format("DD/MM/YYYY HH:mm") : "", calc, extrasArr, extrasTotal, totalWithExtras: r2(calc.total + extrasTotal) };
  });
}

async function getStudentServicePayments(res, req, { student_id, institute_code }) {
  const rows = await ExecuteQuery(res, `
    SELECT sp.*, sv.ed_service_title, c.ed_coin_code
    FROM eduall_service_payments sp
    LEFT JOIN eduall_services sv ON sv.ed_service_id = sp.ed_service_payment_service
    LEFT JOIN eduall_coins    c  ON c.ed_coin_institute_code = ?
    WHERE sp.ed_service_payment_deleted = 0 AND sp.ed_service_payment_institute_code = ? AND sp.ed_service_payment_student_code = ?
    ORDER BY sp.ed_service_payment_registerDate DESC LIMIT 300`,
    [institute_code, institute_code, student_id], true, { db: "eduall_service_payments", type: "select", data: req });
  return (rows || []).map(it => ({ ...it, registerDateFmt: it.ed_service_payment_registerDate ? moment(it.ed_service_payment_registerDate).format("DD/MM/YYYY HH:mm") : "" }));
}

async function getStudentTransportPayments(res, req, { student_id, institute_code }) {
  const rows = await ExecuteQuery(res, `
    SELECT tp.*, sv.ed_service_title, c.ed_coin_code, pass.ed_transport_passenger_code, st.ed_student_name
    FROM eduall_transport_payments tp
    LEFT JOIN eduall_transport_passengers pass ON pass.ed_transport_passenger_id = tp.ed_transport_payment_student
    LEFT JOIN eduall_students st ON st.ed_student_id = pass.ed_transport_passenger_code
    LEFT JOIN eduall_services sv ON sv.ed_service_id = tp.ed_transport_payment_service
    LEFT JOIN eduall_coins    c  ON c.ed_coin_id = sv.ed_service_coin
    WHERE tp.ed_transport_payment_deleted = 0 AND tp.ed_transport_payment_institute_code = ? AND pass.ed_transport_passenger_code = ?
    ORDER BY tp.ed_transport_payment_registerDate DESC LIMIT 200`,
    [institute_code, student_id], true, { db: "eduall_transport_payments", type: "select", data: req });
  return (rows || []).map(it => ({ ...it, registerDateFmt: it.ed_transport_payment_registerDate ? moment(it.ed_transport_payment_registerDate).format("DD/MM/YYYY HH:mm") : "" }));
}

async function buildStudentBundle(res, req, { student_id, institute_code, institute_type, semester = 1 }) {
  const [inst, student] = await Promise.all([
    getInstitute(res, req, institute_code),
    getStudentCoreWithClass(res, req, { student_id, institute_code }),
  ]);
  if (!student) throw new AppError("STUDENT_NOT_FOUND", "Aluno não encontrado.");

  const class_id = Number(student.ed_class_id || student.ed_student_class || 0);
  if (!class_id) throw new AppError("CLASS_NOT_FOUND", "Turma do aluno não encontrada.");

  const [attendance, behavior, suspensions, rfidLogs] = await Promise.all([
    getStudentAttendance(res, req, { student_id, class_id, institute_code }),
    getStudentBehavior(res, req, { student_id, institute_code }),
    getStudentSuspensions(res, req, { student_id, institute_code }),
    getStudentRfidLogs(res, req, { student_id, institute_code }),
  ]);

  let notesBlock = null;
  if (Number(institute_type) === 1) {
    const notes = await getStudentSemesterNotes(res, req, { student_id, class_id, semester, institute_code });
    notesBlock = { mode: "semester", semester: Number(semester || 1), notes };
  } else {
    const qnotes = await getStudentQuarterNotes(res, req, { student_id, class_id, institute_code });
    notesBlock = { mode: "quarter", ...qnotes };
  }

  const [feePayments, servicePayments, transportPayments] = await Promise.all([
    getStudentFeePayments(res, req, { student_id, institute_code }),
    getStudentServicePayments(res, req, { student_id, institute_code }),
    getStudentTransportPayments(res, req, { student_id, institute_code }),
  ]);

  const avg = notesBlock?.mode === "semester" && Array.isArray(notesBlock.notes) && notesBlock.notes.length
    ? r2(notesBlock.notes.reduce((s, n) => s + (Number(n.final) || 0), 0) / notesBlock.notes.length)
    : null;
  const attendanceRate = attendance?.total > 0 ? Math.round((attendance.present / attendance.total) * 100) : null;

  return { generated_at: new Date(), institute: inst, student, notesBlock, attendance, behavior, suspensions, rfidLogs, payments: { fees: feePayments, services: servicePayments, transport: transportPayments }, summary: { avg, attendanceRate } };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IA — GEMINI + FALLBACK
// ═══════════════════════════════════════════════════════════════════════════════
function heuristicFeedback(bundle) {
  const bullets = [];
  const avg  = bundle?.summary?.avg;
  const att  = bundle?.attendance;
  const susp = bundle?.suspensions || [];

  if (avg != null) {
    if (avg >= 14)     bullets.push("Desempenho excelente — manter a consistência e aprofundar os conteúdos.");
    else if (avg >= 10) bullets.push("Progresso satisfatório — com revisão regular é possível melhorar significativamente.");
    else               bullets.push("Reforço necessário — recomenda-se acompanhamento extra e estudo diário estruturado.");
  }

  if (att?.total > 0) {
    const absRate  = Math.round((att.absent / att.total) * 100);
    const lateRate = Math.round((att.late   / att.total) * 100);
    if (absRate <= 5)      bullets.push("Presença exemplar — a assiduidade contribui diretamente para o aproveitamento.");
    else if (absRate <= 15) bullets.push("Reduzir as faltas — a continuidade letiva é determinante para a evolução.");
    else                    bullets.push("Faltas elevadas — recomenda-se plano de recuperação e acompanhamento semanal.");
    if (lateRate > 10)     bullets.push("Pontualidade — reduzir os atrasos melhora a concentração e o aproveitamento.");
  }

  if (susp.length > 0) bullets.push("Comportamento — foco no cumprimento das regras escolares e no respeito mútuo.");
  bullets.push("Sugestão prática: 20–30 minutos diários de revisão, com exercícios curtos e regulares.");
  return { ok: true, mode: "heuristic", bullets };
}

async function generateGeminiFeedback(bundle) {
  if (!GEMINI_API_KEY) return heuristicFeedback(bundle);
  try {
    const compact = {
      student:    { name: bundle?.student?.ed_student_name, class: bundle?.student?.ed_class_title, year: bundle?.student?.ed_academic_year_title },
      summary:    bundle?.summary,
      attendance: bundle?.attendance ? { total: bundle.attendance.total, present: bundle.attendance.present, absent: bundle.attendance.absent, late: bundle.attendance.late } : null,
      notes:      bundle?.notesBlock?.mode === "semester" ? (bundle.notesBlock.notes || []).slice(0, 25) : { q1: (bundle?.notesBlock?.quarters?.quarter_1 || []).slice(0, 20), q2: (bundle?.notesBlock?.quarters?.quarter_2 || []).slice(0, 20), q3: (bundle?.notesBlock?.quarters?.quarter_3 || []).slice(0, 20) },
      suspensions: (bundle?.suspensions || []).length,
    };
    const prompt = `Gera feedback formal em PT (Portugal), 5–7 bullets, para encarregado de educação. Frases claras, respeitosas, com sugestões concretas. Não humilhes. DADOS:\n${JSON.stringify(compact, null, 2)}`;
    const r = await axios.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.55, topP: 0.9, maxOutputTokens: 350 } }, { headers: { "Content-Type": "application/json" }, timeout: 25000 });
    const text = r?.data?.candidates?.[0]?.content?.parts?.map(p => p.text).join("\n") || "";
    const bullets = String(text).split("\n").map(l => l.replace(/^[-•\d\.\)\s]+/, "").trim()).filter(Boolean).slice(0, 10);
    if (!bullets.length) return heuristicFeedback(bundle);
    return { ok: true, mode: "gemini", bullets };
  } catch { return heuristicFeedback(bundle); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  IMAGENS → DATA URL (para PDF funcionar offline)
// ═══════════════════════════════════════════════════════════════════════════════
const fs   = require("fs/promises");
const path = require("path");

async function imageToDataUrl({ src, fallbackUrl }) {
  const finalSrc = (src && String(src).trim()) ? String(src).trim() : fallbackUrl;
  if (/^data:image\//i.test(finalSrc)) return finalSrc;

  const tryFetch = async (url) => {
    const r = await axios.get(url, { responseType: "arraybuffer", timeout: 18000 });
    const ct = r.headers["content-type"] || "image/jpeg";
    return `data:${ct};base64,${Buffer.from(r.data).toString("base64")}`;
  };

  if (/^https?:\/\//i.test(finalSrc)) {
    try { return await tryFetch(finalSrc); } catch { return fallbackUrl; }
  }

  const BASE = process.env.PUBLIC_DIR || path.join(process.cwd(), "public");
  const localPath = path.join(BASE, finalSrc.startsWith("/") ? finalSrc.slice(1) : finalSrc);
  try {
    const buf = await fs.readFile(localPath);
    const ext  = path.extname(localPath).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch { return fallbackUrl; }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HTML DO RELATÓRIO — DESIGN FORMAL / INSTITUCIONAL
// ═══════════════════════════════════════════════════════════════════════════════
async function buildReportHtml({ host, bundle, feedback, description, pdfUrl }) {
  const inst = bundle.institute || {};
  const st   = bundle.student  || {};
  const att  = bundle.attendance || { total: 0, present: 0, absent: 0, late: 0 };

  const logoSrc   = inst.ed_logo_urlcloudinary || inst.ed_institute_logo || "";
  const studentPhoto = await imageToDataUrl({ src: st.ed_student_picture, fallbackUrl: BRAND.avatarFallback });

  const createdAt = fmtDT(bundle.generated_at);

  // ── KPI de notas ────────────────────────────────────────────────────────────
  let notesSummary = { positive: 0, negative: 0, pending: 0, avg: bundle?.summary?.avg };
  if (bundle?.notesBlock?.mode === "semester") {
    for (const n of (bundle.notesBlock.notes || [])) {
      if (n.final == null) notesSummary.pending++;
      else if (Number(n.final) >= 10) notesSummary.positive++;
      else notesSummary.negative++;
    }
  } else {
    const pick = (bundle?.notesBlock?.quarters?.quarter_3 || []).length ? bundle.notesBlock.quarters.quarter_3
      : (bundle?.notesBlock?.quarters?.quarter_2 || []).length ? bundle.notesBlock.quarters.quarter_2
      : bundle?.notesBlock?.quarters?.quarter_1 || [];
    for (const n of pick) {
      if (n.mt == null) notesSummary.pending++;
      else if (Number(n.mt) >= 10) notesSummary.positive++;
      else notesSummary.negative++;
    }
  }

  // ── Helpers de HTML ──────────────────────────────────────────────────────────
  const pillOk   = v => `<span class="pill pill-ok">${v}</span>`;
  const pillFail = v => `<span class="pill pill-fail">${v}</span>`;
  const pillWarn = v => `<span class="pill pill-warn">${v}</span>`;
  const pillGray = v => `<span class="pill pill-gray">${v}</span>`;

  // ── Tabela de presenças ──────────────────────────────────────────────────────
  const attRows = (att.records || []).slice(0, 40).map(a => {
    const s = Number(a.ed_student_attd_status);
    const badge = s === 1 ? pillOk("Presente") : s === 2 ? pillWarn("Atrasado") : pillFail("Ausente");
    const hs = a.ed_timing_hour_start ?? "--"; const ms = a.ed_timing_minute_start ?? "--";
    const he = a.ed_timing_hour_end   ?? "--"; const me = a.ed_timing_minute_end   ?? "--";
    const dateFmt = a.ed_student_attd_date ? moment(a.ed_student_attd_date).format("DD/MM/YYYY") : "";
    return `<tr><td>${dateFmt}</td><td>${hs}h${ms} — ${he}h${me}</td><td>${a.ed_subject_title || "—"}</td><td>${badge}</td></tr>`;
  }).join("");

  // ── Propinas ─────────────────────────────────────────────────────────────────
  const feeRows = (bundle?.payments?.fees || []).slice(0, 60).map(p => {
    const total = p.totalWithExtras != null ? p.totalWithExtras : (p.calc?.total || 0);
    return `<tr>
      <td class="mono">${p.ed_fee_payment_invoiceCode || "—"}</td>
      <td>${p.ed_fee_payment_month || "—"}</td>
      <td class="num">${p.ed_coin_code || ""} ${Number(p.ed_fee_payment_price || 0).toFixed(2)}</td>
      <td class="num">${Number(p.ed_fee_payment_discount || 0).toFixed(0)}%</td>
      <td class="num">${Number(p.ed_fee_payment_iva || 0).toFixed(0)}%</td>
      <td class="num">${(p.calc?.fineAmount || 0).toFixed(2)}</td>
      <td class="num fw6">${total.toFixed(2)}</td>
      <td>${p.registerDateFmt || ""}</td>
    </tr>`;
  }).join("");

  const serviceRows = (bundle?.payments?.services || []).slice(0, 60).map(p =>
    `<tr><td class="mono">${p.ed_service_payment_invoiceCode || "—"}</td><td>${p.ed_service_title || "—"}</td>
     <td class="num">${Number(p.ed_service_payment_price || 0).toFixed(2)}</td>
     <td class="num">${Number(p.ed_service_payment_amount || 0).toFixed(0)}</td>
     <td class="num">${Number(p.ed_service_payment_discount || 0).toFixed(0)}%</td>
     <td>${p.ed_coin_code || ""}</td><td>${p.registerDateFmt || ""}</td></tr>`).join("");

  const transportRows = (bundle?.payments?.transport || []).slice(0, 60).map(p =>
    `<tr><td class="mono">${p.ed_transport_payment_invoiceCode || "—"}</td><td>${p.ed_service_title || "—"}</td>
     <td>${p.ed_transport_payment_month || "—"}</td>
     <td class="num">${Number(p.ed_transport_payment_price || 0).toFixed(2)}</td>
     <td class="num">${Number(p.ed_transport_payment_discount || 0).toFixed(0)}%</td>
     <td>${p.ed_coin_code || ""}</td><td>${p.registerDateFmt || ""}</td></tr>`).join("");

  // ── Comportamento ─────────────────────────────────────────────────────────────
  const behRows = (bundle?.behavior || []).slice(0, 25).map(b => {
    const dt = b.ed_student_behavior_date ? moment(b.ed_student_behavior_date).format("DD/MM/YYYY") : "—";
    return `<tr><td>${dt}</td><td>${b.ed_student_behavior_type || "—"}</td>
      <td>${b.ed_student_behavior_stars || "—"}</td>
      <td>${truncate(b.ed_student_behavior_description || "—", 160)}</td>
      <td>${b.ed_user_account_name || b.ed_employee_name || "—"}</td></tr>`;
  }).join("");

  const suspRows = (bundle?.suspensions || []).slice(0, 25).map(s => {
    const start = s.ed_susp_start_date ? moment(s.ed_susp_start_date).format("DD/MM/YYYY") : "—";
    const end   = s.ed_susp_end_date   ? moment(s.ed_susp_end_date).format("DD/MM/YYYY")   : "—";
    return `<tr><td>${start}</td><td>${end}</td><td>${s.ed_susp_status || "—"}</td><td>${truncate(s.ed_susp_reason || "—", 160)}</td></tr>`;
  }).join("");

  const rfidRows = (bundle?.rfidLogs || []).slice(0, 40).map(l => {
    const dt = l.ed_rfidlog_timestamp ? moment(l.ed_rfidlog_timestamp).format("DD/MM/YYYY HH:mm") : "—";
    return `<tr><td>${dt}</td><td>${l.ed_rfidlog_event_type || "Outro"}</td><td class="mono">${l.ed_rfidlog_code || "—"}</td></tr>`;
  }).join("");

  // ── Notas ─────────────────────────────────────────────────────────────────────
  const noteRow = (n) => {
    const ok = Number(n.final) >= 10;
    return `<tr><td>${n.subject_name}</td>
      <td class="num">${n.p1}</td><td class="num">${n.p2}</td>
      <td class="num">${n.exam}</td><td class="num">${n.specialexam}</td>
      <td class="num fw6 ${ok ? "c-ok" : "c-fail"}">${n.final}</td>
      <td>${ok ? pillOk(n.status) : pillFail(n.status)}</td></tr>`;
  };

  const qRow = (n) => {
    const ok = n.mt != null && Number(n.mt) >= 10;
    return `<tr><td>${n.subject_name}</td>
      <td class="num">${n.mac ?? "—"}</td><td class="num">${n.npp ?? "—"}</td><td class="num">${n.npt ?? "—"}</td>
      <td class="num fw6 ${n.mt == null ? "" : ok ? "c-ok" : "c-fail"}">${n.mt ?? "—"}</td>
      <td>${n.mt == null ? pillGray("Não lançado") : ok ? pillOk(n.status) : pillFail(n.status)}</td></tr>`;
  };

  let notesHtml = "";
  if (bundle?.notesBlock?.mode === "semester") {
    const list = bundle?.notesBlock?.notes || [];
    notesHtml = section("Notas — Semestre " + bundle.notesBlock.semester, "Aprovado se ≥ 10 valores",
      `<table><thead><tr><th>Disciplina</th><th class="num">P1</th><th class="num">P2</th><th class="num">Exame</th><th class="num">Rec.</th><th class="num">Final</th><th>Estado</th></tr></thead>
       <tbody>${list.slice(0, 60).map(noteRow).join("") || empty(7)}</tbody></table>`);
  } else {
    const qSection = (key, title) => {
      const list = bundle?.notesBlock?.quarters?.[key] || [];
      return section(title, "Aprovado se ≥ 10 valores",
        `<table><thead><tr><th>Disciplina</th><th class="num">MAC</th><th class="num">NPP</th><th class="num">NPT</th><th class="num">MT</th><th>Estado</th></tr></thead>
         <tbody>${list.slice(0, 60).map(qRow).join("") || empty(6)}</tbody></table>`);
    };
    notesHtml = qSection("quarter_1","Notas — I Trimestre") + qSection("quarter_2","Notas — II Trimestre") + qSection("quarter_3","Notas — III Trimestre");
  }

  // ── helpers de secção ─────────────────────────────────────────────────────────
  function section(title, sub, body) {
    return `<div class="section">
      <div class="section-head"><span class="section-title">${title}</span><span class="section-sub">${sub}</span></div>
      <div class="section-body">${body}</div>
    </div>`;
  }
  function empty(cols) { return `<tr><td colspan="${cols}" class="empty-row">Sem registos.</td></tr>`; }

  const feedbackItems = (feedback?.bullets || []).slice(0, 10).map(b => `<li>${b}</li>`).join("");
  const descBlock = sTrim(description) ? `<div class="desc-block"><p>${String(description).replace(/\n/g, "<br/>")}</p></div>` : "";

  const pdfLinkBlock = pdfUrl
    ? `<div class="pdf-link-block"><a href="${pdfUrl}" target="_blank">📄 Transferir PDF completo</a></div>`
    : "";

  const aiBadge = feedback?.mode === "gemini"
    ? `<span class="ai-badge">IA</span>`
    : `<span class="auto-badge">AUTO</span>`;

  // ── CSS ───────────────────────────────────────────────────────────────────────
  const css = `
    :root {
      --main:    ${BRAND.main};
      --accent:  ${BRAND.accent};
      --ok:      #166534;
      --ok-bg:   #dcfce7;
      --fail:    #991b1b;
      --fail-bg: #fee2e2;
      --warn:    #92400e;
      --warn-bg: #fef3c7;
      --gray:    #475569;
      --gray-bg: #f1f5f9;
      --line:    #e2e8f0;
      --text:    #0f172a;
      --sub:     #64748b;
    }
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      font-family: "Georgia", "Times New Roman", serif;
      font-size: 11.5px; line-height: 1.55;
      color: var(--text); background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    /* ── PAGE ── */
    .page { padding: 20px 24px; max-width: 900px; margin: 0 auto; }

    /* ── HEADER INSTITUCIONAL ── */
    .inst-header {
      display: flex; align-items: flex-start;
      gap: 16px;
      padding-bottom: 14px;
      border-bottom: 2px solid var(--main);
      margin-bottom: 0;
    }
    .inst-logo {
      flex: 0 0 auto;
      width: 72px; height: 72px;
      display: flex; align-items: center; justify-content: center;
    }
    .inst-logo img { width: 100%; height: 100%; object-fit: contain; }
    .inst-info { flex: 1; }
    .inst-name {
      font-size: 17px; font-weight: 700; letter-spacing: .3px;
      color: var(--main); margin: 0 0 3px;
      font-family: Arial, sans-serif;
    }
    .inst-meta { font-size: 10.5px; color: var(--sub); line-height: 1.5; font-family: Arial, sans-serif; }
    .report-label {
      flex: 0 0 auto; text-align: right;
    }
    .report-label .rl-title {
      font-size: 13px; font-weight: 700; color: var(--main);
      text-transform: uppercase; letter-spacing: .8px;
      font-family: Arial, sans-serif;
    }
    .report-label .rl-meta { font-size: 10px; color: var(--sub); margin-top: 3px; font-family: Arial, sans-serif; }

    /* ── FAIXA AZUL ── */
    .accent-bar {
      background: var(--main);
      height: 4px; margin-bottom: 14px;
    }

    /* ── CARD ALUNO ── */
    .student-card {
      display: flex; gap: 14px; align-items: flex-start;
      border: 1px solid var(--line); border-radius: 6px;
      padding: 12px 14px; margin-bottom: 14px;
      background: #fafbff;
    }
    .student-avatar {
      flex: 0 0 auto; width: 70px; height: 70px;
      border-radius: 4px; overflow: hidden; border: 1px solid var(--line);
      background: #fff;
    }
    .student-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .student-info { flex: 1; font-family: Arial, sans-serif; }
    .student-name { font-size: 15px; font-weight: 700; color: var(--main); margin: 0 0 4px; }
    .student-fields { font-size: 11px; color: var(--sub); line-height: 1.7; }
    .student-fields b { color: var(--text); }
    .badges { margin-top: 8px; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .badge {
      font-size: 11px; font-weight: 700;
      padding: 3px 10px; border-radius: 3px;
      font-family: Arial, sans-serif; letter-spacing: .2px;
    }
    .badge-avg  { background: var(--main); color: #fff; }
    .badge-att  { background: var(--accent); color: #fff; }
    .ai-badge   { background: #7c3aed; color: #fff; font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 3px; font-family: Arial, sans-serif; letter-spacing: .5px; }
    .auto-badge { background: var(--sub); color: #fff; font-size: 9px; font-weight: 800; padding: 2px 7px; border-radius: 3px; font-family: Arial, sans-serif; letter-spacing: .5px; }

    /* ── KPI ROW ── */
    .kpi-row {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
      margin-bottom: 14px;
    }
    .kpi {
      border: 1px solid var(--line); border-radius: 5px;
      padding: 9px 10px; background: var(--gray-bg);
      font-family: Arial, sans-serif;
    }
    .kpi-label { font-size: 10px; color: var(--sub); font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
    .kpi-value { font-size: 20px; font-weight: 700; color: var(--text); margin-top: 4px; }
    .kpi-value.c-ok   { color: var(--ok);   }
    .kpi-value.c-fail { color: var(--fail);  }
    .kpi-value.c-warn { color: var(--warn);  }
    .kpi-value.c-blue { color: var(--accent);}

    /* ── SECTION ── */
    .section {
      border: 1px solid var(--line); border-radius: 5px;
      margin-bottom: 14px; overflow: hidden;
      break-inside: auto; page-break-inside: auto;
    }
    .section-head {
      display: flex; justify-content: space-between; align-items: baseline;
      background: var(--main); color: #fff;
      padding: 7px 12px;
    }
    .section-title { font-size: 12px; font-weight: 700; letter-spacing: .3px; font-family: Arial, sans-serif; }
    .section-sub   { font-size: 10px; opacity: .8; font-family: Arial, sans-serif; }
    .section-body  { padding: 0; }

    /* ── CHART ── */
    .chart-wrap { padding: 12px; }
    .chart-inner { height: 160px; }
    canvas { width: 100% !important; height: 100% !important; }

    /* ── TABLE ── */
    table { width: 100%; border-collapse: collapse; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    tbody tr { page-break-inside: avoid; }
    th {
      font-size: 10.5px; font-weight: 700; text-align: left;
      background: #f1f5f9; color: var(--sub);
      border-bottom: 1px solid var(--line);
      padding: 7px 10px;
      font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: .3px;
    }
    td {
      border-bottom: 1px solid var(--line);
      padding: 7px 10px; font-size: 11px; color: var(--text);
      vertical-align: top;
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:nth-child(even) td { background: #fafbff; }
    .num { text-align: right; font-family: "Courier New", monospace; }
    .fw6 { font-weight: 700; }
    .mono { font-family: "Courier New", monospace; font-size: 10px; }
    .c-ok   { color: var(--ok);   }
    .c-fail { color: var(--fail); }
    .empty-row { text-align: center; color: var(--sub); font-style: italic; padding: 14px; }

    /* ── PILLS ── */
    .pill {
      display: inline-block; border-radius: 3px;
      padding: 2px 8px; font-size: 10px; font-weight: 700;
      font-family: Arial, sans-serif; letter-spacing: .2px; white-space: nowrap;
    }
    .pill-ok   { background: var(--ok-bg);   color: var(--ok);   border: 1px solid #bbf7d0; }
    .pill-fail { background: var(--fail-bg);  color: var(--fail); border: 1px solid #fecaca; }
    .pill-warn { background: var(--warn-bg);  color: var(--warn); border: 1px solid #fde68a; }
    .pill-gray { background: var(--gray-bg);  color: var(--sub);  border: 1px solid var(--line); }

    /* ── FEEDBACK / RECOMENDAÇÕES ── */
    .feedback-list { margin: 10px 12px; padding: 0 0 0 18px; }
    .feedback-list li { margin-bottom: 6px; font-size: 11.5px; color: var(--text); line-height: 1.55; }
    .feedback-note { font-size: 10px; color: var(--sub); font-style: italic; padding: 0 12px 10px; }

    /* ── DESCRIÇÃO ── */
    .desc-block { margin: 0; padding: 10px 12px; background: #fffbeb; border-bottom: 1px solid var(--line); }
    .desc-block p { margin: 0; font-size: 11.5px; color: #1c1917; line-height: 1.6; }

    /* ── PDF LINK ── */
    .pdf-link-block { padding: 10px 12px; border-bottom: 1px solid var(--line); }
    .pdf-link-block a { font-size: 11.5px; color: var(--accent); text-decoration: none; font-weight: 600; font-family: Arial, sans-serif; }

    /* ── RODAPÉ ── */
    .footer {
      margin-top: 18px;
      border-top: 1px solid var(--line);
      padding-top: 10px;
      display: flex; justify-content: space-between; align-items: center;
      font-family: Arial, sans-serif; font-size: 10px; color: var(--sub);
    }
    .footer-brand { font-weight: 800; color: var(--main); font-size: 11px; }
  `;

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8"/>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <style>${css}</style>
</head>
<body>
<div class="page">

  <!-- CABEÇALHO INSTITUCIONAL -->
  <div class="inst-header">
    <div class="inst-logo">
      <img src="${logoSrc}" onerror="this.src='${BRAND.logoFallback}'" alt="logo"/>
    </div>
    <div class="inst-info">
      <div class="inst-name">${inst.ed_institute_name || "Instituição de Ensino"}</div>
      <div class="inst-meta">
        ${sTrim(inst.ed_institute_address) ? sTrim(inst.ed_institute_address) + " &nbsp;·&nbsp; " : ""}${sTrim(inst.ed_institute_country) || ""}
        <br/>
        ${[sTrim(inst.ed_institute_phone1), sTrim(inst.ed_institute_phone2), sTrim(inst.ed_institute_email)].filter(Boolean).join(" &nbsp;·&nbsp; ")}
      </div>
    </div>
    <div class="report-label">
      <div class="rl-title">Relatório do Aluno</div>
      <div class="rl-meta">Emitido em ${createdAt}<br/>${BRAND.name} &nbsp;·&nbsp; ${BRAND.website}</div>
    </div>
  </div>
  <div class="accent-bar"></div>

  <!-- DADOS DO ALUNO -->
  <div class="student-card">
    <div class="student-avatar">
      <img src="${studentPhoto}" onerror="this.src='${BRAND.avatarFallback}'" alt="foto"/>
    </div>
    <div class="student-info">
      <div class="student-name">${st.ed_student_name || "Aluno"}</div>
      <div class="student-fields">
        <b>N.º Matrícula:</b> ${st.ed_student_code || "—"} &nbsp;
        <b>BI:</b> ${st.ed_student_identityCard || "—"} &nbsp;
        <b>Turma:</b> ${st.ed_class_title || "—"}<br/>
        ${sTrim(st.ed_classroom_title) ? `<b>Sala:</b> ${sTrim(st.ed_classroom_title)} &nbsp;` : ""}
        ${sTrim(st.ed_course_title) ? `<b>Curso:</b> ${sTrim(st.ed_course_title)} &nbsp;` : ""}
        <b>Ano Letivo:</b> ${st.ed_academic_year_title || "—"}
        ${sTrim(st.ed_faculty_title) ? ` &nbsp;<b>Faculdade:</b> ${sTrim(st.ed_faculty_title)}` : ""}
      </div>
      <div class="badges">
        <span class="badge badge-avg">Média: ${bundle?.summary?.avg != null ? bundle.summary.avg : "—"}</span>
        <span class="badge badge-att">Presença: ${bundle?.summary?.attendanceRate != null ? bundle.summary.attendanceRate + "%" : "—"}</span>
        ${aiBadge}
      </div>
    </div>
  </div>

  ${descBlock}

  <!-- KPIs DE PRESENÇA -->
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Total</div>       <div class="kpi-value">${att.total}</div></div>
    <div class="kpi"><div class="kpi-label">Presentes</div>   <div class="kpi-value c-ok">${att.present}</div></div>
    <div class="kpi"><div class="kpi-label">Ausências</div>   <div class="kpi-value c-fail">${att.absent}</div></div>
    <div class="kpi"><div class="kpi-label">Atrasos</div>     <div class="kpi-value c-warn">${att.late}</div></div>
  </div>

  <!-- KPIs DE NOTAS -->
  <div class="kpi-row">
    <div class="kpi"><div class="kpi-label">Positivas</div>     <div class="kpi-value c-ok">${notesSummary.positive}</div></div>
    <div class="kpi"><div class="kpi-label">Negativas</div>     <div class="kpi-value c-fail">${notesSummary.negative}</div></div>
    <div class="kpi"><div class="kpi-label">Não lançadas</div>  <div class="kpi-value">${notesSummary.pending}</div></div>
    <div class="kpi"><div class="kpi-label">Média geral</div>   <div class="kpi-value c-blue">${notesSummary.avg != null ? notesSummary.avg : "—"}</div></div>
  </div>

  <!-- GRÁFICO DE PRESENÇAS -->
  ${section("Presenças — Distribuição", "Resumo gráfico",
    `<div class="chart-wrap"><div class="chart-inner"><canvas id="attChart"></canvas></div></div>`)}

  <!-- TABELA DE PRESENÇAS -->
  ${section("Registo de Presenças", "Últimos 40 registos",
    `<table><thead><tr><th>Data</th><th>Horário</th><th>Disciplina</th><th>Estado</th></tr></thead>
     <tbody>${attRows || empty(4)}</tbody></table>`)}

  <!-- NOTAS -->
  ${notesHtml}

  <!-- PROPINAS -->
  ${section("Pagamentos — Propinas", "",
    `<table><thead><tr><th>Fatura</th><th>Mês</th><th class="num">Preço</th><th class="num">Desc.</th><th class="num">IVA</th><th class="num">Multa</th><th class="num">Total</th><th>Data</th></tr></thead>
     <tbody>${feeRows || empty(8)}</tbody></table>`)}

  <!-- SERVIÇOS -->
  ${section("Pagamentos — Serviços", "",
    `<table><thead><tr><th>Fatura</th><th>Serviço</th><th class="num">Preço</th><th class="num">Qtd</th><th class="num">Desc.</th><th>Moeda</th><th>Data</th></tr></thead>
     <tbody>${serviceRows || empty(7)}</tbody></table>`)}

  <!-- TRANSPORTE -->
  ${section("Pagamentos — Transporte", "",
    `<table><thead><tr><th>Fatura</th><th>Serviço</th><th>Mês</th><th class="num">Preço</th><th class="num">Desc.</th><th>Moeda</th><th>Data</th></tr></thead>
     <tbody>${transportRows || empty(7)}</tbody></table>`)}

  <!-- COMPORTAMENTO -->
  ${section("Registo de Comportamento", "Últimos 25 registos",
    `<table><thead><tr><th>Data</th><th>Tipo</th><th>Estrelas</th><th>Descrição</th><th>Registado por</th></tr></thead>
     <tbody>${behRows || empty(5)}</tbody></table>`)}

  <!-- SUSPENSÕES -->
  ${section("Suspensões", "",
    `<table><thead><tr><th>Início</th><th>Fim</th><th>Estado</th><th>Motivo</th></tr></thead>
     <tbody>${suspRows || empty(4)}</tbody></table>`)}

  <!-- RFID -->
  ${section("Registo de Entradas/Saídas (RFID)", "Últimas pichagens",
    `<table><thead><tr><th>Data / Hora</th><th>Evento</th><th>Código</th></tr></thead>
     <tbody>${rfidRows || empty(3)}</tbody></table>`)}

  <!-- RECOMENDAÇÕES -->
  ${section("Recomendações", feedback?.mode === "gemini" ? "Gerado com Inteligência Artificial" : "Gerado automaticamente pelo sistema",
    `${pdfLinkBlock}<ul class="feedback-list">${feedbackItems || "<li>Sem recomendações.</li>"}</ul>
     <div class="feedback-note">${feedback?.mode === "gemini" ? "Texto gerado por IA (Gemini). Validar com a coordenação pedagógica." : "Texto gerado automaticamente pelo Eduall."}</div>`)}

  <!-- RODAPÉ -->
  <div class="footer">
    <div class="footer-brand">Eduall &nbsp;·&nbsp; ${BRAND.website}</div>
    <div>Relatório automático confidencial &nbsp;·&nbsp; ${moment().format("DD/MM/YYYY HH:mm")}</div>
  </div>

</div>

<script>
(function(){
  var wait = ms => new Promise(r => setTimeout(r, ms));
  async function boot(){
    for(var i=0;i<40;i++){ if(window.Chart) break; await wait(250); }
    var canvas = document.getElementById("attChart");
    if(!canvas||!window.Chart){ window.__eduallReady=true; return; }
    var dpr = Math.max(2, window.devicePixelRatio||1);
    new Chart(canvas.getContext("2d"),{
      type:"bar",
      data:{
        labels:["Presentes","Ausências","Atrasos"],
        datasets:[{
          data:[${att.present},${att.absent},${att.late}],
          backgroundColor:["rgba(22,101,52,.75)","rgba(153,27,27,.75)","rgba(146,64,14,.75)"],
          borderColor:["#166534","#991b1b","#92400e"],
          borderWidth:1, borderRadius:4, maxBarThickness:60
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        animation:false, devicePixelRatio:dpr,
        scales:{
          x:{grid:{display:false}, ticks:{font:{size:11,family:"Arial"}}},
          y:{beginAtZero:true, ticks:{precision:0,font:{size:11,family:"Arial"}}, grid:{color:"#e2e8f0"}}
        },
        plugins:{legend:{display:false},tooltip:{enabled:false}}
      }
    });
    await wait(400);
    window.__eduallReady = true;
  }
  boot().catch(function(){ window.__eduallReady=true; });
})();
</script>
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYWRIGHT — RENDER PDF
// ═══════════════════════════════════════════════════════════════════════════════
async function renderPdfFromHtml(html) {
  if (!playwright) throw new AppError("PLAYWRIGHT_NOT_INSTALLED", "Playwright não instalado.");
  const browser = await playwright.chromium.launch({ headless: true, args: ["--no-sandbox","--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    // Aguarda Chart.js renderizar OU timeout de 5s
    await Promise.race([
      page.waitForFunction(() => window.__eduallReady === true),
      new Promise(r => setTimeout(r, 5000)),
    ]).catch(() => null);
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" } });
  } finally {
    await browser.close().catch(() => null);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CANAIS DE ENVIO
// ═══════════════════════════════════════════════════════════════════════════════
async function sendEmail({ to, subject, html }) {
  const { MAIL_HOST, MAIL_PORT, MAIL_SECURE, MAIL_USER, MAIL_PASS, MAIL_FROM } = process.env;
  if (!MAIL_HOST || !MAIL_PORT || !MAIL_USER || !MAIL_PASS)
    throw new AppError("EMAIL_SMTP_NOT_CONFIGURED", "SMTP não configurado.");

  const transporter = nodemailer.createTransport({ host: MAIL_HOST, port: Number(MAIL_PORT), secure: String(MAIL_SECURE || "false") === "true", auth: { user: MAIL_USER, pass: MAIL_PASS } });
  try {
    await transporter.sendMail({ from: MAIL_FROM || `"${BRAND.name}" <${MAIL_USER}>`, to, subject: subject || `Relatório Automático • ${BRAND.name}`, html });
    return true;
  } catch (e) { throw new AppError("EMAIL_SEND_FAIL", "Falha ao enviar email.", { err: e?.message || String(e) }); }
}

async function sendWhatsappCloud({ to, text }) {
  const WHATSAPP_TOKEN          = process.env.WHATSAPP_TOKEN || "EAAMwav5i5PsBQGVWepEf2hV8LqPfds8jyPAlhjDYQ7WzkFKVIsAubsaGzPDxkrsZAxrKTOEQjMbEeV21tBYyiEsPBkMI174ZC9RZBcLoOiiOZCsvRrotLiGZAqa4BBQzS2CJh94NWTzs4nC8LZCn52AYkuZC9ZADSVZA3ROXuPN5v1ECPZBR45zanfmVX9CgdllfEbBpaJqfzgNDep7aTxv4IceCtQEVGDF9hFwep4Cc7LfcpyUmH7ZCQcA8I25bEgHbdMAS1Xen3e0ihmFfzSNmeZCXx1NR";
  const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "925432393982487";
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID)
    throw new AppError("WA_NOT_CONFIGURED", "WhatsApp não configurado.");
  try {
    const r = await axios.post(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: "whatsapp", to, type: "text", text: { body: String(text || "") } },
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, timeout: 20000 });
    if (!(r.status === 200 || r.status === 201)) throw new Error("status=" + r.status);
    return true;
  } catch (e) { throw new AppError("WA_SEND_FAIL", "Falha ao enviar WhatsApp.", { err: e?.message || String(e) }); }
}

async function sendSmsWithCredits(res, req, { institute_code, phone, message, usertype, contact }) {
  const normalized = normalizePhoneAO(phone);
  if (!normalized) throw new AppError("SMS_INVALID_PHONE", "Número inválido.", { phone });

  const calcParts = msg => {
    const max = /[^\x00-\x7F]/.test(msg) ? 70 : 160;
    return Math.ceil(String(msg || "").length / max);
  };
  const parts = calcParts(message);

  const insertRecord = async (status, errText = null) =>
    ExecuteQuery(res, `INSERT INTO eduall_sms_records(ed_sms_record_message,ed_sms_sent_to,ed_sms_record_sent_usertype,ed_sms_sent_contactid,ed_sms_record_status,ed_sms_record_instituteCode) VALUES (?,?,?,?,?,?)`,
      [message, normalized, usertype || "", contact || null, status, institute_code], false, { db: "eduall_sms_records", type: "insert", data: req });

  const creditsRows = await ExecuteQuery(res, `SELECT * FROM eduall_sms_credits WHERE ed_sms_credit_institute_code = ? LIMIT 1`, [institute_code], true, { db: "eduall_sms_credits", type: "select", data: req });
  if (!creditsRows?.length) { await insertRecord(1, "Créditos não encontrados"); throw new AppError("SMS_CREDITS_NOT_FOUND", "Créditos não encontrados."); }
  if (Number(creditsRows[0].ed_sms_credit_total || 0) < parts) { await insertRecord(1, "Créditos insuficientes"); throw new AppError("SMS_INSUFFICIENT_CREDITS", "Créditos insuficientes."); }

  let ok = false;
  try {
    const r = await axios.post("https://www.telcosms.co.ao/send_message", { message: { api_key_app: "prdd0cf231ad82fcfa9c4c8654742", phone_number: normalized, message_body: String(message) } }, { headers: { "Content-Type": "application/json" }, timeout: 20000 });
    ok = r.status === 200 || r.status === 201;
  } catch { ok = false; }

  if (!ok) { await insertRecord(1, "Falha provider"); throw new AppError("SMS_PROVIDER_FAIL", "Falha no envio do SMS."); }
  await insertRecord(0);
  await ExecuteQuery(res, `UPDATE eduall_sms_credits SET ed_sms_credit_total = ed_sms_credit_total - ? WHERE ed_sms_credit_institute_code = ? AND ed_sms_credit_total >= ?`,
    [parts, institute_code, parts], false, { db: "eduall_sms_credits", type: "update", data: req });
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOGS + ESTADOS DE ERRO
// ═══════════════════════════════════════════════════════════════════════════════
async function logSend(res, req, institute_code, report, channel, to, status, errorCode, techError, userMsg, payload) {
  await ExecuteQuery(res, `INSERT INTO eduall_automatic_reports_logs(ed_auto_log_institute_code,ed_auto_log_report_code,ed_auto_log_report_id,ed_auto_log_channel,ed_auto_log_to,ed_auto_log_status,ed_auto_log_error_code,ed_auto_log_error_tech,ed_auto_log_error_user_msg,ed_auto_log_payload) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [institute_code, report.ed_auto_report_code, report.ed_auto_report_id, channel, to || null, status, errorCode || null, techError ? truncate(techError, 8000) : null, userMsg ? truncate(userMsg, 600) : null, payload ? JSON.stringify(payload) : null],
    false, { db: "eduall_automatic_reports_logs", type: "insert", data: req });
}

async function setReportFail(res, req, id, errorCode, userMsg) {
  await ExecuteQuery(res, `UPDATE eduall_automatic_reports SET ed_auto_report_last_result='fail', ed_auto_report_last_error_code=?, ed_auto_report_last_error_user_msg=?, ed_auto_report_last_error_at=NOW(), ed_auto_report_updated_at=NOW() WHERE ed_auto_report_id=?`,
    [errorCode || "UNKNOWN", truncate(userMsg, 600), id], false, { db: "eduall_automatic_reports", type: "update", data: req });
}

async function clearReportFail(res, req, id) {
  await ExecuteQuery(res, `UPDATE eduall_automatic_reports SET ed_auto_report_last_result='ok', ed_auto_report_last_error_code=NULL, ed_auto_report_last_error_user_msg=NULL, ed_auto_report_last_error_at=NULL, ed_auto_report_updated_at=NOW() WHERE ed_auto_report_id=?`,
    [id], false, { db: "eduall_automatic_reports", type: "update", data: req });
}

const ERROR_MESSAGES = {
  SMS_CREDITS_NOT_FOUND:    "SMS: créditos não configurados para esta instituição.",
  SMS_INSUFFICIENT_CREDITS: "SMS: créditos insuficientes.",
  SMS_INVALID_PHONE:        "SMS: número inválido.",
  SMS_PROVIDER_FAIL:        "SMS: falha no serviço externo. Será tentado novamente.",
  EMAIL_SMTP_NOT_CONFIGURED:"Email: SMTP não configurado.",
  EMAIL_SEND_FAIL:          "Email: falha no envio. Será tentado novamente.",
  WA_NOT_CONFIGURED:        "WhatsApp: não configurado.",
  WA_SEND_FAIL:             "WhatsApp: falha no envio. Será tentado novamente.",
  STUDENT_NOT_FOUND:        "Aluno não encontrado.",
  REPORT_BUILD_FAIL:        "Não foi possível gerar o relatório. Será tentado novamente.",
  PLAYWRIGHT_NOT_INSTALLED: "PDF: motor de impressão não instalado.",
  CLOUDINARY_NOT_CONFIGURED:"PDF: Cloudinary não configurado.",
  CLOUDINARY_UPLOAD_FAIL:   "PDF: falha no upload.",
  UNKNOWN:                  "Problema ao enviar o relatório. Será tentado novamente.",
};
function userMsg(code) { return ERROR_MESSAGES[String(code || "UNKNOWN")] || ERROR_MESSAGES.UNKNOWN; }

// ═══════════════════════════════════════════════════════════════════════════════
//  CRON MATCH
// ═══════════════════════════════════════════════════════════════════════════════
function cronMatchesNow(expr, now = new Date()) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const match = (f, v) => f === "*" || (Number.isFinite(Number(f)) && Number(f) === v);
  return match(min, now.getMinutes()) && match(hour, now.getHours()) &&
         match(dom, now.getDate())    && match(mon,  now.getMonth() + 1) &&
         match(dow, now.getDay());
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BACKGROUND RUNNER
//  — Toda a lógica de rede está em try/catch
//  — O tick() nunca propaga exceções
// ═══════════════════════════════════════════════════════════════════════════════
function createBackgroundRunner({ instanceId, batchSize = 4, lockSeconds = 90 }) {
  let inFlight = 0;

  const fakeRes = { status: () => fakeRes, json: () => null };
  const fakeReq = (instCode) => ({
    session: { user: { eduall_user_session_curentinstitute: instCode || "x", eduall_user_session_curentinstitute_type: 0, eduall_user_session_ID: null } },
    headers: {}, get: () => "", protocol: "http",
  });

  const runOne = async (report) => {
    inFlight++;
    const institute_code = report.ed_auto_report_institute_code;
    const req = fakeReq(institute_code);
    const payload = safeJsonParse(report.ed_auto_report_payload, {}) || {};
    req.session.user.eduall_user_session_curentinstitute_type = payload.institute_type || 0;

    const handleFail = async (channel, to, err) => {
      const code = err?.code || "UNKNOWN";
      const tech = err?.details ? JSON.stringify(err.details) : (err?.stack || err?.message || String(err));
      await logSend(fakeRes, req, institute_code, report, channel, to, "fail", code, tech, userMsg(code), null).catch(() => null);
      await setReportFail(fakeRes, req, report.ed_auto_report_id, code, userMsg(code)).catch(() => null);
    };

    try {
      // 1. bundle
      let bundle;
      try {
        const studentId = Number(payload.student_id || report.ed_auto_report_target_id || 0);
        if (!studentId) throw new AppError("REPORT_BUILD_FAIL", "Falta student_id.");
        bundle = await buildStudentBundle(fakeRes, req, { student_id: studentId, institute_code, institute_type: Number(payload.institute_type || 0), semester: Number(payload.semester || 1) });
      } catch (e) {
        await handleFail("system", null, e instanceof AppError ? e : new AppError("REPORT_BUILD_FAIL", "Falha no bundle.", { err: e?.message }));
        return;
      }

      // 2. feedback
      const fb = await generateGeminiFeedback(bundle).catch(() => heuristicFeedback(bundle));

      // 3. PDF
      let pdfUrl = ""; let pdfBuffer = null;
      try {
        const html = await buildReportHtml({ host: payload.host || "", bundle, feedback: fb, description: report.ed_auto_report_description });
        pdfBuffer = await renderPdfFromHtml(html);
        const up  = await uploadPdfToCloudinary(pdfBuffer, { institute_code, report_code: report.ed_auto_report_code, student_id: bundle?.student?.ed_student_id });
        pdfUrl = up.url || "";
        await logSend(fakeRes, req, institute_code, report, "pdf", null, "ok", null, null, null, { pdfUrl, bytes: up.bytes }).catch(() => null);
      } catch (e) { await handleFail("pdf", null, e); }

      // 4. Texto base (com link PDF se disponível)
      const baseText = [
        `${BRAND.name} • Relatório`,
        bundle.student.ed_student_name,
        `Média: ${bundle.summary.avg ?? "—"}`,
        `Presenças: ${bundle.attendance.present}/${bundle.attendance.total}`,
        `Emitido: ${moment().format("DD/MM/YYYY HH:mm")}`,
        pdfUrl ? `PDF: ${pdfUrl}` : "",
      ].filter(Boolean).join("\n");

      const emailHtml = await buildReportHtml({ host: payload.host || "", bundle, feedback: fb, description: report.ed_auto_report_description, pdfUrl }).catch(() => "");

      let anyOk = false;

      // SMS
      if (Number(report.ed_auto_report_send_sms) === 1) {
        try {
          await sendSmsWithCredits(fakeRes, req, { institute_code, phone: report.ed_auto_report_phone, message: baseText, usertype: report.ed_auto_report_target_type, contact: report.ed_auto_report_target_id });
          anyOk = true;
          await logSend(fakeRes, req, institute_code, report, "sms", report.ed_auto_report_phone, "ok", null, null, null, { pdfUrl }).catch(() => null);
        } catch (e) { await handleFail("sms", report.ed_auto_report_phone, e); }
      }

      // Email
      if (Number(report.ed_auto_report_send_email) === 1 && report.ed_auto_report_email) {
        try {
          await sendEmail({ to: report.ed_auto_report_email, subject: `${BRAND.name} • Relatório do aluno • ${bundle.student.ed_student_name || ""}`, html: emailHtml });
          anyOk = true;
          await logSend(fakeRes, req, institute_code, report, "email", report.ed_auto_report_email, "ok", null, null, null, { pdfUrl }).catch(() => null);
        } catch (e) { await handleFail("email", report.ed_auto_report_email, e); }
      }

      // WhatsApp
      if (Number(report.ed_auto_report_send_whatsapp) === 1 && report.ed_auto_report_whatsapp) {
        try {
          const wa = normalizePhoneAO(report.ed_auto_report_whatsapp);
          if (!wa) throw new AppError("WA_SEND_FAIL", "WhatsApp inválido.", { phone: report.ed_auto_report_whatsapp });
          await sendWhatsappCloud({ to: `244${wa}`, text: baseText });
          anyOk = true;
          await logSend(fakeRes, req, institute_code, report, "whatsapp", report.ed_auto_report_whatsapp, "ok", null, null, null, { pdfUrl }).catch(() => null);
        } catch (e) { await handleFail("whatsapp", report.ed_auto_report_whatsapp, e); }
      }

      // 5. Atualizar relatório
      await ExecuteQuery(fakeRes, `UPDATE eduall_automatic_reports SET ed_auto_report_last_run_at=NOW(), ed_auto_report_last_result=?, ed_auto_report_lock_until=NULL, ed_auto_report_locked_by=NULL, ed_auto_report_updated_at=NOW() WHERE ed_auto_report_id=?`,
        [anyOk ? "ok" : "fail", report.ed_auto_report_id], false, { db: "eduall_automatic_reports", type: "update", data: req }).catch(() => null);

      if (anyOk) await clearReportFail(fakeRes, req, report.ed_auto_report_id).catch(() => null);

      if (report.ed_auto_report_schedule_type === "once" && anyOk)
        await ExecuteQuery(fakeRes, `UPDATE eduall_automatic_reports SET ed_auto_report_status='cancelled', ed_auto_report_updated_at=NOW() WHERE ed_auto_report_id=?`,
          [report.ed_auto_report_id], false, { db: "eduall_automatic_reports", type: "update", data: req }).catch(() => null);

    } catch (e) {
      // Último fallback — nunca deixa propagar
      const code = e?.code || "UNKNOWN";
      await setReportFail(fakeRes, req, report.ed_auto_report_id, code, userMsg(code)).catch(() => null);
    } finally {
      inFlight--;
    }
  };

  // ── tick ─────────────────────────────────────────────────────────────────────
  // Nunca propaga — qualquer erro é capturado aqui mesmo
  const tick = async () => {
    if (inFlight >= batchSize) return;

    let candidates = [];
    try {
      const lockUntil = moment().add(lockSeconds, "seconds").format("YYYY-MM-DD HH:mm:ss");
      candidates = await ExecuteQuery(fakeRes, `
        SELECT * FROM eduall_automatic_reports
        WHERE ed_auto_report_deleted = 0
          AND ed_auto_report_status = 'active'
          AND (ed_auto_report_lock_until IS NULL OR ed_auto_report_lock_until < NOW())
        ORDER BY ed_auto_report_id ASC LIMIT 50`,
        [], true, { db: "eduall_automatic_reports", type: "select", data: fakeReq("x") });

      if (!Array.isArray(candidates) || !candidates.length) return;

      const now  = new Date();
      const due  = candidates.filter(r =>
        r.ed_auto_report_schedule_type === "once"      ? (r.ed_auto_report_scheduled_at && new Date(r.ed_auto_report_scheduled_at) <= now) :
        r.ed_auto_report_schedule_type === "recurring" ? cronMatchesNow(r.ed_auto_report_cron_expr, now) : false);

      const picked = due.slice(0, Math.max(0, batchSize - inFlight));

      for (const r of picked) {
        try {
          const reqLock = fakeReq(r.ed_auto_report_institute_code);
          await ExecuteQuery(fakeRes, `UPDATE eduall_automatic_reports SET ed_auto_report_lock_until=?, ed_auto_report_locked_by=?, ed_auto_report_updated_at=NOW() WHERE ed_auto_report_id=? AND (ed_auto_report_lock_until IS NULL OR ed_auto_report_lock_until < NOW())`,
            [moment().add(lockSeconds, "seconds").format("YYYY-MM-DD HH:mm:ss"), instanceId, r.ed_auto_report_id], false, { db: "eduall_automatic_reports", type: "update", data: reqLock });

          const check = await ExecuteQuery(fakeRes, `SELECT ed_auto_report_locked_by FROM eduall_automatic_reports WHERE ed_auto_report_id=? LIMIT 1`,
            [r.ed_auto_report_id], true, { db: "eduall_automatic_reports", type: "select", data: reqLock });

          if (check?.[0]?.ed_auto_report_locked_by === instanceId) {
            runOne(r).catch(() => null); // Fire and forget — crash isolado
            await sleep(25);
          }
        } catch { /* lock fail — outro processo pegou */ }
      }
    } catch (e) {
      // Erros de rede/DB no tick não matam o processo
      const msg = e?.message || String(e);
      const isNetErr = ["ENOTFOUND","EADDRNOTAVAIL","ECONNREFUSED","ETIMEDOUT","ECONNRESET"].some(c => msg.includes(c));
      if (!isNetErr) console.error("[AutoReports] tick error:", msg);
    }
  };

  return { tick };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROUTER (CRUD)
// ═══════════════════════════════════════════════════════════════════════════════
function createRouter() {
  const router = express.Router();

  // CREATE
  router.post("/automatic-reports", async (req, res) => {
    try {
      const institute     = req.session?.user?.eduall_user_session_curentinstitute;
      const instituteType = req.session?.user?.eduall_user_session_curentinstitute_type || 0;
      const userId        = req.session?.user?.eduall_user_session_ID || null;
      if (!institute) return res.status(400).json({ success: false, msg: "Instituto inválido na sessão." });

      const body = req.body || {};
      const schedule_type = body.schedule_type === "recurring" ? "recurring" : "once";

      if (schedule_type === "once"      && !body.scheduled_at) return res.status(400).json({ success: false, msg: "scheduled_at é obrigatório (once)." });
      if (schedule_type === "recurring" && !body.cron_expr)    return res.status(400).json({ success: false, msg: "cron_expr é obrigatório (recurring)." });

      const payload = { ...(body.payload || {}), institute_type: instituteType, host: body.host || "" };
      const code    = randCode(45);

      await ExecuteQuery(res, `
        INSERT INTO eduall_automatic_reports(ed_auto_report_code,ed_auto_report_institute_code,ed_auto_report_target_type,ed_auto_report_target_id,ed_auto_report_target_name,ed_auto_report_email,ed_auto_report_phone,ed_auto_report_whatsapp,ed_auto_report_send_sms,ed_auto_report_send_email,ed_auto_report_send_whatsapp,ed_auto_report_type,ed_auto_report_payload,ed_auto_report_description,ed_auto_report_schedule_type,ed_auto_report_scheduled_at,ed_auto_report_cron_expr,ed_auto_report_timezone,ed_auto_report_status,ed_auto_report_created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [code, String(institute), body.target_type || "student", body.target_id || null, body.target_name || null, body.email || null, body.phone || null, body.whatsapp || null, body.send_sms ? 1 : 0, body.send_email ? 1 : 0, body.send_whatsapp ? 1 : 0, body.report_type || "student_full", JSON.stringify(payload), body.description || null, schedule_type, schedule_type === "once" ? body.scheduled_at : null, schedule_type === "recurring" ? body.cron_expr : null, body.timezone || "Africa/Luanda", "active", userId],
        false, { db: "eduall_automatic_reports", type: "insert", data: req });

      await RegisterAuditAction({ session: req.session, action: 1, form: "Relatórios automáticos", description: `Criou agendamento (${body.report_type || "student_full"})` });
      return res.status(200).json({ success: true, code, msg: "Agendamento criado com sucesso!" });
    } catch (e) { return res.status(500).json({ success: false, msg: e?.message || String(e) }); }
  });

  // LIST
  router.get("/automatic-reports", async (req, res) => {
    try {
      const institute = req.session?.user?.eduall_user_session_curentinstitute;
      if (!institute) return res.status(400).json({ success: false, msg: "Instituto inválido." });
      const rows = await ExecuteQuery(res, `SELECT * FROM eduall_automatic_reports WHERE ed_auto_report_deleted=0 AND ed_auto_report_institute_code=? ORDER BY ed_auto_report_created_at DESC LIMIT 500`,
        [String(institute)], true, { db: "eduall_automatic_reports", type: "select", data: req });
      return res.status(200).json(rows);
    } catch (e) { return res.status(500).json({ success: false, msg: e?.message || String(e) }); }
  });

  // PDF ON-DEMAND
  router.get("/automatic-reports/student/:studentId/pdf", async (req, res) => {
    try {
      const institute_code = req.session?.user?.eduall_user_session_curentinstitute;
      const institute_type = Number(req.session?.user?.eduall_user_session_curentinstitute_type || 0);
      if (!institute_code) return res.status(401).json({ success: false, msg: "Sessão inválida." });

      const student_id = Number(req.params.studentId || 0);
      if (!student_id) return res.status(400).json({ success: false, msg: "studentId inválido." });

      const semester  = Number(req.query.semester || 1);
      const download  = String(req.query.download || "0") === "1";
      const doUpload  = String(req.query.upload   || "0") === "1";
      const host      = computeHost(req);

      const bundle   = await buildStudentBundle(res, req, { student_id, institute_code, institute_type, semester });
      const feedback = await generateGeminiFeedback(bundle);
      const html     = await buildReportHtml({ host, bundle, feedback, description: req.query.description || "" });
      const pdfBuf   = await renderPdfFromHtml(html);

      if (doUpload) {
        const up = await uploadPdfToCloudinary(pdfBuf, { institute_code, report_code: randCode(10), student_id });
        return res.status(200).json({ success: true, student_id, pdfUrl: up?.url || "", bytes: pdfBuf.length });
      }

      const fileName = `relatorio_aluno_${student_id}_${moment().format("YYYYMMDD_HHmm")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Length", String(pdfBuf.length));
      res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${fileName}"`);
      return res.status(200).end(pdfBuf);
    } catch (e) {
      return res.status(500).json({ success: false, code: e?.code || "UNKNOWN", msg: e?.userMessage || e?.message || "Erro ao gerar PDF." });
    }
  });

  // LOGS
  router.get("/automatic-reports/:CODE/logs", async (req, res) => {
    try {
      const institute = req.session?.user?.eduall_user_session_curentinstitute;
      const rows = await ExecuteQuery(res, `SELECT * FROM eduall_automatic_reports_logs WHERE ed_auto_log_institute_code=? AND ed_auto_log_report_code=? ORDER BY ed_auto_log_sent_at DESC LIMIT 200`,
        [String(institute), req.params.CODE], true, { db: "eduall_automatic_reports_logs", type: "select", data: req });
      return res.status(200).json(rows);
    } catch (e) { return res.status(500).json({ success: false, msg: e?.message || String(e) }); }
  });

  // STATUS
  router.put("/automatic-reports/:CODE/status", async (req, res) => {
    try {
      const institute = req.session?.user?.eduall_user_session_curentinstitute;
      const status = ["active","paused","cancelled"].includes(req.body?.status) ? req.body.status : null;
      if (!status) return res.status(400).json({ success: false, msg: "status inválido." });
      await ExecuteQuery(res, `UPDATE eduall_automatic_reports SET ed_auto_report_status=?, ed_auto_report_updated_at=NOW() WHERE ed_auto_report_code=? AND ed_auto_report_institute_code=? AND ed_auto_report_deleted=0`,
        [status, req.params.CODE, String(institute)], false, { db: "eduall_automatic_reports", type: "update", data: req });
      await RegisterAuditAction({ session: req.session, action: 2, form: "Relatórios automáticos", description: `Estado do agendamento (${req.params.CODE}) → ${status}` });
      return res.status(200).json({ success: true, msg: "Estado atualizado!" });
    } catch (e) { return res.status(500).json({ success: false, msg: e?.message || String(e) }); }
  });

  // DELETE
  router.delete("/automatic-reports/:CODE", async (req, res) => {
    try {
      const institute = req.session?.user?.eduall_user_session_curentinstitute;
      await ExecuteQuery(res, `UPDATE eduall_automatic_reports SET ed_auto_report_deleted=1, ed_auto_report_status='cancelled', ed_auto_report_updated_at=NOW() WHERE ed_auto_report_code=? AND ed_auto_report_institute_code=?`,
        [req.params.CODE, String(institute)], false, { db: "eduall_automatic_reports", type: "update", data: req });
      await RegisterAuditAction({ session: req.session, action: 3, form: "Relatórios automáticos", description: `Removeu agendamento (${req.params.CODE})` });
      return res.status(200).json({ success: true, msg: "Agendamento removido!" });
    } catch (e) { return res.status(500).json({ success: false, msg: e?.message || String(e) }); }
  });

  return router;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════
function initEduallAutomaticStudentReports(app, options = {}) {
  const { basePath = "/api", cronSpec = "* * * * *", batchSize = 3, lockSeconds = 90 } = options;

  app.use(basePath, createRouter());

  const fakeRes = { status: () => fakeRes, json: () => null };
  const fakeReq = { session: { user: { eduall_user_session_curentinstitute: "x" } } };

  ensureTables(fakeRes, fakeReq).catch(e => console.error("[AutoReports] Tabelas:", e?.message || e));

  const instanceId = `node_${process.pid}_${randCode(8)}`;
  const runner     = createBackgroundRunner({ instanceId, batchSize, lockSeconds });

  cron.schedule(cronSpec, async () => {
    try { await runner.tick(); } catch { /* nunca deve chegar aqui — mas por precaução */ }
  });

  console.log(`[AutoReports] ON (${cronSpec}) instance=${instanceId}`);
  return { instanceId };
}

 