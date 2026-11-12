#!/usr/bin/env node
/**
 * Liga as páginas de lista/tabela/seletor de alunos e os gráficos do
 * dashboard aos endpoints leves (/get-lite e /class-gender).
 *
 * - Idempotente: pode correr várias vezes.
 * - Só altera o bundle já compilado em static/js/main.*.js.
 * - Se o frontend for recompilado, voltar a correr este script (ou usar os
 *   endpoints no código-fonte React).
 *
 * Uso: node scripts/patch-students-lite.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const JS_DIR = path.join(ROOT, "static", "js");

const replacements = [
  // Lista em cards
  ['const HTe=Nn()+"eduallstudentsapi/get/";', 'const HTe=Nn()+"eduallstudentsapi/get-lite/";'],
  // Tabela de alunos
  ['wNe=Nn()+"eduallstudentsapi/get/",', 'wNe=Nn()+"eduallstudentsapi/get-lite/",'],
  // Seletor de aluno
  ['mPe=Nn()+"eduallstudentsapi/get/",', 'mPe=Nn()+"eduallstudentsapi/get-lite/",'],
  // Lista de presenças
  ['F0e=Nn()+"eduallstudentsapi/get/",', 'F0e=Nn()+"eduallstudentsapi/get-lite/",'],
  // Notas por turma
  ['kht=Nn()+"eduallstudentsapi/get/",', 'kht=Nn()+"eduallstudentsapi/get-lite/",'],
  // Impressão de lista
  ['lft=[Nn()+"eduallstudentsapi/get/",', 'lft=[Nn()+"eduallstudentsapi/get-lite/",'],
  // Dashboard: só precisa de turma + género
  ['pr.get(Nn()+"eduallstudentsapi/get")', 'pr.get(Nn()+"eduallstudentsapi/class-gender")'],
];

// O dashboard de produção define `students: () => API + "eduallstudentsapi/get"`.
// O alias minificado muda a cada build, por isso usamos regex.
const regexReplacements = [
  {
    re: /students:\(\)=>\(0,([A-Za-z_$][\w$]*)\.A\)\(\)\+"eduallstudentsapi\/get"/g,
    to: (_m, v) => `students:()=>(0,${v}.A)()+"eduallstudentsapi/class-gender"`,
  },
];

if (!fs.existsSync(JS_DIR)) {
  console.error("Pasta não encontrada:", JS_DIR);
  process.exit(1);
}

const files = fs.readdirSync(JS_DIR).filter((f) => /^main\..*\.js$/.test(f));
if (!files.length) {
  console.error("Nenhum static/js/main.*.js encontrado.");
  process.exit(1);
}

let total = 0;
for (const file of files) {
  const full = path.join(JS_DIR, file);
  let source = fs.readFileSync(full, "utf8");
  let changed = 0;

  for (const [from, to] of replacements) {
    const count = source.split(from).length - 1;
    if (count > 0) {
      source = source.split(from).join(to);
      changed += count;
    }
  }

  for (const { re, to } of regexReplacements) {
    const before = source;
    source = source.replace(re, to);
    if (source !== before) changed += 1;
  }

  if (changed > 0) {
    fs.writeFileSync(full, source, "utf8");
    console.log(`✅ ${file}: ${changed} substituição(ões)`);
  } else {
    console.log(`— ${file}: sem alterações (já aplicado?)`);
  }
  total += changed;
}

console.log(`\nTotal: ${total} substituição(ões).`);
