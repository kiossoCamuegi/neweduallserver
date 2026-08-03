'use strict';

const express                   = require('express');
const http                      = require('http');
const socketIo                  = require('socket.io');
const moment                    = require('moment');
const cron                      = require('node-cron');
const axios                     = require('axios');

const ExecuteQuery              = require('../Functions/ExecuteQuery');
const { RegisterAuditAction }   = require('../Auditory');

require('dotenv').config();
moment.locale('pt');

// ═══════════════════════════════════════════════════════════════════════════════
//  APP + SERVER + SOCKET.IO
// ═══════════════════════════════════════════════════════════════════════════════
const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, {
  cors: { origin: process.env.APP_CLIENT_URL || '*', credentials: true },
  maxHttpBufferSize: 5e7, // 50MB para fotos/biometria
});

// ─────────────────────────────────────────────────────────────────────────────
//  MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ═══════════════════════════════════════════════════════════════════════════════
//  DDL — TABELAS DO SISTEMA BIOMÉTRICO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * TABELA: eduall_biometric_terminals
 * Terminal registration e device info
 */
const DDL_TERMINALS = `
CREATE TABLE IF NOT EXISTS eduall_biometric_terminals (
  ed_terminal_id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_terminal_sn                VARCHAR(50) NOT NULL UNIQUE,
  ed_terminal_cpusn             VARCHAR(100),
  ed_terminal_institute_code    VARCHAR(120) NOT NULL,
  ed_terminal_model             VARCHAR(100),
  ed_terminal_firmware          VARCHAR(100),
  ed_terminal_mac               VARCHAR(20),
  ed_terminal_user_capacity     INT DEFAULT 3000,
  ed_terminal_fp_capacity       INT DEFAULT 3000,
  ed_terminal_card_capacity     INT DEFAULT 3000,
  ed_terminal_pwd_capacity      INT DEFAULT 3000,
  ed_terminal_log_capacity      INT DEFAULT 100000,
  ed_terminal_used_users        INT DEFAULT 0,
  ed_terminal_used_fps          INT DEFAULT 0,
  ed_terminal_used_cards        INT DEFAULT 0,
  ed_terminal_used_pwds         INT DEFAULT 0,
  ed_terminal_used_logs         INT DEFAULT 0,
  ed_terminal_used_newlogs      INT DEFAULT 0,
  ed_terminal_fp_algorithm      VARCHAR(50),
  ed_terminal_status            ENUM('active','inactive','offline') DEFAULT 'offline',
  ed_terminal_last_heartbeat    DATETIME,
  ed_terminal_last_sync         DATETIME,
  ed_terminal_language          INT DEFAULT 0,
  ed_terminal_volume            INT DEFAULT 6,
  ed_terminal_verify_mode       INT DEFAULT 0,
  ed_terminal_sleep_enabled     TINYINT(1) DEFAULT 0,
  ed_terminal_user_fp_num       INT DEFAULT 3,
  ed_terminal_log_hint          INT DEFAULT 1000,
  ed_terminal_reverify_time     INT DEFAULT 0,
  ed_terminal_door_num          INT DEFAULT 1,
  ed_terminal_created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_terminal_updated_at        DATETIME NULL,
  
  UNIQUE KEY uq_sn              (ed_terminal_sn),
  INDEX idx_institute           (ed_terminal_institute_code),
  INDEX idx_status              (ed_terminal_status),
  INDEX idx_heartbeat           (ed_terminal_last_heartbeat)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_users
 * Utilizadores do terminal (matrícula, biometria, acesso)
 */
const DDL_BIOMETRIC_USERS = `
CREATE TABLE IF NOT EXISTS eduall_biometric_users (
  ed_bio_user_id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_bio_user_code              VARCHAR(80) NOT NULL UNIQUE,
  ed_bio_user_terminal_sn       VARCHAR(50) NOT NULL,
  ed_bio_user_institute_code    VARCHAR(120) NOT NULL,
  ed_bio_user_enroll_id         BIGINT NOT NULL,
  ed_bio_user_name              VARCHAR(200),
  ed_bio_user_department        VARCHAR(200),
  ed_bio_user_position          VARCHAR(200),
  ed_bio_user_card_number       VARCHAR(50),
  ed_bio_user_password          VARCHAR(100),
  ed_bio_user_admin_flag        TINYINT(1) DEFAULT 0,
  ed_bio_user_enabled           TINYINT(1) DEFAULT 1,
  ed_bio_user_fp_count          INT DEFAULT 0,
  ed_bio_user_face_count        INT DEFAULT 0,
  ed_bio_user_palm_count        INT DEFAULT 0,
  ed_bio_user_photo_base64      LONGBLOB,
  ed_bio_user_verify_mode       INT DEFAULT 0,
  ed_bio_user_group_id          INT DEFAULT 0,
  ed_bio_user_weekzone          INT DEFAULT 1,
  ed_bio_user_start_time        DATETIME,
  ed_bio_user_end_time          DATETIME,
  ed_bio_user_synced            TINYINT(1) DEFAULT 0,
  ed_bio_user_created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_bio_user_updated_at        DATETIME NULL,
  ed_bio_user_deleted           TINYINT(1) DEFAULT 0,
  
  UNIQUE KEY uq_enroll          (ed_bio_user_terminal_sn, ed_bio_user_enroll_id),
  INDEX idx_terminal            (ed_bio_user_terminal_sn),
  INDEX idx_institute           (ed_bio_user_institute_code),
  INDEX idx_enroll_id           (ed_bio_user_enroll_id),
  INDEX idx_enabled             (ed_bio_user_enabled),
  INDEX idx_deleted             (ed_bio_user_deleted)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_fingerprints
 * Dados biométricos (fingerprints, faces, palm vein)
 */
const DDL_BIOMETRIC_DATA = `
CREATE TABLE IF NOT EXISTS eduall_biometric_data (
  ed_bio_data_id                BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_bio_data_terminal_sn       VARCHAR(50) NOT NULL,
  ed_bio_data_user_id           BIGINT NOT NULL,
  ed_bio_data_enroll_id         BIGINT NOT NULL,
  ed_bio_data_type              ENUM('fingerprint','face','palm','photo') DEFAULT 'fingerprint',
  ed_bio_data_backup_num        INT DEFAULT 0,
  ed_bio_data_content           LONGBLOB NOT NULL,
  ed_bio_data_order             INT DEFAULT 0,
  ed_bio_data_quality           INT DEFAULT 0,
  ed_bio_data_synced            TINYINT(1) DEFAULT 0,
  ed_bio_data_created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (ed_bio_data_user_id) REFERENCES eduall_biometric_users(ed_bio_user_id) ON DELETE CASCADE,
  INDEX idx_terminal            (ed_bio_data_terminal_sn),
  INDEX idx_user_id             (ed_bio_data_user_id),
  INDEX idx_type                (ed_bio_data_type),
  INDEX idx_synced              (ed_bio_data_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_logs
 * Logs de acesso (punch records)
 */
const DDL_BIOMETRIC_LOGS = `
CREATE TABLE IF NOT EXISTS eduall_biometric_logs (
  ed_bio_log_id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_bio_log_code               VARCHAR(80) NOT NULL UNIQUE,
  ed_bio_log_terminal_sn        VARCHAR(50) NOT NULL,
  ed_bio_log_institute_code     VARCHAR(120) NOT NULL,
  ed_bio_log_enroll_id          BIGINT NOT NULL,
  ed_bio_log_user_name          VARCHAR(200),
  ed_bio_log_timestamp          DATETIME NOT NULL,
  ed_bio_log_mode               INT DEFAULT 0, -- 0:unknown 1:fp 2:pwd 3:card 8:face
  ed_bio_log_inout              INT DEFAULT 0, -- 0:in 1:out
  ed_bio_log_event              INT DEFAULT 0,
  ed_bio_log_temp               DECIMAL(5,2),
  ed_bio_log_image_base64       LONGTEXT,
  ed_bio_log_device_event       VARCHAR(100),
  ed_bio_log_synced             TINYINT(1) DEFAULT 0,
  ed_bio_log_access_granted     TINYINT(1) DEFAULT 1,
  ed_bio_log_door_num           INT DEFAULT 1,
  ed_bio_log_created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE KEY uq_log             (ed_bio_log_terminal_sn, ed_bio_log_timestamp, ed_bio_log_enroll_id),
  INDEX idx_terminal            (ed_bio_log_terminal_sn),
  INDEX idx_institute           (ed_bio_log_institute_code),
  INDEX idx_enroll_id           (ed_bio_log_enroll_id),
  INDEX idx_timestamp           (ed_bio_log_timestamp DESC),
  INDEX idx_synced              (ed_bio_log_synced),
  INDEX idx_mode                (ed_bio_log_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_access_rules
 * Regras de acesso por terminal (day zones, week zones, door control)
 */
const DDL_ACCESS_RULES = `
CREATE TABLE IF NOT EXISTS eduall_biometric_access_rules (
  ed_access_rule_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_access_rule_terminal_sn    VARCHAR(50) NOT NULL,
  ed_access_rule_type           VARCHAR(50), -- dayzone, weekzone, lockgroup, general
  ed_access_rule_name           VARCHAR(200),
  ed_access_rule_config         JSON,
  ed_access_rule_active         TINYINT(1) DEFAULT 1,
  ed_access_rule_synced         TINYINT(1) DEFAULT 0,
  ed_access_rule_created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_access_rule_updated_at     DATETIME NULL,
  
  INDEX idx_terminal            (ed_access_rule_terminal_sn),
  INDEX idx_type                (ed_access_rule_type),
  INDEX idx_synced              (ed_access_rule_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_user_access
 * Acesso por utilizador (per-user rules)
 */
const DDL_USER_ACCESS = `
CREATE TABLE IF NOT EXISTS eduall_biometric_user_access (
  ed_user_access_id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_user_access_terminal_sn    VARCHAR(50) NOT NULL,
  ed_user_access_user_id        BIGINT NOT NULL,
  ed_user_access_enroll_id      BIGINT NOT NULL,
  ed_user_access_weekzone       INT DEFAULT 1,
  ed_user_access_weekzone2      INT DEFAULT 1,
  ed_user_access_weekzone3      INT DEFAULT 1,
  ed_user_access_weekzone4      INT DEFAULT 1,
  ed_user_access_group_id       INT DEFAULT 0,
  ed_user_access_start_time     DATETIME,
  ed_user_access_end_time       DATETIME,
  ed_user_access_times          INT DEFAULT 0, -- 0:unlimited
  ed_user_access_punch_times    INT DEFAULT 0,
  ed_user_access_synced         TINYINT(1) DEFAULT 0,
  ed_user_access_created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_user_access_updated_at     DATETIME NULL,
  
  UNIQUE KEY uq_access          (ed_user_access_terminal_sn, ed_user_access_user_id),
  FOREIGN KEY (ed_user_access_user_id) REFERENCES eduall_biometric_users(ed_bio_user_id) ON DELETE CASCADE,
  INDEX idx_terminal            (ed_user_access_terminal_sn),
  INDEX idx_user_id             (ed_user_access_user_id),
  INDEX idx_synced              (ed_user_access_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_device_params
 * Parâmetros do dispositivo (door sensors, alarm delay, etc)
 */
const DDL_DEVICE_PARAMS = `
CREATE TABLE IF NOT EXISTS eduall_biometric_device_params (
  ed_device_param_id            BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_device_param_terminal_sn   VARCHAR(50) NOT NULL UNIQUE,
  ed_device_param_language      INT DEFAULT 0,
  ed_device_param_volume        INT DEFAULT 6,
  ed_device_param_screensaver   INT DEFAULT 0,
  ed_device_param_verify_mode   INT DEFAULT 0,
  ed_device_param_sleep         TINYINT(1) DEFAULT 0,
  ed_device_param_user_fp_num   INT DEFAULT 3,
  ed_device_param_log_hint      INT DEFAULT 1000,
  ed_device_param_reverify_time INT DEFAULT 0,
  ed_device_param_open_delay    INT DEFAULT 5,
  ed_device_param_door_sensor   INT DEFAULT 0,
  ed_device_param_alarm_delay   INT DEFAULT 0,
  ed_device_param_threat        INT DEFAULT 0,
  ed_device_param_input_alarm   INT DEFAULT 0,
  ed_device_param_antpass       INT DEFAULT 0,
  ed_device_param_interlock     INT DEFAULT 0,
  ed_device_param_multi_open    INT DEFAULT 0,
  ed_device_param_try_alarm     INT DEFAULT 0,
  ed_device_param_tamper        INT DEFAULT 0,
  ed_device_param_wg_format     INT DEFAULT 0,
  ed_device_param_wg_output     INT DEFAULT 0,
  ed_device_param_card_output   INT DEFAULT 0,
  ed_device_param_access_times  INT DEFAULT 0,
  ed_device_param_punch_times   INT DEFAULT 0,
  ed_device_param_synced        TINYINT(1) DEFAULT 0,
  ed_device_param_created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_device_param_updated_at    DATETIME NULL,
  
  UNIQUE KEY uq_terminal        (ed_device_param_terminal_sn),
  INDEX idx_synced              (ed_device_param_synced)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_sync_queue
 * Fila de sincronização de dados (para garantir delivery)
 */
const DDL_SYNC_QUEUE = `
CREATE TABLE IF NOT EXISTS eduall_biometric_sync_queue (
  ed_sync_queue_id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_sync_queue_code            VARCHAR(80) NOT NULL UNIQUE,
  ed_sync_queue_terminal_sn     VARCHAR(50) NOT NULL,
  ed_sync_queue_type            VARCHAR(50), -- user, log, config, access
  ed_sync_queue_action          VARCHAR(50), -- push, pull, delete
  ed_sync_queue_payload         JSON NOT NULL,
  ed_sync_queue_status          ENUM('pending','sent','acked','failed') DEFAULT 'pending',
  ed_sync_queue_retries         INT DEFAULT 0,
  ed_sync_queue_last_retry      DATETIME NULL,
  ed_sync_queue_created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_sync_queue_processed_at    DATETIME NULL,
  
  INDEX idx_terminal            (ed_sync_queue_terminal_sn),
  INDEX idx_status              (ed_sync_queue_status),
  INDEX idx_type                (ed_sync_queue_type),
  INDEX idx_created             (ed_sync_queue_created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

/**
 * TABELA: eduall_biometric_commands_log
 * Log de todos os comandos enviados ao terminal
 */
const DDL_COMMANDS_LOG = `
CREATE TABLE IF NOT EXISTS eduall_biometric_commands_log (
  ed_cmd_log_id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  ed_cmd_log_code               VARCHAR(80) NOT NULL UNIQUE,
  ed_cmd_log_terminal_sn        VARCHAR(50) NOT NULL,
  ed_cmd_log_institute_code     VARCHAR(120) NOT NULL,
  ed_cmd_log_command            VARCHAR(50), -- reg, getuserinfo, setuserinfo, etc
  ed_cmd_log_payload            JSON,
  ed_cmd_log_response           JSON,
  ed_cmd_log_status             ENUM('pending','sent','acked','failed','timeout') DEFAULT 'pending',
  ed_cmd_log_direction          ENUM('upstream','downstream') DEFAULT 'downstream',
  ed_cmd_log_created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
  ed_cmd_log_processed_at       DATETIME NULL,
  
  INDEX idx_terminal            (ed_cmd_log_terminal_sn),
  INDEX idx_command             (ed_cmd_log_command),
  INDEX idx_status              (ed_cmd_log_status),
  INDEX idx_direction           (ed_cmd_log_direction)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

// ─────────────────────────────────────────────────────────────────────────────
//  INICIALIZAÇÃO DE TABELAS
// ─────────────────────────────────────────────────────────────────────────────
async function ensureBiometricTables(req, res) {
  try {
    const fakeRes = { status: () => ({ json: () => {} }) };
    const fakeReq = req || { session: { user: {} } };

    await ExecuteQuery(fakeRes, DDL_TERMINALS,           [], false, { db: 'biometric_terminals', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_BIOMETRIC_USERS,     [], false, { db: 'biometric_users', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_BIOMETRIC_DATA,      [], false, { db: 'biometric_data', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_BIOMETRIC_LOGS,      [], false, { db: 'biometric_logs', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_ACCESS_RULES,        [], false, { db: 'access_rules', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_USER_ACCESS,         [], false, { db: 'user_access', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_DEVICE_PARAMS,       [], false, { db: 'device_params', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_SYNC_QUEUE,          [], false, { db: 'sync_queue', type: 'ddl', data: fakeReq });
    await ExecuteQuery(fakeRes, DDL_COMMANDS_LOG,        [], false, { db: 'commands_log', type: 'ddl', data: fakeReq });

    if (res) return res.status(200).json({ success: true, msg: 'Tabelas biométricas verificadas.' });
  } catch (e) {
    console.error('[ensureBiometricTables]', e.message);
    if (res) return res.status(500).json({ success: false, msg: 'Erro ao criar tabelas biométricas.' });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS — UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════════

function generateCode(prefix = '') {
  return `${prefix}${Date.now()}${Math.random().toString(36).slice(2, 10)}`.toUpperCase();
}

function getInstitute(req) {
  return req.session?.user?.eduall_user_session_curentinstitute || '';
}

function getUserId(req) {
  return req.session?.user?.eduall_user_session_ID || null;
}

function formatDate(dt) {
  return moment(dt).fromNow();
}

function emitToTerminal(terminalSn, event, data) {
  io.to(`terminal_${terminalSn}`).emit(event, data);
}

function emitToInstitute(instituteCode, event, data) {
  io.to(`institute_${instituteCode}`).emit(event, data);
}

// Log de comando para auditoria
async function logCommand(res, terminalSn, instituteCode, cmd, payload, response, direction = 'downstream') {
  try {
    const code = generateCode('CMD_');
    await ExecuteQuery(res, `
      INSERT INTO eduall_biometric_commands_log
        (ed_cmd_log_code, ed_cmd_log_terminal_sn, ed_cmd_log_institute_code, ed_cmd_log_command, 
         ed_cmd_log_payload, ed_cmd_log_response, ed_cmd_log_direction)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code, terminalSn, instituteCode, cmd, JSON.stringify(payload), JSON.stringify(response), direction],
      false,
      { db: 'commands_log', type: 'insert', data: { session: { user: {} } } }
    );
  } catch (e) {
    console.error('[logCommand]', e.message);
  }
}

// Atualizar sincronização
async function markAsSynced(res, table, id) {
  try {
    const columnMap = {
      'biometric_users': 'ed_bio_user_id',
      'biometric_data': 'ed_bio_data_id',
      'biometric_logs': 'ed_bio_log_id',
      'user_access': 'ed_user_access_id',
      'device_params': 'ed_device_param_id',
    };
    
    const col = columnMap[table];
    if (!col) return;

    await ExecuteQuery(res, `
      UPDATE \`${table.replace('_', '').replace('_', '')}\` 
      SET ed_*_synced = 1 
      WHERE ${col} = ?`,
      [id], false, { db: table, type: 'update', data: { session: { user: {} } } }
    );
  } catch (e) {
    console.error('[markAsSynced]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ROTAS REST — GERENCIAMENTO DE TERMINAIS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/biometric/terminals
 * Listar terminais com status
 */
app.get('/api/biometric/terminals', async (req, res) => {
  try {
    const institute = getInstitute(req);
    if (!institute)
      return res.status(401).json({ success: false, msg: 'Sem permissão.' });

    const terminals = await ExecuteQuery(res, `
      SELECT * FROM eduall_biometric_terminals 
      WHERE ed_terminal_institute_code = ?
      ORDER BY ed_terminal_created_at DESC`,
      [institute], true, { db: 'biometric_terminals', type: 'select', data: req }
    );

    const formatted = (terminals || []).map(t => ({
      id: t.ed_terminal_id,
      sn: t.ed_terminal_sn,
      model: t.ed_terminal_model,
      firmware: t.ed_terminal_firmware,
      status: t.ed_terminal_status,
      mac: t.ed_terminal_mac,
      capacity: {
        users: t.ed_terminal_user_capacity,
        fps: t.ed_terminal_fp_capacity,
        cards: t.ed_terminal_card_capacity,
        logs: t.ed_terminal_log_capacity
      },
      usage: {
        users: t.ed_terminal_used_users,
        fps: t.ed_terminal_used_fps,
        cards: t.ed_terminal_used_cards,
        logs: t.ed_terminal_used_logs
      },
      lastHeartbeat: t.ed_terminal_last_heartbeat,
      lastSync: t.ed_terminal_last_sync
    }));

    res.status(200).json({ success: true, terminals: formatted });
  } catch (e) {
    console.error('[GET /api/biometric/terminals]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao carregar terminais.' });
  }
});

/**
 * GET /api/biometric/terminals/:terminalSn
 * Detalhes de um terminal
 */
app.get('/api/biometric/terminals/:terminalSn', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const terminalSn = req.params.terminalSn;

    const terminal = await ExecuteQuery(res, `
      SELECT * FROM eduall_biometric_terminals 
      WHERE ed_terminal_sn = ? AND ed_terminal_institute_code = ? LIMIT 1`,
      [terminalSn, institute], true, { db: 'biometric_terminals', type: 'select', data: req }
    );

    if (!terminal)
      return res.status(404).json({ success: false, msg: 'Terminal não encontrado.' });

    const t = terminal[0];
    const detail = {
      id: t.ed_terminal_id,
      sn: t.ed_terminal_sn,
      cpusn: t.ed_terminal_cpusn,
      model: t.ed_terminal_model,
      firmware: t.ed_terminal_firmware,
      mac: t.ed_terminal_mac,
      fpAlgo: t.ed_terminal_fp_algorithm,
      status: t.ed_terminal_status,
      config: {
        language: t.ed_terminal_language,
        volume: t.ed_terminal_volume,
        verifyMode: t.ed_terminal_verify_mode,
        sleepEnabled: t.ed_terminal_sleep_enabled,
        userFpNum: t.ed_terminal_user_fp_num,
        logHint: t.ed_terminal_log_hint,
        reverifyTime: t.ed_terminal_reverify_time,
        doorNum: t.ed_terminal_door_num
      },
      capacity: {
        users: t.ed_terminal_user_capacity,
        fps: t.ed_terminal_fp_capacity,
        cards: t.ed_terminal_card_capacity,
        pwds: t.ed_terminal_pwd_capacity,
        logs: t.ed_terminal_log_capacity
      },
      usage: {
        users: t.ed_terminal_used_users,
        fps: t.ed_terminal_used_fps,
        cards: t.ed_terminal_used_cards,
        pwds: t.ed_terminal_used_pwds,
        logs: t.ed_terminal_used_logs,
        newlogs: t.ed_terminal_used_newlogs
      },
      lastHeartbeat: t.ed_terminal_last_heartbeat,
      lastSync: t.ed_terminal_last_sync,
      createdAt: t.ed_terminal_created_at
    };

    res.status(200).json({ success: true, terminal: detail });
  } catch (e) {
    console.error('[GET /api/biometric/terminals/:terminalSn]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao carregar terminal.' });
  }
});

/**
 * GET /api/biometric/terminals/:terminalSn/users
 * Listar utilizadores do terminal
 */
app.get('/api/biometric/terminals/:terminalSn/users', async (req, res) => {
  try {
    const terminalSn = req.params.terminalSn;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Number(req.query.limit || 50));
    const offset = (page - 1) * limit;

    const users = await ExecuteQuery(res, `
      SELECT u.*, 
             (SELECT COUNT(*) FROM eduall_biometric_data d WHERE d.ed_bio_data_user_id = u.ed_bio_user_id AND d.ed_bio_data_type = 'fingerprint') AS fps_count,
             (SELECT COUNT(*) FROM eduall_biometric_data d WHERE d.ed_bio_data_user_id = u.ed_bio_user_id AND d.ed_bio_data_type = 'face') AS faces_count
      FROM eduall_biometric_users u
      WHERE u.ed_bio_user_terminal_sn = ? AND u.ed_bio_user_deleted = 0
      ORDER BY u.ed_bio_user_enroll_id ASC
      LIMIT ?, ?`,
      [terminalSn, offset, limit], true, { db: 'biometric_users', type: 'select', data: req }
    );

    const formatted = (users || []).map(u => ({
      id: u.ed_bio_user_id,
      enrollId: u.ed_bio_user_enroll_id,
      name: u.ed_bio_user_name,
      department: u.ed_bio_user_department,
      card: u.ed_bio_user_card_number,
      enabled: u.ed_bio_user_enabled,
      admin: u.ed_bio_user_admin_flag,
      biometrics: {
        fps: Number(fps_count) || 0,
        faces: Number(faces_count) || 0,
        palm: u.ed_bio_user_palm_count
      }
    }));

    res.status(200).json({ success: true, users: formatted, page, limit });
  } catch (e) {
    console.error('[GET /api/biometric/terminals/:terminalSn/users]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao carregar utilizadores.' });
  }
});

