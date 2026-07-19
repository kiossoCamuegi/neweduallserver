 

const jwt = require("jsonwebtoken");
const { TokenExpiredError } = jwt;

const VerifyToken = (req, res, next) => { 
    const token = req.session.user ? req.session.user.eduall_user_session_refreshToken : null;
 
    if (!token) {
        return res.status(401).json({ msg: "No token provided!" });
    }
 
    jwt.verify(token, process.env.REFRESH_TOKEN_SECRET, (err, decoded) => { 
        if (err instanceof TokenExpiredError) {
            return res.status(401).json({ msg: "Unauthorized! Access token has expired!" });
        }
 
        if (err) {
            console.error("Token verification failed:", err);  
            return res.status(401).json({ msg: "Token verification failed!" });
        } 
        req.user = decoded;  
        next();
    });
};

module.exports = VerifyToken;
