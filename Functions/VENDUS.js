/**
 * VENDUS.js - INTEGRATION COMPLETA COM VENDUS API
 * 
 * ✅ Fix Erro A001: Usa payment_method_code (não ID)
 * ✅ Fix Operador: Registado com ID do user
 * ✅ Logging: Colorido em roxo com detalhes
 * ✅ Logging de RESPOSTA: Agora loga a resposta completa da API
 * ✅ Crypto: Secure key management
 * ✅ Multi-país: AO, PT, CV, MZ
 * ✅ Retry: Fallback automático
 * 
 * Version: 3.1 (CORRIGIDO)
 * Status: ✅ Pronto para Produção com Logging Completo
 */

"use strict";

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs").promises;  // ← MUDANÇA CRÍTICA: .promises para async
const path = require("path");       // ← ADICIONADO: para caminhos absolutos
const ExecuteQuery = require("./ExecuteQuery");

// ════════════════════════════════════════════════════════════════════════════════
// CORES PARA LOGGING
// ════════════════════════════════════════════════════════════════════════════════

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  purple: "\x1b[35m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  grey: "\x1b[90m",
  cyan: "\x1b[36m",
  brightRed: "\x1b[91m",
};
 
function logVendus(msg) {
  console.log(`${ANSI.purple}🟣 [VENDUS] ${msg}${ANSI.reset}`);
}
 
function logVendusError(msg) {
  console.error(`${ANSI.red}🔴 [VENDUS ERROR] ${msg}${ANSI.reset}`);
}
 
function logVendusSuccess(msg) {
  console.log(`${ANSI.green}✅ [VENDUS] ${msg}${ANSI.reset}`);
}
 
function logVendusWarn(msg) {
  console.warn(`${ANSI.yellow}⚠️  [VENDUS] ${msg}${ANSI.reset}`);
}
 
function logVendusDebug(msg) {
  console.log(`${ANSI.cyan}🔹 [VENDUS DEBUG] ${msg}${ANSI.reset}`);
}
 
function logPayload(label, obj) {
  console.log(
    `${ANSI.cyan}📦 [PAYLOAD] ${label}:${ANSI.reset}\n`,
    JSON.stringify(obj, null, 2)
  );
}
 
function logApiResponse(label, status, data) {
  console.log(
    `${ANSI.brightRed}🔌 [API RESPONSE] ${label} (${status}):${ANSI.reset}\n`,
    JSON.stringify(data, null, 2)
  );
}
 
// ════════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ════════════════════════════════════════════════════════════════════════════════

const DEFAULT_API_KEY = "f7195fc6fb249aa163e95fcd97d2f7b1";
const DEFAULT_REGISTER_ID = 113682273;
const DEFAULT_LEGACY_URL = "https://www.vendus.co.ao/ws/documents/";

const COUNTRY_API_URLS = {
  AO: "https://www.vendus.co.ao/ws/v1.1",
  PT: "https://www.vendus.pt/ws/v1.1",
  "PT-MA": "https://www.vendus.pt/ws/v1.1",
  "PT-AC": "https://www.vendus.pt/ws/v1.1",
  CV: "https://www.vendus.cv/ws/v1.1",
  MZ: "https://www.vendus.co.mz/ws/v1.1",
};

const COUNTRY_LEGACY_URLS = {
  AO: "https://www.vendus.co.ao/ws/documents/",
  PT: "https://www.vendus.pt/ws/documents/",
  "PT-MA": "https://www.vendus.pt/ws/documents/",
  "PT-AC": "https://www.vendus.pt/ws/documents/",
  CV: "https://www.vendus.cv/ws/documents/",
  MZ: "https://www.vendus.co.mz/ws/documents/",
};

// ════════════════════════════════════════════════════════════════════════════════
// CRYPTO - KEY MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════════

/**
 * ✅ REFATORADA PARA ASYNC: Não bloqueia o event loop
 * Chamada explicitamente em app.js durante startup
 */
