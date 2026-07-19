const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetTransportMaintenances = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_transport_maintenance 
      LEFT JOIN eduall_transport_vehicles ON eduall_transport_vehicles.ed_transport_vehicle_id = ed_transport_maintenance_vehicle
      WHERE ed_transport_maintenance_deleted = 0 AND ed_transport_maintenance_institute_code = ?`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, {
         db: "eduall_transport_maintenance", type: "select", data: req
      });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetsingleTransportMaintenance = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = 'SELECT * FROM eduall_transport_maintenance WHERE ed_transport_maintenance_deleted = 0 AND ed_transport_maintenance_id = ? AND ed_transport_maintenance_institute_code = ?';
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, {
         db: "eduall_transport_maintenance", type: "select", data: req
      });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const RegisterTransportMaintenance = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_transport_maintenance(ed_transport_maintenance_vehicle, ed_transport_maintenance_description,
       ed_transport_maintenance_status, ed_transport_maintenance_institute_code) VALUES(?,?,?,?)`;
      const PARAMS = [
         req.body.maintenence_vehicle,
         req.body.maintenance_description,
         req.body.maintenence_status,
         req.session.user.eduall_user_session_curentinstitute
      ];

      await ExecuteQuery(res, query, PARAMS, false, {
         db: "eduall_transport_maintenance", type: "insert", data: req
      });

      await RegisterAuditAction({
         session: req.session,
         action: 1,
         form: "Manutenção de Transportes",
         description: `Registrou uma nova manutenção para o veículo  ${req.body.maintenence_vehicle}`
      });

      res.status(200).json({ success: true, msg: "Manutenção de transporte registrada com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TransportMaintenanceDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_transport_maintenance SET ed_transport_maintenance_deleted = 1
      WHERE ed_transport_maintenance_deleted = 0 AND ed_transport_maintenance_id = ? AND ed_transport_maintenance_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];

      await ExecuteQuery(res, query, PARAMS, false, {
         db: "eduall_transport_maintenance", type: "update", data: req
      });

      await RegisterAuditAction({
         session: req.session,
         action: 3,
         form: "Manutenção de Transportes",
         description: `Eliminou a manutenção com ID ${ID}`
      });

      res.status(200).json({ success: true, msg: "Manutenção de transporte eliminada com sucesso." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TransportMaintenanceUpdate = async (req, res) => {
   try {
      const { ID } = req.params; 
      const query = `UPDATE eduall_transport_maintenance SET ed_transport_maintenance_vehicle = ?, ed_transport_maintenance_description = ? , 
      ed_transport_maintenance_status = ? WHERE ed_transport_maintenance_deleted = 0 AND ed_transport_maintenance_id = ? AND ed_transport_maintenance_institute_code = ?`;
      const PARAMS = [
         req.body.maintenence_vehicle,
         req.body.maintenance_description,
         req.body.maintenence_status,
         ID,
         req.session.user.eduall_user_session_curentinstitute
      ];

      await ExecuteQuery(res, query, PARAMS, false, {
         db: "eduall_transport_maintenance", type: "update", data: req
      });

      await RegisterAuditAction({
         session: req.session,
         action: 2,
         form: "Manutenção de Transportes",
         description: `Atualizou a manutenção ID ${ID} para o veículo ${req.body.maintenence_vehicle}`
      });

      res.status(200).json({ success: true, msg: "Manutenção de transporte atualizada com sucesso." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

module.exports = {
   GetTransportMaintenances,
   GetsingleTransportMaintenance,
   RegisterTransportMaintenance,
   TransportMaintenanceDelete,
   TransportMaintenanceUpdate
};

 