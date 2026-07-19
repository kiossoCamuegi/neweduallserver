const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");

const GetTransportRoutes = async (req, res) => {
   try {
      const query = `SELECT * FROM eduall_transport_routes
      LEFT JOIN eduall_transport_vehicles ON eduall_transport_vehicles.ed_transport_vehicle_id = eduall_transport_routes.ed_transport_route_vehicle
      WHERE ed_transport_route_deleted = 0 AND ed_transport_route_institute_code = ?`;
      const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_routes", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const GetsingleTransportRoute = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `SELECT * FROM eduall_transport_routes 
      WHERE ed_transport_route_deleted = 0 AND ed_transport_route_id = ?`;
      const PARAMS = [ID];
      const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_transport_routes", type: "select", data: req });
      res.status(200).json(rows);
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const RegisterTransportRoute = async (req, res) => {
   try {
      const query = `INSERT INTO eduall_transport_routes(ed_transport_route_name, ed_transport_route_vehicle, ed_transport_route_map, 
      ed_transport_route_description, ed_transport_route_institute_code) VALUES(?,?,?,?,?)`;
      const PARAMS = [req.body.route_name, req.body.route_vehicle, req.body.route_map, req.body.route_description, req.session.user.eduall_user_session_curentinstitute];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_routes", type: "insert", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 1,  // Ação de registro
         form: "Rotas de Transporte",
         description: `Registrou uma nova rota de transporte com o nome ${req.body.route_name}`,
      });

      res.status(200).json({ success: true, msg: "Rota de transporte registrada com sucesso!" });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TransportRouteDelete = async (req, res) => {
   try {
      const { ID } = req.params;
      const query = `UPDATE eduall_transport_routes SET ed_transport_route_deleted = 1
      WHERE ed_transport_route_deleted = 0 AND ed_transport_route_id = ?`;
      const PARAMS = [ID];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_routes", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 3,  // Ação de eliminação
         form: "Rotas de Transporte",
         description: `Eliminou a rota de transporte com ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Rota de transporte deletada com sucesso." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

const TransportRouteUpdate = async (req, res) => {
   try {
      const { ID } = req.params;
      const { route_name, route_description, route_map, route_vehicle } = req.body;
      const query = `UPDATE eduall_transport_routes SET ed_transport_route_name = ?, ed_transport_route_vehicle = ?, ed_transport_route_map = ?, 
      ed_transport_route_description = ? WHERE ed_transport_route_deleted = 0 AND ed_transport_route_id = ?`;
      const PARAMS = [route_name, route_vehicle, route_map, route_description, ID];
      await ExecuteQuery(res, query, PARAMS, false, { db: "eduall_transport_routes", type: "update", data: req });

      await RegisterAuditAction({
         session: req.session,
         action: 2,  // Ação de atualização
         form: "Rotas de Transporte",
         description: `Atualizou a rota de transporte (${route_name}) com o ID ${ID}`,
      });

      res.status(200).json({ success: true, msg: "Rota de transporte atualizada com sucesso." });
   } catch (err) {
      res.status(400).json({ status: 300, success: false, msg: err.message });
   }
};

 

module.exports = {
   GetTransportRoutes, GetsingleTransportRoute, RegisterTransportRoute, TransportRouteDelete, TransportRouteUpdate
};
