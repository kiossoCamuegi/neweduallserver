 
const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');

const ANSI = {
  blue:  "\x1b[34m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
};

class WorkerPool extends EventEmitter {
  /**
   * Criar um novo pool de workers
   * @param {string} workerScript - Path para o worker script
   * @param {number} poolSize - Nº de workers (default: 4)
   */
  constructor(workerScript, poolSize = 4) {
    super();
    this.workerScript = workerScript;
    this.poolSize = poolSize;
    this.workers = [];
    this.queue = [];
    this.activeWorkers = new Set();
    this.taskCounter = 0;

    console.log(
      `${ANSI.blue}[POOL]${ANSI.reset} ` +
      `Inicializando pool de ${poolSize} workers para: ${path.basename(workerScript)}`
    );
    
    // Criar workers
    for (let i = 0; i < poolSize; i++) {
      this.createWorker(i);
    }
  }

  /**
   * =====================================================================
   * GERENCIAMENTO DE WORKERS
   * =====================================================================
   */

  /**
   * Criar um novo worker
   */
  createWorker(id) {
    try {
      const worker = new Worker(this.workerScript);
      
      worker.id = id;
      worker.busy = false;

      // ─── Listener de mensagens do worker ──────────────────────────────
      worker.on('message', (result) => {
        const taskId = result.taskId;
        const task = this.findTask(taskId);
        
        if (task) {
          clearTimeout(task.timeout);
          worker.busy = false;
          this.activeWorkers.delete(taskId);
          
          if (result.error) {
            console.error(
              `${ANSI.red}[WORKER #${worker.id}] ` +
              `Erro na task ${taskId}:${ANSI.reset} ${result.error}`
            );
            task.reject(new Error(result.error));
          } else {
            console.log(
              `${ANSI.green}[WORKER #${worker.id}]${ANSI.reset} ` +
              `✅ Task ${taskId} concluída`
            );
            task.resolve(result.data);
          }
          
          // Remover task da fila
          this.queue = this.queue.filter(t => t.taskId !== taskId);
        }

        // Processar próxima task na fila
        this.processQueue();
      });

      worker.on('error', (err) => {
        console.error(
          `${ANSI.red}[WORKER #${worker.id}] Erro:${ANSI.reset} ${err.message}`
        );
        worker.busy = false;
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          console.warn(
            `${ANSI.red}[WORKER #${worker.id}] ` +
            `Saiu com código ${code}. Reiniciando...${ANSI.reset}`
          );
          // Recriar worker após delay
          setTimeout(() => this.createWorker(id), 1000);
        }
      });

      this.workers[id] = worker;
      console.log(
        `${ANSI.green}[POOL]${ANSI.reset} ` +
        `Worker #${worker.id} criado (PID: N/A)`
      );

      return worker;
    } catch (err) {
      console.error(
        `${ANSI.red}[POOL] ` +
        `Erro ao criar worker #${id}:${ANSI.reset} ${err.message}`
      );
      throw err;
    }
  }

  /**
   * =====================================================================
   * EXECUÇÃO DE TASKS
   * =====================================================================
   */

  /**
   * Submeter task ao pool
   * @param {object} data - Dados da task
   * @param {number} timeout - ms de timeout (default: 30s)
   * @returns {Promise<any>} Resultado da task
   * 
   * @example
   *   const result = await pool.execute(
   *     { type: 'pautaFinal', data: { students } },
   *     30000
   *   );
   */
  async execute(data, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const taskId = ++this.taskCounter;
      
      const task = {
        taskId,
        data,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.activeWorkers.delete(taskId);
          const errorMsg = `Task ${taskId} timeout após ${timeout}ms`;
          console.error(
            `${ANSI.red}[POOL] ${errorMsg}${ANSI.reset}`
          );
          reject(new Error(errorMsg));
        }, timeout),
        createdAt: Date.now(),
      };

      this.queue.push(task);
      console.log(
        `${ANSI.blue}[POOL]${ANSI.reset} ` +
        `Task ${taskId} enfileirada (fila: ${this.queue.length})`
      );
      
      this.processQueue();
    });
  }

  /**
   * Processar fila de tasks
   */
  processQueue() {
    if (this.queue.length === 0) return;

    // Encontrar worker livre
    const freeWorker = this.workers.find(w => w && !w.busy);
    if (!freeWorker) {
      console.log(
        `${ANSI.blue}[POOL]${ANSI.reset} ` +
        `Todos workers ocupados (fila: ${this.queue.length}), aguardando...`
      );
      return; // Aguardar próxima task concluída
    }

    const task = this.queue[0];
    freeWorker.busy = true;
    this.activeWorkers.add(task.taskId);

    console.log(
      `${ANSI.green}[WORKER #${freeWorker.id}]${ANSI.reset} ` +
      `Executando task ${task.taskId}`
    );

    // Enviar task ao worker
    freeWorker.postMessage({
      taskId: task.taskId,
      ...task.data,
    });
  }

  /**
   * Encontrar task na fila
   */
  findTask(taskId) {
    return this.queue.find(t => t.taskId === taskId);
  }

  /**
   * =====================================================================
   * MONITORAMENTO & STATS
   * =====================================================================
   */

  /**
   * Retornar stats do pool
   * @returns {object} Statistics do pool
   */
  getStats() {
    return {
      poolSize: this.poolSize,
      activeWorkers: this.activeWorkers.size,
      queueLength: this.queue.length,
      totalTasks: this.taskCounter,
      workersStatus: this.workers.map((w, i) => ({
        id: i,
        busy: w ? w.busy : false,
        alive: w ? !w.isDead?.() : false,
      })),
    };
  }

  /**
   * =====================================================================
   * SHUTDOWN
   * =====================================================================
   */

  /**
   * Terminar todos os workers graciosamente
   */
  async terminate() {
    console.log(
      `${ANSI.blue}[POOL]${ANSI.reset} ` +
      `Encerrando ${this.workers.length} workers...`
    );

    for (const worker of this.workers) {
      if (worker) {
        try {
          await worker.terminate();
        } catch (err) {
          console.error(
            `${ANSI.red}[POOL]${ANSI.reset} ` +
            `Erro ao encerrar worker: ${err.message}`
          );
        }
      }
    }

    console.log(
      `${ANSI.green}[POOL]${ANSI.reset} ` +
      `Todos os workers encerrados`
    );
  }
}

module.exports = WorkerPool;
 