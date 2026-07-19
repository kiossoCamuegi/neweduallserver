/**
 * =====================================================================
 * WORKER SERVICE - STUDENTS ONLY
 * =====================================================================
 * 
 * Versão LIMPA - Apenas StudentsWorker
 * 
 * Gerencia pool de StudentsWorker
 * 6 operações de alunos
 * 
 * Uso:
 *   const WorkerService = require('./services/WorkerService');
 *   
 *   // Inicializar (no startServer)
 *   await WorkerService.init({ poolSize: 4 });
 *   
 *   // Usar
 *   const result = await WorkerService.calculateAverages({ students });
 *   const enriched = await WorkerService.transformStudents({ students });
 *   const stats = await WorkerService.aggregateStats({ students });
 *   const sorted = await WorkerService.sortStudents({ students, sortBy: 'name' });
 *   const validation = await WorkerService.validateStudents({ students });
 *   const processed = await WorkerService.bulkProcess({ students, filter: {} });
 */

const path = require('path');
const WorkerPool = require('./workerPool');

const ANSI = {
  blue:  "\x1b[34m",
  green: "\x1b[32m",
  red:   "\x1b[31m",
  reset: "\x1b[0m",
  bold:  "\x1b[1m",
};

class WorkerService {
  constructor() {
    this.pools = {};
    this.initialized = false;
  }

  /**
   * =====================================================================
   * INICIALIZAÇÃO
   * =====================================================================
   */

