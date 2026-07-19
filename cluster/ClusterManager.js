/**
 * =====================================================================
 * CLUSTER MANAGER - Load Balancing & Auto-Restart
 * =====================================================================
 * 
 * Gerencia múltiplos processos Node.js (workers)
 * Distribuição automática de carga
 * Auto-restart se process morre
 * Health monitoring por worker
 * 
 * Uso:
 *   const ClusterManager = require('./clusterManager');
 *   await ClusterManager.start(numWorkers);
 */

const cluster = require('cluster');
const os = require('os');
const EventEmitter = require('events');

const ANSI = {
  blue:   "\x1b[34m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  yellow: "\x1b[33m",
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
};

class ClusterManager extends EventEmitter {
  constructor() {
    super();
    this.workers = new Map();
    this.workerStats = new Map();
    this.isMaster = cluster.isMaster;
    this.numWorkers = 0;
  }

  /**
   * Inicializar clustering
   * @param {number} numWorkers - Nº de workers (default: CPU cores)
   * @param {object} options - Opções adicionais
   */
  async start(numWorkers = 0, options = {}) {
    if (!this.isMaster) {
      // Worker process - não fazer nada no cluster manager
      return;
    }

    // Se não especificar, usar nº de cores
    if (!numWorkers || numWorkers < 1) {
      numWorkers = os.cpus().length;
    }

    this.numWorkers = numWorkers;
    const restartDelay = options.restartDelay || 2000;
    const healthCheckInterval = options.healthCheckInterval || 30000;

    console.log(
      `${ANSI.blue}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
      `Iniciando ${numWorkers} workers em ${numWorkers} CPU cores...`
    );

    // Criar workers iniciais
    for (let i = 0; i < numWorkers; i++) {
      this.createWorker(i);
    }

    // Listener: Quando um worker morre, reiniciar
    cluster.on('exit', (worker, code, signal) => {
      this.workers.delete(worker.id);
      this.workerStats.delete(worker.id);

      const status = signal ? `signal ${signal}` : `code ${code}`;
      console.warn(
        `${ANSI.yellow}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
        `Worker #${worker.process.pid} morreu (${status}). Reiniciando em ${restartDelay}ms...`
      );

      setTimeout(() => {
        const newWorker = this.createWorker(worker.id);
        console.log(
          `${ANSI.green}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
          `Worker #${newWorker.process.pid} reiniciado`
        );
      }, restartDelay);
    });

    // Health check periodicamente
    setInterval(() => {
      this.healthCheck();
    }, healthCheckInterval);

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());

    console.log(
      `${ANSI.green}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
      `Cluster iniciado com ${numWorkers} workers`
    );
  }

  /**
   * Criar um novo worker
   */
  createWorker(id) {
    const worker = cluster.fork();
    
    worker.on('message', (msg) => {
      this.handleWorkerMessage(worker, msg);
    });

    this.workers.set(worker.id, worker);
    this.workerStats.set(worker.id, {
      pid: worker.process.pid,
      created: Date.now(),
      requests: 0,
      uptime: 0,
      memory: 0,
      healthy: true,
    });

    console.log(
      `${ANSI.green}[WORKER]${ANSI.reset} ` +
      `Worker criado: PID ${worker.process.pid} (ID: ${worker.id})`
    );

    return worker;
  }

  /**
   * Processar mensagens dos workers
   */
  handleWorkerMessage(worker, msg) {
    if (msg.type === 'stats') {
      const stats = this.workerStats.get(worker.id);
      if (stats) {
        stats.requests = msg.requests || 0;
        stats.memory = msg.memory || 0;
        stats.uptime = Date.now() - stats.created;
        stats.healthy = msg.healthy !== false;
      }
    }

    if (msg.type === 'error') {
      console.error(
        `${ANSI.red}[WORKER #${worker.process.pid}]${ANSI.reset} ${msg.message}`
      );
    }

    if (msg.type === 'log') {
      console.log(
        `${ANSI.blue}[WORKER #${worker.process.pid}]${ANSI.reset} ${msg.message}`
      );
    }
  }

  /**
   * Health check: verificar se workers estão vivos
   */
  healthCheck() {
    let healthyCount = 0;

    for (const [workerId, worker] of this.workers) {
      const stats = this.workerStats.get(workerId);
      
      if (!worker.isDead()) {
        healthyCount++;
        
        // Request stats do worker
        worker.send({ type: 'getStats' });
      } else {
        console.warn(
          `${ANSI.red}[CLUSTER]${ANSI.reset} ` +
          `Worker #${worker.process.pid} não responde`
        );
      }
    }

    console.log(
      `${ANSI.blue}[CLUSTER]${ANSI.reset} ` +
      `Health check: ${healthyCount}/${this.workers.size} workers vivos`
    );
  }

  /**
   * Restart gracioso de um worker específico (sem downtime)
   * @param {number} workerId - ID do worker a reiniciar
   */
  async restartWorker(workerId) {
    const worker = Array.from(this.workers.values()).find(w => w.id === workerId);
    
    if (!worker) {
      console.warn(`${ANSI.red}[CLUSTER]${ANSI.reset} Worker ID ${workerId} não encontrado`);
      return;
    }

    console.log(
      `${ANSI.yellow}[CLUSTER]${ANSI.reset} ` +
      `Reiniciando worker #${worker.process.pid}...`
    );

    // Sinalizar ao worker para parar graciosamente
    worker.send({ type: 'shutdown' });

    // Dar tempo para terminar requisições em progresso
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Forçar kill se ainda tá vivo
    if (!worker.isDead()) {
      worker.kill();
    }
  }

  /**
   * Restart gracioso de TODOS os workers (zero downtime)
   */
  async restartAllWorkers() {
    console.log(
      `${ANSI.yellow}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
      `Restart gracioso de todos os workers...`
    );

    for (const [workerId, worker] of this.workers) {
      await this.restartWorker(workerId);
    }

    console.log(
      `${ANSI.green}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
      `Todos os workers reiniciados`
    );
  }

  /**
   * Retornar stats de todos os workers
   */
  getStats() {
    const stats = Array.from(this.workerStats.entries()).map(([id, data]) => ({
      workerId: id,
      ...data,
      uptime: Math.floor(data.uptime / 1000) + 's',
      memoryMB: (data.memory / 1024 / 1024).toFixed(2),
    }));

    return {
      isMaster: true,
      numWorkers: this.workers.size,
      cpuCores: os.cpus().length,
      workers: stats,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Shutdown gracioso de todo o cluster
   */
  async shutdown() {
    console.log(
      `${ANSI.red}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
      `Encerrando cluster...`
    );

    // Sinalizar todos os workers
    for (const [id, worker] of this.workers) {
      worker.send({ type: 'shutdown' });
    }

    // Dar tempo pra encerrar
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Forçar kill se ainda tão vivos
    for (const [id, worker] of this.workers) {
      if (!worker.isDead()) {
        worker.kill('SIGKILL');
      }
    }

    console.log(
      `${ANSI.green}${ANSI.bold}[CLUSTER]${ANSI.reset} ` +
      `Cluster encerrado`
    );

    process.exit(0);
  }
}

module.exports = new ClusterManager();