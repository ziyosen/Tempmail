// Ganti seluruh isi Worker kamu dengan kode di bawah ini
const TEMP_MAIL_API = 'https://www.1secmail.com/api/v1/';

export default {
    // GANTI FUNGSI EMAIL DENGAN FETCH (Tidak perlu Cloudflare Email Routing lagi)
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;

        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        };

        if (path === '/api/generate') {
            // Ambil email random dari 1secmail
            const res = await fetch(`${TEMP_MAIL_API}?action=genRandomMailbox&count=1`);
            const data = await res.json();
            
            return new Response(JSON.stringify({
                success: true,
                email: data[0],
                note: 'Email from 1secmail.com'
            }), { headers });
        }

        if (path.startsWith('/api/code/')) {
            const email = decodeURIComponent(path.replace('/api/code/', ''));
            const [login, domain] = email.split('@');

            // Cek apakah ada pesan masuk
            const messagesRes = await fetch(`${TEMP_MAIL_API}?action=getMessages&login=${login}&domain=${domain}`);
            const messages = await messagesRes.json();

            if (messages.length > 0) {
                // Ambil pesan pertama
                const msgId = messages[0].id;
                const msgRes = await fetch(`${TEMP_MAIL_API}?action=readMessage&login=${login}&domain=${domain}&id=${msgId}`);
                const msg = await msgRes.json();

                // Ekstrak kode dari isi email
                const code = extractCode(msg.body + ' ' + msg.subject);

                if (code) {
                    return new Response(JSON.stringify({
                        success: true,
                        code: code,
                        email: email
                    }), { headers });
                } else {
                    return new Response(JSON.stringify({ 
                        success: false, 
                        error: 'Kode tidak ditemukan dalam email',
                        body: msg.body
                    }), { status: 404, headers });
                }
            } else {
                return new Response(JSON.stringify({ 
                    success: false, 
                    error: 'Belum ada email masuk'
                }), { status: 404, headers });
            }
        }

        return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404, headers });
    }
};

// Fungsi untuk mencari kode OTP
function extractCode(text) {
    if (!text) return null;
    const patterns = [
        /verification code[:\s]*([A-Z0-9]{4,8})/i,
        /otp[:\s]*([A-Z0-9]{4,8})/i,
        /code[:\s]*([A-Z0-9]{4,8})/i,
        /(\b\d{4,8}\b)/ // Ambil angka 4-8 digit
    ];
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) return match[1] || match[0];
    }
    return null;
}
