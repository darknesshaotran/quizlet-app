const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware xử lý dữ liệu gửi lên
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình View Engine và Thư mục chứa file HTML/EJS (Đi ra ngoài thư mục api)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

// Cấu hình thư mục chứa file tĩnh (CSS, Images, JS Client)
app.use(express.static(path.join(__dirname, '../public')));
// Trang chủ
app.get('/', (req, res) => res.render('index'));

// Trang Import TXT
app.get('/import', (req, res) => res.render('import'));


// Trang Học Quizlet (Chung cho cả bài mới lẫn bài Chưa Thuộc)
app.get('/quizlet/:type/:level', (req, res) => {
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
app.get('/quiz/:type/:level', (req, res) => {
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
app.get('/dashboard', (req, res) => {
    res.render('dashboard');
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