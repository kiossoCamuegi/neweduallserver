// CACHE-OPT v1 (aplicado por apply_cache_optimizations.py)
// CACHEKEYS-REV 3
// CACHEKEYS-V2 faculty,enrollmentTemplate
// ─────────────────────────────────────────────────────────────────────────────
// Chaves de cache centralizadas. TODAS incluem o instituteCode (multi-tenant),
// exceto `lesson` (aulas-tutorial da plataforma, iguais para todas as escolas).
// Outros controllers (alunos, turmas, ...) importam este ficheiro para poderem
// invalidar as chaves uns dos outros:
//   const CacheKeys = require("../Functions/CacheKeys");
//   await CacheKeys.safeInvalidate(() => [CacheKeys.academicLevel.studentsSummary(code)]);
// ─────────────────────────────────────────────────────────────────────────────
const Cache = require("./CacheRoutes");

// Normaliza o instituteCode para uso em chaves (sem tenant => erro, nunca chave global)
const norm = (code) => {
  const s = String(code === undefined || code === null ? "" : code).trim();
  if (!s) {
    throw new Error("instituteCode em falta: chave de cache sem tenant não é permitida.");
  }
  return s.replace(/[^A-Za-z0-9_.@-]/g, "_").slice(0, 64);
};

// Valida IDs numéricos (devolve o inteiro ou null se inválido)
const parseId = (value) => {
  const s = String(value === undefined || value === null ? "" : value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
};

const academicLevel = {
  list: (code) => `academic_level:list:${norm(code)}`,
  studentsSummary: (code) => `academic_level:students_summary:${norm(code)}`,
};

const academicYear = {
  list: (code) => `academic_year:list:${norm(code)}`,
};

const bookCategory = {
  list: (code) => `bookCategory:list:${norm(code)}`,
};

const bookCollection = {
  list: (code) => `bookCollection:list:${norm(code)}`,
};

const calendarEvent = {
  list: (code) => `calendarEvent:list:${norm(code)}`,
};

const cicle = {
  list: (code) => `cicle:list:${norm(code)}`,
};

const coin = {
  list: (code) => `coin:list:${norm(code)}`,
};

const classroom = {
  list: (code) => `classroom:list:${norm(code)}`,
};

const schoolClass = {
  list: (code) => `class:list:${norm(code)}`,
  exams: (code) => `class:exams:${norm(code)}`,
};

const author = {
  list: (code) => `author:list:${norm(code)}`,
};

const book = {
  list: (code) => `book:list:${norm(code)}`,
};

const exemplar = {
  list: (code) => `exemplar:list:${norm(code)}`,
};

const borrowedBook = {
  list: (code) => `borrowedBook:list:${norm(code)}`,
};

const digitalContent = {
  list: (code) => `digitalContent:list:${norm(code)}`,
};

const bulletinHistory = {
  list: (code) => `bulletinHistory:list:${norm(code)}`,
};

const contact = {
  list: (code) => `contact:list:${norm(code)}`,
};

const point = {
  list: (code) => `point:list:${norm(code)}`,
};

const course = {
  list: (code) => `course:list:${norm(code)}`,
};

const feedback = {
  list: (code) => `feedback:list:${norm(code)}`,
};

const declaration = {
  list: (code) => `declaration:list:${norm(code)}`,
};

const declarationRequest = {
  list: (code) => `declarationRequest:list:${norm(code)}`,
};

const employee = {
  list: (code) => `employee:list:${norm(code)}`,
};

const employeeAttendance = {
  list: (code) => `attendance:list:${norm(code)}`,
};

// Aulas-tutorial da plataforma: iguais para todas as escolas (chave global, sem tenant)
const lesson = {
  list: () => "lesson:list:global",
};

const faculty = {
  list: (code) => `faculty:list:${norm(code)}`,
};

const enrollmentTemplate = {
  list: (code) => `enrollmentTemplate:list:${norm(code)}`,
};

// CACHEKEYS-V3 jobTitle
// Cargos: tabela GLOBAL (sem instituteCode), iguais para todas as escolas
const jobTitle = {
  list: () => "jobTitle:list:global",
};

// Invalida chaves EXATAS. Aceita um array, uma string ou uma função que devolve
// o array (assim um erro ao construir a chave também fica contido aqui).
// NUNCA lança: uma falha de invalidação não pode fazer falhar o pedido.
const safeInvalidate = async (keysOrFn) => {
  try {
    const keys = typeof keysOrFn === "function" ? keysOrFn() : keysOrFn;
    const list = (Array.isArray(keys) ? keys : [keys]).filter(Boolean);
    if (list.length === 0) return 0;
    await Promise.all(list.map((key) => Cache.eduallInvalidate(key)));
    return list.length;
  } catch (err) {
    console.error("⚠️ CACHE: falha ao invalidar (ignorado):", err && err.message);
    return 0;
  }
};

module.exports = {
  norm,
  parseId,
  academicLevel,
  academicYear,
  bookCategory,
  bookCollection,
  calendarEvent,
  cicle,
  coin,
  classroom,
  schoolClass,
  author,
  book,
  exemplar,
  borrowedBook,
  digitalContent,
  bulletinHistory,
  contact,
  point,
  course,
  feedback,
  declaration,
  declarationRequest,
  employee,
  employeeAttendance,
  lesson,
  faculty,
  enrollmentTemplate,
  jobTitle,
  safeInvalidate,
};
