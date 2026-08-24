

const DOMAINS = ["gmaiil.xinquins.de5.net"];
const MAX_EMAIL_AGE = 3600000; // 1 jam (dalam milidetik)
const MAX_EMAILS_PER_IP = 50; // Maksimal email per IP

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;
        const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

        // CORS Headers
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        };

        // Handle CORS preflight
        if (method === 'OPTIONS') {
            return new Response(null, { headers });
        }

        try {
            // ==========================================
            // 1. TESTING ENDPOINT
            // ==========================================
            if (path === '/' && method === 'GET') {
                return new Response(JSON.stringify({
                    status: '🚀 Temp Email Worker Running!',
                    domain: DOMAINS[0],
                    version: '2.0.0',
                    timestamp: new Date().toISOString(),
                    endpoints: {
                        'GET /': 'Home - Info',
                        'GET /api/domains': 'List available domains',
                        'GET /api/generate': 'Generate new email',
                        'GET /api/emails': 'List all emails',
                        'GET /api/code/:email': 'Get verification code for email',
                        'DELETE /api/delete/:email': 'Delete all emails for address',
                        'GET /api/stats': 'Get statistics'
                    }
                }), { headers });
            }

            // ==========================================
            // 2. API ENDPOINTS
            // ==========================================

            // ===== GET /api/domains =====
            if (path === '/api/domains' && method === 'GET') {
                return new Response(JSON.stringify(DOMAINS), { headers });
            }

            // ===== GET /api/generate (SUPPORT GET & POST) =====
            if (path === '/api/generate' && (method === 'GET' || method === 'POST')) {
                // Cleanup old emails first
                await cleanupOldEmails(env);
                
                // Check rate limit per IP
                const emailCount = await countEmailsByIP(env, clientIP);
                if (emailCount >= MAX_EMAILS_PER_IP) {
                    return new Response(JSON.stringify({
                        error: 'Rate limit exceeded',
                        message: `Maximum ${MAX_EMAILS_PER_IP} emails per IP`,
                        limit: MAX_EMAILS_PER_IP
                    }), { status: 429, headers });
                }

                // Generate new email
                const name = generateRandomName();
                const domain = DOMAINS[0];
                const email = `${name}@${domain}`;
                const timestamp = Date.now();
                const id = crypto.randomUUID();
                
                // Simpan ke D1
                await env.DB.prepare(`
                    INSERT INTO emails (id, email, ip_address, created_at, status, used)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).bind(
                    id,
                    email,
                    clientIP,
                    timestamp,
                    'pending',
                    0
                ).run();

                return new Response(JSON.stringify({
                    success: true,
                    id: id,
                    email: email,
                    domain: domain,
                    created_at: new Date(timestamp).toISOString(),
                    expires_in: '1 hour',
                    note: 'Send email to this address to receive verification codes'
                }), { headers });
            }

            // ===== GET /api/emails =====
            if (path === '/api/emails' && method === 'GET') {
                const limit = url.searchParams.get('limit') || 50;
                const result = await env.DB.prepare(`
                    SELECT id, email, created_at, status, used, 
                           subject, from_email, code
                    FROM emails 
                    ORDER BY created_at DESC 
                    LIMIT ?
                `).bind(parseInt(limit)).all();
                
                return new Response(JSON.stringify({
                    total: result.results.length,
                    emails: result.results.map(e => ({
                        ...e,
                        created_at: new Date(e.created_at).toISOString()
                    }))
                }), { headers });
            }

            // ===== GET /api/email/:id =====
            if (path.startsWith('/api/email/') && method === 'GET') {
                const id = path.replace('/api/email/', '');
                const result = await env.DB.prepare(`
                    SELECT * FROM emails WHERE id = ?
                `).bind(id).first();
                
                if (result) {
                    // Tandai sebagai sudah dibaca
                    await env.DB.prepare(`
                        UPDATE emails SET read = 1 WHERE id = ?
                    `).bind(id).run();
                    
                    return new Response(JSON.stringify({
                        ...result,
                        created_at: new Date(result.created_at).toISOString()
                    }), { headers });
                } else {
                    return new Response(JSON.stringify({
                        error: 'Email not found',
                        id: id
                    }), { status: 404, headers });
                }
            }

            // ===== GET /api/code/:email =====
            if (path.startsWith('/api/code/') && method === 'GET') {
                const email = decodeURIComponent(path.replace('/api/code/', ''));
                const result = await env.DB.prepare(`
                    SELECT id, email, subject, content, code, created_at, from_email
                    FROM emails 
                    WHERE email = ? 
                    ORDER BY created_at DESC 
                    LIMIT 1
                `).bind(email).first();
                
                if (result) {
                    // Tandai email sebagai sudah digunakan untuk mendapatkan code
                    await env.DB.prepare(`
                        UPDATE emails SET used = 1 WHERE id = ?
                    `).bind(result.id).run();

                    // Ekstrak kode dari berbagai sumber
                    let code = result.code;
                    if (!code) {
                        code = extractCode(result.subject || '') || 
                               extractCode(result.content || '') || 
                               null;
                        
                        // Update code di database jika ditemukan
                        if (code) {
                            await env.DB.prepare(`
                                UPDATE emails SET code = ? WHERE id = ?
                            `).bind(code, result.id).run();
                        }
                    }
                    
                    return new Response(JSON.stringify({
                        success: true,
                        email: email,
                        code: code,
                        subject: result.subject,
                        from: result.from_email,
                        received_at: new Date(result.created_at).toISOString(),
                        has_code: !!code
                    }), { headers });
                } else {
                    return new Response(JSON.stringify({
                        error: 'No email found for this address',
                        email: email
                    }), { status: 404, headers });
                }
            }

            // ===== GET /api/code/latest/:email =====
            if (path.startsWith('/api/code/latest/') && method === 'GET') {
                const email = decodeURIComponent(path.replace('/api/code/latest/', ''));
                
                // Cari email dengan kode yang belum digunakan
                const result = await env.DB.prepare(`
                    SELECT id, email, subject, content, code, created_at, from_email
                    FROM emails 
                    WHERE email = ? AND used = 0 AND code IS NOT NULL
                    ORDER BY created_at DESC 
                    LIMIT 1
                `).bind(email).first();
                
                if (result) {
                    // Tandai sebagai sudah digunakan
                    await env.DB.prepare(`
                        UPDATE emails SET used = 1 WHERE id = ?
                    `).bind(result.id).run();
                    
                    return new Response(JSON.stringify({
                        success: true,
                        code: result.code,
                        from: result.from_email,
                        subject: result.subject,
                        received_at: new Date(result.created_at).toISOString()
                    }), { headers });
                } else {
                    return new Response(JSON.stringify({
                        success: false,
                        message: 'No unused verification code found',
                        email: email
                    }), { status: 404, headers });
                }
            }

            // ===== DELETE /api/delete/:email =====
            if (path.startsWith('/api/delete/') && method === 'DELETE') {
                const email = decodeURIComponent(path.replace('/api/delete/', ''));
                const result = await env.DB.prepare(`
                    DELETE FROM emails WHERE email = ?
                `).bind(email).run();
                
                return new Response(JSON.stringify({
                    success: true,
                    message: `Deleted emails for ${email}`,
                    deleted: result.meta.changes || 0
                }), { headers });
            }

            // ===== POST /api/clear - Hapus semua email =====
            if (path === '/api/clear' && method === 'POST') {
                // Hanya izinkan dari IP tertentu atau dengan secret key
                const secret = url.searchParams.get('secret');
                const ADMIN_SECRET = env.ADMIN_SECRET || 'admin123';
                
                if (secret !== ADMIN_SECRET) {
                    return new Response(JSON.stringify({
                        error: 'Unauthorized',
                        message: 'Valid secret key required'
                    }), { status: 401, headers });
                }
                
                await env.DB.prepare(`DELETE FROM emails`).run();
                return new Response(JSON.stringify({
                    success: true,
                    message: 'All emails cleared'
                }), { headers });
            }

            // ===== GET /api/stats =====
            if (path === '/api/stats' && method === 'GET') {
                const total = await env.DB.prepare('SELECT COUNT(*) as count FROM emails').first();
                const pending = await env.DB.prepare(
                    'SELECT COUNT(*) as count FROM emails WHERE used = 0'
                ).first();
                const used = await env.DB.prepare(
                    'SELECT COUNT(*) as count FROM emails WHERE used = 1'
                ).first();
                const withCode = await env.DB.prepare(
                    'SELECT COUNT(*) as count FROM emails WHERE code IS NOT NULL'
                ).first();
                
                return new Response(JSON.stringify({
                    total: total.count,
                    pending: pending.count,
                    used: used.count,
                    with_code: withCode.count,
                    domains: DOMAINS,
                    max_age: `${MAX_EMAIL_AGE / 60000} minutes`
                }), { headers });
            }

            // ==========================================
            // 3. HANDLE EMAIL ROUTING (INCOMING EMAIL)
            // ==========================================
            if (path === '/email' && method === 'POST') {
                try {
                    const formData = await request.formData();
                    const to = formData.get('to');
                    const from = formData.get('from');
                    const subject = formData.get('subject') || '';
                    const html = formData.get('html') || '';
                    const plain = formData.get('plain') || '';
                    
                    // Ekstrak kode dari email
                    const content = html || plain;
                    const code = extractCode(content) || extractCode(subject);
                    
                    // Simpan ke database
                    await env.DB.prepare(`
                        INSERT INTO emails (id, email, from_email, subject, content, code, created_at, read, used)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `).bind(
                        crypto.randomUUID(),
                        to,
                        from,
                        subject,
                        content,
                        code,
                        Date.now(),
                        0,
                        0
                    ).run();
                    
                    return new Response('OK', { status: 200 });
                } catch (error) {
                    console.error('Error processing email:', error);
                    return new Response('Error processing email', { status: 500 });
                }
            }

            // ==========================================
            // 4. 404 - NOT FOUND
            // ==========================================
            return new Response(JSON.stringify({
                error: 'Not Found',
                path: path,
                method: method,
                available_endpoints: [
                    '/', '/api/domains', '/api/generate', 
                    '/api/emails', '/api/email/:id', 
                    '/api/code/:email', '/api/code/latest/:email',
                    '/api/stats', '/api/delete/:email'
                ]
            }), { status: 404, headers });

        } catch (error) {
            console.error('Error:', error);
            return new Response(JSON.stringify({
                error: 'Internal Server Error',
                message: error.message,
                stack: error.stack
            }), { status: 500, headers });
        }
    }
};

// ============================================
// HELPER FUNCTIONS
// ============================================

function generateRandomName() {
    const prefixes = [
        'john', 'jane', 'alex', 'sarah', 'mike', 'emma', 'david', 'lisa', 
        'tony', 'anna', 'brian', 'chris', 'diana', 'eric', 'fiona', 'george', 
        'holly', 'ian', 'julia', 'kevin', 'laura', 'mark', 'nina', 'oscar', 
        'paula', 'robert', 'susan', 'thomas', 'ursula', 'victor', 'william', 
        'xena', 'yolanda', 'zach', 'amelia', 'benjamin', 'charlotte', 'daniel'
    ];
    const random = Math.floor(Math.random() * prefixes.length);
    const number = Math.floor(Math.random() * 9999);
    return `${prefixes[random]}${number}`;
}

function extractCode(text) {
    if (!text) return null;
    
    const patterns = [
        /verification code[:\s]*([A-Z0-9]{4,8})/i,
        /verification code[:\s]*(\d{4,8})/i,
        /code de vérification[:\s]*([A-Z0-9]{4,8})/i,
        /código de verificación[:\s]*([A-Z0-9]{4,8})/i,
        /otp[:\s]*([A-Z0-9]{4,8})/i,
        /code[:\s]*([A-Z0-9]{4,8})/i,
        /your code is[:\s]*([A-Z0-9]{4,8})/i,
        /kode verifikasi[:\s]*([A-Z0-9]{4,8})/i,
        /kode[:\s]*([A-Z0-9]{4,8})/i,
        /验证码[:\s]*([A-Z0-9]{4,8})/i,
        /(\b\d{5,8}\b)/,
        /(\b[A-Z]{5,8}\b)/
    ];
    
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1] || match[0];
        }
    }
    
    return null;
}

async function cleanupOldEmails(env) {
    const cutoff = Date.now() - MAX_EMAIL_AGE;
    await env.DB.prepare(`
        DELETE FROM emails 
        WHERE created_at < ? AND used = 1
    `).bind(cutoff).run();
}

async function countEmailsByIP(env, ip) {
    const result = await env.DB.prepare(`
        SELECT COUNT(*) as count 
        FROM emails 
        WHERE ip_address = ? AND created_at > ?
    `).bind(ip, Date.now() - MAX_EMAIL_AGE).first();
    return result.count || 0;
}