/**
 * GET /api/biometric/terminals/:terminalSn/logs
 * Listar logs/punch records do terminal
 */
app.get('/api/biometric/terminals/:terminalSn/logs', async (req, res) => {
  try {
    const terminalSn = req.params.terminalSn;
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Number(req.query.limit || 50));
    const offset = (page - 1) * limit;
    const from = req.query.from;
    const to = req.query.to;

    let where = 'WHERE l.ed_bio_log_terminal_sn = ?';
    let params = [terminalSn];

    if (from && to) {
      where += ' AND l.ed_bio_log_timestamp BETWEEN ? AND ?';
      params.push(from, to);
    }

    const logs = await ExecuteQuery(res, `
      SELECT l.* FROM eduall_biometric_logs l
      ${where}
      ORDER BY l.ed_bio_log_timestamp DESC
      LIMIT ?, ?`,
      [...params, offset, limit], true, { db: 'biometric_logs', type: 'select', data: req }
    );

    const formatted = (logs || []).map(l => ({
      id: l.ed_bio_log_id,
      enrollId: l.ed_bio_log_enroll_id,
      userName: l.ed_bio_log_user_name,
      timestamp: l.ed_bio_log_timestamp,
      mode: ['unknown', 'fingerprint', 'password', 'card', '', '', '', '', 'face'][l.ed_bio_log_mode],
      inOut: l.ed_bio_log_inout === 0 ? 'in' : 'out',
      temp: l.ed_bio_log_temp,
      event: l.ed_bio_log_event,
      accessGranted: l.ed_bio_log_access_granted,
      doorNum: l.ed_bio_log_door_num,
      time: formatDate(l.ed_bio_log_timestamp)
    }));

    res.status(200).json({ success: true, logs: formatted, page, limit });
  } catch (e) {
    console.error('[GET /api/biometric/terminals/:terminalSn/logs]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao carregar logs.' });
  }
});

