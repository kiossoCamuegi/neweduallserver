  // ================== Mini-app de emergência (arranca PRIMEIRO) ==================
 // Só precisa de módulos nativos do Node — nunca falha
 const http = require("http");
 const path = require("path");
 const fs   = require("fs");
const dbConfig = require("./config/DatabaseCredentials");
 
 const BOOT_ERRORS = [];
 const BOOT_START  = Date.now();
 
 // Servidor de emergência na porta do Passenger
 const EMERGENCY_PORT = Number(process.env.PORT || 7500);
 
 const emergencyServer = http.createServer((req, res) => {
   // Resposta mínima enquanto a app carrega — será substituída pela app express em breves segundos
   const uptime = ((Date.now() - BOOT_START) / 1000).toFixed(1);
   const errCount = BOOT_ERRORS.length;
   const errColor = errCount > 0 ? "#ff5555" : "#4caf50";
   const errList  = errCount > 0
     ? BOOT_ERRORS.map(e => `<li style="color:#f55;margin:4px 0"><strong>${e.label}</strong>: ${e.error}</li>`).join("")
     : "<li style='color:#4caf50'>Sem erros — a carregar módulos...</li>";
   res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
   res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="refresh" content="3">
 <title>EduAll — A arrancar</title></head>
 <body style="background:#111;color:#d4d4d4;font-family:monospace;padding:24px">
 <h2 style="color:#fff;margin-bottom:8px">EduAll — a carregar... (${uptime}s)</h2>
 <p style="color:#666;font-size:12px;margin-bottom:16px">Atualiza automaticamente a cada 3s</p>
 <p>Erros: <span style="color:${errColor};font-weight:bold">${errCount}</span></p>
 <ul style="margin-top:8px;padding-left:20px">${errList}</ul>
 </body></html>`);
 });
 
 emergencyServer.listen(EMERGENCY_PORT, () => {
   console.log(`[BOOT] Servidor de emergência na porta ${EMERGENCY_PORT}`);
   // Agora carrega o resto da app de forma segura
   loadFullApp();
 });
 
 // ================== Carregamento seguro da app completa ==================
 function safeRequire(modulePath, label) {
   try {
     return require(modulePath);
   } catch (err) {
     BOOT_ERRORS.push({ label, modulePath, error: err.message, stack: err.stack });
     console.error(`[BOOT ERR] ${label}: ${err.message}`);
     return null;
   }
 }
 
 function loadFullApp() {
   // -- Dependências npm (cada uma isolada) --
   const express         = safeRequire("express",               "express");
   const cookieParser    = safeRequire("cookie-parser",         "cookie-parser");
   const cors            = safeRequire("cors",                  "cors");
   const passport        = safeRequire("passport",              "passport");
   const session         = safeRequire("express-session",       "express-session");
   const MySQLStoreFactory = safeRequire("express-mysql-session","express-mysql-session");
   const mysql2          = safeRequire("mysql2",                "mysql2");
   const helmet          = safeRequire("helmet",                "helmet");
   const compression     = safeRequire("compression",           "compression");
   const morgan          = safeRequire("morgan",                "morgan");
   const dotenv          = safeRequire("dotenv",                "dotenv");
   const cloudinaryPkg   = safeRequire("cloudinary",            "cloudinary");
   const socketIoPkg     = safeRequire("socket.io",             "socket.io");
 
   // Se express não carregou não há nada a fazer — o emergencyServer já responde
   if (!express) {
     BOOT_ERRORS.push({ label: "loadFullApp", error: "express não disponível — a ficar no modo de emergência" });
     return;
   }
 
   // ================== dotenv ==================
   if (dotenv) {
     try {
       const result = dotenv.config({ path: path.join(__dirname, "./.env") });
       if (result.error) {
         BOOT_ERRORS.push({ label: "dotenv (.env file)", error: result.error.message });
         console.warn("[BOOT WARN] .env nao carregado:", result.error.message);
       } else {
         console.log("[BOOT] .env carregado — vars:", Object.keys(result.parsed || {}).length);
       }
     } catch(e) { BOOT_ERRORS.push({ label: "dotenv.config", error: e.message }); }
   }
 
   const cloudinary = cloudinaryPkg?.v2 ?? null;
   const SocketServer = socketIoPkg?.Server ?? null;
 
   const mainUrl        = process.env.APP_CLIENT_URL || "";
   const expiryDate     = 1000 * 60 * 60 * 24 * 31;
   const allowedOrigins = [mainUrl].filter(Boolean);
 
   const app = express();
   app.set("trust proxy", 1);
 
   // Segurança / perf
   if (helmet)      { try { app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } })); } catch(e) { BOOT_ERRORS.push({ label:"helmet", error: e.message }); } }
   if (compression) { try { app.use(compression()); } catch(e) { BOOT_ERRORS.push({ label:"compression", error: e.message }); } }
   if (morgan)      { try { app.use(morgan(process.env.NODE_ENV === "production" ? "tiny" : "dev")); } catch(e) { BOOT_ERRORS.push({ label:"morgan", error: e.message }); } }
 
   app.use(express.json({ limit: "500mb" }));
   app.use(express.urlencoded({ extended: true }));
 
   // CORS
   if (cors) {
     try {
       app.use(cors({
         origin: (origin, cb) => {
           if (!origin) return cb(null, true);
           if (allowedOrigins.length === 0 || allowedOrigins.includes(origin)) return cb(null, true);
           return cb(new Error("Not allowed by CORS"));
         },
         credentials: true,
         methods: ["GET","POST","DELETE","PUT","OPTIONS","PATCH"],
         allowedHeaders: ["Content-Type","Authorization","X-Requested-With"],
       }));
     } catch(e) { BOOT_ERRORS.push({ label:"cors middleware", error: e.message }); }
   }
 
   // MySQL pool
   let pool = null, promisePool = null;
   if (mysql2) {
     try {
       pool = mysql2.createPool({
         ...dbConfig,
         charset: "utf8mb4",
         waitForConnections: true,
         connectionLimit: Number(process.env.DB_CONN_LIMIT || 50),
         maxIdle: Number(process.env.DB_MAX_IDLE || 20),
         idleTimeout: Number(process.env.DB_IDLE_TIMEOUT || 60000),
         queueLimit: 0,
         enableKeepAlive: true,
         keepAliveInitialDelay: 10000,
       });
       promisePool = pool.promise();
     } catch(e) { BOOT_ERRORS.push({ label:"mysql2 pool", error: e.message }); }
   }
 
   async function queryWithRetry(sql, params = [], { retries = 2 } = {}) {
     let lastErr;
     for (let attempt = 0; attempt <= retries; attempt++) {
       try {
         const [rows] = await promisePool.query(sql, params);
         return rows;
       } catch (err) {
         lastErr = err;
         const recoverable = ["PROTOCOL_CONNECTION_LOST","ECONNRESET","ETIMEDOUT","EPIPE","PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR","PROTOCOL_PACKETS_OUT_OF_ORDER"];
         if (!recoverable.includes(err.code)) break;
         await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
       }
     }
     throw lastErr;
   }
 
   async function ExecuteQuery(res, sql, params = [], _silent = true) {
     try {
       return await queryWithRetry(sql, params);
     } catch (err) {
       if (!_silent && res) return res.status(500).json({ error: err.message, code: err.code });
       throw err;
     }
   }
 
   // Sessão
   if (session && MySQLStoreFactory && pool) {
     try {
       const MySQLStore  = MySQLStoreFactory(session);
       const sessionStore = new MySQLStore({ expiration: expiryDate, clearExpired: true, checkExpirationInterval: 15 * 60 * 1000 }, pool);
       if (cookieParser) app.use(cookieParser());
       app.use(session({
         secret: process.env.SESSION_SECRET || "troque-este-segredo",
         resave: false,
         saveUninitialized: true,
         store: sessionStore,
         cookie: { httpOnly: true, maxAge: expiryDate, secure: process.env.NODE_ENV === "production", sameSite: "none" },
       }));
     } catch(e) { BOOT_ERRORS.push({ label:"session/store", error: e.message }); }
   }
 
   if (passport) { try { app.use(passport.initialize()); } catch(e) { BOOT_ERRORS.push({ label:"passport", error: e.message }); } }
 
   // Estáticos
   app.use("/public", express.static("public"));
   const IMAGES_DIR = path.resolve(__dirname, "images");
   const ASSETS_DIR = path.resolve(__dirname, "assets");
   const VIDEOS_DIR = path.resolve(__dirname, "videos");
   const staticOpts = { etag: true, lastModified: true, maxAge: "30d", immutable: true };
   const staticCors = cors ? cors({ origin: allowedOrigins.length ? allowedOrigins : true, credentials: true, methods: ["GET","OPTIONS"] }) : (_, __, n) => n();
   app.use("/assets", staticCors, express.static(ASSETS_DIR, staticOpts));
   app.use("/videos", staticCors, express.static(VIDEOS_DIR, staticOpts));
   app.use("/images", staticCors, (req, res, next) => {
     res.setHeader("Access-Control-Allow-Origin", allowedOrigins.length ? allowedOrigins[0] : "*");
     res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
     next();
   }, express.static(IMAGES_DIR, staticOpts));
 
   // Cloudinary
   if (cloudinary) {
     try {
       cloudinary.config({ cloud_name: process.env.CLOUDINARY_NAME || "", api_key: process.env.CLOUDINARY_KEY || "", api_secret: process.env.CLOUDINARY_SECRET || "" });
     } catch(e) { BOOT_ERRORS.push({ label:"cloudinary.config", error: e.message }); }
   }
 
   // ===== Rotas =====
   app.get("/debug/images", (_req, res) => {
     try {
       const exists = fs.existsSync(IMAGES_DIR);
       res.json({ imagesDir: IMAGES_DIR, exists, sampleFiles: exists ? fs.readdirSync(IMAGES_DIR).slice(0, 50) : [] });
     } catch(e) { res.status(500).json({ error: e.message }); }
   });
 
   app.get("/hits", (req, res) => res.json({
     cloud_name: process.env.CLOUDINARY_NAME || null,
     key_set: Boolean(process.env.CLOUDINARY_KEY),
     secret_set: Boolean(process.env.CLOUDINARY_SECRET),
   }));
 
   app.post("/hits", (req, res) => {
     if (req.session) req.session.hits = { email: req.body?.email, password: req.body?.password };
     res.json({ ok: true });
   });
 
   app.get("/views", async (req, res) => {
     try {
       if (!req.session) return res.json({ error: "sem sessão" });
       if (!req.session.views) req.session.views = 0;
       req.session.views++;
       if (!cloudinary) return res.json({ views: req.session.views, error: "cloudinary não carregado" });
       const result = await cloudinary.uploader.upload("https://i.postimg.cc/bYCSJ7w8/eduall-logo.png", { folder: "eduall" });
       res.json({ views: req.session.views, cloudinaryUrl: result.secure_url });
     } catch(e) { res.json({ views: req.session?.views || 0, error: e.message }); }
   });
 
   app.get("/testdb", async (req, res) => {
     if (!promisePool) return res.status(500).json({ error: "pool não inicializado" });
     try { res.send(await ExecuteQuery(res, "SELECT DATABASE() AS db")); }
     catch(e) { res.status(500).json({ error: e.message }); }
   });
 
   // ================== /debug/routes — lista todas as rotas registadas ==================
   app.get("/debug/routes", (req, res) => {
     if (req.query.token !== process.env.DEBUG_TOKEN) return res.status(403).send("Forbidden");
 
     const routes = [];
     function extractRoutes(stack, prefix = "") {
       for (const layer of stack || []) {
         if (layer.route) {
           const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase()).join(", ");
           routes.push({ method: methods, path: prefix + layer.route.path });
         } else if (layer.name === "router" && layer.handle?.stack) {
           const sub = layer.regexp?.source?.replace("^\\","").replace("\\/?(?=\\/|$)","").replace(/\\/g,"/") || "";
           extractRoutes(layer.handle.stack, prefix + (sub === "(?:)" ? "" : sub));
         }
       }
     }
     extractRoutes(app._router?.stack);
 
     const rows = routes.map(r =>
       `<tr><td style="padding:6px 10px;border-bottom:1px solid #222;color:#4af">${r.method}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #222;color:#fff">${r.path}</td></tr>`
     ).join("");
 
     res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
 <title>Rotas</title><style>
 body{background:#111;color:#d4d4d4;font-family:monospace;padding:20px}
 h2{color:#fff;margin-bottom:12px;font-size:16px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th{text-align:left;padding:8px 10px;background:#1a1a1a;color:#666;border-bottom:1px solid #333}
 </style></head><body>
 <h2>Rotas registadas (${routes.length})</h2>
 <table><thead><tr><th>Método</th><th>Path</th></tr></thead>
 <tbody>${rows}</tbody></table>
 </body></html>`);
   });
 
   app.get("/health", async (_req, res) => {
     try {
       if (promisePool) await promisePool.query("SELECT 1");
       res.json({ ok: true, db: Boolean(promisePool), uptime: process.uptime(), bootErrors: BOOT_ERRORS.length });
     } catch(e) {
       res.status(500).json({ ok: false, db: false, error: e.message, bootErrors: BOOT_ERRORS.length });
     }
   });
 
   app.get("/admin/logs", (req, res) => {
     if (req.query.token !== process.env.DEBUG_TOKEN) return res.status(403).send("Forbidden");
     const logPath = path.join(__dirname, "logs", "app.log");
     const content = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "Sem logs.";
     const lines = content.trim().split("\n").slice(-200);
     res.send(`<html><head><style>body{background:#1e1e1e;color:#d4d4d4;font-family:monospace;padding:20px}
       .error{color:#f44}.warn{color:#fa0}.info{color:#4af}pre{white-space:pre-wrap;word-break:break-all}
     </style><meta http-equiv="refresh" content="10"></head><body>
     <h3 style="color:#fff">App Log — últimas 200 linhas</h3>
     <pre>${lines.map(l => {
       if (l.includes("ERROR")||l.includes("UNCAUGHT")) return `<span class="error">${l}</span>`;
       if (l.includes("WARN")) return `<span class="warn">${l}</span>`;
       return `<span class="info">${l}</span>`;
     }).join("\n")}</pre></body></html>`);
   });
 
   // ================== routes/index ==================
   const routerIndex = safeRequire("./routes/index", "routes/index");
   if (routerIndex) {
     try {
       app.use(routerIndex);
       console.log("[BOOT] routes/index montado");
     } catch(e) { BOOT_ERRORS.push({ label: "routes/index mount", error: e.message, stack: e.stack }); }
   }
 
   // ================== routes/Auth ==================
   const Authrouter = safeRequire("./routes/Auth", "routes/Auth");
   if (Authrouter) {
     try {
       app.use(Authrouter);
       console.log("[BOOT] routes/Auth montado");
     } catch(e) { BOOT_ERRORS.push({ label: "routes/Auth mount", error: e.message, stack: e.stack }); }
   }
 
   // ================== GET / — boot status (definido DEPOIS dos routes para capturar erros deles) ==================
   app.get("/", (_req, res) => {
     if (process.env.APP_CLIENT_URL && BOOT_ERRORS.length === 0) {
       return res.redirect(302, process.env.APP_CLIENT_URL);
     }
     const now    = new Date().toISOString();
     const uptime = process.uptime().toFixed(1);
     const rows   = BOOT_ERRORS.length === 0
       ? `<tr><td colspan="3" style="color:#4caf50;text-align:center;padding:12px">✅ Sem erros de arranque</td></tr>`
       : BOOT_ERRORS.map((e, i) => `<tr>
           <td style="padding:8px;border-bottom:1px solid #222;color:#aaa">${i+1}</td>
           <td style="padding:8px;border-bottom:1px solid #222">
             <strong style="color:#fff">${e.label}</strong>
             ${e.modulePath ? `<br><small style="color:#555">${e.modulePath}</small>` : ""}
           </td>
           <td style="padding:8px;border-bottom:1px solid #222;color:#f55">
             ${e.error}
             ${e.stack ? `<br><details><summary style="cursor:pointer;color:#fa0;font-size:11px">stack trace</summary><pre style="font-size:10px;color:#aaa">${e.stack}</pre></details>` : ""}
           </td>
         </tr>`).join("");
     res.send(`<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8"><meta http-equiv="refresh" content="5">
 <title>EduAll Boot</title><style>
 *{box-sizing:border-box;margin:0;padding:0}
 body{background:#111;color:#d4d4d4;font-family:monospace;padding:24px}
 h1{font-size:18px;color:#fff;margin-bottom:4px}
 .sub{font-size:12px;color:#666;margin-bottom:20px}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:20px}
 .card{background:#1e1e1e;border:1px solid #2a2a2a;border-radius:6px;padding:12px 14px}
 .lbl{font-size:11px;color:#666;margin-bottom:4px}
 .val{font-size:18px;color:#fff}
 .ok{color:#4caf50!important}.err{color:#ff5555!important}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th{text-align:left;padding:8px 10px;background:#1a1a1a;color:#666;font-weight:normal;border-bottom:1px solid #333}
 pre{white-space:pre-wrap;word-break:break-all}
 .links{margin-top:16px;display:flex;gap:8px;flex-wrap:wrap}
 .links a{color:#4af;font-size:12px;text-decoration:none;background:#1e1e1e;border:1px solid #333;padding:5px 10px;border-radius:4px}
 </style></head><body>
 <h1>EduAll — Boot Status</h1>
 <div class="sub">Atualiza a cada 5s &nbsp;·&nbsp; ${now}</div>
 <div class="grid">
   <div class="card"><div class="lbl">uptime</div><div class="val">${uptime}s</div></div>
   <div class="card"><div class="lbl">node env</div><div class="val">${process.env.NODE_ENV||"—"}</div></div>
   <div class="card"><div class="lbl">porta</div><div class="val">${EMERGENCY_PORT}</div></div>
   <div class="card"><div class="lbl">erros</div><div class="val ${BOOT_ERRORS.length>0?"err":"ok"}">${BOOT_ERRORS.length}</div></div>
 </div>
 <table><thead><tr><th>#</th><th>Módulo / Fase</th><th>Erro</th></tr></thead>
 <tbody>${rows}</tbody></table>
 <div class="links">
   <a href="/health">/health</a>
   <a href="/testdb">/testdb</a>
   <a href="/hits">/hits</a>
   <a href="/debug/images">/debug/images</a>
   <a href="/admin/logs?token=${process.env.DEBUG_TOKEN||""}">/admin/logs</a>
   <a href="/debug/routes?token=${process.env.DEBUG_TOKEN||""}">/debug/routes</a>
 </div>
 </body></html>`);
   });
 
   // Erro handler
   app.use((err, _req, res, _next) => {
     if (err?.message?.includes("CORS")) return res.status(403).json({ error: "Acesso negado por CORS" });
     console.error("ERRO:", err.message);
     res.status(err.status || 500).json({ error: err.message });
   });
 
   // ================== Sockets/GetSocketIo ==================
   const SOCKET_IO = safeRequire("./Sockets/GetSocketIo", "Sockets/GetSocketIo");
 
   // ================== Controllers/FormBuilderController ==================
   const FormBuilderMod = safeRequire("./Controllers/FormBuilderController", "Controllers/FormBuilderController");
   let formBuilderRouter = null;
   let formBuilderSockets = null;
   if (FormBuilderMod) {
     try {
       const built = FormBuilderMod();
       formBuilderRouter  = built.router;
       formBuilderSockets = built.attachSockets;
       app.use("/api", formBuilderRouter);
       console.log("[BOOT] FormBuilderController montado");
     } catch(e) { BOOT_ERRORS.push({ label: "FormBuilderController mount", error: e.message, stack: e.stack }); }
   }
 
 
   // Socket.IO
   let io = null;
   if (SocketServer) {
     try {
       const HTTPApp = http.createServer(app);
       io = new SocketServer(HTTPApp, { cors: { origin: allowedOrigins.length ? allowedOrigins : true, credentials: true } });
       app.set("io", io);
 
       // GetSocketIo.init
       if (SOCKET_IO) {
         try { SOCKET_IO.init(io); console.log("[BOOT] GetSocketIo iniciado"); }
         catch(e) { BOOT_ERRORS.push({ label: "GetSocketIo.init", error: e.message, stack: e.stack }); }
       }
 
       // SocketMain
       try { require("./Sockets/SocketMain"); console.log("[BOOT] SocketMain carregado"); }
       catch(e) { BOOT_ERRORS.push({ label: "SocketMain", modulePath: "./Sockets/SocketMain", error: e.message, stack: e.stack }); }
 
       // FormBuilder sockets
       if (formBuilderSockets) {
         try { formBuilderSockets(io); console.log("[BOOT] FormBuilder sockets ligados"); }
         catch(e) { BOOT_ERRORS.push({ label: "FormBuilder sockets", error: e.message, stack: e.stack }); }
       }
 
       io.on("connection", socket => {
         console.log("Socket:", socket.id);
         socket.on("disconnect", () => console.log("Socket off:", socket.id));
       });
 
       emergencyServer.removeAllListeners("request");
       emergencyServer.on("request", app);
       console.log("[BOOT] App completa montada com sucesso.");
     } catch(e) { BOOT_ERRORS.push({ label:"socket.io setup", error: e.message, stack: e.stack }); mountExpressOnly(app); }
   } else {
     mountExpressOnly(app);
   }
 
   // Encerramento gracioso
   async function shutdown() {
     console.log("[STOP] A encerrar...");
     try { if (promisePool) await promisePool.end(); } catch(_) {}
     emergencyServer.close(() => { console.log("[OK] Bye!"); process.exit(0); });
     setTimeout(() => process.exit(1), 5000).unref();
   }
   process.on("SIGINT", shutdown);
   process.on("SIGTERM", shutdown);
 }
 
 function mountExpressOnly(app) {
   // sem socket.io — monta a app express directamente no emergencyServer
   emergencyServer.removeAllListeners("request");
   emergencyServer.on("request", app);
   console.log("[BOOT] App express montada (sem socket.io).");
 }
 
 // Erros não capturados — registar, nunca crashar
 process.on("uncaughtException", (err) => {
   console.error("UncaughtException:", err.message);
   BOOT_ERRORS.push({ label: "uncaughtException (runtime)", error: err.message, stack: err.stack });
 });
 process.on("unhandledRejection", (reason) => {
   const msg = reason instanceof Error ? reason.message : String(reason);
   console.error("UnhandledRejection:", msg);
   BOOT_ERRORS.push({ label: "unhandledRejection (runtime)", error: msg, stack: reason?.stack || "" });
 });
 
 module.exports = {};