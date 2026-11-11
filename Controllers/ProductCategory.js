// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");

const GetProductCategories = async (req, res) => { 
   try {
       const _ck = `productCategories:${req.session.user.eduall_user_session_curentinstitute}:list`;
       const _hit = await _cacheGet(_ck);
       if (_hit !== null) return res.status(200).json(_hit);
       const query = 'SELECT * FROM eduall_product_categories WHERE ed_product_category_deleted = 0 AND ed_product_category_institute_code = ?';
       const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_product_categories", type: "select", data: req });
       await _cacheSet(_ck, rows, 600);
       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao buscar categorias de produtos!", error: error.message });
   }
}; 

const GetSingleProductCategory = async (req, res) => {
   try {
       const _ck = `productCategories:${req.session.user.eduall_user_session_curentinstitute}:single:${req.params.ID}`;
       const _hit = await _cacheGet(_ck);
       if (_hit !== null) return res.status(200).json(_hit);
       const { ID } = req.params; 
       const query = 'SELECT * FROM eduall_product_categories WHERE ed_product_category_deleted = 0 AND ed_product_category_id = ? AND ed_product_category_institute_code = ?';
       const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_product_categories", type: "select", data: req });
       await _cacheSet(_ck, rows, 600);
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

       await _cacheClear(`productCategories:${req.session.user.eduall_user_session_curentinstitute}:*`, `products:${req.session.user.eduall_user_session_curentinstitute}:*`);
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

       await _cacheClear(`productCategories:${req.session.user.eduall_user_session_curentinstitute}:*`, `products:${req.session.user.eduall_user_session_curentinstitute}:*`);
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

       await _cacheClear(`productCategories:${req.session.user.eduall_user_session_curentinstitute}:*`, `products:${req.session.user.eduall_user_session_curentinstitute}:*`);
       res.status(200).json(rows);
   } catch (error) {
       res.status(500).json({ success: false, message: "Falha ao atualizar categoria de produto!", error: error.message });
   }
};

module.exports = { GetProductCategories, GetSingleProductCategory, RegisterProductCategory, DeleteProductCategory, UpdateProductCategory };