  /**
   * Inicializar pool de StudentsWorker
   * @param {object} options - Configuração
   *   - poolSize: número de workers (default: 4)
   */
  async init(options = {}) {
    if (this.initialized) {
      console.log(`${ANSI.blue}[WorkerService]${ANSI.reset} Já foi inicializado`);
      return;
    }

    const poolSize = options.poolSize || 4;
    const workersDir = path.join(__dirname, '../workers');

    console.log(
      `${ANSI.blue}${ANSI.bold}[WorkerService]${ANSI.reset} ` +
      `Inicializando ${poolSize} StudentsWorker...`
    );

    try {
      // Pool de Students
      this.pools.students = new WorkerPool(
        path.join(workersDir, 'studentsWorker.js'),
        poolSize
      );

      this.initialized = true;

      console.log(
        `${ANSI.green}${ANSI.bold}[WorkerService]${ANSI.reset} ` +
        `StudentsWorker inicializado ✅`
      );
    } catch (err) {
      console.error(
        `${ANSI.red}${ANSI.bold}[WorkerService]${ANSI.reset} ` +
        `Erro ao inicializar: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * =====================================================================
   * STUDENTS OPERATIONS
   * =====================================================================
   */

  /**
   * Calcular médias de alunos
   * @param {array} students - Array de alunos com notas
   * @returns {Promise<array>} Alunos com médias calculadas
   * 
   * @example
   *   const result = await WorkerService.calculateAverages({
   *     students: [
   *       { id: 1, name: 'João', grades: { 'Português': 15, 'Matemática': 18 } }
   *     ]
   *   });
   */
  async calculateAverages({ students }) {
    if (!this.initialized) {
      throw new Error('WorkerService não foi inicializado. Chamar init() primeiro.');
    }

    if (!Array.isArray(students)) {
      throw new Error('students deve ser um array');
    }

    console.log(
      `${ANSI.blue}[WorkerService]${ANSI.reset} ` +
      `Calculando médias para ${students.length} alunos...`
    );

    const startTime = Date.now();

    try {
      const result = await this.pools.students.execute(
        { operation: 'calculateStudentAverages', students },
        30000
      );

      const duration = Date.now() - startTime;
      console.log(
        `${ANSI.green}[WorkerService]${ANSI.reset} ` +
        `Médias calculadas em ${duration}ms`
      );

      return result;
    } catch (err) {
      console.error(
        `${ANSI.red}[WorkerService]${ANSI.reset} ` +
        `Erro ao calcular médias: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * Enriquecer dados de alunos
   * @param {array} students - Array de alunos
   * @returns {Promise<array>} Alunos enriquecidos (idade, género, iniciais)
   */
  async transformStudents({ students }) {
    if (!this.initialized) {
      throw new Error('WorkerService não foi inicializado. Chamar init() primeiro.');
    }

    if (!Array.isArray(students)) {
      throw new Error('students deve ser um array');
    }

    console.log(
      `${ANSI.blue}[WorkerService]${ANSI.reset} ` +
      `Enriquecendo dados de ${students.length} alunos...`
    );

    const startTime = Date.now();

    try {
      const result = await this.pools.students.execute(
        { operation: 'transformStudents', students },
        30000
      );

      const duration = Date.now() - startTime;
      console.log(
        `${ANSI.green}[WorkerService]${ANSI.reset} ` +
        `Dados enriquecidos em ${duration}ms`
      );

      return result;
    } catch (err) {
      console.error(
        `${ANSI.red}[WorkerService]${ANSI.reset} ` +
        `Erro ao enriquecer dados: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * Agregar estatísticas de alunos
   * @param {array} students - Array de alunos
   * @returns {Promise<object>} Estatísticas (total, por género, por status, etc.)
   */
  async aggregateStats({ students }) {
    if (!this.initialized) {
      throw new Error('WorkerService não foi inicializado. Chamar init() primeiro.');
    }

    if (!Array.isArray(students)) {
      throw new Error('students deve ser um array');
    }

    console.log(
      `${ANSI.blue}[WorkerService]${ANSI.reset} ` +
      `Agregando estatísticas de ${students.length} alunos...`
    );

    const startTime = Date.now();

    try {
      const result = await this.pools.students.execute(
        { operation: 'aggregateStudentStats', students },
        30000
      );

      const duration = Date.now() - startTime;
      console.log(
        `${ANSI.green}[WorkerService]${ANSI.reset} ` +
        `Estatísticas agregadas em ${duration}ms`
      );

      return result;
    } catch (err) {
      console.error(
        `${ANSI.red}[WorkerService]${ANSI.reset} ` +
        `Erro ao agregar estatísticas: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * Ordenar alunos
   * @param {array} students - Array de alunos
   * @param {string} sortBy - Campo para ordenar (name, age, average, class)
   * @param {boolean} ascending - Ascendente (default: true)
   * @returns {Promise<array>} Alunos ordenados
   */
  async sortStudents({ students, sortBy = 'name', ascending = true }) {
    if (!this.initialized) {
      throw new Error('WorkerService não foi inicializado. Chamar init() primeiro.');
    }

    if (!Array.isArray(students)) {
      throw new Error('students deve ser um array');
    }

    console.log(
      `${ANSI.blue}[WorkerService]${ANSI.reset} ` +
      `Ordenando ${students.length} alunos por ${sortBy}...`
    );

    const startTime = Date.now();

    try {
      const result = await this.pools.students.execute(
        { operation: 'sortStudents', students, sortBy, ascending },
        30000
      );

      const duration = Date.now() - startTime;
      console.log(
        `${ANSI.green}[WorkerService]${ANSI.reset} ` +
        `Alunos ordenados em ${duration}ms`
      );

      return result;
    } catch (err) {
      console.error(
        `${ANSI.red}[WorkerService]${ANSI.reset} ` +
        `Erro ao ordenar alunos: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * Validar dados de alunos
   * @param {array} students - Array de alunos
   * @returns {Promise<object>} { valid: [...], errors: [...] }
   */
  async validateStudents({ students }) {
    if (!this.initialized) {
      throw new Error('WorkerService não foi inicializado. Chamar init() primeiro.');
    }

    if (!Array.isArray(students)) {
      throw new Error('students deve ser um array');
    }

    console.log(
      `${ANSI.blue}[WorkerService]${ANSI.reset} ` +
      `Validando ${students.length} alunos...`
    );

    const startTime = Date.now();

    try {
      const result = await this.pools.students.execute(
        { operation: 'validateStudents', students },
        30000
      );

      const duration = Date.now() - startTime;
      console.log(
        `${ANSI.green}[WorkerService]${ANSI.reset} ` +
        `Validação concluída em ${duration}ms`
      );

      return result;
    } catch (err) {
      console.error(
        `${ANSI.red}[WorkerService]${ANSI.reset} ` +
        `Erro ao validar alunos: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * Processar alunos em bulk
   * @param {array} students - Array de alunos
   * @param {number} batchSize - Tamanho de batch (default: 100)
   * @param {object} filter - Filtros a aplicar
   * @returns {Promise<object>} Resultado do processamento
   */
  async bulkProcess({ students, batchSize = 100, filter }) {
    if (!this.initialized) {
      throw new Error('WorkerService não foi inicializado. Chamar init() primeiro.');
    }

    if (!Array.isArray(students)) {
      throw new Error('students deve ser um array');
    }

    console.log(
      `${ANSI.blue}[WorkerService]${ANSI.reset} ` +
      `Processando bulk de ${students.length} alunos...`
    );

    const startTime = Date.now();

    try {
      const result = await this.pools.students.execute(
        { operation: 'bulkProcessStudents', students, batchSize, filter: filter || {} },
        30000
      );

      const duration = Date.now() - startTime;
      console.log(
        `${ANSI.green}[WorkerService]${ANSI.reset} ` +
        `Processamento concluído em ${duration}ms`
      );

      return result;
    } catch (err) {
      console.error(
        `${ANSI.red}[WorkerService]${ANSI.reset} ` +
        `Erro ao processar bulk: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * =====================================================================
   * MONITORAMENTO & STATS
   * =====================================================================
   */

  /**
   * Retornar stats do pool
   * @returns {object} Statistics
   */
  getStats() {
    if (!this.initialized) {
      return {
        initialized: false,
        message: 'WorkerService não inicializado',
      };
    }

    return {
      initialized: true,
      timestamp: new Date().toISOString(),
      pool: this.pools.students.getStats(),
    };
  }

  /**
   * Retornar status resumido
   */
  getStatus() {
    if (!this.initialized) {
      return { status: 'not_initialized' };
    }

    const stats = this.pools.students.getStats();

    return {
      status: 'ok',
      initialized: true,
      poolSize: stats.poolSize,
      activeWorkers: stats.activeWorkers,
      queuedTasks: stats.queueLength,
      totalTasks: stats.totalTasks,
      isBusy: stats.activeWorkers > 0 || stats.queueLength > 0,
    };
  }

  /**
   * =====================================================================
   * GRACEFUL SHUTDOWN
   * =====================================================================
   */

  /**
   * Encerrar workers
   */
  async shutdown() {
    if (!this.initialized) {
      console.log(`${ANSI.blue}[WorkerService]${ANSI.reset} Não foi inicializado`);
      return;
    }

    console.log(`${ANSI.blue}[WorkerService]${ANSI.reset} Encerrando StudentsWorker...`);

    try {
      await this.pools.students.terminate();
      console.log(`${ANSI.green}[WorkerService]${ANSI.reset} StudentsWorker encerrado`);
      this.initialized = false;
    } catch (err) {
      console.error(
        `${ANSI.red}[WorkerService]${ANSI.reset} ` +
        `Erro ao encerrar: ${err.message}`
      );
      throw err;
    }
  }

  /**
   * =====================================================================
   * HEALTH CHECK
   * =====================================================================
   */

  /**
   * Executar health check
   */
  async healthCheck() {
    if (!this.initialized) {
      return { healthy: false, reason: 'not_initialized' };
    }

    try {
      await this.pools.students.execute({ operation: 'health' }, 5000);
      return {
        healthy: true,
        timestamp: new Date().toISOString(),
        pool: 'ok',
      };
    } catch (err) {
      return {
        healthy: false,
        reason: err.message,
      };
    }
  }
}

// Exportar como singleton
module.exports = new WorkerService();