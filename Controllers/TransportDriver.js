 

 const multer = require("multer");
 const path = require("path");
 const ExecuteQuery = require("../Functions/ExecuteQuery");
 const { RegisterAuditAction } = require("./Auditory");
 
 const GetTransportDrivers = async (req, res) => {
    try {
       const query = 'SELECT * FROM eduall_transport_drivers WHERE ed_transport_driver_deleted = 0 AND ed_transport_driver_institute_code = ? ORDER BY ed_transport_driver_name ASC';
       const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_drivers", type: "select", data: req });
       res.status(200).json(rows);
    } catch (err) {
       res.status(400).json({ status: 300, success: false, msg: err.message });
    }
 };
 
 const GetSingleTransportDriver = async (req, res) => {
    try { 
       const { ID } = req.params;
       const query = 'SELECT * FROM eduall_transport_drivers WHERE ed_transport_driver_deleted = 0 AND ed_transport_driver_id = ? AND ed_transport_driver_institute_code = ?';
       const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
       const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_drivers", type: "select", data: req });
       res.status(200).json(rows);
    } catch (err) {
       res.status(400).json({ status: 300, success: false, msg: err.message });
    }
 };
 
const RegisterTransportDriver = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_transport_drivers(ed_transport_driver_name, ed_transport_driver_neighborhood, ed_transport_driver_status, 
      ed_transport_driver_city, ed_transport_driver_email, ed_transport_driver_nif, ed_transport_driver_phone,
      ed_transport_driver_identification_number, ed_transport_driver_address, ed_transport_driver_picture, 
      ed_transport_driver_institute_code) VALUES(?,?,?,?,?,?,?,?,?,?,?)`;

      const PARAMS = [
         req.body.driver_name, req.body.driver_neighborhood, req.body.driver_status, req.body.driver_city, 
         req.body.driver_email, req.body.driver_nif, req.body.driver_phone, req.body.driver_identification_number, 
         req.body.driver_address, req.file?.path ?? "", req.session.user.eduall_user_session_curentinstitute
      ];

      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_drivers", type: "insert", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 1,
         form: "Motoristas do Transporte",
         description: `Registou um novo motorista (${req.body.driver_name}) com telefone ${req.body.driver_phone}`,
      });

      res.status(200).json({ success: true, msg: "Motorista registado com sucesso!" });
   } catch (err) {
      console.log(err);
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

 
const TransportDriverUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { driver_name, driver_neighborhood, driver_status, driver_city, driver_email,
      driver_nif, driver_phone, driver_identification_number, driver_address } = req.body; 

      const query = `UPDATE eduall_transport_drivers 
      SET ed_transport_driver_name = ?, ed_transport_driver_neighborhood = ?, ed_transport_driver_status = ?,
      ed_transport_driver_city = ?, ed_transport_driver_email = ?, ed_transport_driver_nif = ?, 
      ed_transport_driver_phone = ?, ed_transport_driver_identification_number = ?, ed_transport_driver_address = ?
      ${req.file?.path ? ", ed_transport_driver_picture = ?" : ""}
      WHERE ed_transport_driver_deleted = 0 AND ed_transport_driver_id = ? AND ed_transport_driver_institute_code = ?`;

      const PARAMS = [
         driver_name, driver_neighborhood, driver_status, driver_city, driver_email, 
         driver_nif, driver_phone, driver_identification_number, driver_address,
         ...(req.file?.path ? [req.file.path] : []),
         ID, req.session.user.eduall_user_session_curentinstitute
      ];

      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_drivers", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 2,
         form: "Motoristas do Transporte",
         description: `Atualizou informações do motorista (${driver_name}) com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Motorista atualizado com sucesso." });
   } catch (err) {
      console.log(err);
      res.status(400).json({ status: 300, success: false, msg: err.message }); 
   }
};

  
 const TransportDriverDelete = async (req, res) => {
    try {
       const { ID } = req.params;
       const query = `UPDATE eduall_transport_drivers SET ed_transport_driver_deleted = 1
       WHERE ed_transport_driver_deleted = 0 AND ed_transport_driver_id = ? AND ed_transport_driver_institute_code = ?`;
       const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
       
       await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_drivers", type: "update", data: req });
 
       await RegisterAuditAction({
          session: req.session,
          action: 3,
          form: "Motoristas do Transporte",
          description: `Eliminou o motorista com ID ${ID}`,
       });
 
       res.status(200).json({ success: true, msg: "Motorista eliminado com sucesso." });
    } catch (err) {
       res.status(400).json({ status: 300, success: false, msg: err.message });
    }
 };
 
 const storage = multer.diskStorage({
     destination: 'images/drivers',
     filename: (req, file, cb) => {
        return cb(null, `eduall_file_${file.fieldname}_${Date.now()}_${Math.random(1,389398393993100012002)}_${path.extname(file.originalname)}`);
     }
 }); 
 
 const uploadTransportDriverPicture = multer({
     storage: storage
 }).single('driver_picture');


 
 
 module.exports = { 
    GetTransportDrivers, 
    uploadTransportDriverPicture, 
    GetSingleTransportDriver, 
    RegisterTransportDriver, 
    TransportDriverDelete, 
    TransportDriverUpdate 
 };
 
 