require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const cookieParser = require('cookie-parser');

const supabase = require('./config/supabaseClient');
const supabaseAdmin = require('./config/supabaseAdmin');
const { attachUser, requireAuth, setSessionCookies, clearSessionCookies } = require('./middleware/auth');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware xử lý dữ liệu gửi lên
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Gắn req.user + res.locals.user cho MỌI request (không chặn trang nào ở đây,
// việc chặn cụ thể do requireAuth đảm nhận ở từng route bên dưới).
app.use(attachUser);

// Cấu hình View Engine và Thư mục chứa file HTML/EJS (Đi ra ngoài thư mục api)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Cấu hình thư mục chứa file tĩnh (CSS, Images, JS Client)
app.use(express.static(path.join(__dirname, '../public')));
// Trang chủ
app.get('/', (req, res) => res.render('index'));

// Trang Import TXT
app.get('/import', (req, res) => res.render('import'));

// ==== Đăng ký / Đăng nhập / Đăng xuất ====
app.get('/register', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('register', { error: null });
});

app.post('/register', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) return res.render('register', { error: error.message });

    // Nếu project bật "Confirm email" (mặc định), session sẽ null cho tới khi
    // người dùng bấm link xác nhận trong email -> chưa đăng nhập được ngay.
    if (data.session) {
        setSessionCookies(res, data.session);
        return res.redirect('/dashboard');
    }
    res.render('login', { error: 'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận, sau đó đăng nhập.' });
});

app.get('/login', (req, res) => {
    if (req.user) return res.redirect('/dashboard');
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
        return res.render('login', { error: 'Sai email hoặc mật khẩu.' });
    }
    setSessionCookies(res, data.session);
    res.redirect('/dashboard');
});

app.post('/logout', (req, res) => {
    clearSessionCookies(res);
    res.redirect('/login');
});

// Trang Học Quizlet (Chung cho cả bài mới lẫn bài Chưa Thuộc)
app.get('/quizlet/:type/:level', requireAuth, (req, res) => {
    const { type, level } = req.params;
    const mode = req.query.mode;
    const isUnlearned = mode === 'unlearned'; // Chế độ xem từ CHƯA THUỘC
    const isLearned = mode === 'learned';     // Chế độ xem từ ĐÃ THUỘC
    const filePath = path.join(__dirname, '../data', type, `${level}.json`);
    let cards = [];

    if (fs.existsSync(filePath)) {
        try {
            const fileData = fs.readFileSync(filePath, 'utf-8').trim();
            cards = fileData ? JSON.parse(fileData) : [];
        } catch (e) {
            console.error("Lỗi đọc file JSON:", e);
        }
    }

    res.render('quizlet', { type, level, cards, isUnlearned, isLearned });
});

// Trang Quiz trắc nghiệm (chọn nghĩa đúng trong 4 đáp án)
app.get('/quiz/:type/:level', requireAuth, (req, res) => {
    const { type, level } = req.params;
    const filePath = path.join(__dirname, '../data', type, `${level}.json`);
    let cards = [];

    if (fs.existsSync(filePath)) {
        try {
            const fileData = fs.readFileSync(filePath, 'utf-8').trim();
            cards = fileData ? JSON.parse(fileData) : [];
        } catch (e) {
            console.error("Lỗi đọc file JSON:", e);
        }
    }

    res.render('quiz', { type, level, cards });
});

// Trang Dashboard tổng quan (tiến độ N1-N5, streak, tổng số từ đã học)
app.get('/dashboard', requireAuth, (req, res) => {
    res.render('dashboard');
});

// API: Lấy toàn bộ tiến trình (Đã thuộc/Chưa thuộc) của TÀI KHOẢN ĐANG ĐĂNG NHẬP
// cho 1 type+level. FE dùng để đồng bộ lại localStorage khi vào trang trên thiết bị khác.
app.get('/api/progress/:type/:level', requireAuth, async (req, res) => {
    const { type, level } = req.params;
    const PAGE = 1000; // Supabase mặc định chỉ trả tối đa 1000 dòng/truy vấn -> đọc theo từng trang
    let all = [];

    for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabaseAdmin
            .from('user_progress')
            .select('card_id, status, updated_at')
            .eq('user_id', req.user.id)
            .eq('type', type)
            .eq('level', level)
            .order('card_id')
            .range(from, from + PAGE - 1);

        if (error) return res.status(500).json({ error: error.message });
        all = all.concat(data);
        if (data.length < PAGE) break;
    }
    res.json(all);
});

