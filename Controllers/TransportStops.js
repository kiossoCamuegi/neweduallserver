const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetTransportStops = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_transport_stops
      LEFT JOIN eduall_transport_routes ON eduall_transport_routes.ed_transport_route_id = ed_transport_stop_route
      WHERE ed_transport_stop_deleted = 0 AND ed_transport_stop_institute_code = ? ORDER BY ed_transport_stop_name ASC`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_stops", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
}; 

const GetsingleTransportStop = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `SELECT * FROM eduall_transport_stops 
      WHERE ed_transport_stop_deleted = 0 AND ed_transport_stop_id = ? 
      AND ed_transport_stop_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_stops", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const RegisterTransportStop = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_transport_stops(ed_transport_stop_name, ed_transport_stop_route, ed_transport_stop_map,
      ed_transport_stop_estimate_of_arrival, ed_transport_stop_institute_code) VALUES(?,?,?,?,?)`;
      const PARAMS = [req.body.stop_name, req.body.stop_route, req.body.stop_map, req.body.stop_estimate_of_arrival, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_stops", type: "insert", data: req });

      // Registro da ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 1,  // Ação de registro
         form: "Paradas de Transporte",
         description: `Registrou uma nova parada de transporte (${req.body.stop_name})`,
      });

      res.status(200).json({ success: true, msg: "Parada de transporte registrada com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TransportStopDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_transport_stops SET ed_transport_stop_deleted = 1
      WHERE ed_transport_stop_deleted = 0 AND ed_transport_stop_id = ? 
      AND ed_transport_stop_institute_code = ?`;
      const PARAMS = [ID, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_stops", type: "update", data: req });

      // Registro da ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de eliminação
         form: "Paradas de Transporte",
         description: `Eliminou a parada de transporte com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Parada de transporte deletada com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TransportStopUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { stop_name, stop_route, stop_map, stop_estimate_of_arrival } = req.body;
      const query = `UPDATE eduall_transport_stops SET ed_transport_stop_name = ?, ed_transport_stop_route = ?, 
      ed_transport_stop_map = ?, ed_transport_stop_estimate_of_arrival = ? 
      WHERE ed_transport_stop_deleted = 0 AND ed_transport_stop_id = ? 
      AND ed_transport_stop_institute_code = ?`;
      const PARAMS = [stop_name, stop_route, stop_map, stop_estimate_of_arrival, ID, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_stops", type: "update", data: req });

      // Registro da ação de auditoria
      await RegisterAuditAction({
         session: req.session,
         action: 2,  // Ação de atualização
         form: "Paradas de Transporte",
         description: `Atualizou a parada de transporte (${stop_name}) com a rota ${stop_route} e ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Parada de transporte atualizada com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

module.exports = { GetTransportStops, GetsingleTransportStop, RegisterTransportStop,
TransportStopDelete, TransportStopUpdate };
