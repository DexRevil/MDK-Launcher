/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

const pkg = require('../package.json');
const nodeFetch = require("node-fetch");
const convert = require('xml-js');
let url = pkg.user ? `${pkg.url}/${pkg.user}` : pkg.url

let config = `${url}/launcher/config-launcher/config.json`;
let news = `${url}/launcher/news-launcher/news.json`;

class Config {
    GetConfig() {
        return new Promise((resolve, reject) => {
            nodeFetch(config).then(async config => {
                if (config.status === 200) return resolve(config.json());
                else return reject({ error: { code: config.statusText, message: 'server not accessible' } });
            }).catch(error => {
                return reject({ error });
            })
        })
    }

    async getInstanceList() {
        let urlInstance = `${url}/files`
        let instances;
        let retries = 3;
        let lastError;

        while (retries > 0) {
            try {
                let res = await nodeFetch(urlInstance, { timeout: 5000 });
                instances = await res.json();
                break; // Éxito, salir del bucle
            } catch (err) {
                lastError = err;
                retries--;
                if (retries > 0) {
                    console.warn(`[Config] Error al obtener lista de instancias (reintentando...):`, err.message || err);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // Esperar 1s antes de reintentar
                }
            }
        }

        if (retries === 0) {
            console.error('[Config] Error crítico al obtener lista de instancias tras varios intentos:', lastError.message || lastError);
            return [];
        }

        if (!instances || typeof instances !== 'object') return [];

        let instancesList = []
        instances = Object.entries(instances)

        for (let [name, data] of instances) {
            let instance = data
            instance.name = name
            instancesList.push(instance)
        }
        return instancesList
    }

    async getNews() {
        let config = await this.GetConfig() || {}

        if (config.rss) {
            return new Promise((resolve, reject) => {
                nodeFetch(config.rss).then(async config => {
                    if (config.status === 200) {
                        let news = [];
                        let response = await config.text()
                        response = (JSON.parse(convert.xml2json(response, { compact: true })))?.rss?.channel?.item;

                        if (!Array.isArray(response)) response = [response];
                        for (let item of response) {
                            news.push({
                                title: item.title._text,
                                content: item['content:encoded']._text,
                                author: item['dc:creator']._text,
                                publish_date: item.pubDate._text
                            })
                        }
                        return resolve(news);
                    }
                    else return reject({ error: { code: config.statusText, message: 'server not accessible' } });
                }).catch(error => reject({ error }))
            })
        } else {
            return new Promise((resolve, reject) => {
                nodeFetch(news).then(async config => {
                    if (config.status === 200) return resolve(config.json());
                    else return reject({ error: { code: config.statusText, message: 'server not accessible' } });
                }).catch(error => {
                    return reject({ error });
                })
            })
        }
    }

    async getRatings(instanceName = null, userName = null) {
        let ratingsUrl = `${url}/files/ratings.php`;
        let params = [];
        if (instanceName) params.push(`instance=${encodeURIComponent(instanceName)}`);
        if (userName) params.push(`user=${encodeURIComponent(userName)}`);
        if (params.length > 0) ratingsUrl += `?${params.join('&')}`;

        try {
            let res = await nodeFetch(ratingsUrl, { timeout: 4000 });
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
                timeout: 5000
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