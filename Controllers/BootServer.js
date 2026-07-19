// routes/ai.js — FULL SERVER CODE (versão só com GEMINI)
const express = require('express');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
const multer = require('multer');
const XLSX = require('xlsx');
const pdfParse = require('pdf-parse');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');

// ==== Integrações internas ====
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require('./Auditory');
const { SendSms } = require('./SendSms');
const SendEmailMessage = require('./SendEmailMessage');

const router = express.Router();
router.use(express.json({ limit: '8mb' }));

router.use(rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false
}));

/* =================== Tema / CSS =================== */
const EDUALL_COLORS = { main: '#6352ff', secondary: '#00d6a1', tertiary: '#ffc20a' };
const CSS_INLINE = `
  <style>
    .text-main{ color:${EDUALL_COLORS.main}!important; }
    .bg-main{ background:${EDUALL_COLORS.main}!important; color:#fff!important; }
    .badge-main{ background:${EDUALL_COLORS.main}!important; }
    .badge-sec{ background:${EDUALL_COLORS.secondary}!important; color:#001b14!important; }
    .badge-ter{ background:${EDUALL_COLORS.tertiary}!important; color:#3b2c00!important; }
    .grey-text{ color:#6c757d!important; }
    .card{ border:1px solid #e9ecef; border-radius:10px; box-shadow: 0 4px 12px rgba(0,0,0,0.04); }
    .table thead th{ background:#f7f9fc; }
    .alert-soft{ background:#f8f9ff; border:1px solid ${EDUALL_COLORS.main}33; color:#212529; }
    .sep{height:1px;background:#eee;margin:12px 0;}
  </style>`;

const PRINT_CSS = `
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color:#111; }
    h1,h2,h3,h4,h5 { margin: 0 0 8px 0; }
    .header { margin-bottom: 8px; }
    .footer { margin-top: 8px; font-size: 10px; color: #666; text-align:center; }
    .table { width: 100%; border-collapse: collapse; }
    .table th, .table td { border: 1px solid #e5e7eb; padding: 6px 8px; }
    .table thead th { background: #f7f9fc; }
  </style>
`;

/* =================== Helpers =================== */
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function ensureExt(name, ext) {
  const base = String(name || `relatorio_${Date.now()}`).replace(/[^\w\-.]+/g, '_');
  return base.toLowerCase().endsWith('.' + ext) ? base : `${base}.${ext}`;
}
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function normalizePrompt(p) { return String(p || '').replace(/\s+/g, ' ').trim().slice(0, 300); }

function wrapHtmlForPrint({ title = 'Relatório', bodyHtml = '' }) {
  return `
    <!doctype html>
    <html lang="pt">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/css/bootstrap.min.css"
        rel="stylesheet" crossorigin="anonymous">
        ${CSS_INLINE}
        ${PRINT_CSS}
      </head>
      <body>
        <div class="header">
          <h3 class="text-main">${title}</h3>
        </div>
        <div>${bodyHtml}</div>
        <div class="footer">Gerado por EDUALL — ${new Date().toLocaleString('pt-PT')}</div>
      </body>
    </html>
  `;
}

/* =================== Sessão obrigatória =================== */
router.use((req, res, next) => {
  try {
    const user = (req.session || {}).user || {};
    if (!user.eduall_user_session_curentinstitute) {
      return res.status(401).json({ success: false, msg: 'Sessão inválida (instituição não definida).' });
    }
    next();
  } catch (e) {
    return res.status(500).json({ success: false, msg: 'Falha de sessão.', error: e.message });
  }
});

/* =================== IA: Gemini =================== */
const GEMINI_KEY = process.env.GEMINI_API_KEY || 'AIzaSyCW-uNqo1cxd1twpu_cUfSAnen1DrDYcDw';


// ======== CHAMADA JSON FORÇADA ========
async function callGeminiJson(system, user) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY em falta");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
${system}

Responde **apenas** com JSON válido.
Não uses markdown, não coloques \`\`\`json, nem comentários.

---
${user}
          `,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };

  try {
    const { data } = await axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
    });

    let txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Remove markdown se vier
    txt = txt.trim().replace(/^```json/, "").replace(/```$/, "");

    // Tenta converter
    return JSON.parse(txt);
  } catch (err) {
    console.error("Gemini response error:", err.response?.data || err.message);
    throw new Error(
      "Gemini falhou: " + (err.response?.data?.error?.message || err.message)
    );
  }
}

// ======== CHAMADA VISION ========
async function callGeminiVision(system, imgB64, userText = "") {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY em falta");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: `${system}\n\n---\n\n${userText}` },
          { inlineData: { mimeType: "image/png", data: imgB64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1 },
  };

  try {
    const { data } = await axios.post(url, body, {
      headers: { "Content-Type": "application/json" },
    });
    let txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    txt = txt.trim().replace(/^```json/, "").replace(/```$/, "");
    return JSON.parse(txt);
  } catch (err) {
    throw new Error(
      "Gemini Vision falhou: " + (err.response?.data?.error?.message || err.message)
    );
  }
}

// ======== PLANEAMENTO EDUALL ========
  async function aiPlanAndPreview(payload) {
  const system = `
És um orquestrador de operações do EDUALL.
Entrada: { "extractedData": ..., "userPrompt": ..., "type_of_actions": ..., "key_actions": ... }.
Devolve JSON **válido** no formato:
{
  "summary": "Resumo textual do plano",
  "actions": [ { "label": "...", "type": "...", "details": "..." } ],
  "html": "<div>Preview HTML a exibir</div>"
}
Nunca sugerir operações destrutivas em massa.
  `;

  const user = JSON.stringify(payload, null, 2);
  return await callGeminiJson(system, user);
}

 

/* =================== Preview (cache leve) =================== */
const previewCache = new Map();
function cacheKey(body, institute) {
  return JSON.stringify({ body, institute });
}

