/**
 * @author Luuxis & MDK Team
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

let dnsResolver = null;
try {
    dnsResolver = require('./dnsResolver.js');
} catch (e1) {
    try {
        dnsResolver = require('./assets/js/utils/dnsResolver.js');
    } catch (e2) {
        try {
            dnsResolver = require('./utils/dnsResolver.js');
        } catch (e3) {
            console.warn('[Config] dnsResolver cargado desde globalAgent');
        }
    }
}
const nodeFetch = require("node-fetch");
const convert = require('xml-js');

let pkg = null;
try {
    pkg = require('../../../../package.json');
} catch (e1) {
    try {
        pkg = require('../package.json');
    } catch (e2) {
        pkg = { url: "https://servicio.mdkgameteam.xyz" };
    }
}

const DEFAULT_SERVER_URL = "https://servicio.mdkgameteam.xyz";
let baseUrl = (pkg && pkg.url) ? pkg.url : DEFAULT_SERVER_URL;
let url = (pkg && pkg.user) ? `${baseUrl}/${pkg.user}` : baseUrl;

let config = `${url}/launcher/config-launcher/config.json`;
let news = `${url}/launcher/news-launcher/news.json`;

class Config {
    constructor() {
        this.cachedConfig = null;
    }

    async GetConfig() {
        let retries = 4;
        let lastError;

        while (retries > 0) {
            try {
                let res = await nodeFetch(config, {
                    agent: dnsResolver?.customHttpsAgent,
                    timeout: 8000
                });
                if (res.ok) {
                    let data = await res.json();
                    this.cachedConfig = data;
                    return data;
                } else {
                    lastError = { code: res.statusText || 'HTTP_ERR', message: `Server returned status ${res.status}` };
                }
            } catch (err) {
                lastError = err;
                retries--;
                if (retries > 0) {
                    console.warn(`[Config] Reintentando conexión con config.json (${retries} intentos restantes)... Error:`, err.message || err);
                    await new Promise(r => setTimeout(r, 400));
                }
            }
        }

        // Intento de rescate final directo con DoH (DNS-over-HTTPS)
        try {
            console.log('[Config] Intentando rescate DoH para config.json...');
            const urlObj = new URL(config);
            const dohRecords = await dnsResolver?.queryDoH(urlObj.hostname, 'A');
            if (dohRecords && dohRecords.length > 0) {
                const targetIp = dohRecords[0].address;
                const directUrl = `https://${targetIp}${urlObj.pathname}${urlObj.search}`;
                const res = await nodeFetch(directUrl, {
                    headers: { 'Host': urlObj.hostname },
                    timeout: 7000
                });
                if (res.ok) {
                    let data = await res.json();
                    this.cachedConfig = data;
                    console.log('[Config] ✅ Rescate DoH exitoso para config.json.');
                    return data;
                }
            }
        } catch (rescueErr) {
            console.warn('[Config] Rescate DoH no disponible:', rescueErr.message || rescueErr);
        }

        // Si fallaron los intentos pero existe caché local previa, usarla para evitar crash
        if (this.cachedConfig) {
            console.warn('[Config] ⚡ Usando configuración en caché local tras error de conexión temporal.');
            return this.cachedConfig;
        }

        return Promise.reject({ error: lastError || { code: 'CONN_ERROR', message: 'Servidor no accesible' } });
    }

    async getInstanceList() {
        let urlInstance = `${url}/files/`;
        let instances;
        let retries = 3;
        let lastError;

        while (retries > 0) {
            try {
                let res = await nodeFetch(urlInstance, {
                    agent: dnsResolver?.customHttpsAgent,
                    timeout: 6000
                });
                instances = await res.json();
                break;
            } catch (err) {
                lastError = err;
                retries--;
                if (retries > 0) {
                    console.warn(`[Config] Error al obtener lista de instancias (reintentando...):`, err.message || err);
                    await new Promise(resolve => setTimeout(resolve, 800));
                }
            }
        }

        if (retries === 0) {
            console.error('[Config] Error crítico al obtener lista de instancias tras varios intentos:', lastError?.message || lastError);
            return [];
        }

        if (!instances || typeof instances !== 'object') return [];

        let instancesList = [];
        instances = Object.entries(instances);

        for (let [name, data] of instances) {
            let instance = data;
            instance.name = name;
            if (instance.url && typeof instance.url === 'string' && instance.url.startsWith('http://servicio.')) {
                instance.url = instance.url.replace(/^http:\/\//, 'https://');
            }
            instancesList.push(instance);
        }
        return instancesList;
    }

    async getNews() {
        let configData = await this.GetConfig() || {};

        if (configData.rss) {
            return new Promise((resolve, reject) => {
                nodeFetch(configData.rss, {
                    agent: dnsResolver?.customHttpsAgent,
                    timeout: 6000
                }).then(async res => {
                    if (res.status === 200) {
                        let newsList = [];
                        let responseText = await res.text();
                        let responseJson = (JSON.parse(convert.xml2json(responseText, { compact: true })))?.rss?.channel?.item;

                        if (!Array.isArray(responseJson)) responseJson = [responseJson];
                        for (let item of responseJson) {
                            if (item) {
                                newsList.push({
                                    title: item.title?._text || '',
                                    content: item['content:encoded']?._text || '',
                                    author: item['dc:creator']?._text || '',
                                    publish_date: item.pubDate?._text || ''
                                });
                            }
                        }
                        return resolve(newsList);
                    }
                    return reject({ error: { code: res.statusText, message: 'server not accessible' } });
                }).catch(error => reject({ error }));
            });
        } else {
            return new Promise((resolve, reject) => {
                nodeFetch(news, {
                    agent: dnsResolver?.customHttpsAgent,
                    timeout: 6000
                }).then(async res => {
                    if (res.status === 200) return resolve(res.json());
                    return reject({ error: { code: res.statusText, message: 'server not accessible' } });
                }).catch(error => reject({ error }));
            });
        }
    }

    async getRatings(instanceName = null, userName = null) {
        let ratingsUrl = `${url}/files/ratings.php`;
        let params = [];
        if (instanceName) params.push(`instance=${encodeURIComponent(instanceName)}`);
        if (userName) params.push(`user=${encodeURIComponent(userName)}`);
        if (params.length > 0) ratingsUrl += `?${params.join('&')}`;

        try {
            let res = await nodeFetch(ratingsUrl, {
                agent: dnsResolver?.customHttpsAgent,
                timeout: 5000
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.debug('[Config] Servidor de calificaciones no disponible en este momento:', e.message || e);
        }
        return null;
    }

    async submitRating(instanceName, userName, rating, comment = '', uuid = '') {
        let ratingsUrl = `${url}/files/ratings.php`;
        try {
            let res = await nodeFetch(ratingsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instance: instanceName,
                    user: userName,
                    uuid: uuid,
                    rating: parseInt(rating),
                    comment: comment
                }),
                agent: dnsResolver?.customHttpsAgent,
                timeout: 6000
            });
            if (res.ok) {
                return await res.json();
            }
        } catch (e) {
            console.warn('[Config] Error al enviar calificación al servidor:', e.message || e);
        }
        return null;
    }
}

export default new Config;