// API: Lưu (upsert) trạng thái Đã thuộc/Chưa thuộc của 1 thẻ cho tài khoản đang đăng nhập.
// Yêu cầu bảng user_progress đã có UNIQUE constraint trên (user_id, type, level, card_id),
// nếu không upsert sẽ chèn trùng dòng thay vì cập nhật.
app.post('/api/progress', requireAuth, async (req, res) => {
    const { type, level, card_id, status } = req.body;
    if (!type || !level || !card_id || !status) {
        return res.status(400).json({ error: 'Thiếu dữ liệu' });
    }

    const { error } = await supabaseAdmin
        .from('user_progress')
        .upsert({
            user_id: req.user.id,
            type,
            level,
            card_id: String(card_id),
            status,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,type,level,card_id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// API: Lưu nhiều thẻ một lúc (dùng để chuyển dữ liệu cũ từ localStorage lên DB)
app.post('/api/progress/bulk', requireAuth, async (req, res) => {
    const { type, level, items } = req.body;
    if (!type || !level || !Array.isArray(items)) {
        return res.status(400).json({ error: 'Thiếu dữ liệu' });
    }
    const now = new Date().toISOString();
    const rows = items
        .filter(i => i && i.card_id != null && i.status)
        .map(i => ({
            user_id: req.user.id,
            type,
            level,
            card_id: String(i.card_id),
            status: i.status,
            updated_at: now
        }));
    if (!rows.length) return res.json({ ok: true, count: 0 });

    const { error } = await supabaseAdmin
        .from('user_progress')
        .upsert(rows, { onConflict: 'user_id,type,level,card_id' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, count: rows.length });
});

// API: Xoá trạng thái của 1 thẻ (dùng cho nút Hoàn tác)
app.delete('/api/progress/:type/:level/:cardId', requireAuth, async (req, res) => {
    const { type, level, cardId } = req.params;
    const { error } = await supabaseAdmin
        .from('user_progress')
        .delete()
        .eq('user_id', req.user.id)
        .eq('type', type)
        .eq('level', level)
        .eq('card_id', String(cardId));

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// API: Số thẻ ĐÃ THUỘC theo từng type+level của tài khoản đang đăng nhập
// -> { 'tu-vung': { n1: 12, ... }, 'ngu-phap': { ... } }  (dùng cho Dashboard + thanh % ở navbar)
app.get('/api/progress-summary', requireAuth, async (req, res) => {
    const types = ['tu-vung', 'ngu-phap'];
    const levels = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const result = {};
    const jobs = [];

    types.forEach(type => {
        result[type] = {};
        levels.forEach(level => {
            jobs.push(
                supabaseAdmin
                    .from('user_progress')
                    .select('card_id', { count: 'exact', head: true })
                    .eq('user_id', req.user.id)
                    .eq('type', type)
                    .eq('level', level)
                    .eq('status', 'learned') // phải khớp STATUS_LEARNED trong quizlet.ejs
                    .then(({ count, error }) => {
                        if (error) throw error;
                        result[type][level] = count || 0;
                    })
            );
        });
    });

    try {
        await Promise.all(jobs);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// API: Xoá toàn bộ tiến độ (Đã thuộc/Chưa thuộc) của 1 type+level cho tài khoản đang đăng nhập.
app.delete('/api/progress/:type/:level', requireAuth, async (req, res) => {
    const { type, level } = req.params;
    const { error } = await supabaseAdmin
        .from('user_progress')
        .delete()
        .eq('user_id', req.user.id)
        .eq('type', type)
        .eq('level', level);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// API: Lấy vị trí đang học (thứ tự thẻ, index hiện tại, phán quyết phiên, SRS bật/tắt)
// riêng cho từng mode (normal / unlearned / learned) của tài khoản đang đăng nhập.
app.get('/api/session/:type/:level/:mode', requireAuth, async (req, res) => {
    const { type, level, mode } = req.params;
    const { data, error } = await supabaseAdmin
        .from('user_session_state')
        .select('order_ids, current_index, session_verdict, srs_on, updated_at')
        .eq('user_id', req.user.id)
        .eq('type', type)
        .eq('level', level)
        .eq('mode', mode)
        .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    res.json(data || null);
});

// API: Lưu (upsert) vị trí đang học hiện tại.
app.post('/api/session', requireAuth, async (req, res) => {
    const { type, level, mode, order_ids, current_index, session_verdict, srs_on } = req.body;
    if (!type || !level || !mode) {
        return res.status(400).json({ error: 'Thiếu dữ liệu' });
    }

    const { error } = await supabaseAdmin
        .from('user_session_state')
        .upsert({
            user_id: req.user.id,
            type,
            level,
            mode,
            order_ids: order_ids || [],
            current_index: current_index || 0,
            session_verdict: session_verdict || {},
            srs_on: !!srs_on,
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,type,level,mode' });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// API: Trả về tổng số thẻ (từ vựng / ngữ pháp) của từng cấp N1-N5
// Dùng để FE tính % tiến độ học (đã thuộc / tổng số * 100)
app.get('/api/counts', (req, res) => {
    const types = ['tu-vung', 'ngu-phap'];
    const levels = ['n1', 'n2', 'n3', 'n4', 'n5'];
    const result = {};

    types.forEach(type => {
        result[type] = {};
        levels.forEach(level => {
            const filePath = path.join(__dirname, '../data', type, `${level}.json`);
            let count = 0;
            if (fs.existsSync(filePath)) {
                try {
                    const fileData = fs.readFileSync(filePath, 'utf-8').trim();
                    const arr = fileData ? JSON.parse(fileData) : [];
                    count = Array.isArray(arr) ? arr.length : 0;
                } catch (e) {
                    count = 0;
                }
            }
            result[type][level] = count;
        });
    });

    res.json(result);
});

// API Convert File TXT -> JSON
app.post('/api/convert', upload.single('txtFile'), (req, res) => {
    if (!req.file) return res.status(400).send('Vui lòng chọn file TXT');

    const type = req.body.type;
    const content = req.file.buffer.toString('utf-8');
    const lines = content.split(/\r?\n/).filter(line => line.trim() !== '');

    let resultJson = [];
    if (type === 'tu-vung') {
        resultJson = lines.map((line, index) => {
            const cols = line.split('\t').map(c => c.replace(/[\r\n]+/g, ' ').trim()).filter(Boolean);
            let id = (index + 1).toString();
            let kanji = '', furigana = '', hanviet = '', example = '', meaning = '';

            if (cols.length > 0 && !isNaN(cols[0])) id = cols.shift();
            if (cols.length > 0) kanji = cols.shift();
            if (cols.length > 0) furigana = cols.shift();

            cols.forEach(col => {
                if (col.startsWith('□') || col.includes(' - ') || col.includes('He is related')) {
                    example += (example ? ' | ' : '') + col;
                } else if (col.includes('(') || col.includes('●') || col.includes('◆') || col.includes('tính từ') || col.includes('danh từ') || col.includes('trạng từ')) {
                    meaning += (meaning ? ' | ' : '') + col;
                } else if (!hanviet && col.length <= 15 && !col.includes(' ')) {
                    hanviet = col;
                } else {
                    meaning += (meaning ? ' | ' : '') + col;
                }
            });

            return { id, kanji, furigana, hanviet, example, meaning };
        });
    } else {
        resultJson = lines.map((line, index) => {
            const cols = line.split('\t').map(c => c.replace(/[\r\n]+/g, ' ').trim()).filter(Boolean);
            return {
                id: (index + 1).toString(),
                structure: cols[0] || '',
                meaning: cols.slice(1).join(' - ') || ''
            };
        });
    }

    res.setHeader('Content-disposition', 'attachment; filename=data_converted.json');
    res.setHeader('Content-type', 'application/json');
    res.send(JSON.stringify(resultJson, null, 2));
});

// const PORT = 3000;
// app.listen(PORT, () => console.log(`Server running: http://localhost:${PORT}`));
module.exports = app;