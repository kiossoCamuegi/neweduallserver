const multer = require('multer');
const path = require('path');
const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetTransportVehicles = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_transport_vehicles 
      LEFT JOIN eduall_transport_drivers ON eduall_transport_vehicles.ed_transport_vehicle_driver = eduall_transport_drivers.ed_transport_driver_id 
      WHERE ed_transport_vehicle_deleted = 0 AND ed_transport_vehicle_institute_code = ?`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_vehicles", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetSingleTransportVehicle = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `SELECT * FROM eduall_transport_vehicles WHERE ed_transport_vehicle_deleted = 0 
      AND ed_transport_vehicle_id = ? AND ed_transport_vehicle_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_vehicles", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const RegisterTransportVehicle = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_transport_vehicles(ed_transport_vehicle_model, ed_transport_vehicle_plate, 
      ed_transport_vehicle_driver, ed_transport_vehicle_typology, ed_transport_vehicle_capacity, 
      ed_transport_vehicle_value, ed_transport_vehicle_acquisition_date, ed_transport_vehicle_montlyCosts, 
      ed_transport_vehicle_liters, ed_transport_vehicle_owner, ed_transport_vehicle_picture, 
      ed_transport_vehicle_description, ed_transport_vehicle_institute_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`;
      const PARAMS = [req.body.vehicle_model, req.body.vehicle_plate, req.body.vehicle_driver, req.body.vehicle_typology,
         req.body.vehicle_capacity, req.body.vehicle_value, req.body.vehicle_acquisition_date, req.body.vehicle_monthly_costs,
         req.body.vehicle_liters, req.body.vehicle_owner, (req.file ? req.file.path : "") , req.body.vehicle_description, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_vehicles", type: "insert", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 1,  // Ação de registro
         form: "Veículos de Transporte",
         description: `Registrou um novo veículo (${req.body.vehicle_model}) com a matrícula ${req.body.vehicle_plate}`,
      });

      res.status(200).json({ success: true, msg: "Veículo registrado com sucesso!" });
   } catch (err) {
      res.status(400).json({status: 300, success: false, msg: err.message});
   }
};

const TransportVehicleDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_transport_vehicles SET ed_transport_vehicle_deleted = 1 
      WHERE ed_transport_vehicle_deleted = 0 AND ed_transport_vehicle_id = ? 
      AND ed_transport_vehicle_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_vehicles", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de eliminação
         form: "Veículos de Transporte",
         description: `Eliminou o veículo com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Veículo deletado com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TransportVehicleUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { vehicle_model, vehicle_plate, vehicle_driver, vehicle_typology, vehicle_capacity, 
      vehicle_value, vehicle_acquisition_date, vehicle_monthly_costs, vehicle_liters, vehicle_owner, vehicle_description } = req.body;

      let query, PARAMS;
      if (req.file) { 
         query = `UPDATE eduall_transport_vehicles SET ed_transport_vehicle_model = ?, ed_transport_vehicle_plate = ?, 
         ed_transport_vehicle_driver = ?, ed_transport_vehicle_typology = ?, ed_transport_vehicle_capacity = ?, 
         ed_transport_vehicle_value = ?, ed_transport_vehicle_acquisition_date = ?, ed_transport_vehicle_montlyCosts = ?, 
         ed_transport_vehicle_liters = ?, ed_transport_vehicle_owner = ?, ed_transport_vehicle_picture = ?, 
         ed_transport_vehicle_description = ? WHERE ed_transport_vehicle_deleted = 0 AND ed_transport_vehicle_id = ? 
         AND ed_transport_vehicle_institute_code = ?`;
         PARAMS = [vehicle_model, vehicle_plate, vehicle_driver, vehicle_typology, vehicle_capacity, vehicle_value,
         vehicle_acquisition_date, vehicle_monthly_costs, vehicle_liters, vehicle_owner, (req.file ? req.file.path : ""), 
         vehicle_description, ID, req.session.user.eduall_user_session_curentinstitute];   
      } else { 
         query = `UPDATE eduall_transport_vehicles SET ed_transport_vehicle_model = ?, ed_transport_vehicle_plate = ?, 
         ed_transport_vehicle_driver = ?, ed_transport_vehicle_typology = ?, ed_transport_vehicle_capacity = ?, 
         ed_transport_vehicle_value = ?, ed_transport_vehicle_acquisition_date = ?, ed_transport_vehicle_montlyCosts = ?, 
         ed_transport_vehicle_liters = ?, ed_transport_vehicle_owner = ?, ed_transport_vehicle_description = ? 
         WHERE ed_transport_vehicle_deleted = 0 AND ed_transport_vehicle_id = ? AND ed_transport_vehicle_institute_code = ?`;
         PARAMS = [vehicle_model, vehicle_plate, vehicle_driver, vehicle_typology, vehicle_capacity, vehicle_value,
         vehicle_acquisition_date, vehicle_monthly_costs, vehicle_liters, vehicle_owner, 
         vehicle_description, ID, req.session.user.eduall_user_session_curentinstitute];
      }

      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_vehicles", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 2,  // Ação de atualização
         form: "Veículos de Transporte",
         description: `Atualizou o veículo com a matrícula ${vehicle_plate} e modelo ${vehicle_model}`,
      });

      res.status(200).json({ success: true, msg: "Veículo atualizado com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const storage = multer.diskStorage({
    destination: 'images/vehicles',
    filename: (req, file, cb) => {
       return cb(null, `eduall_file_${file.fieldname}_${Date.now()}_${Math.random(1, 389398393993100012002)}_${path.extname(file.originalname)}`);
    }
});

const uploadTransportVehiclePicture = multer({
    storage: storage
}).single('vehicle_picture');

 

module.exports = { GetTransportVehicles, GetSingleTransportVehicle, RegisterTransportVehicle,
TransportVehicleDelete, TransportVehicleUpdate, uploadTransportVehiclePicture };
