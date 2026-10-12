/**
 * @author MDK Game Team
 * DNS Resolver Autónomo con soporte Multi-DNS, DNS-over-HTTPS (DoH) y Dual-Stack (IPv4/IPv6).
 * Permite que el Launcher resuelva dominios directamente sin depender del DNS de Windows ni de restricciones del ISP.
 */

const dns = require('dns');
const https = require('https');
const http = require('http');
const net = require('net');
const fs = require('fs');
const { exec } = require('child_process');

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
 * Consulta DoH cifrada para registros SRV de Minecraft
 */
async function queryDoH_SRV(hostname) {
    const endpoints = [
        `https://1.1.1.1/dns-query?name=${encodeURIComponent('_minecraft._tcp.' + hostname)}&type=SRV`,
        `https://dns.google/resolve?name=${encodeURIComponent('_minecraft._tcp.' + hostname)}&type=SRV`
    ];
    for (const url of endpoints) {
        try {
            const res = await new Promise((resolve, reject) => {
                const req = https.get(url, { headers: { 'Accept': 'application/dns-json' }, timeout: 2500 }, (r) => {
                    let d = '';
                    r.on('data', c => d += c);
                    r.on('end', () => resolve(d));
                });
                req.on('error', reject);
                req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
            });
            const json = JSON.parse(res);
            if (json && Array.isArray(json.Answer)) {
                for (const ans of json.Answer) {
                    if (ans.type === 33 && ans.data) {
                        const parts = ans.data.trim().split(/\s+/);
                        if (parts.length >= 4) {
                            return { port: parseInt(parts[2], 10), name: parts[3].replace(/\.$/, '') };
                        }
                    }
                }
            }
        } catch (_) {}
    }
    return null;
}

/**
 * Resuelve registros SRV de Minecraft (_minecraft._tcp.<domain>)
 * Devuelve { port, name } o null.
 */
async function resolveSrvRecord(hostname) {
    if (!hostname || net.isIP(hostname)) return null;

    // 1. Intento por DNS UDP directo
    try {
        const records = await new Promise((resolve, reject) => {
            dns.resolveSrv(`_minecraft._tcp.${hostname}`, (err, res) => {
                if (!err && res && res.length > 0) return resolve(res);
                reject(err || new Error('No SRV'));
            });
        });
        if (records && records[0] && records[0].port) {
            return {
                port: Number(records[0].port),
                name: (records[0].name || '').replace(/\.$/, '')
            };
        }
    } catch (_) {}

    // 2. Fallback a DoH
    try {
        const doh = await queryDoH_SRV(hostname);
        if (doh) return doh;
    } catch (_) {}

    return null;
}

/**
 * Resuelve cualquier host (Playit, túnel o servidor externo) a su IP numérica final y puerto.
 * - Detecta si viene puerto explícito (ej: host:13602 o [ipv6]:13602)
 * - Si no tiene puerto, consulta registros SRV de Minecraft
 * - Traduce el dominio a su IP numérica directa usando Cloudflare / Google (DoH + Anycast)
 * Devuelve: { ip, port, target, isNumeric, originalHost }
 */
async function resolveHostAndPort(rawHost, defaultPort = 25565) {
    if (!rawHost) return { ip: '', port: defaultPort, target: '', isNumeric: false };
    let hostname = String(rawHost).trim();
    let port = Number(defaultPort) || 25565;
    let hadPortInHost = false;

    // Separar host y puerto si vienen juntos
    if (hostname.includes(':') && !hostname.endsWith(']')) {
        const lastColon = hostname.lastIndexOf(':');
        const candidatePort = Number(hostname.substring(lastColon + 1));
        if (!isNaN(candidatePort) && candidatePort > 0) {
            port = candidatePort;
            hostname = hostname.substring(0, lastColon).replace(/^\[|\]$/g, '').trim();
            hadPortInHost = true;
        }
    }

    // Si ya es una IP numérica (IPv4 o IPv6), retornar directo sin demoras
    const ipFamily = net.isIP(hostname);
    if (ipFamily) {
        const target = ipFamily === 6 ? `[${hostname}]:${port}` : `${hostname}:${port}`;
        return { ip: hostname, port: port, target: target, isNumeric: true, family: ipFamily };
    }

    // Si no traía puerto explícito o tenía el default, verificar si tiene SRV
    let targetHost = hostname;
    if (!hadPortInHost || port === 25565) {
        try {
            const srv = await resolveSrvRecord(hostname);
            if (srv && srv.port && srv.name) {
                port = srv.port;
                targetHost = srv.name;
            }
        } catch (_) {}
    }

    // Resolver targetHost a IP numérica usando la estrategia multi-DNS
    let resolvedIp = targetHost;
    try {
        const records = await resolveDomain(targetHost);
        if (records && records.length > 0) {
            // Priorizar IPv4 para túneles Playit y servidores generales
            const v4 = records.find(r => r.family === 4);
            resolvedIp = v4 ? v4.address : records[0].address;
        }
    } catch (_) {}

    const isNum = Boolean(net.isIP(resolvedIp));
    const target = isNum && net.isIP(resolvedIp) === 6 ? `[${resolvedIp}]:${port}` : `${resolvedIp}:${port}`;

    return {
        ip: resolvedIp,
        port: port,
        target: target,
        isNumeric: isNum,
        originalHost: hostname
    };
}

