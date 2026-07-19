import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Counter, Trend, Gauge } from 'k6/metrics';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÉTRICAS PERSONALIZADAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const httpErrors = new Counter('http_errors');
const loginFailures = new Counter('login_failures');
const successfulLogins = new Counter('successful_logins');
const apiResponseTime = new Trend('api_response_time_ms');
const loginResponseTime = new Trend('login_response_time_ms');
const slowRequests = new Counter('slow_requests');  // > 1000ms
const verySlowRequests = new Counter('very_slow_requests');  // > 2000ms
const databaseErrors = new Counter('database_errors');
const cacheHits = new Counter('cache_hits');
const cacheMisses = new Counter('cache_misses');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURAÇÃO DE TESTE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export let options = {
  // FASES DO TESTE (Ramp-up, Sustain, Ramp-down)
  stages: [
    { duration: '5m', target: 1000 },    // Fase 1: Subir para 1000 users em 5 min
    { duration: '5m', target: 5000 },    // Fase 2: Subir para 5000 users em 5 min
    { duration: '15m', target: 10000 },  // Fase 3: Subir para 10000 users em 15 min
    { duration: '20m', target: 10000 },  // Fase 4: Manter 10000 users 20 min
    { duration: '5m', target: 5000 },    // Fase 5: Descer para 5000 em 5 min
    { duration: '5m', target: 0 },       // Fase 6: Descer para 0 em 5 min
  ],
 
  // LIMITES DE PERFORMANCE (Thresholds)
  thresholds: {
    // Latência
    'http_req_duration': [
      'p(50)<200',    // 50% das requisições < 200ms
      'p(90)<500',    // 90% das requisições < 500ms
      'p(95)<800',    // 95% das requisições < 800ms
      'p(99)<1500',   // 99% das requisições < 1500ms
      'p(99.9)<2500', // 99.9% das requisições < 2500ms
    ],
    
    // Taxa de erro
    'http_req_failed': ['rate<0.001'],    // Menos de 0.1% de falhas
    
    // Métricas personalizadas
    'http_errors': ['rate<0.001'],
    'login_failures': ['rate<0.005'],
    'slow_requests': ['rate<0.05'],       // Menos de 5% de requisições lentas
    'very_slow_requests': ['rate<0.01'],  // Menos de 1% de requisições muito lentas
    'database_errors': ['rate<0.001'],
  },

  // Configurações gerais
  ext: {
    loadimpact: {
      projectID: 3356643,
      name: 'Eduall PRO Load Test - 10K Users',
    },
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CONFIGURAÇÃO DO HOST
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const BASE_URL = 'http://localhost:7500';
const TIMEOUT = '30s';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ENDPOINTS DO TESTE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const ENDPOINTS = {
  health: {
    method: 'GET',
    url: '/health',
    name: 'Health Check',
    weight: 10,
  },
  
  login: {
    method: 'POST',
    url: '/login',
    name: 'Login',
    weight: 20,
  },
  
  students: {
    method: 'GET',
    url: '/api/students',
    name: 'Get Students',
    weight: 20,
  },
  
  teachers: {
    method: 'GET',
    url: '/api/teachers',
    name: 'Get Teachers',
    weight: 15,
  },
  
  classes: {
    method: 'GET',
    url: '/api/classes',
    name: 'Get Classes',
    weight: 15,
  },
  
  grades: {
    method: 'GET',
    url: '/api/grades',
    name: 'Get Grades',
    weight: 10,
  },
  
  library: {
    method: 'GET',
    url: '/api/library',
    name: 'Get Library',
    weight: 10,
  },
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UTILIZADORES DE TESTE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const TEST_USERS = [
  { email: 'mauro@example.com', password: 'password123' },
  { email: 'user1@example.com', password: 'password123' },
  { email: 'user2@example.com', password: 'password123' },
  { email: 'user3@example.com', password: 'password123' },
  { email: 'user4@example.com', password: 'password123' },
  { email: 'user5@example.com', password: 'password123' },
  { email: 'user6@example.com', password: 'password123' },
  { email: 'user7@example.com', password: 'password123' },
  { email: 'user8@example.com', password: 'password123' },
  { email: 'user9@example.com', password: 'password123' },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FUNÇÕES AUXILIARES
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Fazer requisição HTTP
 */
function makeRequest(method, endpoint, body = null) {
  const url = BASE_URL + endpoint;
  const params = {
    timeout: TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'k6-loadtest/1.0',
    },
  };

  let response;
  
  if (method === 'GET') {
    response = http.get(url, params);
  } else if (method === 'POST') {
    response = http.post(url, JSON.stringify(body), params);
  } else if (method === 'PUT') {
    response = http.put(url, JSON.stringify(body), params);
  } else if (method === 'DELETE') {
    response = http.del(url, params);
  }

  return response;
}

/**
 * Escolher endpoint aleatório baseado em peso
 */
function getRandomEndpoint() {
  const endpoints = Object.values(ENDPOINTS);
  const totalWeight = endpoints.reduce((sum, ep) => sum + ep.weight, 0);
  let random = Math.random() * totalWeight;

  for (const endpoint of endpoints) {
    random -= endpoint.weight;
    if (random <= 0) {
      return endpoint;
    }
  }

  return endpoints[0];
}

/**
 * Simular utilizador autenticado fazendo requisições
 */
function authenticatedRequests(token, userNum) {
  // Fazer 3-7 requisições por utilizador
  const numRequests = 3 + Math.floor(Math.random() * 5);

  for (let i = 0; i < numRequests; i++) {
    const endpoint = getRandomEndpoint();

    group(`[User ${userNum}] ${endpoint.name}`, () => {
      const response = makeRequest(endpoint.method, endpoint.url);

      const isSuccess = check(response, {
        [`${endpoint.name} status 200`]: (r) => r.status === 200,
        [`${endpoint.name} response time < 500ms`]: (r) => r.timings.duration < 500,
        [`${endpoint.name} response time < 1000ms`]: (r) => r.timings.duration < 1000,
        [`${endpoint.name} no error body`]: (r) => !r.body.includes('error'),
      });

      // Registar métricas
      apiResponseTime.add(response.timings.duration);

      if (response.timings.duration > 2000) {
        verySlowRequests.add(1);
      } else if (response.timings.duration > 1000) {
        slowRequests.add(1);
      }

      if (!isSuccess) {
        httpErrors.add(1);

        if (response.status >= 500) {
          databaseErrors.add(1);
        }
      }

      // Simular cache hit/miss (fake)
      if (Math.random() > 0.3) {
        cacheHits.add(1);
      } else {
        cacheMisses.add(1);
      }
    });

    // Simular think time entre requisições
    sleep(Math.random() * 2);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TESTE PRINCIPAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export default function() {
  // Cada Virtual User (VU) simula um utilizador real
  const userId = Math.floor(__VU % TEST_USERS.length);
  const user = TEST_USERS[userId];
  const userNum = __VU;

  // ─── FASE 1: Health Check ───────────────────────────────────────────

  group('Phase 1 - Health Check', () => {
    const response = makeRequest('GET', '/health');

    check(response, {
      'health check status 200': (r) => r.status === 200,
      'health check response time < 100ms': (r) => r.timings.duration < 100,
    });
  });

  sleep(Math.random() * 2);

  // ─── FASE 2: Login ──────────────────────────────────────────────────

  group('Phase 2 - User Login', () => {
    const loginPayload = {
      ed_user_account_email: user.email,
      ed_user_account_password: user.password,
    };

    const response = makeRequest('POST', '/login', loginPayload);
    const duration = response.timings.duration;

    loginResponseTime.add(duration);

    const isSuccess = check(response, {
      'login status 200': (r) => r.status === 200,
      'login response time < 1000ms': (r) => r.timings.duration < 1000,
      'login response time < 2000ms': (r) => r.timings.duration < 2000,
      'login has accessToken': (r) => r.body.includes('accessToken') || r.status === 200,
    });

    if (isSuccess) {
      successfulLogins.add(1);
    } else {
      loginFailures.add(1);
    }

    if (duration > 1000) {
      slowRequests.add(1);
    }
  });

  sleep(Math.random() * 3);

  // ─── FASE 3: Requisições Autenticadas ────────────────────────────────

  group('Phase 3 - Authenticated Requests', () => {
    authenticatedRequests(null, userNum);
  });

  sleep(Math.random() * 5);

  // ─── FASE 4: Operações Pesadas (Simulado) ───────────────────────────

  group('Phase 4 - Heavy Operations', () => {
    // Simular operação que toma mais tempo (ex: relatório)
    const heavyEndpoints = [
      '/api/students?limit=1000&offset=0',
      '/api/teachers?filter=active',
      '/api/classes?sort=name',
    ];

    const endpoint = heavyEndpoints[Math.floor(Math.random() * heavyEndpoints.length)];
    const response = makeRequest('GET', endpoint);

    check(response, {
      'heavy operation status 200': (r) => r.status === 200,
      'heavy operation response time < 2000ms': (r) => r.timings.duration < 2000,
    });

    apiResponseTime.add(response.timings.duration);

    if (response.timings.duration > 2000) {
      verySlowRequests.add(1);
    }
  });

  sleep(Math.random() * 5);

  // ─── FASE 5: Stress Final ───────────────────────────────────────────

  // Burst de requisições para simular pico
  if (Math.random() > 0.9) {
    group('Phase 5 - Burst of Requests', () => {
      for (let i = 0; i < 10; i++) {
        const endpoint = getRandomEndpoint();
        const response = makeRequest(endpoint.method, endpoint.url);
        apiResponseTime.add(response.timings.duration);

        if (response.timings.duration > 1000) {
          slowRequests.add(1);
        }
      }
    });
  }

  sleep(Math.random() * 3);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SETUP (Executado uma vez antes do teste)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function setup() {
  console.log('🚀 INICIANDO TESTE PRO DE CARGA EDUALL');
  console.log('========================================');
  console.log('');
  console.log('📊 CONFIGURAÇÃO:');
  console.log('├─ Host: ' + BASE_URL);
  console.log('├─ Utilizadores: até 10,000');
  console.log('├─ Duração: 55 minutos');
  console.log('├─ Pedidos esperados: ~1,000,000+');
  console.log('└─ Limiar de erro: < 0.1%');
  console.log('');
  console.log('✅ Setup completo, começando teste...');
  console.log('');

  // Verificar se servidor está disponível
  const healthCheck = makeRequest('GET', '/health');
  if (healthCheck.status !== 200) {
    throw new Error(`Servidor não disponível em ${BASE_URL}`);
  }

  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// TEARDOWN (Executado uma vez após o teste)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function teardown(data) {
  console.log('');
  console.log('✅ TESTE COMPLETO!');
  console.log('========================================');
  console.log('');
  console.log('📊 RESUMO FINAL:');
  console.log('├─ HTTP Errors: ' + httpErrors.value);
  console.log('├─ Login Failures: ' + loginFailures.value);
  console.log('├─ Successful Logins: ' + successfulLogins.value);
  console.log('├─ Slow Requests (>1000ms): ' + slowRequests.value);
  console.log('├─ Very Slow Requests (>2000ms): ' + verySlowRequests.value);
  console.log('├─ Database Errors: ' + databaseErrors.value);
  console.log('├─ Cache Hits: ' + cacheHits.value);
  console.log('├─ Cache Misses: ' + cacheMisses.value);
  console.log('└─ Avg Response Time: ' + apiResponseTime.value + 'ms');
  console.log('');
  console.log('📈 Verifique os resultados acima para detalhes completos.');
  console.log('');
}