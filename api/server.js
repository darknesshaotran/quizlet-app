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
    const isUnlearned = req.query.mode === 'unlearned'; // Kiểm tra xem có phải chế độ xem từ chưa thuộc không
    const filePath = path.join(__dirname, 'data', type, `${level}.json`);

    let cards = [];
    
    if (fs.existsSync(filePath)) {
        try {
            const fileData = fs.readFileSync(filePath, 'utf-8').trim();
            cards = fileData ? JSON.parse(fileData) : [];
        } catch (e) {
            console.error("Lỗi đọc file JSON:", e);
        }
    }

    res.render('quizlet', { type, level, cards, isUnlearned });
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