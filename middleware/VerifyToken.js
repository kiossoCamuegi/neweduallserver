const jwt = require("jsonwebtoken");
const { TokenExpiredError } = jwt;
const { ensureSessionRefreshToken } = require("../auth/sessionTokens");

const VerifyToken = async (req, res, next) => {
    const token = req.session?.user?.eduall_user_session_refreshToken || null;

    if (!token) {
        return res.status(401).json({
            success: false,
            code: "REFRESH_TOKEN_MISSING",
            msg: "A sessão expirou. Inicie sessão novamente.",
        });
    }

    try {
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
        } catch (error) {
            if (!(error instanceof TokenExpiredError)) throw error;
            const refreshed = await ensureSessionRefreshToken(req, res);
            decoded = refreshed.decoded;
        }
        req.user = decoded;
        return next();
    } catch (error) {
        if (!(error instanceof TokenExpiredError)) {
            console.error("Token verification failed:", error);
        }
        return res.status(401).json({
            success: false,
            code: error.code || "TOKEN_INVALID",
            msg: error.code === "REFRESH_ACCOUNT_INACTIVE"
                ? error.message
                : "A sessão já não pode ser renovada. Inicie sessão novamente.",
        });
    }
};

module.exports = VerifyToken;
