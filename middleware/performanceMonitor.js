/**
 * METRICS MONITOR PRO
 * Monitor em tempo real para Node.js Express
 * Rota: GET /dashboardlogs
 * 
 * Uso:
 * const metricsMonitor = require('./metricsMonitor');
 * app.use(metricsMonitor);
 */

const express = require('express');
const router = express.Router();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CLASSE DE MONITORAMENTO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

class MetricsMonitor {
  constructor() {
    this.requests = new Map();
    this.logs = [];
    this.maxLogs = 500; // Guardar últimos 500 logs
    this.requestId = 0;
    this.metrics = {
      totalRequests: 0,
      totalErrors: 0,
      avgResponseTime: 0,
      slowRequests: 0,
      uptime: Date.now(),
    };
    this.hourlyData = {
      timestamps: [],
      requests: [],
      errors: [],
      avgTime: [],
    };
    this.clients = []; // Clientes SSE conectados
    this.startEventLoopMonitor();
    this.startHourlyMetrics();
  }

  // ───── Monitorar Event Loop ─────
  startEventLoopMonitor() {
    let lastCheck = Date.now();

    setInterval(() => {
      const now = Date.now();
      const lag = (now - lastCheck) - 1000;
      lastCheck = now;

      if (lag > 100) {
        this.addLog({
          level: 'warning',
          message: `⚠️ EVENT LOOP LAG: ${lag.toFixed(0)}ms`,
          timestamp: new Date(),
          activeRequests: this.requests.size,
          lag: lag,
        });
      }
    }, 1000);
  }

  // ───── Coletar Métricas Horárias ─────
  startHourlyMetrics() {
    setInterval(() => {
      const now = new Date();
      const hour = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

      this.hourlyData.timestamps.push(hour);
      this.hourlyData.requests.push(this.metrics.totalRequests);
      this.hourlyData.errors.push(this.metrics.totalErrors);
      this.hourlyData.avgTime.push(Math.round(this.metrics.avgResponseTime));

      // Manter últimas 12 horas
      if (this.hourlyData.timestamps.length > 12) {
        this.hourlyData.timestamps.shift();
        this.hourlyData.requests.shift();
        this.hourlyData.errors.shift();
        this.hourlyData.avgTime.shift();
      }

      this.broadcastMetrics();
    }, 60000); // A cada minuto
  }

  // ───── Rastrear Requisição ─────
  trackRequest(req) {
    const id = ++this.requestId;
    const reqData = {
      id,
      method: req.method,
      url: req.url,
      start: Date.now(),
      status: null,
      duration: 0,
      isSlowWarned: false,
    };

    this.requests.set(id, reqData);
    this.metrics.totalRequests++;

    // Avisar se ficar lento (a cada 2 segundos)
    const slowWarnInterval = setInterval(() => {
      const duration = Date.now() - reqData.start;
      
      if (duration > 2000 && !reqData.isSlowWarned) {
        reqData.isSlowWarned = true;
        this.addLog({
          level: 'warning',
          message: `🐢 SLOW REQUEST: ${reqData.method} ${reqData.url}`,
          duration: duration,
          url: reqData.url,
          method: reqData.method,
          timestamp: new Date(),
        });
        this.broadcastMetrics();
      }

      // Parar se já terminou
      if (reqData.duration > 0) {
        clearInterval(slowWarnInterval);
      }
    }, 2000);

    return id;
  }

  // ───── Finalizar Requisição ─────
  finishRequest(id, statusCode) {
    const reqData = this.requests.get(id);
    if (!reqData) return;

    const duration = Date.now() - reqData.start;
    reqData.duration = duration;
    reqData.status = statusCode;

    // Calcular média de latência
    const allDurations = Array.from(this.requests.values())
      .filter(r => r.duration > 0)
      .map(r => r.duration);
    this.metrics.avgResponseTime = allDurations.length > 0
      ? allDurations.reduce((a, b) => a + b, 0) / allDurations.length
      : 0;

    // Contar requisições lentas e erros
    if (duration > 1000) {
      this.metrics.slowRequests++;
    }

    if (statusCode >= 400) {
      this.metrics.totalErrors++;
      this.addLog({
        level: 'error',
        message: `❌ ERROR: ${reqData.method} ${reqData.url} [${statusCode}]`,
        status: statusCode,
        url: reqData.url,
        method: reqData.method,
        duration: duration,
        timestamp: new Date(),
      });
    } else if (duration > 1000) {
      this.addLog({
        level: 'info',
        message: `✅ COMPLETED: ${reqData.method} ${reqData.url} - ${duration}ms`,
        status: statusCode,
        duration: duration,
        url: reqData.url,
        method: reqData.method,
        timestamp: new Date(),
      });
    }

    // Remover da lista de requisições ativas
    setTimeout(() => this.requests.delete(id), 100);
    this.broadcastMetrics();
  }

