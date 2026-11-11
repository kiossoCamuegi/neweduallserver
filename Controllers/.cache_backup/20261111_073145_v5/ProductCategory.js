const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetProductCategories = async (req, res) => { 
   try {
       const query = 'SELECT * FROM eduall_product_categories WHERE ed_product_category_deleted = 0 AND ed_product_category_institute_code = ?';
       const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_product_categories", type: "select", data: req });
       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao buscar categorias de produtos!", error: error.message });
   }
}; 

const GetSingleProductCategory = async (req, res) => {
   try {
       const { ID } = req.params; 
       const query = 'SELECT * FROM eduall_product_categories WHERE ed_product_category_deleted = 0 AND ed_product_category_id = ? AND ed_product_category_institute_code = ?';
       const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_product_categories", type: "select", data: req });
       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao buscar a categoria de produto!", error: error.message });
   }
};

const RegisterProductCategory = async (req, res) => { 
   try {
       const query = `INSERT INTO eduall_product_categories (ed_product_category_name, ed_product_category_institute_code) VALUES(?,?)`;
       const PARAMS = [req.body.product_category, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_product_categories", type: "insert", data: req });

       await RegisterAuditAction({
         session: req.session,
         action: 1,  // Ação de registro
         form: "Categorias de Produtos",
         description: `Registrou uma nova categoria de produto (${req.body.product_category})`,
       });

       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao registrar categoria de produto!", error: error.message });
   }
};

const DeleteProductCategory = async (req, res) => {
   try {
       const { ID } = req.params;
       const query = `UPDATE eduall_product_categories SET ed_product_category_deleted = 1 WHERE ed_product_category_deleted = 0 AND ed_product_category_id = ? AND ed_product_category_institute_code = ?`;
       const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_product_categories", type: "update", data: req });

       await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de eliminação
         form: "Categorias de Produtos",
         description: `Eliminou a categoria de produto com ID ${ID}`,
       });

       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao excluir categoria de produto!", error: error.message });
   }
};

const UpdateProductCategory = async (req, res) => {
   try {
       const { ID } = req.params;
       const { product_category } = req.body;
       const query = `UPDATE eduall_product_categories SET ed_product_category_name = ? WHERE ed_product_category_deleted = 0 AND ed_product_category_id = ? AND ed_product_category_institute_code = ?`; 
       const PARAMS = [product_category, ID, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_product_categories", type: "update", data: req });

       await RegisterAuditAction({
         session: req.session,
         action: 2,  // Ação de atualização
         form: "Categorias de Produtos",
         description: `Atualizou a categoria de produto com ID ${ID} para o nome ${product_category}`,
       });

       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao atualizar categoria de produto!", error: error.message });
   }
};

module.exports = { GetProductCategories, GetSingleProductCategory, RegisterProductCategory, DeleteProductCategory, UpdateProductCategory };
