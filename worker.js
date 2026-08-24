// worker.js - Versi Testing untuk Custom Domain
const DOMAINS = ["gmaiil.xinquins.de5.net"];

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // CORS Headers
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        };

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return new Response(null, { headers });
        }

        try {
            // ============ TESTING ENDPOINT ============
            // GET / - Cek apakah worker berjalan
            if (path === '/' && method === 'GET') {
                return new Response(JSON.stringify({
                    status: 'Worker is running!',
                    domain: DOMAINS[0],
                    timestamp: new Date().toISOString()
                }), { headers });
            }

            // ============ API ENDPOINTS ============
            
            // GET /api/domains - Dapatkan daftar domain
            if (path === '/api/domains' && method === 'GET') {
                return new Response(JSON.stringify(DOMAINS), { headers });
            }

            // GET /api/health - Cek koneksi ke D1
            if (path === '/api/health' && method === 'GET') {
                try {
                    // Test koneksi ke D1
                    const result = await env.DB.prepare('SELECT 1 as test').first();
                    return new Response(JSON.stringify({
                        status: 'healthy',
                        database: 'connected',
                        test: result
                    }), { headers });
                } catch (dbError) {
                    return new Response(JSON.stringify({
                        status: 'unhealthy',
                        database: 'error',
                        error: dbError.message
                    }), { status: 500, headers });
                }
            }

            // POST /api/generate - Generate email baru
            if (path === '/api/generate' && method === 'POST') {
                const name = generateRandomName();
                const domain = DOMAINS[0];
                const email = `${name}@${domain}`;
                const timestamp = Date.now();
                
                // Simpan ke D1
                await env.DB.prepare(`
                    INSERT INTO emails (id, email, created_at, status)
                    VALUES (?, ?, ?, ?)
                `).bind(
                    crypto.randomUUID(),
                    email,
                    timestamp,
                    'pending'
                ).run();

                return new Response(JSON.stringify({
                    success: true,
                    email: email,
                    domain: domain,
                    created_at: new Date(timestamp).toISOString()
                }), { headers });
            }

            // GET /api/emails - Lihat semua email
            if (path === '/api/emails' && method === 'GET') {
                const result = await env.DB.prepare(`
                    SELECT * FROM emails 
                    ORDER BY created_at DESC 
                    LIMIT 50
                `).all();
                
                return new Response(JSON.stringify({
                    total: result.results.length,
                    emails: result.results
                }), { headers });
            }

            // POST /api/clear - Hapus semua email (hati-hati!)
            if (path === '/api/clear' && method === 'POST') {
                await env.DB.prepare(`DELETE FROM emails`).run();
                return new Response(JSON.stringify({
                    success: true,
                    message: 'All emails cleared'
                }), { headers });
            }

            // GET /api/code/:email - Cari kode verifikasi
            if (path.startsWith('/api/code/') && method === 'GET') {
                const email = path.replace('/api/code/', '');
                const result = await env.DB.prepare(`
                    SELECT * FROM emails 
                    WHERE email = ? 
                    ORDER BY created_at DESC 
                    LIMIT 1
                `).bind(email).first();
                
                if (result) {
                    // Ekstrak kode dari subject atau content (jika ada)
                    const code = extractCode(result.subject || '') || 
                                extractCode(result.content || '') || 
                                'NO_CODE_FOUND';
                    return new Response(JSON.stringify({
                        email: email,
                        code: code,
                        data: result
                    }), { headers });
                } else {
                    return new Response(JSON.stringify({
                        error: 'Email not found',
                        email: email
                    }), { status: 404, headers });
                }
            }

            // 404 - Not Found
            return new Response(JSON.stringify({
                error: 'Not Found',
                path: path,
                method: method
            }), { status: 404, headers });

        } catch (error) {
            console.error('Error:', error);
            return new Response(JSON.stringify({
                error: 'Internal Server Error',
                message: error.message
            }), { status: 500, headers });
        }
    }
};

// ============ HELPER FUNCTIONS ============

function generateRandomName() {
    const prefixes = ['john', 'jane', 'alex', 'sarah', 'mike', 'emma', 'david', 'lisa', 'tony', 'anna', 
                      'brian', 'chris', 'diana', 'eric', 'fiona', 'george', 'holly', 'ian', 'julia', 'kevin',
                      'laura', 'mark', 'nina', 'oscar', 'paula', 'robert', 'susan', 'thomas', 'ursula', 'victor'];
    const random = Math.floor(Math.random() * prefixes.length);
    const number = Math.floor(Math.random() * 9999);
    return `${prefixes[random]}${number}`;
}

function extractCode(text) {
    if (!text) return null;
    
    // Pola umum untuk kode verifikasi
    const patterns = [
        /verification code[:\s]*([A-Z0-9]{4,8})/i,
        /verification code[:\s]*(\d{4,8})/i,
        /otp[:\s]*([A-Z0-9]{4,8})/i,
        /code[:\s]*([A-Z0-9]{4,8})/i,
        /your code is[:\s]*([A-Z0-9]{4,8})/i,
        /kode verifikasi[:\s]*([A-Z0-9]{4,8})/i,
        /kode[:\s]*([A-Z0-9]{4,8})/i,
        /(\d{5,8})/, // 5-8 digit angka
        /([A-Z]{5,8})/ // 5-8 huruf kapital
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1] || match[0];
        }
    }
    
    return null;
}
