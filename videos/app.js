 
  
   const createError = require('http-errors');
   const express = require('express');
   const path = require('path');
   const cookieParser = require('cookie-parser');
   const dotenv = require("dotenv");
   const bodyParser = require("body-parser");
   const cors = require("cors");
   const passport = require("passport");
   const session = require("express-session");
   const mysql = require("mysql");
   const MySQLStore = require("express-mysql-session")(session);
   const Sanitize = require('./middleware/Sanitize');
   const RandomStrings = require('./config/RandomStrings');
   const SocketSession = require("express-socket.io-session");
   
   const router = require('./routes/index');
   const Authrouter = require('./routes/Auth');
   const ExecuteQuery = require('./Functions/ExecuteQuery');
   
   const app = express();
   dotenv.config({ path: path.join(__dirname, './.env') });
   
   const CODE = RandomStrings();
   const mainUrl = process.env.APP_CLIENT_URL;
   const expiryDate = 1000 * 60 * 60 * 24 * 31; // 31 dias
   
   // --- Configuração CORS GLOBAL ---
   // Permitir vários domínios conforme necessidade
   const allowedOrigins =  mainUrl
   
   app.use(cors({
     origin: function (origin, callback) {
       if (!origin) {
         console.log("[⚠️ CORS] Requisição sem origin (ex: curl ou mobile app)");
         return callback(null, true);
       }
       if (allowedOrigins.includes(origin)) {
         return callback(null, true);
       } else {
         console.warn(`[❌ CORS] Origin não permitida: ${origin}`);
         return callback(new Error('Not allowed by CORS'));
       }
     },
     credentials: true,
     methods: ['GET', 'POST', 'DELETE', 'PUT', 'OPTIONS'],
     allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
   }));
    
   const dbOptions =  {
  connectionLimit: 10,
  password: "q!s&$AXo@{dc",
  user: "eduallpt_andre",
  database: "eduallpt_institutes",
  host: "cpanel155.dnscpanel.com",
  charset: "utf8mb4",
};
   
   let sessionConnection;
   function handleDisconnect() {
     sessionConnection = mysql.createConnection(dbOptions);
     sessionConnection.connect(err => {
       if (err) {
         console.error('[❌ DB CONN ERROR]:', err);
         setTimeout(handleDisconnect, 2000); // tenta reconectar após 2s
       } else {
         console.log("[ DB CONN OK]");
       }
     });
     sessionConnection.on('error', err => {
       if (err.code === 'PROTOCOL_CONNECTION_LOST') {
         console.warn('[⚠️ Reconnecting MySQL]');
         handleDisconnect();
       } else {
         throw err;
       }
     });
   }
   handleDisconnect();
   
   const sessionStore = new MySQLStore({}, sessionConnection);
   
   const appSession = session({
     secret: 'somerandom',
     resave: false,
     saveUninitialized: false,
     store: sessionStore,
     cookie: {
       httpOnly: true,
       maxAge: expiryDate,
       secure: false // true em produção com HTTPS
     }
   });
   
   app.use(appSession);
   
   // Middleware para bloquear acesso direto não autorizado (revisado)
   app.use((req, res, next) => {
     const referer = req.headers.referer || '';
     const origin = req.headers.origin || '';
     const host = req.headers.host || '';
   
     const isApiRequest = req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/eduall');
     const allowedOrigin = mainUrl.replace(/\/$/, ''); // remove slash no final
   
     if (
       origin && !origin.includes(allowedOrigin) &&
       referer && !referer.includes(allowedOrigin) &&
       !host.includes('localhost') &&
       !host.includes('127.0.0.1')
     ) {
       console.warn(`[🚫 Acesso bloqueado - origem não permitida] Origin: ${origin} | Referer: ${referer} | Host: ${host}`);
       return res.redirect(301, mainUrl);
     }
   
     next();
   });
   
   app.use(passport.initialize());
   app.use(express.json());
   app.use(bodyParser.urlencoded({ extended: true }));
   app.use(bodyParser.json());
   app.use(cookieParser());
   
   // Define as rotas públicas com CORS e servindo estáticos
   const staticCorsOptions = {
     origin: allowedOrigins,
     credentials: true,
     methods: ['GET', 'OPTIONS'],
   };
   
   app.use('/images', cors(staticCorsOptions), express.static(path.join(__dirname, 'images')));
   app.use('/assets', cors(staticCorsOptions), express.static(path.join(__dirname, 'assets')));
   app.use('/videos', cors(staticCorsOptions), express.static(path.join(__dirname, 'videos')));
   
   // Middleware de debug da sessão
   app.use(async (req, res, next) => {
     if (req.session && req.session.user) {
       req.session.user.views = (req.session.user.views || 0) + 1;
   
       if (req.method === 'POST' && req.originalUrl.startsWith('/eduallupdatecurrentinstitutecode/post/')) {
         const code = req.params.CODE || req.originalUrl.split('/').pop();
         const preview = code.length > 10 ? code.slice(0, 10) + '...' : code;
   
         if (code && code.length > 4) {
           try {
             const query = 'SELECT * FROM eduall_institutes WHERE ed_institute_deleted = 0 AND ed_institute_code = ?';
             const PARAMS = [code];
             const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduallpt_institutes", type: "select", data: req });
   
             if (result && result.length > 0) {
               req.session.user.eduall_user_session_curentinstitute = code;
               req.session.user.eduall_user_session_curentinstitute_type = result[0].ed_institute_type * 1;
               console.log(`[🎓 Instituição atualizada: ${preview}] Tipo: ${result[0].ed_institute_type}`);
             } else {
               console.warn(`[⚠️ Instituto não encontrado para o CODE: ${code}]`);
             }
           } catch (error) {
             console.error(`[❌ Erro ao buscar instituto: ${error.message}]`);
           }
         }
   
         console.log(`[🔁 Alterando instituição] CODE: ${preview}`);
       }
   
       console.log(`[👤 Usuário: ${req.session.user.nome}] Views: ${req.session.user.views}`);
       if (req.session.user.eduall_user_session_curentinstitute) {
         console.log(`🎓 Instituição atual: ${req.session.user.eduall_user_session_curentinstitute}`);
       }
     } else {
       console.log(`[👥 Visitante anônimo acessou: ${req.originalUrl}]`);
     }
   
     next();
   });
   
   // Teste de sessão
   app.get('/hits', (req, res) => {
     if (req.session.hits) {
       res.status(200).json({
         sessionData: req.session.hits,
         views: req.session.views
       });
     } else {
       res.status(200).json("SESSION NOT FOUND!");
     }
   });
   
   app.post('/hits', (req, res) => {
     req.session.hits = { email: req.body.email, password: req.body.password };
     res.status(200).json(req.session.hits);
   });
   
   const HTTPApp = require('http').createServer(app);
   require("./Sockets/SocketMain");
   
   app.use(router);
   app.use(Authrouter);
   app.use(Sanitize());
   
   // Middleware de tratamento de erros (ajustado para erros CORS também)
   app.use((err, req, res, next) => {
     if (err.message && err.message.includes('CORS')) {
       console.warn(`[⚠️ Erro CORS detectado]: ${err.message}`);
       return res.status(403).json({ error: 'Acesso negado por CORS' });
     }
   
     console.error('🔥 ERRO NO SERVIDOR:', err.stack);
     res.status(err.status || 500).json({
       error: process.env.NODE_ENV === 'production'
         ? 'Erro interno no servidor'
         : err.message,
       stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
     });
   });
   
   // Inicia o servidor
   const PORT = process.env.PORT || 5000;
   HTTPApp.listen(PORT, () => {
     console.log(` Servidor iniciado na porta: ${PORT}`);
   });
   
   // Exportações
   module.exports = { app, HTTPApp, SocketSession, corsOptions: { allowedOrigins } };
   

 
 