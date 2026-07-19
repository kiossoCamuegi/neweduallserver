
const MailOptions = () => ({
  host: "mail.eduall.site",  // mail.eduall.pt
  port: 465,                        
  secure: true,                   
  auth: {
    user:"noreply@eduall.site",    
    pass:"Q=!LK80~64BK99YY",  
  },
  tls: { rejectUnauthorized: false }   
});


 module.exports =  {MailOptions}
 