function buildPreviewHTMLFromPlan(plan, institute) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const counts = actions.reduce((acc, a) => {
    const k = `${a.type || 'acao'}:${a.entity || 'entidade'}`;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const rows = Object.entries(counts).map(([k, v]) => {
    const [type, entity] = k.split(':');
    const badgeClass = type === 'delete' ? 'badge-ter' : type === 'add' ? 'badge-sec' : 'badge-main';
    return `<tr><td><span class="badge ${badgeClass}">${type.toUpperCase()}</span></td><td>${entity}</td><td class="text-end">${v}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="grey-text">Sem ações.</td></tr>`;

  return `
    ${CSS_INLINE}
    <div class="card p-3">
      <h5 class="mb-1 text-main">Pré-visualização — ${institute || 'Instituição'}</h5>
      <p class="grey-text mb-3">${plan?.summary || 'Plano de operações.'}</p>
      <div class="alert alert-soft mb-3">Esta é apenas uma antevisão. Nenhuma operação foi executada.</div>
      <div class="table-responsive">
        <table class="table table-sm align-middle">
          <thead><tr><th>Tipo</th><th>Entidade</th><th class="text-end">Quantidade</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* =================== Dados da instituição =================== */
async function getInstituteInfo(instituteCode, res, req) {
  const q = `SELECT ed_institute_name, ed_institute_docheader, ed_institute_slogan, ed_logo_urlcloudinary, ed_institute_address, ed_institute_email, ed_institute_phone1
             FROM eduall_institutes WHERE ed_institute_code = ? LIMIT 1`;
  const rows = await ExecuteQuery(res, q, [instituteCode], true, { db: 'eduall_institutes', type: 'select', data: req });
  const r = rows?.[0] || {};
  return {
    name: r.ed_institute_name || 'Instituição',
    slogan: r.ed_institute_slogan || '',
    docheader: r.ed_institute_docheader || '',
    logo: r.ed_logo_urlcloudinary || '',
    address: r.ed_institute_address || '',
    email: r.ed_institute_email || '',
    phone: r.ed_institute_phone1 || ''
  };
}

function instituteHeaderHTML(institute, title = 'Relatório EDUALL') {
  const logo = institute?.logo
    ? `<img src="${escapeHtml(institute.logo)}" alt="logo" style="height:60px;width:auto;border-radius:6px;object-fit:contain;margin-right:12px;" />`
    : '';
  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
      ${logo}
      <div>
        <div style="font-weight:700;font-size:16px" class="text-main">${escapeHtml(title)}</div>
        <div style="font-size:12px;color:#6b7280">${escapeHtml(institute?.name || 'Instituição')}${institute?.slogan ? ' — ' + escapeHtml(institute.slogan) : ''}</div>
      </div>
    </div>
  `;
}

function buildInstituteReportHTML({ plan, institute, title }) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const rows = actions.map((a, i) => `
    <tr>
      <td>${String(a.type || '').toUpperCase()}</td>
      <td>${a.entity || '-'}</td>
      <td>${a.criteria ? `<code>${escapeHtml(JSON.stringify(a.criteria))}</code>` : '-'}</td>
      <td>${a.data ? `<code>${escapeHtml(JSON.stringify(a.data))}</code>` : '-'}</td>
    </tr>
  `).join('');
  return `
    ${CSS_INLINE}
    <div class="card p-3">
      ${instituteHeaderHTML(institute, title || 'Relatório EDUALL')}
      <p class="grey-text">${plan?.summary || 'Plano de operações.'}</p>
      <div class="table-responsive">
        <table class="table">
          <thead><tr><th>Tipo</th><th>Entidade</th><th>Critérios</th><th>Dados</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="grey-text">Sem ações.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
  `;
}

/* =================== Rotas: PREVIEW & EXECUTE =================== */

// PREVIEW
router.post('/preview', async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userPrompt = normalizePrompt(req.body?.userPrompt);
    const { extractedData, type_of_actions, key_actions } = req.body || {};
    if (!userPrompt) return res.status(400).json({ success: false, msg: 'Pedido vazio.' });

    const ck = cacheKey({ userPrompt, extractedData, type_of_actions, key_actions }, instituteCode);
    const now = Date.now();
    const cached = previewCache.get(ck);
    if (cached && now - cached.t < 30000) return res.status(200).json(cached.payload);

    const plan = await aiPlanAndPreview({
      app: 'Eduall',
      userPrompt,
      extractedData,
      type_of_actions,
      key_actions,
      instituteCode
    });

    const safePlan = { summary: plan?.summary || 'Plano de operações.', actions: Array.isArray(plan?.actions) ? plan.actions : [] };
    const institute = await getInstituteInfo(instituteCode, res, req);
    const html = plan?.html || buildInstituteReportHTML({ plan: safePlan, institute });

    try { await RegisterAuditAction({ session: req.session, action: 0, form: 'Assistente IA', description: `Pré-visualização: ${userPrompt}` }); } catch {}

    const payload = { success: true, html, plan: safePlan };
    previewCache.set(ck, { t: now, payload });
    return res.status(200).json(payload);
  } catch (err) {
    const html = `${CSS_INLINE}<div class="alert alert-danger"><strong>Falha ao gerar pré-visualização.</strong><br/><span class="grey-text">${err.message}</span></div>`;
    console.log(err.message)
    return res.status(500).json({ success: false, html, msg: 'Falha ao gerar pré-visualização.', error: err.message });
  }
});

// EXECUTE
router.post('/execute', async (req, res) => {
  const instituteCode = req.session.user.eduall_user_session_curentinstitute;
  try {
    const { plan, userPrompt } = req.body || {};
    if (!plan || !Array.isArray(plan.actions)) return res.status(400).json({ success: false, msg: 'Plano inválido.' });

    for (const action of plan.actions) {
      const type = String(action.type || '').toLowerCase();
      const entity = String(action.entity || '').toLowerCase();

      if (entity === 'student') {
        await handleStudents(type, action, instituteCode, req, res);
      } else if (entity === 'class') {
        await handleClasses(type, action, instituteCode, req, res);
      } else if (entity === 'course') {
        await handleCourses(type, action, instituteCode, req, res);
      } else if (entity === 'employee') {
        await handleEmployees(type, action, instituteCode, req, res);
      } else if (entity === 'sms') {
        await handleSms(type, action, instituteCode, req, res);
      } else if (entity === 'email') {
        await handleEmail(type, action, instituteCode, req, res);
      } else if (entity === 'report' || type === 'report' || type === 'resume') {
        // no-op
      }
    }

    try { await RegisterAuditAction({ session: req.session, action: 9, form: 'Assistente IA', description: `Execução confirmada: ${String(userPrompt || '').slice(0, 200)}` }); } catch {}

    const html = `${CSS_INLINE}<div class="card p-3"><div class="alert alert-success"><strong>Operações executadas com sucesso.</strong></div></div>`;
    return res.status(200).json({ success: true, msg: 'Operações concluídas.', html });
  } catch (err) {
    const html = `${CSS_INLINE}<div class="card p-3"><div class="alert alert-warning"><strong>Falha na execução.</strong><div class="grey-text">${err.message}</div></div></div>`;
    return res.status(500).json({ success: false, msg: 'Falha na execução.', html, error: err.message });
  }
});

