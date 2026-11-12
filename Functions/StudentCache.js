/**
 * Invalidação centralizada das caches que dependem de alunos/turmas.
 *
 * Usar SEMPRE que uma escrita alterar:
 *  - eduall_students (turma, nome, estado, bolseiro, etc.)
 *  - eduall_class / cicles / cursos / salas / níveis (títulos que vão no JOIN)
 *  - matrículas/confirmações que mudam a turma do aluno
 *
 * Uma falha de cache nunca pode fazer falhar o pedido.
 */
const Cache = require("./CacheRoutes");

async function invalidateStudentCaches(instituteCode) {
  try {
    // Sem escola identificada: limpa tudo (nunca deixa dados velhos).
    if (!instituteCode) {
      await Promise.all([
        Cache.eduallClear("students:*").catch(() => 0),
        Cache.eduallClear("student:transfer:*").catch(() => 0),
      ]);
      return;
    }

    const patterns = [
      `students:list:${instituteCode}`,
      `students:list-lite:${instituteCode}`,
      `students:class-gender:${instituteCode}`,
      `students:byinstitute:${instituteCode}`,
      `students:byclass:*:${instituteCode}`,
      `students:single:*:${instituteCode}`,
      `students:byidentity:*:${instituteCode}`,
      `students:bycode:*`, // chaves antigas sem tenant (conjunto pequeno)
      `students:emails:${instituteCode}`,
      `students:transferred:${instituteCode}`,
      `students:transport:*:${instituteCode}`,
      `students:*:global`, // GetSTDS (lista global)
      `student:transfer:*`, // estado/histórico de transferências
    ];

    await Promise.all(patterns.map((p) => Cache.eduallClear(p).catch(() => 0)));
  } catch (err) {
    console.error("⚠️ CACHE: falha ao invalidar alunos (ignorado):", err && err.message);
  }
}

module.exports = { invalidateStudentCaches };
