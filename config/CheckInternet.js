/*var internetAvailable = require("internet-available");   
const {LocalStorage} =  require('node-localstorage');
var localStorage = new LocalStorage('./scratch'); 
*/
const CheckInternet = ()=>{  
   /*
 internetAvailable({timeout: 5000,  retries: 5}).then(() => {  
    localStorage.setItem('eduall_network_status1', 1);
 }).catch(() => { 
    localStorage.setItem('eduall_network_status1', 0); 
}); 
 return (localStorage.getItem('eduall_network_status1')*1) === 1 ? true : true;*/
 return true;
}

 



module.exports = CheckInternet;