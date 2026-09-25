require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_ANON_KEY trong file .env');
}

// Server tự quản lý session qua cookie (xem middleware/auth.js) nên tắt
// autoRefreshToken/persistSession mặc định của supabase-js (vốn dành cho trình duyệt).
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

module.exports = supabase;
