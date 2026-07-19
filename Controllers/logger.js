/**
 * ============================================================================
 * FUNÇÃO: printInvoiceAndRegistry
 * ============================================================================
 * 
 * O que faz:
 * - Imprime dados do aluno
 * - Imprime dados da fatura
 * - Imprime dados do registo no banco
 * Tudo junto e bonito no console!
 */

function printInvoiceAndRegistry(studentName, studentCode, invoiceData, registryData) {
  console.log("");
  console.log(c("┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓", "green"));
  console.log(
    c("┃ ✅ CONFIRMAÇÃO + FATURA REGISTADA", "green") +
    " ".repeat(22) +
    c("┃", "green")
  );
  console.log(c("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛", "green"));
  console.log("");

  // ──────────────────────────────────────────────────────────────────────
  // SEÇÃO 1: DADOS DO ALUNO
  // ──────────────────────────────────────────────────────────────────────
  console.log(c("👤 ALUNO", "bright"));
  console.log(c("─".repeat(58), "cyan"));
  console.log(`  Nome: ${c(studentName || "-", "green")}`);
  console.log(`  Código: ${c(studentCode || "-", "cyan")}`);
  console.log("");

  // ──────────────────────────────────────────────────────────────────────
  // SEÇÃO 2: DADOS DA FATURA
  // ──────────────────────────────────────────────────────────────────────
  if (invoiceData && invoiceData.number) {
    console.log(c("📄 FATURA", "bright"));
    console.log(c("─".repeat(58), "yellow"));

    if (invoiceData.number) {
      console.log(
        `  Nº Fatura: ${c(invoiceData.number, "bright")} ${c("(gerada na VENDUS)", "dim")}`
      );
    }
    if (invoiceData.id) {
      console.log(`  ID Sistema: ${c(invoiceData.id, "cyan")}`);
    }
    if (invoiceData.total) {
      console.log(`  Total: ${c(`${invoiceData.total} AOA`, "green")}`);
    }
    if (invoiceData.date) {
      console.log(`  Data: ${c(invoiceData.date, "cyan")}`);
    }
    if (invoiceData.status) {
      const statusColor = invoiceData.status === "confirmed" ? "green" : "yellow";
      console.log(`  Status: ${c(invoiceData.status, statusColor)}`);
    }
    console.log("");
  }

  // ──────────────────────────────────────────────────────────────────────
  // SEÇÃO 3: DADOS DO BANCO (REGISTO)
  // ──────────────────────────────────────────────────────────────────────
  if (registryData) {
    console.log(c("💾 REGISTO NO BANCO", "bright"));
    console.log(c("─".repeat(58), "magenta"));

    // Campos importantes primeiro
    if (registryData.ed_enrollment_confirmation_id) {
      console.log(
        `  ID Confirmação: ${c(registryData.ed_enrollment_confirmation_id, "cyan")}`
      );
    }
    if (registryData.ed_enrollment_confirmation_student) {
      console.log(
        `  ID Aluno: ${c(registryData.ed_enrollment_confirmation_student, "cyan")}`
      );
    }
    if (registryData.ed_enrollment_confirmation_class) {
      console.log(
        `  ID Turma: ${c(registryData.ed_enrollment_confirmation_class, "cyan")}`
      );
    }
    if (registryData.ed_enrollment_confirmation_institute_code) {
      console.log(
        `  Instituto: ${c(registryData.ed_enrollment_confirmation_institute_code, "green")}`
      );
    }
    if (registryData.ed_enrollment_confirmation_service) {
      console.log(
        `  Serviço: ${c(registryData.ed_enrollment_confirmation_service, "cyan")}`
      );
    }

    // Campos de fatura
    if (registryData.ed_enrollment_confirmation_invoice_code) {
      console.log(
        `  Código Fatura (BD): ${c(registryData.ed_enrollment_confirmation_invoice_code, "yellow")}`
      );
    }
    if (registryData.ed_enrollment_confirmation_invoice_file) {
      console.log(
        `  Ficheiro Fatura (BD): ${c(registryData.ed_enrollment_confirmation_invoice_file, "cyan")}`
      );
    }

    // Data de criação
    if (registryData.created_at) {
      console.log(`  Criado em: ${c(registryData.created_at, "cyan")}`);
    }
    if (registryData.ed_enrollment_confirmation_deleted) {
      const deletedStatus = registryData.ed_enrollment_confirmation_deleted === 0 ? "Ativo" : "Apagado";
      const deletedColor = registryData.ed_enrollment_confirmation_deleted === 0 ? "green" : "red";
      console.log(`  Status BD: ${c(deletedStatus, deletedColor)}`);
    }

    console.log("");
  }

  // ──────────────────────────────────────────────────────────────────────
  // SEÇÃO 4: RESUMO FINAL
  // ──────────────────────────────────────────────────────────────────────
  console.log(c("✅ ", "green") + b("Confirmação registada com sucesso!"));
  console.log("");
}

module.exports = { printInvoiceAndRegistry };

