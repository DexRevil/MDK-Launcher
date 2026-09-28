/**
 * @author MDK Game Team
 * DNS Resolver Autónomo con soporte Multi-DNS, DNS-over-HTTPS (DoH) y Dual-Stack (IPv4/IPv6).
 * Permite que el Launcher resuelva dominios directamente sin depender del DNS de Windows ni de restricciones del ISP.
 */

const dns = require('dns');
const https = require('https');
const http = require('http');

// 1. Configuración de servidores DNS públicos redundantes (Cloudflare, Google, Quad9)
const DNS_SERVERS = [
    '1.1.1.1',
    '1.0.0.1',
    '8.8.8.8',
    '8.8.4.4',
    '9.9.9.9'
];

try {
    dns.setServers(DNS_SERVERS);
} catch (e) {
    console.warn('[DNS-Resolver] Aviso al asignar servidores DNS UDP:', e.message || e);
}

// 2. Endpoints DoH (DNS-over-HTTPS) cifrados en caso de bloqueo de puerto 53
const DOH_ENDPOINTS = [
    { url: 'https://1.1.1.1/dns-query', type: 'cloudflare' },
    { url: 'https://dns.google/resolve', type: 'google' },
    { url: 'https://dns.quad9.net/dns-query', type: 'quad9' }
];

// Caché en memoria para evitar latencia en peticiones continuas
const dnsCache = new Map(); // hostname -> { records: [{ address, family }], expires: timestamp }
const CACHE_TTL_MS = 120000; // 2 minutos

/**
 * Consulta DoH cifrada por HTTPS
 */
async function queryDoH(hostname, recordType = 'A') {
    const isAAAA = recordType === 'AAAA';
    const numericType = isAAAA ? 28 : 1;

    for (const ep of DOH_ENDPOINTS) {
        try {
            const queryUrl = `${ep.url}?name=${encodeURIComponent(hostname)}&type=${recordType}`;
            const res = await new Promise((resolve, reject) => {
                const req = https.get(queryUrl, {
                    headers: { 'Accept': 'application/dns-json' },
                    timeout: 2500
                }, r => {
                    let body = '';
                    r.on('data', chunk => body += chunk);
                    r.on('end', () => resolve(body));
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('Timeout DoH')); });
            });

            const json = JSON.parse(res);
            if (json && Array.isArray(json.Answer)) {
                const addrs = json.Answer
                    .filter(a => a.type === numericType)
                    .map(a => a.data);
                if (addrs.length > 0) {
                    return addrs.map(addr => ({ address: addr, family: isAAAA ? 6 : 4 }));
                }
            }
        } catch (err) {
            // Continuar con el siguiente endpoint DoH
        }
    }
    return [];
}

/**
 * Resuelve un hostname usando estrategia multi-DNS en cascada:
 * 1. Caché interna
 * 2. DNS UDP directo (Cloudflare / Google / Quad9)
 * 3. DoH cifrado (HTTPS)
 * 4. Fallback a DNS del sistema
 */
async function resolveDomain(hostname) {
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) {
        return null; // IP directa o localhost, usar resolución local
    }

    const cached = dnsCache.get(hostname);
    if (cached && cached.expires > Date.now()) {
        return cached.records;
    }

    let records = [];

    // Intento 1: DNS UDP directo IPv4 (resolve4)
    try {
        const addrs4 = await new Promise((resolve, reject) => {
            dns.resolve4(hostname, (err, addrs) => {
                if (!err && addrs && addrs.length > 0) return resolve(addrs);
                reject(err || new Error('No IPv4'));
            });
        });
        records = addrs4.map(ip => ({ address: ip, family: 4 }));
    } catch (e4) {
        // Intento 2: DNS UDP directo IPv6 (resolve6) para dominios puramente IPv6
        try {
            const addrs6 = await new Promise((resolve, reject) => {
                dns.resolve6(hostname, (err, addrs) => {
                    if (!err && addrs && addrs.length > 0) return resolve(addrs);
                    reject(err || new Error('No IPv6'));
                });
            });
            records = addrs6.map(ip => ({ address: ip, family: 6 }));
        } catch (e6) {
            // Intento 3: DoH (DNS-over-HTTPS) IPv4
            try {
                records = await queryDoH(hostname, 'A');
                if (!records || records.length === 0) {
                    // Intento 4: DoH IPv6
                    records = await queryDoH(hostname, 'AAAA');
                }
            } catch (eDoH) {
                // Falla DoH
            }
        }
    }

    if (records && records.length > 0) {
        dnsCache.set(hostname, { records, expires: Date.now() + CACHE_TTL_MS });
        return records;
    }

    return null;
}

/**
 * Función customLookup para inyectar en http/https agents y node-fetch
 */
function customLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    resolveDomain(hostname).then(records => {
        if (records && records.length > 0) {
            if (options && options.all) {
                return callback(null, records);
            }
            return callback(null, records[0].address, records[0].family);
        }
        // Fallback al lookup del sistema de Windows si los DNS externos fallaron
        dns.lookup(hostname, options, callback);
    }).catch(() => {
        dns.lookup(hostname, options, callback);
    });
}

// Inyectar lookup en los agents globales de Node.js
if (https.globalAgent) {
    https.globalAgent.options = https.globalAgent.options || {};
    https.globalAgent.options.lookup = customLookup;
}
if (http.globalAgent) {
    http.globalAgent.options = http.globalAgent.options || {};
    http.globalAgent.options.lookup = customLookup;
}

// Instancias dedicadas de Agent para uso explícito
const customHttpsAgent = new https.Agent({
    lookup: customLookup,
    keepAlive: true,
    timeout: 10000
});

const customHttpAgent = new http.Agent({
    lookup: customLookup,
    keepAlive: true,
    timeout: 10000
});

console.log('[DNS-Resolver] ✅ Sistema Multi-DNS autónomo activo (Cloudflare + Google + Quad9 + DoH).');

module.exports = {
    customLookup,
    resolveDomain,
    queryDoH,
    customHttpsAgent,
    customHttpAgent
};
