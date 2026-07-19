const bcrypt = require("bcryptjs");
const ExecuteQuery = require("./ExecuteQuery");

const InvoiceController = async (req, res) => {
    const prefix = "FT";
    const series = "FA03";
    const year = new Date().getFullYear();
  
    try { 
        // Atualizar todas as faturas sem código criptografado
        const selectQuery = "SELECT id, code FROM eduall_invoices_cod WHERE encrypted_code IS NULL";
        const invoices = await ExecuteQuery(res, selectQuery, [], true, { db: "eduall_invoices_cod", type: "select" });
        
        for (const invoice of invoices) {
            const encryptedCode = await bcrypt.hash(invoice.code, 10);
            const updateQuery = "UPDATE eduall_invoices_cod SET encrypted_code = ? WHERE id = ?";
            await ExecuteQuery(res, updateQuery, [encryptedCode, invoice.id], false, { db: "eduall_invoices_cod", type: "update" });
        }

        // Criar uma nova fatura
        let number = 1;
        let invoiceCode = `${prefix} ${series}.${year}/${number}`;
    
        const checkQuery = "SELECT COUNT(*) AS count FROM eduall_invoices_cod WHERE code = ?";
        let result = await ExecuteQuery(res, checkQuery, [invoiceCode], true, { db: "eduall_invoices_cod", type: "select" });
    
        while (result[0].count > 0) {
            number++;
            invoiceCode = `${prefix} ${series}.${year}/${number}`;
            result = await ExecuteQuery(res, checkQuery, [invoiceCode], true, { db: "eduall_invoices_cod", type: "select" });
        }
    
        const encryptedCode = await bcrypt.hash(invoiceCode, 10);
    
        const insertQuery = "INSERT INTO eduall_invoices_cod (code, encrypted_code) VALUES (?, ?)";
        await ExecuteQuery(res, insertQuery, [invoiceCode, encryptedCode], false, { db: "eduall_invoices_cod", type: "insert" });
    
        return res.status(200).json({
            success: true,
            message: "Todos os códigos de fatura foram atualizados e uma nova fatura foi gerada.",
            invoiceCode,
            encryptedCode,
        });
    } catch (error) {
        console.error("Erro ao atualizar ou gerar código da fatura:", error);
    
        return res.status(500).json({
            success: false,
            message: `Erro ao atualizar ou gerar código da fatura: ${error.message || "Erro desconhecido"}`,
        });
    }
};

module.exports = InvoiceController;