/**
 * POST /api/biometric/terminals/:terminalSn/command/opendoor
 * Abrir porta remotamente
 */
app.post('/api/biometric/terminals/:terminalSn/command/opendoor', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const terminalSn = req.params.terminalSn;
    const { doorNum } = req.body;

    const cmdCode = generateCode('OPENDOOR_');
    const payload = { cmd: 'opendoor', doornum: doorNum || 1 };

    await logCommand(res, terminalSn, institute, 'opendoor', payload, null);

    emitToTerminal(terminalSn, 'command:opendoor', {
      code: cmdCode,
      doornum: doorNum || 1
    });

    await RegisterAuditAction({
      session: req.session, res, req,
      action: 1, form: 'BiometricTerminal',
      description: `Abriu porta (${doorNum || 1}) no terminal ${terminalSn}.`
    }).catch(() => null);

    res.status(200).json({ success: true, cmdCode });
  } catch (e) {
    console.error('[POST opendoor]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao abrir porta.' });
  }
});

/**
 * POST /api/biometric/terminals/:terminalSn/command/reboot
 * Reiniciar terminal
 */
app.post('/api/biometric/terminals/:terminalSn/command/reboot', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const terminalSn = req.params.terminalSn;

    const cmdCode = generateCode('REBOOT_');
    await logCommand(res, terminalSn, institute, 'reboot', {}, null);

    emitToTerminal(terminalSn, 'command:reboot', { code: cmdCode });

    await RegisterAuditAction({
      session: req.session, res, req,
      action: 1, form: 'BiometricTerminal',
      description: `Reiniciou terminal ${terminalSn}.`
    }).catch(() => null);

    res.status(200).json({ success: true, cmdCode });
  } catch (e) {
    console.error('[POST reboot]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao reiniciar terminal.' });
  }
});