/* =================== Export (Servidor) =================== */

// HTML -> PDF
router.post('/report/pdf', async (req, res) => {
  const instituteCode = req.session.user.eduall_user_session_curentinstitute;
  try {
    const { html, title, fileName, plan, footerText } = req.body || {};
    const institute = await getInstituteInfo(instituteCode, res, req);

    let contentHtml = html;
    if (!contentHtml) {
      contentHtml = buildInstituteReportHTML({ plan, institute, title });
      if (footerText) contentHtml += `<div class="mt-2 grey-text">${escapeHtml(footerText)}</div>`;
    }
    const printHtml = wrapHtmlForPrint({ title: title || 'Relatório eduall', bodyHtml: contentHtml });

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(printHtml, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '14mm', right: '14mm', bottom: '14mm', left: '14mm' } });
    await browser.close();

    const safeName = ensureExt(fileName || `relatorio_${Date.now()}`, 'pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    return res.status(200).send(pdf);
  } catch (err) {
    const htmlErr = `${CSS_INLINE}<div class="alert alert-danger"><strong>Falha ao gerar PDF.</strong><br/><span class="grey-text">${err.message}</span></div>`;
    return res.status(500).json({ success: false, html: htmlErr, msg: 'Erro ao gerar PDF.', error: err.message });
  }
});

// HTML/Plan -> Excel
router.post('/report/excel', async (req, res) => {
  const instituteCode = req.session.user.eduall_user_session_curentinstitute;
  try {
    const { html, fileName, plan } = req.body || {};
    let tables = [];
    if (html) tables = extractTablesFromHTML(html);
    if (!tables.length && plan) tables = tablesFromPlan(plan);
    if (!tables.length) return res.status(400).json({ success: false, msg: 'Não foram encontrados dados tabulares para exportar.' });

    const wb = XLSX.utils.book_new();
    tables.forEach((t) => {
      const aoa = [t.headers, ...t.rows.map(r => t.headers.map(h => r[h]))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      XLSX.utils.book_append_sheet(wb, ws, (t.name || 'Sheet').substring(0, 31));
    });

    const safeName = ensureExt(fileName || `relatorio_${Date.now()}`, 'xlsx');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    return res.status(200).send(buf);
  } catch (err) {
    const htmlErr = `${CSS_INLINE}<div class="alert alert-warning"><strong>Falha ao gerar Excel.</strong><br/><span class="grey-text">${err.message}</span></div>`;
    return res.status(500).json({ success: false, html: htmlErr, msg: 'Erro ao gerar Excel.', error: err.message });
  }
});

/* =================== Ingest (Imagem / PDF / Excel) =================== */

router.post('/ingest/image', upload.single('file'), async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userPrompt = normalizePrompt(req.body?.userPrompt);
    if (!req.file) return res.status(400).json({ success: false, msg: 'Imagem não enviada.' });

    const imgB64 = req.file.buffer.toString('base64');
    const system = `Extrai TABELAS do documento (imagem). Devolve JSON {tables:[{name,headers[],rows[]}]}. Não inventar colunas, respeitar ordem.`;

    let vision;
    try { vision = await callGeminiVision(system, imgB64, userPrompt); }
    catch { throw new Error('Falhou extração com IA Vision.'); }

    const tables = Array.isArray(vision?.tables) ? vision.tables : [];
    const institute = await getInstituteInfo(instituteCode, res, req);

    const { html, plan, pdfMeta } = buildReportFromTables({ tables, institute, userPrompt });
    return res.status(200).json({ success: true, html, plan, tables, pdfMeta });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
});

router.post('/ingest/pdf', upload.single('file'), async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userPrompt = normalizePrompt(req.body?.userPrompt);
    if (!req.file) return res.status(400).json({ success: false, msg: 'PDF não enviado.' });

    const parsed = await pdfParse(req.file.buffer);
    const tables = heuristicTablesFromText(parsed.text || "");
    const institute = await getInstituteInfo(instituteCode, res, req);

    const { html, plan, pdfMeta } = buildReportFromTables({ tables, institute, userPrompt });
    return res.status(200).json({ success: true, html, plan, tables, pdfMeta });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
});

