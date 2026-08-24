// Ganti fungsi getEmailRandom
async function getEmailRandom() {
    try {
        const workerUrl = 'https://temp-email-worker.your-subdomain.workers.dev';
        const res = await fetch(`${workerUrl}/api/domains`);
        const domains = await res.json();
        return domains;
    } catch (err) {
        console.error(chalk.red("Error:", err.message));
        return ['gmaiil.xinquins.de5.net']; // Fallback ke domain Anda
    }
}

// Atau gunakan endpoint /api/generate
async function generateEmailViaWorker() {
    try {
        const workerUrl = 'https://temp-email-worker.your-subdomain.workers.dev';
        const res = await fetch(`${workerUrl}/api/generate`, {
            method: 'POST'
        });
        const data = await res.json();
        return data.email;
    } catch (err) {
        console.error(chalk.red("Error generating email:", err.message));
        return null;
    }
}