  // ───── Adicionar Log ─────
  addLog(logData) {
    this.logs.push({
      ...logData,
      id: Date.now(),
    });

    // Manter apenas últimos 500 logs
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    this.broadcastMetrics();
  }

  // ───── Obter Métricas ─────
  getMetrics() {
    const uptime = Date.now() - this.metrics.uptime;
    const errorRate = this.metrics.totalRequests > 0
      ? ((this.metrics.totalErrors / this.metrics.totalRequests) * 100).toFixed(2)
      : 0;

    return {
      ...this.metrics,
      uptime: this.formatUptime(uptime),
      errorRate: `${errorRate}%`,
      activeRequests: this.requests.size,
      hourlyData: this.hourlyData,
    };
  }

  // ───── Requisições Ativas ─────
  getActiveRequests() {
    return Array.from(this.requests.values()).map(req => ({
      ...req,
      duration: Date.now() - req.start,
    }));
  }

  // ───── Broadcast Métricas via SSE ─────
  broadcastMetrics() {
    const data = JSON.stringify({
      metrics: this.getMetrics(),
      activeRequests: this.getActiveRequests(),
      logs: this.logs.slice(-50), // Últimos 50 logs
    });

    this.clients.forEach(client => {
      try {
        client.write(`data: ${data}\n\n`);
      } catch (e) {
        // Cliente desconectado
      }
    });
  }

  // ───── Formatar Uptime ─────
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // ───── Registar Cliente SSE ─────
  addClient(res) {
    this.clients.push(res);
  }

