const supabase = require('../config/supabaseClient');

const ACCESS_COOKIE = 'sb_access_token';
const REFRESH_COOKIE = 'sb_refresh_token';

const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production'
};

function setSessionCookies(res, session) {
    res.cookie(ACCESS_COOKIE, session.access_token, { ...cookieOptions, maxAge: 1000 * 60 * 60 }); // 1 giờ
    res.cookie(REFRESH_COOKIE, session.refresh_token, { ...cookieOptions, maxAge: 1000 * 60 * 60 * 24 * 30 }); // 30 ngày
}

function clearSessionCookies(res) {
    res.clearCookie(ACCESS_COOKIE);
    res.clearCookie(REFRESH_COOKIE);
}

// Gắn req.user + res.locals.user nếu có session hợp lệ. KHÔNG chặn request nếu chưa đăng nhập
// -> dùng làm middleware toàn cục để mọi trang (kể cả trang public) đều biết ai đang đăng nhập.
async function attachUser(req, res, next) {
    req.user = null;
    res.locals.user = null;

    const accessToken = req.cookies[ACCESS_COOKIE];
    if (!accessToken) return next();

    try {
        const { data, error } = await supabase.auth.getUser(accessToken);
        if (data && data.user && !error) {
            req.user = data.user;
            res.locals.user = data.user;
            return next();
        }
    } catch (e) {
        // rơi xuống thử refresh bên dưới
    }

    // access token hết hạn/không hợp lệ -> thử refresh bằng refresh token
    const refreshToken = req.cookies[REFRESH_COOKIE];
    if (refreshToken) {
        try {
            const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
            if (data && data.session && !error) {
                setSessionCookies(res, data.session);
                req.user = data.session.user;
                res.locals.user = data.session.user;
            } else {
                clearSessionCookies(res);
            }
        } catch (e) {
            clearSessionCookies(res);
        }
    }

    next();
}

// Chặn truy cập nếu chưa đăng nhập -> dùng cho các trang cần gắn với 1 tài khoản
// (học flashcard, quiz, dashboard, API lưu tiến trình).
function requireAuth(req, res, next) {
    if (!req.user) return res.redirect('/login');
    next();
}

module.exports = { attachUser, requireAuth, setSessionCookies, clearSessionCookies };