/**
 * Limpia la caché DNS de Windows y del proceso Node.js en segundo plano (sin abrir consolas).
 */
function flushSystemDnsCache() {
    return new Promise((resolve) => {
        dnsCache.clear();
        if (process.platform === 'win32') {
            exec('ipconfig /flushdns', { windowsHide: true }, (err) => {
                if (!err) {
                    console.log('[DNS-Resolver] 🧹 Caché DNS de Windows limpiada con éxito.');
                }
                resolve(!err);
            });
        } else {
            resolve(true);
        }
    });
}

/**
 * Agrega permisos automáticos en el Firewall de Windows para el ejecutable de Java.
 */
function repairWindowsFirewallForJava(javaExePath) {
    return new Promise((resolve) => {
        if (process.platform !== 'win32' || !javaExePath) {
            return resolve(false);
        }
        try {
            if (!fs.existsSync(javaExePath)) {
                return resolve(false);
            }
        } catch (_) {
            return resolve(false);
        }

        const ruleNameOut = 'MDK-Launcher Java Runtime Out';
        const ruleNameIn = 'MDK-Launcher Java Runtime In';
        const cmdOut = `netsh advfirewall firewall add rule name="${ruleNameOut}" dir=out action=allow program="${javaExePath}" enable=yes`;
        const cmdIn = `netsh advfirewall firewall add rule name="${ruleNameIn}" dir=in action=allow program="${javaExePath}" enable=yes`;

        exec(`${cmdOut} & ${cmdIn}`, { windowsHide: true }, (err) => {
            if (!err) {
                console.log('[Firewall] ✅ Reglas de Firewall de Windows aplicadas para Java:', javaExePath);
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

/**
 * Función customLookup para inyectar en http/https agents y node-fetch
 */
function customLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    // Para GitHub, Microsoft y CDN de actualización, usar lookup nativo prioritario sin demoras
    if (
        hostname.includes('github.com') || 
        hostname.includes('githubusercontent.com') || 
        hostname.includes('microsoft.com') || 
        hostname.includes('live.com') || 
        hostname.includes('xboxlive.com')
    ) {
        return dns.lookup(hostname, options, (err, address, family) => {
            if (!err) {
                if (options && options.all) return callback(null, [{ address, family }]);
                return callback(null, address, family);
            }
            // Si el DNS del ISP bloquea GitHub, intentar con el resolver autónomo
            resolveDomain(hostname).then(records => {
                if (records && records.length > 0) {
                    if (options && options.all) return callback(null, records);
                    return callback(null, records[0].address, records[0].family);
                }
                callback(err);
            }).catch(() => callback(err));
        });
    }

    resolveDomain(hostname).then(records => {
        if (records && records.length > 0) {
            if (options && options.all) {
                return callback(null, records);
            }
            return callback(null, records[0].address, records[0].family);
        }
        // Fallback al lookup del sistema si los DNS externos fallaron
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

const resolverModule = {
    customLookup,
    resolveDomain,
    queryDoH,
    queryDoH_SRV,
    resolveSrvRecord,
    resolveHostAndPort,
    flushSystemDnsCache,
    repairWindowsFirewallForJava,
    customHttpsAgent,
    customHttpAgent
};

if (typeof global !== 'undefined') {
    global.__MDK_DNS_RESOLVER__ = resolverModule;
    global.dnsResolver = resolverModule;
}

module.exports = resolverModule;