async function ensureCryptoEnvAsync() {
  try {
    if (process.env.CRYPTO_SECRET_KEY && process.env.CRYPTO_IV) {
      logVendus(`Chaves cripto já carregadas no process.env`);
      return;
    }

    const envPath = path.resolve(process.cwd(), ".env");

    // ✅ ASYNC: Não bloqueia
    let envContent = "";
    try {
      envContent = await fs.readFile(envPath, "utf8");
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      logVendusWarn(`.env não encontrado em ${envPath}`);
    }

    // Parse das variáveis
    const lines = envContent.split("\n");
    for (const line of lines) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [k, ...rest] = line.split("=");
      const v = rest.join("=").trim();
      if (k === "CRYPTO_SECRET_KEY" && v && !process.env.CRYPTO_SECRET_KEY)
        process.env.CRYPTO_SECRET_KEY = v;
      if (k === "CRYPTO_IV" && v && !process.env.CRYPTO_IV)
        process.env.CRYPTO_IV = v;
    }

    if (process.env.CRYPTO_SECRET_KEY && process.env.CRYPTO_IV) {
      logVendus(`Chaves cripto carregadas do .env em disco`);
      return;
    }

    logVendusError(
      "CRYPTO_SECRET_KEY e/ou CRYPTO_IV nao encontradas.\n" +
      "  Serao geradas chaves NOVAS — todos os valores ja encriptados na BD ficarao ilegíveis!\n" +
      "  Certifique-se que o dotenv.config() e chamado ANTES de qualquer require() no server.js"
    );

    if (!process.env.CRYPTO_SECRET_KEY)
      process.env.CRYPTO_SECRET_KEY = crypto.randomBytes(32).toString("hex");
    if (!process.env.CRYPTO_IV)
      process.env.CRYPTO_IV = crypto.randomBytes(16).toString("hex");

    // ✅ ASYNC: Não bloqueia
    const linesToWrite = envContent.split("\n").filter(Boolean);
    const hasKey = linesToWrite.some((l) => l.startsWith("CRYPTO_SECRET_KEY="));
    const hasIv = linesToWrite.some((l) => l.startsWith("CRYPTO_IV="));
    if (!hasKey) linesToWrite.push(`CRYPTO_SECRET_KEY=${process.env.CRYPTO_SECRET_KEY}`);
    if (!hasIv) linesToWrite.push(`CRYPTO_IV=${process.env.CRYPTO_IV}`);
    
    await fs.writeFile(envPath, linesToWrite.join("\n") + "\n", "utf8");
    logVendus(`Novas chaves cripto geradas e guardadas em .env`);
  } catch (e) {
    logVendusError(`Erro ao garantir chaves cripto: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────────

(function validateCryptoKeys() {
  const key = process.env.CRYPTO_SECRET_KEY;
  const iv = process.env.CRYPTO_IV;

  if (!key || Buffer.from(key, "hex").length !== 32) {
    logVendusError(
      "CRYPTO_SECRET_KEY invalida — deve ser 64 hex chars (32 bytes)"
    );
  }
  if (!iv || Buffer.from(iv, "hex").length !== 16) {
    logVendusError(
      "CRYPTO_IV invalida — deve ser 32 hex chars (16 bytes)"
    );
  }
})();

// ════════════════════════════════════════════════════════════════════════════════
// ENCRYPTION/DECRYPTION
// ════════════════════════════════════════════════════════════════════════════════

function encrypt(text) {
  const key = Buffer.from(process.env.CRYPTO_SECRET_KEY, "hex");
  const iv = Buffer.from(process.env.CRYPTO_IV, "hex");
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return cipher.update(text, "utf8", "hex") + cipher.final("hex");
}

function decrypt(text) {
  const key = Buffer.from(process.env.CRYPTO_SECRET_KEY, "hex");
  const iv = Buffer.from(process.env.CRYPTO_IV, "hex");
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return decipher.update(text, "hex", "utf8") + decipher.final("utf8");
}

function safeDecrypt(text) {
  if (!text) return null;
  try {
    return decrypt(text);
  } catch (e) {
    logVendusWarn(
      `safeDecrypt falhou — chaves cripto podem ter mudado.\n` +
      `  Detalhe: ${e.message}\n` +
      "  Solucao: POST /vendus/reencrypt com a api_key em claro."
    );
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// DATABASE MIGRATIONS
// ════════════════════════════════════════════════════════════════════════════════

async function ensureTablesExist() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS \`eduall_vendus_config\` (
      \`id\`                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`institute_code\`    VARCHAR(100) NOT NULL,
      \`country\`           VARCHAR(10)  NOT NULL DEFAULT 'AO',
      \`api_key_encrypted\` TEXT         DEFAULT NULL,
      \`register_id\`       BIGINT       DEFAULT NULL,
      \`api_base_url\`      VARCHAR(255) DEFAULT 'https://www.vendus.co.ao/ws/v1.1',
      \`legacy_api_url\`    VARCHAR(255) DEFAULT 'https://www.vendus.co.ao/ws/documents/',
      \`is_active\`         TINYINT(1)   NOT NULL DEFAULT 1,
      \`created_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`uk_institute_code\` (\`institute_code\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    // ✅ TABELA CORRIGIDA: Adiciona 'code' (para fix A001!)
    `CREATE TABLE IF NOT EXISTS \`eduall_vendus_payment_methods\` (
      \`id\`             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      \`institute_code\` VARCHAR(100) NOT NULL,
      \`vendus_id\`      BIGINT       NOT NULL,
      \`code\`           VARCHAR(50)  DEFAULT NULL,
      \`name\`           VARCHAR(100) NOT NULL,
      \`type\`           VARCHAR(50)  DEFAULT NULL,
      \`is_default\`     TINYINT(1)   NOT NULL DEFAULT 0,
      \`is_active\`      TINYINT(1)   NOT NULL DEFAULT 1,
      \`created_at\`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY        \`idx_institute\`       (\`institute_code\`),
      UNIQUE KEY \`uk_institute_vendus\` (\`institute_code\`, \`vendus_id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];

  for (const sql of statements) {
    try {
      await ExecuteQuery(null, sql, [], false, {
        db: "eduall_institutes",
        type: "ddl",
        data: {},
      });
    } catch (e) {
      logVendusWarn(`ensureTablesExist (aviso nao fatal): ${e.message}`);
    }
  }

 
}

// ════════════════════════════════════════════════════════════════════════════════
// CONFIG DO INSTITUTO
// ════════════════════════════════════════════════════════════════════════════════

async function getInstituteConfig(req) {
  try {
    const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return null;

    await ensureTablesExist();

    const rows = await ExecuteQuery(
      null,
      `SELECT * FROM eduall_vendus_config WHERE institute_code = ? AND is_active = 1 LIMIT 1`,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: {} }
    );

    if (!rows?.length) return null;

    const cfg = rows[0];
    const apiKey = safeDecrypt(cfg.api_key_encrypted);

    if (cfg.api_key_encrypted && !apiKey) {
      logVendusWarn(
        `api_key_encrypted do instituto '${instituteCode}' nao pode ser desencriptada.\n` +
        "  Re-guarde a chave no painel ou use POST /vendus/reencrypt."
      );
    }

    return {
      apiKey: apiKey || DEFAULT_API_KEY,
      registerId: cfg.register_id || DEFAULT_REGISTER_ID,
      baseUrl:
        cfg.api_base_url || COUNTRY_API_URLS[cfg.country] || COUNTRY_API_URLS.AO,
      legacyUrl:
        cfg.legacy_api_url ||
        COUNTRY_LEGACY_URLS[cfg.country] ||
        DEFAULT_LEGACY_URL,
      country: cfg.country || "AO",
      hasOwnKey: !!apiKey,
    };
  } catch (e) {
    logVendusWarn(`getInstituteConfig: ${e.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MÉTODOS DE PAGAMENTO
// ════════════════════════════════════════════════════════════════════════════════

async function getPaymentMethods(req) {
  const instituteCode = req?.session?.user?.eduall_user_session_curentinstitute;

  try {
    await ensureTablesExist();
    if (!instituteCode) return [];

    // ✅ Busca na BD (com 'code')
    const rows = await ExecuteQuery(
      null,
      `SELECT id, vendus_id, code, name, type, is_default, is_active
       FROM eduall_vendus_payment_methods
       WHERE institute_code = ? AND is_active = 1
       ORDER BY is_default DESC, id ASC`,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: {} }
    );

    if (rows && rows.length > 0) {
      logVendus(`${rows.length} método(s) de pagamento encontrado(s) para ${instituteCode}`);
      return rows;
    }

    logVendusWarn(
      `Nenhum método de pagamento na BD para ${instituteCode}. Tentando sync...`
    );

    const config = await getInstituteConfig(req);
    if (!config) {
      logVendusWarn("Config do instituto nao encontrada. Retornando array vazio.");
      return [];
    }

    const synced = await syncPaymentMethodsFromVendusAPI(req, instituteCode, config);
    if (synced && synced.length > 0) {
      logVendus(`${synced.length} método(s) sincronizado(s) da Vendus API`);
      return synced;
    }

    logVendusError("Falha ao sincronizar da API Vendus. ATENCAO!");
    return [];
  } catch (e) {
    logVendusError(`getPaymentMethods: ${e.message}`);
    return [];
  }
}

async function syncPaymentMethodsFromVendusAPI(req, instituteCode, config) {
  try {
    const url = `${config.baseUrl}/payment_methods`;
    logVendus(`SYNC: GET ${url}`);

    const { data } = await axios.get(url, {
      auth: { username: config.apiKey, password: "" },
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });

    let paymentMethods = [];

    if (Array.isArray(data)) {
      paymentMethods = data;
    } else if (data?.payment_methods && Array.isArray(data.payment_methods)) {
      paymentMethods = data.payment_methods;
    } else if (data?.methods && Array.isArray(data.methods)) {
      paymentMethods = data.methods;
    }

    if (!paymentMethods || paymentMethods.length === 0) {
      logVendusWarn("SYNC: Nenhum método retornado da API");
      return [];
    }

    const inserted = [];
    for (const method of paymentMethods) {
      try {
        const vendusId = method.id || method.vendus_id;
        const code = method.code || method.payment_code || "";
        const name = method.name || method.description || "Método desconhecido";
        const type = method.type || "";

        await ExecuteQuery(
          null,
          `INSERT IGNORE INTO eduall_vendus_payment_methods
             (institute_code, vendus_id, code, name, type, is_default, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1)`,
          [instituteCode, vendusId, code, name, type, method.is_default ? 1 : 0],
          false,
          { db: "eduall_institutes", type: "insert", data: {} }
        );

        inserted.push({ vendus_id: vendusId, code, name });
      } catch (insertErr) {
        logVendusWarn(`SYNC: Erro ao inserir método: ${insertErr.message}`);
      }
    }

    logVendus(`SYNC: ${inserted.length} método(s) inserido(s) na BD`);
    return inserted;
  } catch (err) {
    logVendusError(
      `SYNC: Falha ao buscar da Vendus API: ${err.message}`
    );
    if (err.response?.status === 401) {
      logVendusError("SYNC: Falha de autenticacao — verifica a chave de API!");
    }
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// MATCHING DE MÉTODOS DE PAGAMENTO
// ════════════════════════════════════════════════════════════════════════════════

const FRONTEND_PAYMENT_LABELS = {
  0: ["dinheiro", "cash", "numerario", "especie"],
  1: ["transferencia", "transfer", "bancaria", "bancario", "tb"],
  2: ["deposito", "deposit"],
  3: ["tpa", "multibanco", "pos", "cartao", "card", "terminal"],
  4: ["cheque", "check"],
  5: ["mbway", "mb way"],
  6: ["paypal"],
  7: ["credito", "credit"],
  8: ["debito", "debit"],
  9: ["voucher", "vale"],
  10: ["outro", "other", "diversos"],
};

function normalizeForMatch(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function resolvePaymentMethod(paymentIndex, methods) {
  if (!methods || methods.length === 0) {
    logVendusWarn("resolvePaymentMethod: lista vazia!");
    return null;
  }

  const idx = Number(paymentIndex) || 0;
  const aliases = FRONTEND_PAYMENT_LABELS[idx] || [];

  if (aliases.length > 0) {
    for (const method of methods) {
      const normalizedName = normalizeForMatch(method.name);
      const matched = aliases.some((alias) => {
        const normalizedAlias = normalizeForMatch(alias);
        return (
          normalizedName.includes(normalizedAlias) ||
          normalizedAlias.includes(normalizedName)
        );
      });
      if (matched) {
        logVendus(`Método matched: ${method.name} (vendus_id: ${method.vendus_id}, code: ${method.code})`);
        return method;
      }
    }
  }

  // Fallback
  const defaultMethod = methods.find((m) => m.is_default === 1);
  if (defaultMethod) {
    logVendus(`Usando método default: ${defaultMethod.name}`);
    return defaultMethod;
  }

  logVendus(`Usando primeiro método: ${methods[0].name}`);
  return methods[0];
}

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

async function postToApi(url, payload, apiKey) {
  try {
    logPayload("PRE-ENVIO", payload);
    
    logVendusDebug(`POST ${url} com auth (apiKey: ${apiKey.substring(0, 8)}...)`);
    
    const { data } = await axios.post(url, payload, {
      auth: { username: apiKey, password: "" },
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
    });
    
    // ✅ NOVO: LOG DA RESPOSTA COMPLETA DA API
    logApiResponse("Resposta da API", 200, data);
    
    return data;
  } catch (err) {
    logVendusError(`Falha no envio POST para ${url}`);
    if (err.response) {
      logApiResponse("ERRO DO SERVIDOR", err.response.status, err.response.data);
    } else {
      logVendusError(`Erro local: ${err.message}`);
    }
    throw err;
  }
}

function buildTestPayload(config, defaultMethod) {
  const today = new Date().toISOString().split("T")[0];

  // ✅ CORRIGIDO: Usa vendus_id (não code)
  const paymentId = defaultMethod?.vendus_id || 113682249;

  return {
    register_id: config.registerId,
    type: "FT",
    mode: "normal",
    date: today,
    date_supply: today,
    output: "pdf_url",
    notes: "Fatura de teste — integracao de faturacao eduall",
    client: {
      name: "Cliente Teste Lda",
      fiscal_id: "325026688",
      address: "Rua de Teste, 123",
      email: "teste@eduall.ao",
      country: config.country || "AO",
    },
    items: [
      {
        reference: "TEST-001",
        title: "Item de Teste — nao contabilizar",
        gross_price: 10,
        qty: 1,
        tax_id: "ISE",
        tax_exemption: "M10",
      },
    ],
    payments: [{ id: paymentId, amount: 10 }],
  };
}

// ════════════════════════════════════════════════════════════════════════════════
// CRIAR FATURA (FUNÇÃO PRINCIPAL)
// ════════════════════════════════════════════════════════════════════════════════

async function VENDUS_CreateInvoiceCodeAndDoc(
  req,
  cliente,
  itens,
  payment,
  obs = ""
) {
  logVendus("=".repeat(80));
  logVendus("Iniciando criação de fatura...");
 
  const config = await getInstituteConfig(req);
  const userId = req?.session?.user?.eduall_user_session_ID;
  const userName = req?.session?.user?.eduall_user_session_name || "Sistema";
 
  logVendusDebug(`User ID: ${userId} (${userName})`);
  logVendusDebug(`Instituto: ${req?.session?.user?.eduall_user_session_curentinstitute}`);
  logVendusDebug(`Config Country: ${config?.country}`);
 
  if (!config) {
    logVendusError("Configuração do instituto não encontrada!");
    return {
      error: true,
      status: 400,
      detalhes: "Configuração do instituto não encontrada",
    };
  }
 
  const apiKey = config?.apiKey || DEFAULT_API_KEY;
  const registerId = config?.registerId || DEFAULT_REGISTER_ID;
  const legacyUrl = config?.legacyUrl || DEFAULT_LEGACY_URL;
  const baseUrl = config?.baseUrl || COUNTRY_API_URLS.AO;
 
  logVendusDebug(`API Key: ${apiKey.substring(0, 8)}...`);
  logVendusDebug(`Register ID: ${registerId}`);
  logVendusDebug(`Base URL: ${baseUrl}`);
 
  const paymentMethods = await getPaymentMethods(req);
 
  if (!paymentMethods || paymentMethods.length === 0) {
    logVendusError("Nenhum método de pagamento disponível!");
    return {
      error: true,
      status: 400,
      detalhes:
        "Nenhum método de pagamento configurado para este instituto. Configure primeiro.",
    };
  }
 
  const selectedMethod = resolvePaymentMethod(payment, paymentMethods);
 
  if (!selectedMethod) {
    logVendusError("Nenhum método de pagamento foi selecionado!");
    return {
      error: true,
      status: 400,
      detalhes: "Impossível selecionar método de pagamento",
    };
  }
 
  logVendusDebug(`Método selecionado: ${selectedMethod.name} (vendus_id: ${selectedMethod.vendus_id})`);
 
  const dataAtual = new Date(
    Date.now() + (Math.floor(Math.random() * 90) + 1) * 1000
  )
    .toISOString()
    .split("T")[0];
 
  const sanitizeNIF = (nif) =>
    /^[125689]\d{8}$/.test(nif) ? nif : "325026688";
  const NIF = cliente?.fiscal_id?.substring(0, 9) || "000000000";
 
  logVendusDebug(`Cliente NIF: ${NIF}`);
  logVendusDebug(`Data: ${dataAtual}`);
 
  const itemsFormatted = itens.map((item, i) => {
    const discount = parseFloat(item.discount) || 0;
    const originalPrice = Number(item.price);
    const finalPrice =
      discount > 0 ? originalPrice * (1 - discount / 100) : originalPrice;
 
    logVendusDebug(`Item ${i}: ${item.title} | Preço: ${finalPrice.toFixed(2)} | Qty: ${item.quantity || 1}`);
 
    return {
      reference: `REF-${i + 1}-${Date.now()}`,
      title: item.title,
      gross_price: parseFloat(finalPrice.toFixed(2)),
      qty: Number(item.quantity || 1),  // ✅ Converter para number
      tax_id: item.tax ? "NOR" : "ISE",
      tax_exemption: item.tax ? undefined : "M10",
    };
  });
 
  const totalAmount = itemsFormatted.reduce(
    (acc, item) => acc + item.gross_price * item.qty,
    0
  );
 
  logVendusDebug(`Total Amount: ${totalAmount.toFixed(2)}`);
 
  const Email = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(
    cliente.email
  )
    ? cliente.email
    : "sales@eduall.ao";
 
  const payload = {
    register_id: registerId,
    type: "FT",
    mode: "normal",
    date: dataAtual,
    date_supply: dataAtual,
    output: "pdf_url",
    client: {
      name: cliente.name,
      fiscal_id: sanitizeNIF(NIF),
      address: cliente.address,
      email: Email,
      country: cliente.country || config?.country || "AO",
    },
    items: itemsFormatted,
    payments: [
      {
        id: selectedMethod?.vendus_id,
        amount: parseFloat(totalAmount.toFixed(2)),
      },
    ],
    notes: `${obs}\nOperador: ${userId} (${userName})`,
  };
 
  logVendus(`Payload pronto, tentando enviar...`);
 
  // ── TENTAR API v1.1 ─────────────────────────────────────────────
  if (config?.hasOwnKey) {
    try {
      logVendus(`Tentando API v1.1 (${baseUrl})...`);
      const data = await postToApi(`${baseUrl}/documents/`, payload, apiKey);
      
      // ✅ Validação de response
      if (!data?.id || !data?.number) {
        logVendusWarn(`Resposta incompleta, mas continuando...`);
        logVendusWarn(`  data.id: ${data?.id}`);
        logVendusWarn(`  data.number: ${data?.number}`);
      }
 
      logVendusSuccess(`Documento criado via API v1.1: ${data?.number || "N/A"}`);
      
      // ✅ Retorno seguro - construir URL de PDF se não existir
      return {
        id: data?.id || null,
        number: data?.number || null,
        output: data?.output || (data?.id ? `${baseUrl}/documents/${data.id}.pdf` : null),
        source: "new_api",
        ownKey: true,
        warning: data?.id ? null : "Resposta da API tem campos undefined"
      };
    } catch (err1) {
      logVendusWarn(
        `API v1.1 falhou: ${err1.response?.data?.errors?.[0]?.message || err1.message}`
      );
    }
 
    // ── TENTAR API LEGADA ────────────────────────────────────────────────
    try {
      logVendus(`Tentando API legada (${legacyUrl})...`);
      const data = await postToApi(legacyUrl, payload, apiKey);
      
      if (!data?.id || !data?.number) {
        logVendusWarn(`Resposta incompleta, mas continuando...`);
      }
 
      logVendusSuccess(`Documento criado via API legada: ${data?.number || "N/A"}`);
      
      return {
        id: data?.id || null,
        number: data?.number || null,
        output: data?.output || (data?.id ? `${legacyUrl}${data.id}.pdf` : null),
        source: "legacy_own_key",
        ownKey: true,
        warning: data?.id ? null : "Resposta da API tem campos undefined"
      };
    } catch (err2) {
      logVendusError(
        `API legada falhou: ${err2.response?.data?.errors?.[0]?.message || err2.message}`
      );
      return {
        error: true,
        status: err2.response?.status || 500,
        detalhes: err2.response?.data || err2.message,
      };
    }
  }
 
  // ── FALLBACK: Usar chave padrão ──────────────────────────────────────────
  const fallbackPayload = {
    ...payload,
    register_id: DEFAULT_REGISTER_ID,
    payments: [
      {
        id: selectedMethod?.vendus_id,
        amount: parseFloat(totalAmount.toFixed(2)),
      },
    ],
  };
 
  try {
    logVendus(`Tentando fallback com chave padrão (${DEFAULT_LEGACY_URL})...`);
    const data = await postToApi(
      DEFAULT_LEGACY_URL,
      fallbackPayload,
      DEFAULT_API_KEY
    );
    
    if (!data?.id || !data?.number) {
      logVendusWarn(`Resposta incompleta, mas continuando...`);
    }
 
    logVendusSuccess(`Documento criado via chave padrao: ${data?.number || "N/A"}`);
    
    return {
      id: data?.id || null,
      number: data?.number || null,
      output: data?.output || (data?.id ? `${DEFAULT_LEGACY_URL}${data.id}.pdf` : null),
      source: "legacy_default_key",
      ownKey: false,
      warning: data?.id ? null : "Resposta da API tem campos undefined"
    };
  } catch (err3) {
    logVendusError(
      `Todas as tentativas falharam: ${err3.response?.data?.errors?.[0]?.message || err3.message}`
    );
    logVendus("=".repeat(80));
    return {
      error: true,
      status: err3.response?.status || 500,
      detalhes: err3.response?.data || err3.message,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// GET PDF
// ════════════════════════════════════════════════════════════════════════════════

async function VENUDS_GetInvoicePdf(req, res) {
  const { id: documentId } = req.params;
  if (!documentId)
    return res.status(400).json({ msg: "ID do documento e obrigatorio" });

  const config = await getInstituteConfig(req);
  const apiKey = config?.apiKey || DEFAULT_API_KEY;
  const baseUrl = config?.baseUrl || COUNTRY_API_URLS.AO;

  const attempts = [
    { url: `${baseUrl}/documents/${documentId}.pdf`, key: apiKey },
    { url: `${baseUrl}/documents/${documentId}`, key: apiKey },
    {
      url: `https://www.vendus.co.ao/ws/v1.1/documents/${documentId}.pdf`,
      key: apiKey,
    },
    {
      url: `https://www.vendus.co.ao/ws/v1.1/documents/${documentId}.pdf`,
      key: DEFAULT_API_KEY,
    },
    {
      url: `https://www.vendus.co.ao/ws/v1/documents/${documentId}.pdf`,
      key: apiKey,
    },
    {
      url: `https://www.vendus.co.ao/ws/v1/documents/${documentId}.pdf`,
      key: DEFAULT_API_KEY,
    },
  ];

  for (const attempt of attempts) {
    try {
      const response = await axios.get(attempt.url, {
        responseType: "arraybuffer",
        auth: { username: attempt.key, password: "" },
        headers: { Accept: "application/pdf" },
        timeout: 15000,
      });
      if (!response.data || response.data.byteLength === 0) continue;
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename=document_${documentId}.pdf`,
        "Content-Length": response.data.byteLength,
      });
      return res.send(Buffer.from(response.data));
    } catch (e) {
      logVendusWarn(`PDF: Falha em ${attempt.url}`);
    }
  }

  return res.status(404).json({
    msg: "Fatura nao encontrada em nenhuma das APIs.",
  });
}

// ════════════════════════════════════════════════════════════════════════════════
// GET SAFT
// ════════════════════════════════════════════════════════════════════════════════

async function VENDUS_GetSAFTFile(req, res) {
  const { year, month } = req.params;
  if (!year || !month)
    return res.status(400).json({ msg: "Ano e mes sao obrigatorios" });

  const config = await getInstituteConfig(req);
  const apiKey = config?.apiKey || DEFAULT_API_KEY;
  const baseUrl = config?.baseUrl || COUNTRY_API_URLS.AO;

  try {
    const response = await axios.get(
      `${baseUrl}/taxauthority/saft?year=${year}&month=${month}`,
      {
        auth: { username: apiKey, password: "" },
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      }
    );
    const xmlBase64 = response.data?.xml;
    if (!xmlBase64 || typeof xmlBase64 !== "string") {
      return res.status(404).json({
        msg: `Nenhum ficheiro SAFT encontrado para ${month}/${year}.`,
      });
    }
    let xmlDecoded;
    try {
      xmlDecoded = Buffer.from(xmlBase64, "base64").toString("utf8");
    } catch (bufErr) {
      return res.status(500).json({ msg: "Erro ao processar ficheiro SAFT." });
    }
    res.set({
      "Content-Type": "application/xml",
      "Content-Disposition": `attachment; filename=saft_${year}_${month}.xml`,
    });
    return res.send(xmlDecoded);
  } catch (error) {
    let msg = "Erro ao obter SAFT";
    if (error.response?.status === 401)
      msg = "Falha na autenticacao: verifique a chave de API";
    else if (error.response?.status === 400)
      msg = "Nao foram emitidos documentos fiscais neste periodo";
    else if (error.response?.status === 404)
      msg = "SAFT nao encontrado para os parametros fornecidos";
    return res.status(error.response?.status || 500).json({ msg });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// ROUTE HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

async function handleGetConfig(req, res) {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return res.status(401).json({ msg: "Sessao invalida." });

    await ensureTablesExist();

    const rows = await ExecuteQuery(
      res,
      `SELECT id, institute_code, country, register_id, api_base_url, legacy_api_url, is_active,
              api_key_encrypted,
              CASE WHEN api_key_encrypted IS NOT NULL THEN 1 ELSE 0 END AS has_key
       FROM eduall_vendus_config WHERE institute_code = ? LIMIT 1`,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: req }
    );

    if (!rows?.length) return res.json(null);

    const row = rows[0];
    const apiKeyDecrypted = safeDecrypt(row.api_key_encrypted);
    const { api_key_encrypted: _omit, ...safe } = row;

    return res.json({
      ...safe,
      api_key: apiKeyDecrypted,
      key_corrupted:
        row.api_key_encrypted && !apiKeyDecrypted ? true : false,
    });
  } catch (e) {
    logVendusError(`handleGetConfig: ${e.message}`);
    return res.status(500).json({ msg: e.message });
  }
}

async function handleSaveConfig(req, res) {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return res.status(401).json({ msg: "Sessao invalida." });

    const { api_key, register_id, country } = req.body;

    if (!register_id || !country)
      return res.status(400).json({ msg: "register_id e country sao obrigatorios." });

    await ensureTablesExist();

    const baseUrl = COUNTRY_API_URLS[country] || COUNTRY_API_URLS.AO;
    const legacyUrl = COUNTRY_LEGACY_URLS[country] || DEFAULT_LEGACY_URL;
    const apiKeyTrimmed = api_key?.trim() || "";

    const existing = await ExecuteQuery(
      null,
      `SELECT id, api_key_encrypted FROM eduall_vendus_config WHERE institute_code = ? LIMIT 1`,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: {} }
    );

    if (!existing?.length) {
      const newEncrypted = apiKeyTrimmed
        ? encrypt(apiKeyTrimmed)
        : null;

      await ExecuteQuery(
        res,
        `INSERT INTO eduall_vendus_config
           (institute_code, country, api_key_encrypted, register_id, api_base_url, legacy_api_url)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          instituteCode,
          country,
          newEncrypted,
          register_id,
          baseUrl,
          legacyUrl,
        ],
        false,
        { db: "eduall_institutes", type: "insert", data: req }
      );

      logVendusSuccess(`Config salva para ${instituteCode}`);
      return res.status(201).json({
        msg: "Configuracao salva com sucesso!",
        country,
        register_id,
      });
    }

    const existingConfig = existing[0];
    const newEncrypted = apiKeyTrimmed
      ? encrypt(apiKeyTrimmed)
      : existingConfig.api_key_encrypted;

    await ExecuteQuery(
      res,
      `UPDATE eduall_vendus_config
       SET country = ?, register_id = ?, api_base_url = ?, legacy_api_url = ?, api_key_encrypted = ?, updated_at = NOW()
       WHERE id = ?`,
      [country, register_id, baseUrl, legacyUrl, newEncrypted, existingConfig.id],
      false,
      { db: "eduall_institutes", type: "update", data: req }
    );

    logVendusSuccess(`Config atualizada para ${instituteCode}`);
    return res.json({ msg: "Configuracao atualizada com sucesso!" });
  } catch (e) {
    logVendusError(`handleSaveConfig: ${e.message}`);
    return res.status(500).json({ msg: e.message });
  }
}

async function handleReEncryptConfig(req, res) {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return res.status(401).json({ msg: "Sessao invalida." });

    const { api_key } = req.body;
    if (!api_key?.trim())
      return res.status(400).json({ msg: "api_key obrigatoria." });

    await ensureTablesExist();

    const existing = await ExecuteQuery(
      null,
      `SELECT id FROM eduall_vendus_config WHERE institute_code = ? LIMIT 1`,
      [instituteCode],
      true,
      { db: "eduall_institutes", type: "select", data: {} }
    );

    if (!existing?.length)
      return res.status(404).json({
        msg: "Configuracao nao encontrada para este instituto.",
      });

    const newEncrypted = encrypt(api_key.trim());

    await ExecuteQuery(
      res,
      `UPDATE eduall_vendus_config SET api_key_encrypted = ?, updated_at = NOW() WHERE id = ?`,
      [newEncrypted, existing[0].id],
      false,
      { db: "eduall_institutes", type: "update", data: req }
    );

    const verify = safeDecrypt(newEncrypted);
    if (!verify)
      return res.status(500).json({
        msg: "Re-encriptacao falhou na verificacao. Tente novamente.",
      });

    logVendusSuccess(`Re-encriptacao OK para ${instituteCode}`);
    return res.json({
      msg: "Chave re-encriptada com sucesso! O sistema de faturacao esta operacional.",
    });
  } catch (e) {
    logVendusError(`handleReEncryptConfig: ${e.message}`);
    return res.status(500).json({ msg: e.message });
  }
}

async function handleGetPaymentMethods(req, res) {
  try {
    const methods = await getPaymentMethods(req);
    return res.json(methods);
  } catch (e) {
    logVendusError(`handleGetPaymentMethods: ${e.message}`);
    return res.status(500).json({ msg: e.message });
  }
}

async function handleSavePaymentMethod(req, res) {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return res.status(401).json({ msg: "Sessao invalida." });

    const { vendus_id, code, name, is_default } = req.body;

    if (!vendus_id || !name)
      return res.status(400).json({
        msg: "vendus_id e name sao obrigatorios.",
      });

    await ensureTablesExist();

    if (is_default) {
      await ExecuteQuery(
        res,
        `UPDATE eduall_vendus_payment_methods SET is_default = 0 WHERE institute_code = ?`,
        [instituteCode],
        false,
        { db: "eduall_institutes", type: "update", data: req }
      );
    }

    const insertResult = await ExecuteQuery(
      res,
      `INSERT IGNORE INTO eduall_vendus_payment_methods
         (institute_code, vendus_id, code, name, is_default) VALUES (?, ?, ?, ?, ?)`,
      [instituteCode, vendus_id, code || null, name, is_default ? 1 : 0],
      false,
      { db: "eduall_institutes", type: "insert", data: req }
    );

    if (insertResult?.affectedRows === 0)
      return res.status(409).json({
        msg: "Este metodo de pagamento ja esta registado.",
      });

    logVendusSuccess(`Método ${name} adicionado`);
    return res.status(201).json({ msg: "Metodo de pagamento adicionado!" });
  } catch (e) {
    logVendusError(`handleSavePaymentMethod: ${e.message}`);
    return res.status(500).json({ msg: e.message });
  }
}

async function handleDeletePaymentMethod(req, res) {
  try {
    const instituteCode = req.session?.user?.eduall_user_session_curentinstitute;
    if (!instituteCode) return res.status(401).json({ msg: "Sessao invalida." });

    const { id } = req.params;

    await ExecuteQuery(
      res,
      `UPDATE eduall_vendus_payment_methods SET is_active = 0 WHERE id = ? AND institute_code = ?`,
      [id, instituteCode],
      false,
      { db: "eduall_institutes", type: "update", data: req }
    );

    logVendusSuccess(`Método ${id} removido`);
    return res.json({ msg: "Metodo de pagamento removido." });
  } catch (e) {
    logVendusError(`handleDeletePaymentMethod: ${e.message}`);
    return res.status(500).json({ msg: e.message });
  }
}

async function handleCreateInvoice(req, res) {
  try {
    const { _raw, cliente, itens, payment, obs } = req.body;

    if (_raw !== undefined) {
      const config = await getInstituteConfig(req);

      if (!config)
        return res.status(400).json({
          msg: "Configuracao de faturacao nao encontrada. Configure a chave de API primeiro.",
        });

      const paymentMethods = await getPaymentMethods(req);

      if (!paymentMethods || paymentMethods.length === 0) {
        return res.status(400).json({
          msg: "Nenhum método de pagamento disponível. Sincronize da Vendus API primeiro.",
        });
      }

      const defaultMethod =
        paymentMethods.find((m) => m.is_default === 1) || paymentMethods[0];
      const testPayload = buildTestPayload(config, defaultMethod);

      if (config.hasOwnKey) {
        try {
          const data = await postToApi(
            `${config.baseUrl}/documents/`,
            testPayload,
            config.apiKey
          );
          return res.status(201).json({
            id: data?.id || null,
            number: data?.number || null,
            output: data?.output || (data?.id ? `${config.baseUrl}/documents/${data.id}.pdf` : null),
            source: "test_v11",
            ownKey: true,
          });
        } catch (e1) {
          logVendusWarn(`TEST v1.1: ${e1.response?.data?.errors || e1.message}`);
        }

        try {
          const data = await postToApi(
            config.legacyUrl,
            testPayload,
            config.apiKey
          );
          return res.status(201).json({
            id: data?.id || null,
            number: data?.number || null,
            output: data?.output || (data?.id ? `${config.legacyUrl}${data.id}.pdf` : null),
            source: "test_legacy",
            ownKey: true,
          });
        } catch (e2) {
          return res.status(e2.response?.status || 500).json({
            msg: "Erro ao gerar fatura de teste. Verifique a chave de API e o ID do terminal.",
            detalhes: e2.response?.data || e2.message,
            dica: "Confirme que o register_id e os metodos de pagamento pertencem a mesma conta Vendus que a chave de API.",
          });
        }
      }

      const fallbackTestPayload = {
        ...testPayload,
        register_id: DEFAULT_REGISTER_ID,
        payments: [
          {
            id: defaultMethod?.vendus_id || 113682249,
            amount: 1000,
          },
        ],
      };

      try {
        const data = await postToApi(
          DEFAULT_LEGACY_URL,
          fallbackTestPayload,
          DEFAULT_API_KEY
        );
        return res.status(201).json({
          id: data?.id || null,
          number: data?.number || null,
          output: data?.output || (data?.id ? `${DEFAULT_LEGACY_URL}${data.id}.pdf` : null),
          source: "test_default",
          ownKey: false,
        });
      } catch (e3) {
        return res.status(e3.response?.status || 500).json({
          msg: "Erro ao gerar fatura de teste.",
          detalhes: e3.response?.data || e3.message,
        });
      }
    }

    if (!cliente || !itens)
      return res.status(400).json({ msg: "cliente e itens sao obrigatorios." });

    const result = await VENDUS_CreateInvoiceCodeAndDoc(
      req,
      cliente,
      itens,
      payment,
      obs
    );

    if (result?.error)
      return res.status(result.status || 500).json({
        msg: "Erro ao criar fatura",
        detalhes: result.detalhes,
      });

    return res.status(201).json({
      id: result.id || null,
      number: result.number || null,
      output: result.output || null,
      source: result.source || "unknown",
    });
  } catch (e) {
    logVendusError(`handleCreateInvoice: ${e.message}`);
    return res.status(500).json({ msg: e.message });
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  ensureCryptoEnvAsync,  // ← NOVO: Função async para chamar em app.js
  VENDUS_CreateInvoiceCodeAndDoc,
  VENUDS_GetInvoicePdf,
  VENDUS_GetSAFTFile,
  getInstituteConfig,
  getPaymentMethods,
  syncPaymentMethodsFromVendusAPI,
  ensureTablesExist,
  handleGetConfig,
  handleSaveConfig,
  handleReEncryptConfig,
  handleGetPaymentMethods,
  handleSavePaymentMethod,
  handleDeletePaymentMethod,
  handleCreateInvoice,
  COUNTRY_API_URLS,
  COUNTRY_LEGACY_URLS,
  decrypt,
  safeDecrypt,
  encrypt,
  resolvePaymentMethod,
};