/**
 * POST /api/biometric/terminals/:terminalSn/sync/pull
 * Forçar sincronização (pull de dados do terminal)
 */
app.post('/api/biometric/terminals/:terminalSn/sync/pull', async (req, res) => {
  try {
    const institute = getInstitute(req);
    const terminalSn = req.params.terminalSn;

    const cmdCode = generateCode('SYNCPULL_');
    await logCommand(res, terminalSn, institute, 'getnewlog', {}, null);

    emitToTerminal(terminalSn, 'command:sync-pull', {
      code: cmdCode,
      cmd: 'getnewlog',
      stn: true
    });

    res.status(200).json({ success: true, cmdCode, msg: 'Sincronização solicitada.' });
  } catch (e) {
    console.error('[POST sync-pull]', e.message);
    res.status(500).json({ success: false, msg: 'Erro ao solicitar sincronização.' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SOCKET.IO — WEBSOCKET+JSON PROTOCOL 3.0
// ═══════════════════════════════════════════════════════════════════════════════

io.on('connection', (socket) => {
  console.log(`[BiometricSocket] Nova conexão: ${socket.id}`);

  // ─────────────────────────────────────────────────────────────────────────────
  //  A. TERMINAL ACTIVE SEND DATA TO SERVER
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * 1. Register
   * Terminal envia: { cmd: "reg", sn, cpusn, devinfo }
   */
  socket.on('terminal:register', async (data) => {
    try {
      const { sn, cpusn, devinfo } = data;
      
      if (!sn) {
        return socket.emit('terminal:register-response', {
          ret: 'reg', result: false, reason: 'SN obrigatório'
        });
      }

      // Verifica se terminal existe
      let terminal = await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
        SELECT * FROM eduall_biometric_terminals WHERE ed_terminal_sn = ? LIMIT 1`,
        [sn], true, { db: 'biometric_terminals', type: 'select', data: {} }
      );

      const now = moment().format('YYYY-MM-DD HH:mm:ss');
      
      if (!terminal || terminal.length === 0) {
        // Novo terminal — inserir
        const instituteCode = devinfo?.institute || 'default';
        await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
          INSERT INTO eduall_biometric_terminals
            (ed_terminal_sn, ed_terminal_cpusn, ed_terminal_institute_code, ed_terminal_model, 
             ed_terminal_firmware, ed_terminal_mac, ed_terminal_user_capacity, ed_terminal_fp_capacity,
             ed_terminal_card_capacity, ed_terminal_pwd_capacity, ed_terminal_log_capacity,
             ed_terminal_fp_algorithm, ed_terminal_status, ed_terminal_last_heartbeat)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
          [sn, cpusn, instituteCode, devinfo?.modelname, devinfo?.firmware, devinfo?.mac,
           devinfo?.usersize || 3000, devinfo?.fpsize || 3000, devinfo?.cardsize || 3000,
           devinfo?.pwdsize || 3000, devinfo?.logsize || 100000, devinfo?.fpalgo, now],
          false, { db: 'biometric_terminals', type: 'insert', data: {} }
        );
      } else {
        // Atualizar heartbeat
        await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
          UPDATE eduall_biometric_terminals 
          SET ed_terminal_status = 'active', ed_terminal_last_heartbeat = ?,
              ed_terminal_used_users = ?, ed_terminal_used_fps = ?,
              ed_terminal_used_cards = ?, ed_terminal_used_pwds = ?,
              ed_terminal_used_logs = ?, ed_terminal_used_newlogs = ?
          WHERE ed_terminal_sn = ?`,
          [now, devinfo?.useduser || 0, devinfo?.usedfp || 0, devinfo?.usedcard || 0,
           devinfo?.usedpwd || 0, devinfo?.usedlog || 0, devinfo?.usednewlog || 0, sn],
          false, { db: 'biometric_terminals', type: 'update', data: {} }
        );
      }

      // Junta-se à sala do terminal
      socket.join(`terminal_${sn}`);
      socket.join(`institute_${terminal?.[0]?.ed_terminal_institute_code || 'default'}`);

      await logCommand({ status: () => ({ json: () => {} }) }, sn, 
                       terminal?.[0]?.ed_terminal_institute_code || 'default',
                       'reg', data, { result: true }, 'upstream');

      socket.emit('terminal:register-response', {
        ret: 'reg',
        result: true,
        cloudtime: now,
        nosenduser: false
      });

      emitToInstitute(terminal?.[0]?.ed_terminal_institute_code || 'default', 'terminal:status-changed', {
        sn, status: 'active', time: now
      });

      console.log(`[Register] Terminal ${sn} registado.`);
    } catch (e) {
      console.error('[terminal:register]', e.message);
      socket.emit('terminal:register-response', {
        ret: 'reg', result: false, reason: e.message
      });
    }
  });

  /**
   * 2. Send the logs
   * Terminal envia logs/punch records
   */
  socket.on('terminal:sendlog', async (data) => {
    try {
      const { sn, count, logindex, record } = data;
      
      if (!sn || !record || !Array.isArray(record)) {
        return socket.emit('terminal:sendlog-response', {
          ret: 'sendlog', result: false, reason: 'Dados inválidos'
        });
      }

      const terminal = await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
        SELECT * FROM eduall_biometric_terminals WHERE ed_terminal_sn = ? LIMIT 1`,
        [sn], true, { db: 'biometric_terminals', type: 'select', data: {} }
      );

      if (!terminal) {
        return socket.emit('terminal:sendlog-response', {
          ret: 'sendlog', result: false, reason: 'Terminal não registado'
        });
      }

      const instituteCode = terminal[0].ed_terminal_institute_code;
      let insertedCount = 0;

      // Insere cada log
      for (const log of record) {
        try {
          const logCode = generateCode('LOG_');
          const deviceEvent = log.event === 0 ? 'normal' : `event_${log.event}`;

          await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
            INSERT INTO eduall_biometric_logs
              (ed_bio_log_code, ed_bio_log_terminal_sn, ed_bio_log_institute_code, 
               ed_bio_log_enroll_id, ed_bio_log_timestamp, ed_bio_log_mode, 
               ed_bio_log_inout, ed_bio_log_event, ed_bio_log_temp, ed_bio_log_image_base64,
               ed_bio_log_device_event)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [logCode, sn, instituteCode, log.enrollid, log.time, log.mode || 0,
             log.inout || 0, log.event || 0, log.temp || null, log.image || null, deviceEvent],
            false, { db: 'biometric_logs', type: 'insert', data: {} }
          );

          insertedCount++;

          // Emit real-time para o instituto
          emitToInstitute(instituteCode, 'biometric:log-received', {
            terminal: sn,
            enrollId: log.enrollid,
            timestamp: log.time,
            mode: log.mode,
            inOut: log.inout,
            temp: log.temp
          });
        } catch (e) {
          console.error('[insertLog]', e.message);
        }
      }

      await logCommand({ status: () => ({ json: () => {} }) }, sn, instituteCode, 
                       'sendlog', { count, logindex }, { inserted: insertedCount }, 'upstream');

      socket.emit('terminal:sendlog-response', {
        ret: 'sendlog',
        result: true,
        count: insertedCount,
        logindex: logindex,
        cloudtime: moment().format('YYYY-MM-DD HH:mm:ss'),
        access: 1
      });

      console.log(`[SendLog] Terminal ${sn}: ${insertedCount}/${count} logs salvos.`);
    } catch (e) {
      console.error('[terminal:sendlog]', e.message);
      socket.emit('terminal:sendlog-response', {
        ret: 'sendlog', result: false, reason: e.message
      });
    }
  });

  /**
   * 3. Send user information
   * Terminal envia dados de novo utilizador
   */
  socket.on('terminal:senduser', async (data) => {
    try {
      const { sn, enrollid, name, backupnum, admin, record } = data;
      
      if (!sn || !enrollid) {
        return socket.emit('terminal:senduser-response', {
          ret: 'senduser', result: false, reason: 'Dados inválidos'
        });
      }

      const terminal = await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
        SELECT * FROM eduall_biometric_terminals WHERE ed_terminal_sn = ? LIMIT 1`,
        [sn], true, { db: 'biometric_terminals', type: 'select', data: {} }
      );

      if (!terminal) {
        return socket.emit('terminal:senduser-response', {
          ret: 'senduser', result: false, reason: 'Terminal não registado'
        });
      }

      const instituteCode = terminal[0].ed_terminal_institute_code;
      const userCode = generateCode('BIO_USER_');

      // Verifica se utilizador existe
      let existingUser = await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
        SELECT * FROM eduall_biometric_users 
        WHERE ed_bio_user_terminal_sn = ? AND ed_bio_user_enroll_id = ? LIMIT 1`,
        [sn, enrollid], true, { db: 'biometric_users', type: 'select', data: {} }
      );

      if (!existingUser || existingUser.length === 0) {
        // Novo utilizador
        await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
          INSERT INTO eduall_biometric_users
            (ed_bio_user_code, ed_bio_user_terminal_sn, ed_bio_user_institute_code,
             ed_bio_user_enroll_id, ed_bio_user_name, ed_bio_user_admin_flag)
          VALUES (?, ?, ?, ?, ?, ?)`,
          [userCode, sn, instituteCode, enrollid, name, admin ? 1 : 0],
          false, { db: 'biometric_users', type: 'insert', data: {} }
        );
      }

      // Insere biometria
      if (backupnum !== undefined && record) {
        const bioType = 
          backupnum >= 0 && backupnum <= 9 ? 'fingerprint' :
          backupnum === 10 ? 'password' :
          backupnum === 11 ? 'card' :
          backupnum >= 20 && backupnum <= 27 ? 'face' :
          backupnum >= 40 && backupnum <= 41 ? 'palm' :
          backupnum === 50 ? 'photo' : 'unknown';

        const userId = existingUser?.[0]?.ed_bio_user_id || 
                      (await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
                        SELECT ed_bio_user_id FROM eduall_biometric_users 
                        WHERE ed_bio_user_terminal_sn = ? AND ed_bio_user_enroll_id = ? LIMIT 1`,
                        [sn, enrollid], true, { db: 'biometric_users', type: 'select', data: {} }
                      ))?.[0]?.ed_bio_user_id;

        if (userId) {
          await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
            INSERT INTO eduall_biometric_data
              (ed_bio_data_terminal_sn, ed_bio_data_user_id, ed_bio_data_enroll_id,
               ed_bio_data_type, ed_bio_data_backup_num, ed_bio_data_content)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [sn, userId, enrollid, bioType, backupnum, record],
            false, { db: 'biometric_data', type: 'insert', data: {} }
          );
        }
      }

      await logCommand({ status: () => ({ json: () => {} }) }, sn, instituteCode,
                       'senduser', data, { result: true }, 'upstream');

      socket.emit('terminal:senduser-response', {
        ret: 'senduser',
        result: true,
        cloudtime: moment().format('YYYY-MM-DD HH:mm:ss')
      });

      emitToInstitute(instituteCode, 'biometric:user-received', {
        terminal: sn,
        enrollId: enrollid,
        name: name,
        backupnum: backupnum
      });

      console.log(`[SendUser] Terminal ${sn}: Utilizador ${enrollid} (${name}) recebido.`);
    } catch (e) {
      console.error('[terminal:senduser]', e.message);
      socket.emit('terminal:senduser-response', {
        ret: 'senduser', result: false, reason: e.message
      });
    }
  });

  /**
   * 27. QR code sending
   * Terminal envia QR code para validação
   */
  socket.on('terminal:sendqrcode', async (data) => {
    try {
      const { sn, record } = data;

      const terminal = await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
        SELECT * FROM eduall_biometric_terminals WHERE ed_terminal_sn = ? LIMIT 1`,
        [sn], true, { db: 'biometric_terminals', type: 'select', data: {} }
      );

      if (!terminal) {
        return socket.emit('terminal:sendqrcode-response', {
          ret: 'sendqrcode', result: false, reason: 'Terminal não registado'
        });
      }

      await logCommand({ status: () => ({ json: () => {} }) }, sn,
                       terminal[0].ed_terminal_institute_code,
                       'sendqrcode', data, null, 'upstream');

      // Validar QR code (integração com sistema externo)
      const access = 1; // Assumir acesso permitido
      const enrollid = 0;
      const username = 'QR-User';

      socket.emit('terminal:sendqrcode-response', {
        ret: 'sendqrcode',
        result: true,
        access: access,
        enrollid: enrollid,
        username: username,
        message: 'Acesso permitido',
        voice: 'ok'
      });

      emitToInstitute(terminal[0].ed_terminal_institute_code, 'biometric:qrcode-received', {
        terminal: sn,
        qrcode: record,
        access: access
      });

      console.log(`[SendQRCode] Terminal ${sn}: QR ${record} - Acesso ${access ? 'permitido' : 'negado'}`);
    } catch (e) {
      console.error('[terminal:sendqrcode]', e.message);
      socket.emit('terminal:sendqrcode-response', {
        ret: 'sendqrcode', result: false, reason: e.message
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  B. SERVER ACTIVE PUSH MESSAGE TO TERMINAL
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Join terminal room para comandos
   */
  socket.on('terminal:join', (data) => {
    const { sn } = data;
    if (sn) {
      socket.join(`terminal_${sn}`);
      console.log(`[Socket] ${socket.id} entrou em terminal_${sn}`);
    }
  });

  /**
   * Ping/heartbeat
   */
  socket.on('terminal:ping', (data) => {
    socket.emit('terminal:pong', { time: moment().format('YYYY-MM-DD HH:mm:ss') });
  });

  /**
   * Desconexão
   */
  socket.on('disconnect', async () => {
    console.log(`[BiometricSocket] Desconexão: ${socket.id}`);
    
    // Atualizar status de terminais conectados
    try {
      await ExecuteQuery({ status: () => ({ json: () => {} }) }, `
        UPDATE eduall_biometric_terminals 
        SET ed_terminal_status = 'offline'
        WHERE ed_terminal_last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
        [], false, { db: 'biometric_terminals', type: 'update', data: {} }
      );
    } catch (e) {
      console.error('[disconnect-update]', e.message);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  CRON JOBS — SINCRONIZAÇÃO E MANUTENÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A cada 5 minutos: verificar heartbeat de terminais
 */
cron.schedule('*/5 * * * *', async () => {
  try {
    const fakeRes = { status: () => ({ json: () => {} }) };
    const fakeReq = { session: { user: {} } };

    // Marcar como offline se sem heartbeat há mais de 5 min
    await ExecuteQuery(fakeRes, `
      UPDATE eduall_biometric_terminals 
      SET ed_terminal_status = 'offline'
      WHERE ed_terminal_status = 'active' AND ed_terminal_last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE)`,
      [], false, { db: 'biometric_terminals', type: 'update', data: fakeReq }
    );

    console.log('[Cron] Heartbeat check executado.');
  } catch (e) {
    console.error('[Cron heartbeat]', e.message);
  }
});

/**
 * A cada 30 minutos: sincronizar dados pendentes
 */
cron.schedule('*/30 * * * *', async () => {
  try {
    const fakeRes = { status: () => ({ json: () => {} }) };
    const fakeReq = { session: { user: {} } };

    // Atualizar contadores
    await ExecuteQuery(fakeRes, `
      UPDATE eduall_biometric_terminals t
      SET ed_terminal_used_users = (SELECT COUNT(*) FROM eduall_biometric_users WHERE ed_bio_user_terminal_sn = t.ed_terminal_sn),
          ed_terminal_used_fps = (SELECT COUNT(*) FROM eduall_biometric_data WHERE ed_bio_data_terminal_sn = t.ed_terminal_sn AND ed_bio_data_type = 'fingerprint'),
          ed_terminal_used_cards = (SELECT COUNT(*) FROM eduall_biometric_data WHERE ed_bio_data_terminal_sn = t.ed_terminal_sn AND ed_bio_data_type = 'card'),
          ed_terminal_used_logs = (SELECT COUNT(*) FROM eduall_biometric_logs WHERE ed_bio_log_terminal_sn = t.ed_terminal_sn)
      WHERE ed_terminal_status IN ('active', 'offline')`,
      [], false, { db: 'biometric_terminals', type: 'update', data: fakeReq }
    );

    console.log('[Cron] Contadores de terminais atualizados.');
  } catch (e) {
    console.error('[Cron sync]', e.message);
  }
});

/**
 * A cada hora: retentativas de sincronização
 */
cron.schedule('0 * * * *', async () => {
  try {
    const fakeRes = { status: () => ({ json: () => {} }) };
    const fakeReq = { session: { user: {} } };

    const pending = await ExecuteQuery(fakeRes, `
      SELECT * FROM eduall_biometric_sync_queue 
      WHERE ed_sync_queue_status = 'pending' AND ed_sync_queue_retries < 5
      LIMIT 100`,
      [], true, { db: 'sync_queue', type: 'select', data: fakeReq }
    );

    for (const item of (pending || [])) {
      try {
        // Emit ao terminal para retry
        emitToTerminal(item.ed_sync_queue_terminal_sn, 'command:sync', {
          code: item.ed_sync_queue_code,
          type: item.ed_sync_queue_type,
          action: item.ed_sync_queue_action
        });

        await ExecuteQuery(fakeRes, `
          UPDATE eduall_biometric_sync_queue 
          SET ed_sync_queue_retries = ed_sync_queue_retries + 1,
              ed_sync_queue_last_retry = NOW()
          WHERE ed_sync_queue_id = ?`,
          [item.ed_sync_queue_id], false, { db: 'sync_queue', type: 'update', data: fakeReq }
        );
      } catch (e) {
        console.error('[retry-sync]', e.message);
      }
    }

    console.log(`[Cron] ${pending?.length || 0} itens de sincronização em retry.`);
  } catch (e) {
    console.error('[Cron retry]', e.message);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

const PORT = process.env.BIOMETRIC_PORT || 5001;

app.get('/api/setup/ensure-biometric-tables', async (req, res) => {
  await ensureBiometricTables(req, res);
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'BiometricTerminalSystem' });
});

server.listen(PORT, async () => {
  console.log(`\n✓ Sistema Biométrico ativo em porta ${PORT}`);
  const fakeReq = { session: { user: {} } };
  const fakeRes = { status: () => ({ json: () => {} }) };
  await ensureBiometricTables(fakeReq, fakeRes);
});

module.exports = { app, server, io, ensureBiometricTables };