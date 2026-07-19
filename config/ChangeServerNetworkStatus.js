const {LocalStorage} =  require('node-localstorage');
var localStorage = new LocalStorage('./scratch'); 

const ChangeServerNetworkStatus = async(req, res)=>{  
    try {
        localStorage.setItem('eduall_network_status', (req.body.status == true ? 1 : 0));
        let st = localStorage.getItem('eduall_network_status');
        res.status(200).json(st);
    } catch (error) {
        res.status(500).json(error);
    } 
}
module.exports = ChangeServerNetworkStatus;