  // ───── Remover Cliente SSE ─────
  removeClient(res) {
    this.clients = this.clients.filter(client => client !== res);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// INSTÂNCIA GLOBAL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const monitor = new MetricsMonitor();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MIDDLEWARE DE RASTREAMENTO
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.use((req, res, next) => {
  // Não rastrear rota do dashboard
  if (req.path.startsWith('/dashboardlogs')) {
    return next();
  }

  const requestId = monitor.trackRequest(req);

  // Interceptar resposta
  const originalSend = res.send;
  res.send = function (data) {
    monitor.finishRequest(requestId, res.statusCode);
    return originalSend.call(this, data);
  };

  const originalJson = res.json;
  res.json = function (data) {
    monitor.finishRequest(requestId, res.statusCode);
    return originalJson.call(this, data);
  };

  next();
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ROTAS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// ───── Dashboard UI ─────
router.get('/dashboardlogs', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(getDashboardHTML());
});

// ───── API: Métricas em Tempo Real (SSE) ─────
router.get('/dashboardlogs/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  monitor.addClient(res);
  monitor.broadcastMetrics();

  req.on('close', () => {
    monitor.removeClient(res);
  });
});

// ───── API: Métricas JSON ─────
router.get('/dashboardlogs/api/metrics', (req, res) => {
  res.json(monitor.getMetrics());
});

// ───── API: Requisições Ativas ─────
router.get('/dashboardlogs/api/active-requests', (req, res) => {
  res.json(monitor.getActiveRequests());
});

// ───── API: Logs ─────
router.get('/dashboardlogs/api/logs', (req, res) => {
  res.json(monitor.logs);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HTML DO DASHBOARD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function getDashboardHTML() {
  return `<!DOCTYPE html>
<html lang="pt-PT">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>📊 Metrics Monitor - Real-time Dashboard</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * {
      font-family: 'Montserrat', sans-serif;
    }

    body {
      background: linear-gradient(135deg, #0f172a 0%, #1a1f2e 100%);
      color: #e2e8f0;
      min-height: 100vh;
      padding: 20px;
    }

    .dashboard-container {
      max-width: 1400px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      margin-bottom: 40px;
      animation: slideDown 0.5s ease-out;
    }

    .header h1 {
      font-weight: 800;
      font-size: 2.5em;
      background: linear-gradient(135deg, #00d4ff, #0099ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 10px;
    }

    .metric-card {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      border: 1px solid #475569;
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
      transition: all 0.3s ease;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    }

    .metric-card:hover {
      transform: translateY(-5px);
      border-color: #00d4ff;
      box-shadow: 0 8px 12px rgba(0, 212, 255, 0.2);
    }

    .metric-label {
      font-size: 0.9em;
      color: #94a3b8;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 10px;
    }

    .metric-value {
      font-size: 2em;
      font-weight: 700;
      color: #00d4ff;
    }

    .metric-value.error {
      color: #ff6b6b;
    }

    .metric-value.warning {
      color: #ffa500;
    }

    .metric-value.success {
      color: #4ade80;
    }

    .status-badge {
      display: inline-block;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
    }

    .status-online {
      background: rgba(74, 222, 128, 0.2);
      color: #4ade80;
      border: 1px solid #4ade80;
    }

    .status-warning {
      background: rgba(255, 165, 0, 0.2);
      color: #ffa500;
      border: 1px solid #ffa500;
    }

    .status-error {
      background: rgba(255, 107, 107, 0.2);
      color: #ff6b6b;
      border: 1px solid #ff6b6b;
    }

    .chart-container {
      position: relative;
      height: 300px;
      margin-bottom: 20px;
    }

    .logs-container {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      border: 1px solid #475569;
      border-radius: 12px;
      padding: 20px;
      max-height: 600px;
      overflow-y: auto;
    }

    .log-item {
      padding: 12px;
      margin-bottom: 10px;
      border-left: 4px solid;
      border-radius: 4px;
      font-size: 0.95em;
      animation: slideIn 0.3s ease-out;
    }

    .log-item.error {
      background: rgba(255, 107, 107, 0.1);
      border-left-color: #ff6b6b;
      color: #ff6b6b;
    }

    .log-item.warning {
      background: rgba(255, 165, 0, 0.1);
      border-left-color: #ffa500;
      color: #ffa500;
    }

    .log-item.info {
      background: rgba(0, 212, 255, 0.1);
      border-left-color: #00d4ff;
      color: #00d4ff;
    }

    .log-time {
      font-size: 0.8em;
      opacity: 0.7;
      margin-right: 10px;
    }

    .active-requests {
      background: linear-gradient(135deg, #1e293b 0%, #334155 100%);
      border: 1px solid #475569;
      border-radius: 12px;
      padding: 20px;
      max-height: 400px;
      overflow-y: auto;
    }

    .request-row {
      display: grid;
      grid-template-columns: 60px 1fr 100px 100px;
      gap: 15px;
      padding: 10px;
      margin-bottom: 10px;
      background: rgba(0, 212, 255, 0.05);
      border-radius: 6px;
      border-left: 3px solid #00d4ff;
    }

    .request-method {
      font-weight: 700;
      padding: 5px 10px;
      border-radius: 4px;
      text-align: center;
      font-size: 0.85em;
    }

    .method-get { background: #0099ff; color: white; }
    .method-post { background: #4ade80; color: white; }
    .method-put { background: #ffa500; color: white; }
    .method-delete { background: #ff6b6b; color: white; }

    .request-duration {
      color: #ffa500;
      font-weight: 600;
    }

    .request-duration.slow {
      color: #ff6b6b;
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-20px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateX(-20px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }

    .section-title {
      font-weight: 700;
      font-size: 1.3em;
      margin-top: 30px;
      margin-bottom: 20px;
      padding-bottom: 10px;
      border-bottom: 2px solid #00d4ff;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .pulse {
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    ::-webkit-scrollbar {
      width: 8px;
    }

    ::-webkit-scrollbar-track {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 10px;
    }

    ::-webkit-scrollbar-thumb {
      background: #00d4ff;
      border-radius: 10px;
    }

    ::-webkit-scrollbar-thumb:hover {
      background: #0099ff;
    }
  </style>
</head>
<body>
  <div class="dashboard-container">
    <!-- HEADER -->
    <div class="header">
      <h1>📊 METRICS MONITOR</h1>
      <p>Real-time Performance Dashboard</p>
      <span class="status-badge status-online pulse">🟢 LIVE</span>
    </div>

    <!-- MÉTRICAS PRINCIPAIS -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total de Requisições</div>
        <div class="metric-value" id="totalRequests">0</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Requisições Ativas</div>
        <div class="metric-value" id="activeRequests">0</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Latência Média</div>
        <div class="metric-value" id="avgResponseTime">0ms</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Total de Erros</div>
        <div class="metric-value error" id="totalErrors">0</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Taxa de Erro</div>
        <div class="metric-value warning" id="errorRate">0%</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Requisições Lentas</div>
        <div class="metric-value warning" id="slowRequests">0</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Uptime</div>
        <div class="metric-value success" id="uptime">0s</div>
      </div>
    </div>

    <!-- CHARTS -->
    <div class="section-title">📈 Gráficos em Tempo Real</div>
    <div class="row">
      <div class="col-md-6">
        <div class="metric-card">
          <div class="chart-container">
            <canvas id="requestsChart"></canvas>
          </div>
        </div>
      </div>
      <div class="col-md-6">
        <div class="metric-card">
          <div class="chart-container">
            <canvas id="errorsChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <div class="row">
      <div class="col-12">
        <div class="metric-card">
          <div class="chart-container">
            <canvas id="latencyChart"></canvas>
          </div>
        </div>
      </div>
    </div>

    <!-- REQUISIÇÕES ATIVAS -->
    <div class="section-title">🔄 Requisições Ativas</div>
    <div class="active-requests" id="activeRequestsList">
      <p style="text-align: center; color: #94a3b8;">Nenhuma requisição ativa...</p>
    </div>

    <!-- LOGS -->
    <div class="section-title">📋 Logs em Tempo Real</div>
    <div class="logs-container" id="logsList">
      <p style="text-align: center; color: #94a3b8;">Aguardando logs...</p>
    </div>
  </div>

  <script>
    // ───── CONFIGURAÇÃO DE CHARTS ─────
    const chartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#94a3b8',
            font: { family: "'Montserrat', sans-serif" },
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(71, 85, 105, 0.2)' },
          ticks: { color: '#94a3b8' }
        },
        y: {
          grid: { color: 'rgba(71, 85, 105, 0.2)' },
          ticks: { color: '#94a3b8' }
        }
      }
    };

    // Chart: Requisições
    const requestsCtx = document.getElementById('requestsChart').getContext('2d');
    const requestsChart = new Chart(requestsCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Requisições/Minuto',
          data: [],
          borderColor: '#00d4ff',
          backgroundColor: 'rgba(0, 212, 255, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: chartOptions
    });

    // Chart: Erros
    const errorsCtx = document.getElementById('errorsChart').getContext('2d');
    const errorsChart = new Chart(errorsCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Erros/Minuto',
          data: [],
          borderColor: '#ff6b6b',
          backgroundColor: 'rgba(255, 107, 107, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: chartOptions
    });

    // Chart: Latência
    const latencyCtx = document.getElementById('latencyChart').getContext('2d');
    const latencyChart = new Chart(latencyCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          label: 'Latência Média (ms)',
          data: [],
          borderColor: '#ffa500',
          backgroundColor: 'rgba(255, 165, 0, 0.1)',
          tension: 0.4,
          fill: true
        }]
      },
      options: chartOptions
    });

    // ───── SSE STREAM ─────
    const eventSource = new EventSource('/dashboardlogs/stream');

    eventSource.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        const metrics = data.metrics;
        const activeRequests = data.activeRequests;
        const logs = data.logs;

        // Atualizar métricas
        document.getElementById('totalRequests').textContent = metrics.totalRequests;
        document.getElementById('activeRequests').textContent = metrics.activeRequests;
        document.getElementById('avgResponseTime').textContent = Math.round(metrics.avgResponseTime) + 'ms';
        document.getElementById('totalErrors').textContent = metrics.totalErrors;
        document.getElementById('errorRate').textContent = metrics.errorRate;
        document.getElementById('slowRequests').textContent = metrics.slowRequests;
        document.getElementById('uptime').textContent = metrics.uptime;

        // Atualizar charts
        const hourlyData = metrics.hourlyData;
        if (hourlyData && hourlyData.timestamps.length > 0) {
          requestsChart.data.labels = hourlyData.timestamps;
          requestsChart.data.datasets[0].data = hourlyData.requests;
          requestsChart.update('none');

          errorsChart.data.labels = hourlyData.timestamps;
          errorsChart.data.datasets[0].data = hourlyData.errors;
          errorsChart.update('none');

          latencyChart.data.labels = hourlyData.timestamps;
          latencyChart.data.datasets[0].data = hourlyData.avgTime;
          latencyChart.update('none');
        }

        // Atualizar requisições ativas
        const activeList = document.getElementById('activeRequestsList');
        if (activeRequests.length > 0) {
          activeList.innerHTML = activeRequests.map(req => {
            const duration = req.duration;
            const isSlow = duration > 2000;
            return \`
              <div class="request-row">
                <div class="request-method method-\${req.method.toLowerCase()}">\${req.method}</div>
                <div style="word-break: break-all;">\${req.url}</div>
                <div class="request-duration \${isSlow ? 'slow' : ''}">\${duration}ms</div>
              </div>
            \`;
          }).join('');
        } else {
          activeList.innerHTML = '<p style="text-align: center; color: #94a3b8;">Nenhuma requisição ativa...</p>';
        }

        // Atualizar logs
        const logsList = document.getElementById('logsList');
        logsList.innerHTML = logs.slice(-50).reverse().map(log => \`
          <div class="log-item \${log.level}">
            <span class="log-time">\${new Date(log.timestamp).toLocaleTimeString()}</span>
            <span>\${log.message}\${log.duration ? \` (\${log.duration}ms)\` : ''}</span>
          </div>
        \`).join('');

      } catch (e) {
        console.error('Erro ao processar dados:', e);
      }
    };

    eventSource.onerror = function() {
      console.error('Erro na conexão SSE');
    };

    // Auto-refresh a cada 1 segundo se SSE não funcionar
    setInterval(() => {
      fetch('/dashboardlogs/api/metrics')
        .then(r => r.json())
        .then(data => {
          // Fallback manual se SSE não funcionar
        })
        .catch(e => console.error('Erro ao fetch:', e));
    }, 5000);
  </script>
</body>
</html>
  `;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EXPORT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

module.exports = router;