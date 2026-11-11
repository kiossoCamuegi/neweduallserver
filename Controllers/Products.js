// CACHE-OPT v5 (aplicado por apply_cache_optimizations.py)
const multer = require("multer");
const path = require("path");
const ExecuteQuery = require("../Functions/ExecuteQuery");

// CACHE-OPT v5: cache por escola (chaves "<entidade>:<escola>:..."); uma falha de cache nunca parte o pedido
const Cache = require("../Functions/CacheRoutes");
const _cacheGet = async (key) => { try { const v = await Cache.eduallGet(key); return v === undefined ? null : v; } catch (e) { return null; } };
const _cacheSet = async (key, value, ttl) => { try { if (value !== undefined && value !== null) await Cache.eduallSet(key, value, ttl); } catch (e) { /* cache indisponível: ignorado */ } };
const _cacheClear = async (...patterns) => { for (const p of patterns) { try { await Cache.eduallClear(p); } catch (e) { /* ignorado */ } } };
const { RegisterAuditAction } = require("./Auditory");

const GetProducts = async (req, res) => {
    try {
        const _ck = `products:${req.session.user.eduall_user_session_curentinstitute}:list`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const query = `SELECT * FROM eduall_products 
        LEFT JOIN eduall_providers ON eduall_products.ed_product_provider = eduall_providers.ed_provider_id
        LEFT JOIN eduall_coins ON eduall_products.ed_product_coin = eduall_coins.ed_coin_id
        LEFT JOIN eduall_product_categories ON eduall_product_categories.ed_product_category_id = ed_product_category
        WHERE  ed_product_deleted = 0 AND ed_product_institute_code = ?  ORDER BY ed_product_name ASC`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_products", type: "select" });
        await _cacheSet(_ck, result, 300);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter os produtos!", success: false, error: error.message });
    }
};

const GetSingleProduct = async (req, res) => {
    try {
        const _ck = `products:${req.session.user.eduall_user_session_curentinstitute}:single:${req.params.ID}`;
        const _hit = await _cacheGet(_ck);
        if (_hit !== null) return res.status(200).json(_hit);
        const { ID } = req.params;
        const query = `SELECT * FROM eduall_products WHERE ed_product_deleted = 0 AND ed_product_id = ? AND ed_product_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, {db:"eduall_products", type: "select"});
        await _cacheSet(_ck, result, 300);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao obter o produto!", success: false, error: error.message });
    }
};

const RegisterProducts = async (req, res) => {
    try {
        const query = `INSERT INTO eduall_products(ed_product_name, ed_product_category, ed_product_purchase_price, ed_product_sale_price, ed_product_provider,
            ed_product_coin, ed_product_stock_amount, ed_product_stock_left, ed_product_picture, ed_product_description, ed_product_institute_code) 
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`;
        const PARAMS = [req.body.product_title, req.body.product_category, req.body.product_purchase_price, req.body.product_sales_price,
            req.body.product_provider, req.body.product_type_of_coin, req.body.product_stock_amount, req.body.product_stock_amount,
            (req.file ? req.file.path : ""), req.body.product_description, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_products", type: "insert", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 1,  // Ação de registro
            form: "Produtos",
            description: `Registrou um novo produto (${req.body.product_title}) com o preço de compra ${req.body.product_purchase_price} e preço de venda ${req.body.product_sales_price}`,
        });

        await _cacheClear(`products:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao registrar o produto!", success: false, error: error.message });
    }
};

const ProductDelete = async (req, res) => {
    try {
        const { ID } = req.params;
        const query = `UPDATE eduall_products SET ed_product_deleted = 1 WHERE ed_product_deleted = 0 AND ed_product_id = ? AND ed_product_institute_code = ?`;
        const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_products", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 3,  // Ação de eliminação
            form: "Produtos",
            description: `Eliminou o produto com ID ${ID}`,
        });

        await _cacheClear(`products:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ msg: "Falha ao deletar o produto!", success: false, error: error.message });
    }
};

const ProductUpdate = async (req, res) => {
    try {
        const { ID } = req.params;
        const { product_title, product_stock_amount, product_category, product_purchase_price, 
            product_sales_price, product_provider, product_type_of_coin, product_description } = req.body;

        let query, PARAMS;

        if (req.file) {
            query = `UPDATE eduall_products SET ed_product_name = ?, ed_product_category = ?, 
                ed_product_purchase_price = ?, ed_product_sale_price = ?, ed_product_provider = ?, 
                ed_product_coin = ?, ed_product_stock_amount = ?, ed_product_picture = ?, 
                ed_product_description = ? WHERE ed_product_deleted = 0 
                AND ed_product_id = ? AND ed_product_institute_code = ?`;

            PARAMS = [
                product_title, product_category, product_purchase_price, product_sales_price, 
                product_provider, product_type_of_coin, product_stock_amount, req.file.path, 
                product_description, ID, req.session.user.eduall_user_session_curentinstitute
            ];
        } else {
            query = `UPDATE eduall_products SET ed_product_name = ?, ed_product_category = ?, 
                ed_product_purchase_price = ?, ed_product_sale_price = ?, ed_product_provider = ?, 
                ed_product_coin = ?, ed_product_stock_amount = ?, ed_product_description = ? 
                WHERE ed_product_deleted = 0 AND ed_product_id = ? AND ed_product_institute_code = ?`;

            PARAMS = [
                product_title, product_category, product_purchase_price, product_sales_price, 
                product_provider, product_type_of_coin, product_stock_amount, product_description, 
                ID, req.session.user.eduall_user_session_curentinstitute
            ];
        }

        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_products", type: "update", data: req });

        // Registrar ação de auditoria
        await RegisterAuditAction({
            session: req.session,
            action: 2,  // Ação de atualização
            form: "Produtos",
            description: `Atualizou o produto (${product_title}) com o preço de compra ${product_purchase_price} e preço de venda ${product_sales_price}`,
        });

        await _cacheClear(`products:${req.session.user.eduall_user_session_curentinstitute}:*`);
        res.status(200).json(result);
    } catch (error) { 
        res.status(500).json({ msg: "Falha ao atualizar o produto!", success: false, error: error.message });
    }
};

const storage = multer.diskStorage({
    destination: `images/products`,
    filename: (req, file, cb) => {
        return cb(null, `eduall_file_${file.fieldname}_${Date.now()}_${Math.random(1, 389399399399393993939939398393993100012002)}${path.extname(file.originalname)}`);
    }
});

const uploadProductPicture = multer({
    storage: storage
}).single(`product_image`);

module.exports = { GetProducts, GetSingleProduct, RegisterProducts, ProductDelete, ProductUpdate, uploadProductPicture }; 
