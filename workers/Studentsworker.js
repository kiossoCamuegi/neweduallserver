 
const { parentPort } = require('worker_threads');

// ═══════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Calcular idade em anos
 */
function calculateAge(birthDate) {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

/**
 * Formatar nome (Title Case)
 */
function formatName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Calcular média de notas
 */
function calculateAverage(grades) {
  if (!grades || Object.keys(grades).length === 0) return 0;
  const values = Object.values(grades).filter(g => typeof g === 'number');
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return parseFloat((sum / values.length).toFixed(2));
}

/**
 * Determinar status (Aprovado/Reprovado)
 * Baseado em média (>= 10 = Aprovado)
 */
function getStudentStatus(average) {
  if (average >= 10) return 'Aprovado';
  if (average >= 8) return 'Condicional';
  return 'Reprovado';
}

/**
 * Classificar aluno por performance
 */
function classifyPerformance(average) {
  if (average >= 18) return 'Excelente';
  if (average >= 15) return 'Muito Bom';
  if (average >= 12) return 'Bom';
  if (average >= 10) return 'Satisfatório';
  return 'Insuficiente';
}

// ═══════════════════════════════════════════════════════════════════════
// OPERAÇÕES
// ═══════════════════════════════════════════════════════════════════════

/**
 * OPERAÇÃO 1: Calcular Médias de Alunos
 * 
 * Input:
 * {
 *   operation: 'calculateStudentAverages',
 *   students: [
 *     {
 *       id: 1,
 *       name: 'João Silva',
 *       grades: { 'Português': 15, 'Matemática': 18, 'Inglês': 14 }
 *     }
 *   ]
 * }
 * 
 * Output:
 * {
 *   taskId: 123,
 *   data: [
 *     {
 *       id: 1,
 *       name: 'João Silva',
 *       grades: { ... },
 *       average: 15.67,
 *       status: 'Aprovado',
 *       performance: 'Muito Bom'
 *     }
 *   ]
 * }
 */
function calculateStudentAverages(taskId, data) {
  const { students } = data;

  if (!Array.isArray(students)) {
    throw new Error('students deve ser um array');
  }

  const result = students.map(student => {
    const average = calculateAverage(student.grades);
    const status = getStudentStatus(average);
    const performance = classifyPerformance(average);

    return {
      ...student,
      average,
      status,
      performance,
      processedAt: new Date().toISOString(),
    };
  });

  return {
    taskId,
    data: result,
  };
}

 
function transformStudents(taskId, data) {
  const { students } = data;

  if (!Array.isArray(students)) {
    throw new Error('students deve ser um array');
  }

  const result = students.map(student => {
    const name = formatName(student.name || '');
    const age = student.birthDate ? calculateAge(student.birthDate) : null;
    const gender = student.gender === 0 ? 'Masculino' : 'Feminino';
    
    // Iniciais do nome
    const initials = name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase();

    return {
      ...student,
      name,
      age,
      gender,
      initials,
      processedAt: new Date().toISOString(),
    };
  });

  return {
    taskId,
    data: result,
  };
}
 
function bulkProcessStudents(taskId, data) {
  const { students, batchSize = 100, filter } = data;

  if (!Array.isArray(students)) {
    throw new Error('students deve ser um array');
  }

  // Aplicar filtros
  let filtered = students;

  if (filter) {
    filtered = students.filter(student => {
      if (filter.status && student.status !== filter.status) return false;
      if (filter.class && student.class !== filter.class) return false;
      if (filter.gender !== undefined && student.gender !== filter.gender) return false;
      if (filter.minAge && student.age && student.age < filter.minAge) return false;
      if (filter.maxAge && student.age && student.age > filter.maxAge) return false;
      return true;
    });
  }

  // Dividir em batches
  const batches = [];
  for (let i = 0; i < filtered.length; i += batchSize) {
    batches.push(filtered.slice(i, i + batchSize));
  }

  return {
    taskId,
    data: {
      totalProcessed: students.length,
      totalFiltered: filtered.length,
      batches: batches.length,
      batchSize,
      filter: filter || {},
      results: filtered,
      processedAt: new Date().toISOString(),
    },
  };
}
 
function aggregateStudentStats(taskId, data) {
  const { students } = data;

  if (!Array.isArray(students)) {
    throw new Error('students deve ser um array');
  }

  const stats = {
    total: students.length,
    byGender: {},
    byStatus: {},
    byClass: {},
    ageDistribution: {},
    ages: [],
  };

  students.forEach(student => {
    // Por género
    const gender = student.gender === 0 ? 'Masculino' : 'Feminino';
    stats.byGender[gender] = (stats.byGender[gender] || 0) + 1;

    // Por status
    if (student.status) {
      stats.byStatus[student.status] = (stats.byStatus[student.status] || 0) + 1;
    }

    // Por turma
    if (student.class || student.ed_student_class) {
      const classId = student.class || student.ed_student_class;
      stats.byClass[classId] = (stats.byClass[classId] || 0) + 1;
    }

    // Distribuição de idades
    if (student.age || student.birthDate) {
      const age = student.age || calculateAge(student.birthDate);
      if (age) {
        const ageRange = `${age}-${age + 1}`;
        stats.ageDistribution[ageRange] = (stats.ageDistribution[ageRange] || 0) + 1;
        stats.ages.push(age);
      }
    }
  });

  // Média de idades
  const averageAge = stats.ages.length > 0
    ? parseFloat((stats.ages.reduce((a, b) => a + b, 0) / stats.ages.length).toFixed(2))
    : 0;

  // Limpar array de idades (não precisamos manter)
  delete stats.ages;

  return {
    taskId,
    data: {
      ...stats,
      averageAge,
      processedAt: new Date().toISOString(),
    },
  };
}

 
function sortStudents(taskId, data) {
  const { students, sortBy = 'name', ascending = true } = data;

  if (!Array.isArray(students)) {
    throw new Error('students deve ser um array');
  }

  const sorted = [...students].sort((a, b) => {
    let aVal, bVal;

    switch (sortBy) {
      case 'age':
        aVal = a.age || 0;
        bVal = b.age || 0;
        break;
      case 'average':
        aVal = a.average || 0;
        bVal = b.average || 0;
        break;
      case 'class':
        aVal = a.class || a.ed_student_class || 0;
        bVal = b.class || b.ed_student_class || 0;
        break;
      case 'name':
      default:
        aVal = (a.name || '').toLowerCase();
        bVal = (b.name || '').toLowerCase();
    }

    if (aVal < bVal) return ascending ? -1 : 1;
    if (aVal > bVal) return ascending ? 1 : -1;
    return 0;
  });

  return {
    taskId,
    data: sorted,
  };
}
 
function validateStudents(taskId, data) {
  const { students } = data;

  if (!Array.isArray(students)) {
    throw new Error('students deve ser um array');
  }

  const valid = [];
  const errors = [];

  students.forEach(student => {
    const studentErrors = [];

    // Validar nome
    if (!student.name || String(student.name).trim() === '') {
      studentErrors.push('Nome é obrigatório');
    }

    // Validar data de nascimento
    if (student.birthDate) {
      const birth = new Date(student.birthDate);
      const today = new Date();
      if (isNaN(birth.getTime())) {
        studentErrors.push('Data de nascimento inválida');
      } else if (birth > today) {
        studentErrors.push('Data de nascimento não pode ser no futuro');
      }
    }

    // Validar email
    if (student.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(student.email)) {
        studentErrors.push('Email inválido');
      }
    }

    if (studentErrors.length === 0) {
      valid.push(student);
    } else {
      errors.push({
        id: student.id,
        name: student.name,
        errors: studentErrors,
      });
    }
  });

  return {
    taskId,
    data: {
      valid,
      errors,
      totalStudents: students.length,
      validCount: valid.length,
      errorCount: errors.length,
      processedAt: new Date().toISOString(),
    },
  };
}

 
parentPort.on('message', (message) => {
  try {
    const { taskId, operation, ...payload } = message;

    if (!taskId || !operation) {
      throw new Error('taskId e operation são obrigatórios');
    }

    let result;

    switch (operation) {
      case 'calculateStudentAverages':
        result = calculateStudentAverages(taskId, payload);
        break;

      case 'transformStudents':
        result = transformStudents(taskId, payload);
        break;

      case 'bulkProcessStudents':
        result = bulkProcessStudents(taskId, payload);
        break;

      case 'aggregateStudentStats':
        result = aggregateStudentStats(taskId, payload);
        break;

      case 'sortStudents':
        result = sortStudents(taskId, payload);
        break;

      case 'validateStudents':
        result = validateStudents(taskId, payload);
        break;

      case 'health':
        // Health check
        result = { taskId, data: { status: 'ok' } };
        break;

      default:
        throw new Error(`Operação desconhecida: ${operation}`);
    }

    // Enviar resultado ao main thread
    parentPort.postMessage(result);

  } catch (err) {
    // Enviar erro ao main thread
    parentPort.postMessage({
      taskId: message.taskId,
      error: err.message,
    });
  }
});
 