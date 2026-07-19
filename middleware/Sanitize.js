const sanitizeHtml = require('sanitize-html');

// Lista de padrões perigosos mais abrangente
const patterns = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|GRANT|REVOKE|TRUNCATE|EXEC|DECLARE|ALTER|CREATE|RENAME|CAST)\b)/i,
  /(\bOR\b|\bAND\b)\s+.+?=.+?/i,
  /['"`][\s]*?(OR|AND)[\s]+?.+?=.*?['"`]/i,
  /--|#|\/\*|\*\//g,
  /0x[0-9A-F]+/i, // hexadecimal SQL injection
  /<script.*?>.*?<\/script>/gi,
  /<.*?on\w+=.*?>/gi,
  /javascript:[^"]*/gi,
  /data:text\/html/i,
  /document\.cookie/i,
  /localStorage/i,
  /window\.location/i,
  /<iframe.*?>/gi,
  /<img.*?onerror=.*?>/gi,
  /<link.*?>/gi,
  /<meta.*?>/gi
];

// Detecção de entrada maliciosa
function isMalicious(input) {
  return typeof input === 'string' && patterns.some((pattern) => pattern.test(decodeURIComponent(input)));
}

// Sanitiza um valor único
function sanitizeValue(value) {
  if (typeof value === 'string') {
    const decoded = decodeURIComponent(value); // Detecta bypass via % encoding

    if (isMalicious(decoded)) {
      throw new Error('Entrada maliciosa detectada');
    }

    // Limpa HTML perigoso
    return sanitizeHtml(decoded, {
      allowedTags: [],
      allowedAttributes: {}
    }).trim();
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeValue(v));
  }

  if (typeof value === 'object' && value !== null) {
    return sanitizeObject(value);
  }

  return value;
}

// Recursivamente sanitiza objetos
function sanitizeObject(obj) {
  const clean = Array.isArray(obj) ? [] : {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      clean[key] = sanitizeValue(obj[key]);
    }
  }

  return clean;
}

// Middleware Express
const Sanitize = () => {
  return (req, res, next) => {
    try {
      if (typeof req.body === 'object') {
        req.body = sanitizeObject(req.body);
      }

      if (typeof req.query === 'object') {
        req.query = sanitizeObject(req.query);
      }

      if (typeof req.params === 'object') {
        req.params = sanitizeObject(req.params);
      }

      next();
    } catch (error) {
      return res.status(400).json({ success: false, error: 'Entrada inválida ou maliciosa bloqueada.' });
    }
  };
};

module.exports = Sanitize;