router.post('/ingest/excel', upload.single('file'), async (req, res) => {
  try {
    const instituteCode = req.session.user.eduall_user_session_curentinstitute;
    const userPrompt = normalizePrompt(req.body?.userPrompt);
    if (!req.file) return res.status(400).json({ success: false, msg: 'Excel não enviado.' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const tables = [];
    wb.SheetNames.forEach((name) => {
      const ws = wb.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (!aoa || !aoa.length) return;
      const headers = (aoa[0] || []).map((h) => String(h || ''));
      const rows = aoa.slice(1).filter(r => r && r.length).map((arr) => {
        const o = {};
        headers.forEach((h, i) => { o[h] = arr[i] ?? ''; });
        return o;
      });
      tables.push({ name, headers, rows });
    });

    const institute = await getInstituteInfo(instituteCode, res, req);
    const { html, plan, pdfMeta } = buildReportFromTables({ tables, institute, userPrompt });
    return res.status(200).json({ success: true, html, plan, tables, pdfMeta });
  } catch (err) {
    return res.status(500).json({ success: false, msg: err.message });
  }
});

/* =================== Extractors/Builders tabulares =================== */

function extractTablesFromHTML(html){
  const $ = cheerio.load(html || '');
  const tables = [];
  $('table').each((i, el) => {
    const name = $(el).attr('id') || `Tabela_${i + 1}`;
    const headers = [];
    const headRow = $(el).find('thead tr').first();
    if (headRow.length) {
      headRow.find('th,td').each((_, th) => headers.push($(th).text().trim()));
    } else {
      const first = $(el).find('tbody tr').first();
      first.find('th,td').each((_, th) => headers.push($(th).text().trim()));
    }
    const rows = [];
    $(el).find('tbody tr').each((_, tr) => {
      const obj = {};
      $(tr).find('th,td').each((j, td) => {
        const label = headers[j] || `col_${j + 1}`;
        obj[label] = $(td).text().trim();
      });
      if (Object.keys(obj).length) rows.push(obj);
    });
    if (headers.length) tables.push({ name, headers, rows });
  });
  return tables;
}

function tablesFromPlan(plan) {
  const tables = [];
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  actions.forEach((a, i) => {
    const preview = Array.isArray(a.previewRows) ? a.previewRows : [];
    if (preview.length) {
      const headers = Object.keys(preview[0]);
      tables.push({ name: `${(a.type || 'acao')}_${(a.entity || 'entidade')}_${i + 1}`, headers, rows: preview });
    }
  });
  return tables;
}

// heurística simples: detectar “tabelas” em texto de PDF
function heuristicTablesFromText(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const blocks = [];
  let cur = [];
  lines.forEach((ln) => {
    if (/[-]{3,}|\={3,}/.test(ln)) { if (cur.length) { blocks.push(cur); cur = []; } }
    else cur.push(ln);
  });
  if (cur.length) blocks.push(cur);

  const tables = [];
  blocks.forEach((b, idx) => {
    const rows = b.map((ln) => ln.split(/\s{2,}|\t/g).filter(Boolean));
    const headers = (rows[0] || []).map(h => h.trim());
    if (headers.length >= 2 && rows.length >= 2) {
      const data = rows.slice(1).map(arr => {
        const o = {};
        headers.forEach((h, i) => o[h] = arr[i] ?? '');
        return o;
      });
      if (data.length) tables.push({ name: `Tabela_${idx + 1}`, headers, rows: data });
    }
  });
  return tables;
}

function buildReportFromTables({ tables, institute, userPrompt }) {
  const title = "Relatório — Importação";
  const summary = userPrompt || "Relatório gerado a partir de ficheiro importado.";
  const plan = {
    summary,
    actions: tables.map((t) => ({
      type: "report",
      entity: "table",
      data: { name: t.name },
      previewRows: t.rows.slice(0, 25)
    }))
  };

  const tablesHTML = tables.map((t) => {
    const head = `<thead><tr>${t.headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>`;
    const body = `<tbody>${t.rows.map(r=>`<tr>${t.headers.map(h=>`<td>${escapeHtml(String(r[h] ?? ''))}</td>`).join('')}</tr>`).join('')}</tbody>`;
    return `<div class="mb-3">
      <div class="fw-semibold mb-1">${escapeHtml(t.name || 'Tabela')}</div>
      <div class="table-responsive"><table class="table table-sm">${head}${body}</table></div>
    </div>`;
  }).join('') || `<div class="grey-text">Nenhuma tabela detectada.</div>`;

  const html = `
    ${CSS_INLINE}
    <div class="card p-3">
      ${instituteHeaderHTML(institute, title)}
      <div class="grey-text mb-2">${escapeHtml(summary)}</div>
      ${tablesHTML}
    </div>
  `;

  const pdfMeta = { institute, title, subtitle: summary, footer: "" };
  return { html, plan, pdfMeta };
}

/* ===================== Handlers (com validações de tenant) ===================== */

async function assertBelongs(table, idField, idValue, instituteField, instituteCode, res, req) {
  const q = `SELECT 1 FROM ${table} WHERE ${idField} = ? AND ${instituteField} = ? AND (${table.replace(/.*\./,'')}_deleted = 0 OR ${table.replace(/.*\./,'')}_deleted IS NULL) LIMIT 1`;
  const rows = await ExecuteQuery(res, q, [idValue, instituteCode], true, { db: table, type: 'select', data: req });
  if (!rows || rows.length === 0) throw new Error('Registo não pertence à instituição ativa ou não existe.');
}

async function handleStudents(type, action, instituteCode, req, res) {
  const c = action.criteria || {};
  const d = action.data || {};

  if (type === 'delete') {
    if (c.ids && Array.isArray(c.ids) && c.ids.length) {
      for (const id of c.ids) await assertBelongs('eduall_students', 'ed_student_id', id, 'ed_student_institute_code', instituteCode, res, req);
      const q = `UPDATE eduall_students SET ed_student_deleted = 1 WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_id IN (${c.ids.map(()=>'?').join(',')})`;
      await ExecuteQuery(res, q, [instituteCode, ...c.ids], false, { db: 'eduall_students', type: 'update', data: req });
    } else if (c.class) {
      const q = `UPDATE eduall_students SET ed_student_deleted = 1 WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_class = ?`;
      await ExecuteQuery(res, q, [instituteCode, c.class], false, { db: 'eduall_students', type: 'update', data: req });
    } else if (c.min_number) {
      const q = `UPDATE eduall_students SET ed_student_deleted = 1 WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND CAST(ed_student_code AS UNSIGNED) >= ?`;
      await ExecuteQuery(res, q, [instituteCode, Number(c.min_number)], false, { db: 'eduall_students', type: 'update', data: req });
    }
  }

  if (type === 'update') {
    if (c.id) {
      await assertBelongs('eduall_students', 'ed_student_id', c.id, 'ed_student_institute_code', instituteCode, res, req);
      const map = {
        name: 'ed_student_name',
        address: 'ed_student_address',
        nacionality: 'ed_student_nacionality',
        gender: 'ed_student_gender',
        religion: 'ed_student_religion',
        birthday: 'ed_student_birthday',
        phone: 'ed_student_phone',
        email: 'ed_student_email',
        class: 'ed_student_class',
        code: 'ed_student_code',
        identityCard: 'ed_student_identityCard',
        status: 'ed_student_status',
        naturalness: 'ed_student_naturalness'
      };
      const fields = [];
      const params = [];
      Object.keys(d || {}).forEach((k) => { if (map[k]) { fields.push(`${map[k]} = ?`); params.push(d[k]); } });
      if (fields.length) {
        const q = `UPDATE eduall_students SET ${fields.join(', ')} WHERE ed_student_deleted = 0 AND ed_student_id = ? AND ed_student_institute_code = ?`;
        params.push(c.id, instituteCode);
        await ExecuteQuery(res, q, params, false, { db: 'eduall_students', type: 'update', data: req });
      }
    }
  }

  if (type === 'add' || type === 'registerbulk') {
    const items = Array.isArray(action.items) ? action.items : [d];
    for (const it of items) {
      const q = `
        INSERT INTO eduall_students(
          ed_student_name, ed_student_address, ed_student_nacionality, ed_student_gender,
          ed_student_religion, ed_student_birthday, ed_student_phone, ed_student_email,
          ed_student_class, ed_student_code, ed_student_picture, ed_student_identityCard,
          ed_student_health_problems, ed_student_health_problems_description, ed_student_status,
          ed_student_naturalness, ed_student_institute_code, ed_student_type
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      const p = [
        it.name || '', it.address || '', it.nacionality || '', it.gender || '',
        it.religion || '', it.birthday || null, it.phone || '', it.email || '',
        it.class || null, it.code || null, it.picture || '',
        it.identityCard || '', it.health_problems || 0, it.health_desc || '',
        it.status || 1, it.naturalness || '', instituteCode, it.type || 1
      ];
      await ExecuteQuery(res, q, p, false, { db: 'eduall_students', type: 'insert', data: req });
    }
  }
}

async function handleClasses(type, action, instituteCode, req, res) {
  const c = action.criteria || {};
  const d = action.data || {};

  if (type === 'delete' && c.id) {
    await assertBelongs('eduall_class', 'ed_class_id', c.id, 'ed_class_institute_code', instituteCode, res, req);

    const checkQuery = `SELECT COUNT(*) AS total FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_class = ? AND ed_student_institute_code = ?`;
    const checkRows = await ExecuteQuery(res, checkQuery, [c.id, instituteCode], true, { db: 'eduall_students', type: 'select', data: req });
    const studentCount = checkRows[0]?.total || 0;
    if (studentCount > 0) throw new Error(`Não é possível eliminar. Existem ${studentCount} alunos associados.`);

    const q = `UPDATE eduall_class SET ed_class_deleted = 1 WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?`;
    await ExecuteQuery(res, q, [c.id, instituteCode], false, { db: 'eduall_class', type: 'update', data: req });
  }

  if (type === 'add' || type === 'registerbulk') {
    const items = Array.isArray(action.items) ? action.items : [d];
    for (const it of items) {
      const q = `INSERT INTO eduall_class(
        ed_class_title, ed_class_faculty, ed_class_code, ed_class_course, ed_class_period, ed_class_year,
        ed_class_room, ed_class_cicle, ed_class_academic_level, ed_class_description, ed_class_subjects, ed_class_institute_code)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`;
      const p = [
        it.title || '', it.faculty || '', it.code || '', it.course || null, it.period || '',
        it.year || '', it.room || '', it.cicle || '', it.academic_level || '',
        it.description || '', it.subjects || '', instituteCode
      ];
      await ExecuteQuery(res, q, p, false, { db: 'eduall_class', type: 'insert', data: req });
    }
  }

  if (type === 'update' && c.id) {
    await assertBelongs('eduall_class', 'ed_class_id', c.id, 'ed_class_institute_code', instituteCode, res, req);
    const map = {
      title: 'ed_class_title', faculty: 'ed_class_faculty', code: 'ed_class_code', course: 'ed_class_course',
      period: 'ed_class_period', year: 'ed_class_year', room: 'ed_class_room', cicle: 'ed_class_cicle',
      academic_level: 'ed_class_academic_level', description: 'ed_class_description', subjects: 'ed_class_subjects'
    };
    const fields = []; const params = [];
    Object.keys(d || {}).forEach((k) => { if (map[k]) { fields.push(`${map[k]} = ?`); params.push(d[k]); } });
    if (fields.length) {
      const q = `UPDATE eduall_class SET ${fields.join(', ')} WHERE ed_class_deleted = 0 AND ed_class_id = ? AND ed_class_institute_code = ?`;
      params.push(c.id, instituteCode);
      await ExecuteQuery(res, q, params, false, { db: 'eduall_class', type: 'update', data: req });
    }
  }
}

async function handleCourses(type, action, instituteCode, req, res) {
  const c = action.criteria || {};
  const d = action.data || {};

  if (type === 'delete' && c.id) {
    await assertBelongs('eduall_courses', 'ed_course_id', c.id, 'ed_course_institute_code', instituteCode, res, req);
    const checkQuery = `SELECT COUNT(*) AS total FROM eduall_class WHERE ed_class_course = ? AND ed_class_institute_code = ? AND ed_class_deleted = 0`;
    const check = await ExecuteQuery(res, checkQuery, [c.id, instituteCode], true, { db: 'eduall_class', type: 'select', data: req });
    if ((check[0]?.total || 0) > 0) throw new Error('Curso com turmas associadas.');
    const q = `UPDATE eduall_courses SET ed_course_deleted = 1 WHERE ed_course_deleted = 0 AND ed_course_id = ? AND ed_course_institute_code = ?`;
    await ExecuteQuery(res, q, [c.id, instituteCode], false, { db: 'eduall_courses', type: 'update', data: req });
  }

  if (type === 'add') {
    const q = `INSERT INTO eduall_courses (ed_course_title, ed_course_category, ed_course_institute_code) VALUES(?, ?, ?)`;
    await ExecuteQuery(res, q, [d.title || '', d.category || '', instituteCode], false, { db: 'eduall_courses', type: 'insert', data: req });
  }

  if (type === 'update' && c.id) {
    await assertBelongs('eduall_courses', 'ed_course_id', c.id, 'ed_course_institute_code', instituteCode, res, req);
    const fields = []; const params = [];
    if (d.title) { fields.push('ed_course_title = ?'); params.push(d.title); }
    if (d.category) { fields.push('ed_course_category = ?'); params.push(d.category); }
    if (fields.length) {
      const q = `UPDATE eduall_courses SET ${fields.join(', ')} WHERE ed_course_deleted = 0 AND ed_course_id = ? AND ed_course_institute_code = ?`;
      params.push(c.id, instituteCode);
      await ExecuteQuery(res, q, params, false, { db: 'eduall_courses', type: 'update', data: req });
    }
  }
}

async function handleEmployees(type, action, instituteCode, req, res) {
  const c = action.criteria || {};
  const d = action.data || {};

  if (type === 'delete' && c.id) {
    await assertBelongs('eduall_employees', 'ed_employee_id', c.id, 'ed_employee_institute_code', instituteCode, res, req);
    const q = `UPDATE eduall_employees SET ed_employee_deleted = 1 WHERE ed_employee_deleted = 0 AND ed_employee_id = ? AND ed_employee_institute_code = ?`;
    await ExecuteQuery(res, q, [c.id, instituteCode], false, { db: 'eduall_employees', type: 'update', data: req });
  }

  if (type === 'add') {
    const q = `INSERT INTO eduall_employees(
      ed_employee_name, ed_employee_address, ed_employee_nacionality, ed_employee_naturalness, 
      ed_employee_gender, ed_employee_religion, ed_employee_birthday, ed_employee_phone, ed_employee_phone2, ed_employee_nif, ed_employee_email,
      ed_employee_civil_state, ed_employee_code, ed_employee_picture, ed_employee_identityCard, ed_employee_charge, 
      ed_employee_subjects, ed_employee_status, ed_employee_institute_code
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
    const p = [
      d.name || '', d.address || '', d.nacionality || '', d.naturalness || '',
      d.gender || '', d.religion || '', d.birthday || null, d.phone || '', d.phone2 || '', d.nif || '', d.email || '',
      d.civil_state || '', d.code || '', d.picture || '', d.identityCard || '', d.charge || null,
      d.subjects || '', d.status || 1, instituteCode
    ];
    await ExecuteQuery(res, q, p, false, { db: 'eduall_employees', type: 'insert', data: req });
  }

  if (type === 'update' && c.id) {
    await assertBelongs('eduall_employees', 'ed_employee_id', c.id, 'ed_employee_institute_code', instituteCode, res, req);
    const map = {
      name: 'ed_employee_name',
      address: 'ed_employee_address',
      nacionality: 'ed_employee_nacionality',
      naturalness: 'ed_employee_naturalness',
      gender: 'ed_employee_gender',
      religion: 'ed_employee_religion',
      birthday: 'ed_employee_birthday',
      phone: 'ed_employee_phone',
      phone2: 'ed_employee_phone2',
      nif: 'ed_employee_nif',
      email: 'ed_employee_email',
      civil_state: 'ed_employee_civil_state',
      identityCard: 'ed_employee_identityCard',
      charge: 'ed_employee_charge',
      subjects: 'ed_employee_subjects',
      status: 'ed_employee_status'
    };
    const fields = []; const params = [];
    Object.keys(d || {}).forEach((k) => { if (map[k]) { fields.push(`${map[k]} = ?`); params.push(d[k]); } });
    if (fields.length) {
      const q = `UPDATE eduall_employees SET ${fields.join(', ')} WHERE ed_employee_id = ? AND ed_employee_institute_code = ?`;
      params.push(c.id, instituteCode);
      await ExecuteQuery(res, q, params, false, { db: 'eduall_employees', type: 'update', data: req });
    }
  }
}

/* ===================== HELPERS COMMS ===================== */

function normalizePhone(raw, defaultCountry = '244') {
  if (!raw) return '';
  let s = String(raw).replace(/[^\d+]/g, '');
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    if (s.length >= 9 && !s.startsWith('0')) s = `+${defaultCountry}${s}`;
    else if (s.startsWith('0')) s = `+${defaultCountry}${s.slice(1)}`;
  }
  if (s.length < 11 || s.length > 18) return '';
  return s;
}

function isValidEmail(v) {
  if (!v) return false;
  const s = String(v).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

function shortenMessage(msg, hardLimit = 160) {
  if (!msg) return '';
  let s = String(msg).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s
    .replace(/\bpor favor\b/gi, 'pf')
    .replace(/\bobrigado(a)?\b/gi, 'obg')
    .replace(/\bnumero\b/gi, 'nº')
    .replace(/\btele(?:fone)?\b/gi, 'tel')
    .replace(/\bmensagem\b/gi, 'msg')
    .replace(/\bseguinte\b/gi, 'seg.')
    .replace(/\bproximo\b/gi, 'prox.');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length <= hardLimit) return s;
  const urls = s.match(/\bhttps?:\/\/\S+/gi) || [];
  let base = s;
  urls.forEach(u => { base = base.replace(u, '').trim(); });
  base = base.slice(0, Math.max(0, hardLimit - (urls.join(' ').length + 1))) + (hardLimit > 3 ? '…' : '');
  return (base + (urls.length ? ' ' + urls.join(' ') : '')).slice(0, hardLimit);
}

async function isSuppressedContact({ phone, email, instituteCode, res, req }) {
  try {
    if (phone) {
      const q1 = `SELECT 1 FROM eduall_comms_suppression WHERE sup_institute_code = ? AND sup_phone = ? LIMIT 1`;
      const r1 = await ExecuteQuery(res, q1, [instituteCode, phone], true, { db: 'eduall_comms_suppression', type: 'select', data: req });
      if (r1?.length) return true;
    }
    if (email) {
      const q2 = `SELECT 1 FROM eduall_comms_suppression WHERE sup_institute_code = ? AND sup_email = ? LIMIT 1`;
      const r2 = await ExecuteQuery(res, q2, [instituteCode, email], true, { db: 'eduall_comms_suppression', type: 'select', data: req });
      if (r2?.length) return true;
    }
  } catch {}
  return false;
}

async function suppressContact({ phone, email, instituteCode, why, res, req }) {
  try {
    const q = `INSERT IGNORE INTO eduall_comms_suppression (sup_institute_code, sup_phone, sup_email, sup_reason, sup_created_at)
               VALUES (?,?,?,?, NOW())`;
    await ExecuteQuery(res, q, [instituteCode, phone || null, email || null, why || 'invalid'], false, { db: 'eduall_comms_suppression', type: 'insert', data: req });
  } catch {}
}

async function resolveTargets({ action, instituteCode, res, req }) {
  const out = [];

  if (Array.isArray(action.targets)) {
    action.targets.forEach(t => {
      out.push({
        id: t.id || null,
        role: (t.role || 'student').toLowerCase(),
        name: t.name || '',
        phone: t.phone || '',
        email: t.email || '',
        class: t.class || null
      });
    });
  }

  const c = action.criteria || {};
  const role = (c.role || '').toLowerCase();
  const text = (c.text || '').trim();

  if (c.class) {
    const q = `SELECT ed_student_id AS id, ed_student_name AS name, ed_student_phone AS phone,
                      ed_student_email AS email
               FROM eduall_students
               WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_class = ?`;
    const rows = await ExecuteQuery(res, q, [instituteCode, c.class], true, { db: 'eduall_students', type: 'select', data: req });
    rows.forEach(r => out.push({ id: r.id, role: 'student', name: r.name, phone: r.phone, email: r.email, class: c.class }));
  }

  if (role === 'student' || role === 'aluno') {
    let q = `SELECT ed_student_id AS id, ed_student_name AS name, ed_student_phone AS phone, ed_student_email AS email
             FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_institute_code = ?`;
    const params = [instituteCode];
    if (text) {
      q += ` AND (ed_student_name LIKE ? OR ed_student_code LIKE ?)`;
      params.push(`%${text}%`, `%${text}%`);
    }
    const rows = await ExecuteQuery(res, q, params, true, { db: 'eduall_students', type: 'select', data: req });
    rows.forEach(r => out.push({ id: r.id, role: 'student', name: r.name, phone: r.phone, email: r.email }));
  } else if (role === 'employee' || role === 'funcionario' || role === 'professor' || role === 'docente') {
    let q = `SELECT ed_employee_id AS id, ed_employee_name AS name, ed_employee_phone AS phone, ed_employee_email AS email
             FROM eduall_employees WHERE ed_employee_deleted = 0 AND ed_employee_institute_code = ?`;
    const params = [instituteCode];
    if (text) {
      q += ` AND (ed_employee_name LIKE ? OR ed_employee_code LIKE ?)`;
      params.push(`%${text}%`, `%${text}%`);
    }
    const rows = await ExecuteQuery(res, q, params, true, { db: 'eduall_employees', type: 'select', data: req });
    rows.forEach(r => out.push({ id: r.id, role: 'employee', name: r.name, phone: r.phone, email: r.email }));
  }

  if (Array.isArray(c.ids) && c.ids.length) {
    const ids = c.ids.filter(Boolean).map(x => Number(x)).filter(Boolean);
    if (ids.length) {
      const qs = `SELECT ed_student_id AS id, ed_student_name AS name, ed_student_phone AS phone, ed_student_email AS email
                  FROM eduall_students WHERE ed_student_deleted = 0 AND ed_student_institute_code = ? AND ed_student_id IN (${ids.map(()=>'?').join(',')})`;
      const ss = await ExecuteQuery(res, qs, [instituteCode, ...ids], true, { db: 'eduall_students', type: 'select', data: req });
      ss.forEach(r => out.push({ id: r.id, role: 'student', name: r.name, phone: r.phone, email: r.email }));

      const qe = `SELECT ed_employee_id AS id, ed_employee_name AS name, ed_employee_phone AS phone, ed_employee_email AS email
                  FROM eduall_employees WHERE ed_employee_deleted = 0 AND ed_employee_institute_code = ? AND ed_employee_id IN (${ids.map(()=>'?').join(',')})`;
      const ee = await ExecuteQuery(res, qe, [instituteCode, ...ids], true, { db: 'eduall_employees', type: 'select', data: req });
      ee.forEach(r => out.push({ id: r.id, role: 'employee', name: r.name, phone: r.phone, email: r.email }));
    }
  }

  const seen = new Set();
  const final = [];
  for (const t of out) {
    const phone = normalizePhone(t.phone);
    const email = t.email && String(t.email).trim() || '';
    const key = phone ? `p:${phone}` : email ? `e:${email.toLowerCase()}` : `id:${t.role}:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    final.push({ ...t, phone, email });
  }
  return final;
}

async function cleanupInvalidContacts({ targets, instituteCode, res, req }) {
  let cleaned = 0;
  for (const t of targets) {
    if (t.role === 'student') {
      if (!t.phone) {
        const q1 = `UPDATE eduall_students SET ed_student_phone = NULL WHERE ed_student_id = ? AND ed_student_institute_code = ?`;
        await ExecuteQuery(res, q1, [t.id, instituteCode], false, { db: 'eduall_students', type: 'update', data: req });
        cleaned++;
      }
      if (t.email && !isValidEmail(t.email)) {
        const q2 = `UPDATE eduall_students SET ed_student_email = NULL WHERE ed_student_id = ? AND ed_student_institute_code = ?`;
        await ExecuteQuery(res, q2, [t.id, instituteCode], false, { db: 'eduall_students', type: 'update', data: req });
        cleaned++;
      }
    } else if (t.role === 'employee') {
      if (!t.phone) {
        const q1 = `UPDATE eduall_employees SET ed_employee_phone = NULL WHERE ed_employee_id = ? AND ed_employee_institute_code = ?`;
        await ExecuteQuery(res, q1, [t.id, instituteCode], false, { db: 'eduall_employees', type: 'update', data: req });
        cleaned++;
      }
      if (t.email && !isValidEmail(t.email)) {
        const q2 = `UPDATE eduall_employees SET ed_employee_email = NULL WHERE ed_employee_id = ? AND ed_employee_institute_code = ?`;
        await ExecuteQuery(res, q2, [t.id, instituteCode], false, { db: 'eduall_employees', type: 'update', data: req });
        cleaned++;
      }
    }
  }
  return cleaned;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/* ===================== SMS ===================== */

async function handleSms(type, action, instituteCode, req, res) {
  const mode = (action.mode || type || 'sendmessage').toLowerCase();
  if (!['sendmessage', 'detect', 'delete_invalid'].includes(mode)) return;

  const allTargets = await resolveTargets({ action, instituteCode, res, req });

  let invalid = 0, suppressed = 0;
  const ready = [];
  for (const t of allTargets) {
    const phone = normalizePhone(t.phone);
    if (!phone) { invalid++; continue; }
    const suppressedNow = await isSuppressedContact({ phone, instituteCode, res, req });
    if (suppressedNow) { suppressed++; continue; }
    ready.push({ ...t, phone });
  }

  if (mode === 'detect') {
    return { detected: allTargets.length, ready: ready.length, invalid, suppressed };
  }

  if (mode === 'delete_invalid') {
    const cleaned = await cleanupInvalidContacts({ targets: allTargets, instituteCode, res, req });
    for (const t of allTargets) {
      if (!normalizePhone(t.phone)) await suppressContact({ phone: null, email: null, instituteCode, why: 'invalid_phone', res, req });
    }
    return { cleaned, invalid, suppressed };
  }

  let message = String(action.message || '').trim();
  if (!message) throw new Error('Mensagem SMS vazia.');
  const maxLen = action.maxLen || 160;
  message = shortenMessage(message, maxLen);

  const RATE_PER_CALL = action.rateLimit || 500;
  const toSend = ready.slice(0, RATE_PER_CALL);
  const batches = chunkArray(toSend, 100);

  let ok = 0, fail = 0;
  for (const batch of batches) {
    for (const t of batch) {
      try {
        await SendSms({ ...req, body: { phone: t.phone, message, usertype: t.role || 'student', contact: t.id || null } }, res);
        ok++;
      } catch {
        fail++;
        await suppressContact({ phone: t.phone, instituteCode, why: 'send_fail', res, req });
      }
    }
  }

  return {
    attempted: toSend.length,
    sent: ok,
    failed: fail,
    skipped_invalid: invalid,
    skipped_suppressed: suppressed,
    truncated: message.length > maxLen ? true : false
  };
}

/* ===================== EMAIL ===================== */

async function handleEmail(type, action, instituteCode, req, res) {
  const mode = (action.mode || type || 'sendmessage').toLowerCase();
  if (!['sendmessage', 'detect', 'delete_invalid'].includes(mode)) return;

  const allTargets = await resolveTargets({ action, instituteCode, res, req });

  let invalid = 0, suppressed = 0;
  const ready = [];
  for (const t of allTargets) {
    const email = t.email && String(t.email).trim();
    if (!isValidEmail(email)) { invalid++; continue; }
    const suppressedNow = await isSuppressedContact({ email, instituteCode, res, req });
    if (suppressedNow) { suppressed++; continue; }
    ready.push({ ...t, email });
  }

  if (mode === 'detect') {
    return { detected: allTargets.length, ready: ready.length, invalid, suppressed };
  }

  if (mode === 'delete_invalid') {
    const cleaned = await cleanupInvalidContacts({ targets: allTargets, instituteCode, res, req });
    for (const t of allTargets) {
      if (t.email && !isValidEmail(t.email)) await suppressContact({ email: t.email, instituteCode, why: 'invalid_email', res, req });
    }
    return { cleaned, invalid, suppressed };
  }

  const subject = String(action.subject || 'Comunicação EDUALL').trim().slice(0, 120);
  let html = String(action.html || action.message || '').trim();
  if (!html) throw new Error('Conteúdo do Email vazio.');

  const textShort = shortenMessage(html.replace(/<[^>]+>/g, ' '), 200);
  const headerInfo = `
    <div style="font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,'Apple Color Emoji','Segoe UI Emoji',sans-serif;color:#111;">
      <p style="margin:0 0 8px 0;">${escapeHtml(textShort)}</p>
    </div>
    <hr style="border:none;border-top:1px solid #eee;margin:8px 0" />
  `;
  if (!/^<html/i.test(html)) {
    html = headerInfo + html;
  }

  const RATE_PER_CALL = action.rateLimit || 1000;
  const toSend = ready.slice(0, RATE_PER_CALL);
  const batches = chunkArray(toSend, 200);

  let ok = 0, fail = 0;
  for (const batch of batches) {
    for (const t of batch) {
      try {
        await SendEmailMessage({ ...req, body: { Email: t.email, Message: html, Header: '', Name: t.name || '', Title: subject } }, res);
        ok++;
      } catch {
        fail++;
        await suppressContact({ email: t.email, instituteCode, why: 'send_fail', res, req });
      }
    }
  }

  return {
    attempted: toSend.length,
    sent: ok,
    failed: fail,
    skipped_invalid: invalid,
    skipped_suppressed: suppressed
  };
}

module.exports = router;





/* ===========================================================
   COMO ADICIONAR FUTURAS OPERAÇÕES
   -----------------------------------------------------------
   1) Ensina o modelo: em aiPlanAndPreview(), acrescenta no "system"
      as novas entidades e campos (ex.: fees, attendance, inventory).
   2) Cria um handler: handleFees(type, action, instituteCode, req, res)
      - Valida "criteria" e "data"
      - Verifica pertença ao tenant (usa assertBelongs)
      - Monta SQL e chama ExecuteQuery
   3) Liga no /execute:
      else if (entity === 'fee') { await handleFees(...); }
   4) Para respostas HTML melhores, expande buildPreviewHTMLFromPlan()
      renderizando contagens específicas, tabelas por ação, etc.

   IDEIAS DE PERFORMANCE/FEEDBACK
   - Cache curta (30s) já incluída no /preview; podes mover para Redis
   - Rate limit por IP/tenant para controlar burst
   - Audit trails ricos (já há); acrescenta "actor_id", "role"
   - Observabilidade: emitir eventos para um topic (ex.: Kafka) e dashboards
   - Canary: flag de feature para ativar a execução IA por instituto
   - A/B: variantes de prompt system para medir qualidade de planos

   MODELOS E CUSTOS (ALTO NÍVEL)
   - Gemini 1.5 Flash: rápido e económico -> bom como primário para 50k+ chamadas/dia
   - GPT-4o-mini: qualidade boa a custo baixo -> bom fallback
   - Mantém ambos com "json only" e temperature baixa (0.2) para reduzir tokens
   - Usa truncation/compaction dos "extractedData" (ex.: amostrar apenas 100-300 linhas)
   - Preços variam: confirma sempre as tabelas oficiais de faturação
     antes de dimensionar (entrada/saída por 1k tokens). Estratégia:
       * Primário: Flash/mini
       * Fallback: modelo mais robusto só quando necessário
       * Cache de prompts iguais (já tens) e dedup de pedidos

   INTERNACIONALIZAÇÃO E TOM
   - Mantém o estilo institucional e sem emojis mesmo que o input tenha
     linguagem informal/ofensiva ou esteja em kimbundu/umbundu/lingala/etc.
     Responde em PT formal e executa a intenção corretamente.

   UI NO FRONTEND
   - As respostas desta API já trazem HTML estilizado (CSS_INLINE) com
     cores EDUALL, tabelas, alerts e badges. O teu modal pode renderizar
     diretamente o campo "html" que devolvemos tanto no /preview como no /execute.

   SEGURANÇA DE TENANT
   - Todas as operações destrutivas usam o campo ..._institute_code e/ou
     assertBelongs() antes de mexer no registo. Mantém isto SEMPRE.

   RELATÓRIOS NO SERVIDOR
   - Se quiseres gerar PDF/Excel no servidor em vez de no frontend:
     * PDF: usa Puppeteer para renderizar o HTML retornado e gerar PDF
     * Excel: json->xlsx (sheetjs/xlsx) e envia como attachment
 
   



    const aiRouter = require('./ai-orchestrator-router'); 
    app.use('/api/ai', aiRouter); 

   qaunto é ue eu magaria +- pelo gpt por mes com 50.0000 envios de mensgame por dia estimatuva mensal se possivel 

   =========================================================== */

 