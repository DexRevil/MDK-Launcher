/**
 * @author ElFo2Ks
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup, setInstanceBackground } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const net = require('net')

// Helper para calcular hash (SHA-256 por defecto, o SHA-1/MD5) vía streams
const computeFileHash = (filePath, algorithm = 'sha256') => {
    return new Promise((resolve, reject) => {
        try {
            const shasum = crypto.createHash(algorithm);
            const stream = fs.createReadStream(filePath);
            stream.on('data', (d) => shasum.update(d));
            stream.on('end', () => resolve(shasum.digest('hex')));
            stream.on('error', (err) => reject(err));
        } catch (err) {
            reject(err);
        }
    });
};

// Monkey-patch a minecraft-java-core para soportar verificación nativa de hashes SHA-256 (64 hex)
const applyMjcHashPatch = () => {
    try {
        let bundleModule = null;
        for (const key of Object.keys(require.cache)) {
            if (key.replace(/\\/g, '/').endsWith('Minecraft/Minecraft-Bundle.js')) {
                bundleModule = require.cache[key]?.exports;
                break;
            }
        }
        if (!bundleModule) {
            try {
                const mjcMain = require.resolve('minecraft-java-core');
                const mjcDir = path.dirname(mjcMain);
                bundleModule = require(path.join(mjcDir, 'Minecraft', 'Minecraft-Bundle.js'));
            } catch (_) {}
        }
        const MinecraftBundle = bundleModule?.default || bundleModule;
        if (MinecraftBundle && MinecraftBundle.prototype && !MinecraftBundle.prototype._sha256Patched) {
            MinecraftBundle.prototype._sha256Patched = true;
            MinecraftBundle.prototype.checkBundle = async function(bundle) {
                const toDownload = [];
                for (const file of bundle) {
                    if (!file.path) continue;
                    if (file.url && typeof file.url === 'string') {
                        file.url = file.url.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i, 'https://servicio.mdkgameteam.xyz');
                        file.url = file.url.replace(/^http:\/\/servicio\./i, 'https://servicio.');
                    }
                    file.path = path.resolve(this.options.path, file.path).replace(/\\/g, '/');
                    file.folder = file.path.split('/').slice(0, -1).join('/');

                    if (file.type === 'CFILE') {
                        if (!fs.existsSync(file.folder)) {
                            fs.mkdirSync(file.folder, { recursive: true, mode: 0o777 });
                        }
                        fs.writeFileSync(file.path, file.content ?? '', { encoding: 'utf8', mode: 0o755 });
                        continue;
                    }

                    if (fs.existsSync(file.path)) {
                        let replaceName = `${this.options.path}/`;
                        if (this.options.instance) {
                            replaceName = `${this.options.path}/instances/${this.options.instance}/`;
                        }
                        const relativePath = file.path.replace(replaceName, '');
                        if (this.options.ignored && this.options.ignored.includes(relativePath)) {
                            continue;
                        }
                        if (file.sha1) {
                            let algo = 'sha1';
                            if (file.sha1.length === 64) algo = 'sha256';
                            else if (file.sha1.length === 32) algo = 'md5';

                            try {
                                const localHash = await computeFileHash(file.path, algo);
                                if (localHash.toLowerCase() !== file.sha1.toLowerCase()) {
                                    toDownload.push(file);
                                }
                            } catch (e) {
                                toDownload.push(file);
                            }
                        }
                    } else {
                        toDownload.push(file);
                    }
                }
                return toDownload;
            };
            console.log('[Patch] ✅ Soporte para SHA-256 habilitado en minecraft-java-core (checkBundle).');
        }
    } catch (e) {
        console.warn('[Patch] Aviso: no se pudo parchear checkBundle de minecraft-java-core:', e.message || e);
    }
};

applyMjcHashPatch();

// ==================== DUAL STACK ROUTING ENGINE ====================

/**
 * Prueba la conectividad IPv6 hacia el host y puerto especificados con timeout configurable.
 * @param {string} host 
 * @param {number} port 
 * @param {number} timeoutMs 
 * @returns {Promise<boolean>}
 */
const checkIPv6Connectivity = (host, port, timeoutMs = 1500) => {
    return new Promise((resolve) => {
        let finished = false;
        const socket = new net.Socket();
        socket.setTimeout(timeoutMs);

        const finish = (result) => {
            if (!finished) {
                finished = true;
                socket.destroy();
                resolve(result);
            }
        };

        socket.on('connect', () => finish(true));
        socket.on('timeout', () => finish(false));
        socket.on('error', () => finish(false));

        try {
            socket.connect({ host: host, port: Number(port) || 25565, family: 6 });
        } catch (_) {
            finish(false);
        }
    });
};

/**
 * Genera un buffer binario NBT completamente conforme al estándar para servers.dat de Minecraft.
 * @param {string} serverName 
 * @param {string} serverIp 
 * @returns {Buffer}
 */
const createServersDatBuffer = (serverName, serverIp) => {
    const nameBuf = Buffer.from(serverName || 'Minecraft Server', 'utf8');
    const ipBuf = Buffer.from(serverIp, 'utf8');

    const nameLen = Buffer.alloc(2);
    nameLen.writeUInt16BE(nameBuf.length, 0);

    const ipLen = Buffer.alloc(2);
    ipLen.writeUInt16BE(ipBuf.length, 0);

    return Buffer.concat([
        Buffer.from([0x0a, 0x00, 0x00]), // Root Compound
        Buffer.from([0x09, 0x00, 0x07]), Buffer.from('servers', 'utf8'), // List "servers"
        Buffer.from([0x0a, 0x00, 0x00, 0x00, 0x01]), // Element type Compound, count 1
        Buffer.from([0x08, 0x00, 0x04]), Buffer.from('name', 'utf8'), nameLen, nameBuf, // String "name"
        Buffer.from([0x08, 0x00, 0x02]), Buffer.from('ip', 'utf8'), ipLen, ipBuf, // String "ip"
        Buffer.from([0x01, 0x00, 0x06]), Buffer.from('hidden', 'utf8'), Buffer.from([0x00]), // Byte "hidden" = 0
        Buffer.from([0x00]), // TAG_End for item
        Buffer.from([0x00])  // TAG_End for root
    ]);
};

/**
 * Modifica servers.dat con el host:port enrutado, creando respaldo .original si no existe.
 * @param {string} instancePath 
 * @param {string} targetHostPort 
 * @param {string} instanceName 
 */
const updateServersDat = (instancePath, targetHostPort, instanceName = 'MDK Server') => {
    const serversDatPath = path.join(instancePath, 'servers.dat');
    const serversDatBackup = path.join(instancePath, 'servers.dat.original');

    try {
        if (fs.existsSync(serversDatPath)) {
            // Respaldar original si no existe respaldo previo
            if (!fs.existsSync(serversDatBackup)) {
                fs.copyFileSync(serversDatPath, serversDatBackup);
                console.log(`[DualStack] 💾 Respaldo creado: ${serversDatBackup}`);
            }

            let buf = fs.readFileSync(serversDatPath);
            const marker = Buffer.from([0x08, 0x00, 0x02, 0x69, 0x70]); // TAG_String "ip"
            let idx = buf.indexOf(marker);

            if (idx !== -1) {
                let lenIdx = idx + marker.length;
                let oldLen = buf.readUInt16BE(lenIdx);
                let strIdx = lenIdx + 2;

                let newIpBuf = Buffer.from(targetHostPort, 'utf8');
                let newLenBuf = Buffer.alloc(2);
                newLenBuf.writeUInt16BE(newIpBuf.length, 0);

                let updatedBuf = Buffer.concat([
                    buf.slice(0, lenIdx),
                    newLenBuf,
                    newIpBuf,
                    buf.slice(strIdx + oldLen)
                ]);

                fs.writeFileSync(serversDatPath, updatedBuf);
                console.log(`[DualStack] 🎮 servers.dat actualizado con IP: ${targetHostPort}`);
                return true;
            }
        }

        // Si no existía o no contenía la etiqueta "ip", generar un servers.dat limpio
        const newBuf = createServersDatBuffer(instanceName, targetHostPort);
        fs.writeFileSync(serversDatPath, newBuf);
        console.log(`[DualStack] 🎮 servers.dat generado con IP: ${targetHostPort}`);
        return true;
    } catch (e) {
        console.warn(`[DualStack] Aviso al modificar servers.dat:`, e.message || e);
        return false;
    }
};

/**
 * Modifica todos los archivos de personalización de FancyMenu que contengan [action_type:joinserver]
 * @param {string} instancePath 
 * @param {string} targetHostPort 
 */
const updateFancyMenuCustomizations = (instancePath, targetHostPort) => {
    const fmDir = path.join(instancePath, 'config', 'fancymenu', 'customization');
    if (!fs.existsSync(fmDir)) return;

    try {
        const files = fs.readdirSync(fmDir);
        for (const file of files) {
            if (!file.endsWith('.txt') || file.endsWith('.original')) continue;

            const filePath = path.join(fmDir, file);
            const backupPath = filePath + '.original';

            try {
                let content = fs.readFileSync(filePath, 'utf8');
                const joinServerPattern = /(\[action_type:joinserver\]\s*=\s*)[^\r\n]+/g;

                if (joinServerPattern.test(content)) {
                    // Respaldar original si no existe
                    if (!fs.existsSync(backupPath)) {
                        fs.copyFileSync(filePath, backupPath);
                        console.log(`[DualStack] 💾 Respaldo FancyMenu creado: ${backupPath}`);
                    }

                    // Reemplazar host:port en la acción de unirse al servidor
                    content = content.replace(joinServerPattern, `$1${targetHostPort}`);
                    fs.writeFileSync(filePath, content, 'utf8');
                    console.log(`[DualStack] 🎨 FancyMenu [${file}] actualizado con host: ${targetHostPort}`);
                }
            } catch (err) {
                console.warn(`[DualStack] Error al procesar archivo FancyMenu ${file}:`, err.message || err);
            }
        }
    } catch (e) {
        console.warn(`[DualStack] Error al escanear directorio FancyMenu:`, e.message || e);
    }
};

/**
 * Restaura los archivos originales (servers.dat y layouts de FancyMenu) si la instancia es externa
 * o si se deshabilitó el modo local.
 * @param {string} instancePath 
 */
const restoreOriginalNetworkFiles = (instancePath) => {
    try {
        // 1. Restaurar servers.dat
        const serversDatPath = path.join(instancePath, 'servers.dat');
        const serversDatBackup = path.join(instancePath, 'servers.dat.original');
        if (fs.existsSync(serversDatBackup)) {
            fs.copyFileSync(serversDatBackup, serversDatPath);
            console.log(`[DualStack] 🔄 servers.dat restaurado desde original`);
        }

        // 2. Restaurar archivos FancyMenu
        const fmDir = path.join(instancePath, 'config', 'fancymenu', 'customization');
        if (fs.existsSync(fmDir)) {
            const files = fs.readdirSync(fmDir);
            for (const file of files) {
                if (file.endsWith('.txt.original')) {
                    const originalPath = path.join(fmDir, file);
                    const targetPath = originalPath.slice(0, -9); // quita .original
                    fs.copyFileSync(originalPath, targetPath);
                    console.log(`[DualStack] 🔄 FancyMenu restaurado desde original: ${path.basename(targetPath)}`);
                }
            }
        }
    } catch (e) {
        console.warn(`[DualStack] Error al restaurar archivos originales:`, e.message || e);
    }
};

/**
 * Aplica el enrutamiento Dual Stack completo (IPv6 directa o IPv4 Playit.gg de respaldo).
 * @param {string} instancePath 
 * @param {object} networkConfig 
 * @param {string} instanceName 
 */
const applyDualStackRouting = async (instancePath, networkConfig, instanceName) => {
    if (!networkConfig || networkConfig.mode !== 'internal') {
        console.log(`[DualStack] Instancia "${instanceName}" en modo Externo/Remoto. Restaurando archivos originales si aplica.`);
        restoreOriginalNetworkFiles(instancePath);
        return;
    }

    const ipv6Host = networkConfig.ipv6_host || 'mc.mdkgameteam.xyz';
    const ipv6Port = Number(networkConfig.ipv6_port) || 25565;
    const ipv4Host = networkConfig.ipv4_host ? networkConfig.ipv4_host.trim() : '';
    const ipv4Port = Number(networkConfig.ipv4_port) || 25565;

    console.log(`[DualStack] Verificando conectividad IPv6 hacia [${ipv6Host}:${ipv6Port}]...`);
    const isIpv6Ok = await checkIPv6Connectivity(ipv6Host, ipv6Port, 1500);

    let chosenTarget = '';
    if (isIpv6Ok) {
        chosenTarget = `${ipv6Host}:${ipv6Port}`;
        console.log(`[DualStack] 🚀 Conectividad IPv6 DIRECTA verificada exitosamente. Enrutando a: ${chosenTarget}`);
    } else {
        if (ipv4Host) {
            chosenTarget = `${ipv4Host}:${ipv4Port}`;
            console.log(`[DualStack] ⚡ Sin conectividad IPv6 directa (posible CGNAT de ISP). Enrutando vía túnel Playit.gg a: ${chosenTarget}`);
        } else {
            chosenTarget = `${ipv6Host}:${ipv6Port}`;
            console.warn(`[DualStack] ⚠️ Sin IPv6 y no se especificó túnel IPv4. Manteniendo IPv6 como fallback: ${chosenTarget}`);
        }
    }

    updateServersDat(instancePath, chosenTarget, instanceName);
    updateFancyMenuCustomizations(instancePath, chosenTarget);
};

// ==================== END DUAL STACK ROUTING ENGINE ====================

class Home {
    static id = "home";

    constructor() {
        this.selectedRating = 0;
        this.currentRatedInstance = null;
        this.ratingsCache = {
            "Bingo": { average: 4.8, total_votes: 6, user_rating: null },
            "Puchungolan": { average: 4.9, total_votes: 12, user_rating: null },
            "SurvivalZ": { average: 4.6, total_votes: 8, user_rating: null },
            "hypixel": { average: 4.7, total_votes: 15, user_rating: null }
        };
        this.ratingDescriptions = {
            1: "⭐ 1/5 - Muy malo",
            2: "⭐⭐ 2/5 - Regular",
            3: "⭐⭐⭐ 3/5 - Bueno",
            4: "⭐⭐⭐⭐ 4/5 - Muy bueno",
            5: "⭐⭐⭐⭐⭐ 5/5 - ¡Excelente!"
        };
    }

    async init(config) {
        this.config = config;
        this.db = new database();

        // En cada inicio del launcher, asegurar que no haya instancia preseleccionada
        let configClient = await this.db.readData('configClient');
        if (configClient && configClient.instance_selct) {
            configClient.instance_selct = null;
            await this.db.updateData('configClient', configClient);
        }

        // Llamadas iniciales
        this.setupEventListeners();
        this.setupRatingListeners();
        await this.loadRatingsData();
        await this.updateInstancesData();
        this.IniciarEstadoDiscord();
        this.isGameRunning = false;
        this.setSidebarActionsBlocked(false);
        await this.updatePlayButtonState(null);

        // 🔁 Actualización automática cada 30s
        setInterval(() => {
            if (!this.isGameRunning) {
                this.updateInstancesData();
            }
        }, 30000); // 30,000 ms = 30 segundos
    }

    setSidebarActionsBlocked(blocked) {
        this.isGameRunning = blocked;
        const settingsBtn = document.querySelector('.settings-btn');
        const reloadBtn = document.getElementById('sidebar-reload-btn');
        const instancesList = document.querySelector('.instances-visible-list');

        if (blocked) {
            settingsBtn?.classList.add('btn-blocked');
            settingsBtn?.setAttribute('data-tooltip', 'Configuración bloqueada durante el juego');

            reloadBtn?.classList.add('btn-blocked');
            reloadBtn?.setAttribute('data-tooltip', 'Recarga bloqueada durante el juego');

            instancesList?.classList.add('instances-blocked');
        } else {
            settingsBtn?.classList.remove('btn-blocked');
            settingsBtn?.setAttribute('data-tooltip', 'Configuración');

            reloadBtn?.classList.remove('btn-blocked');
            reloadBtn?.setAttribute('data-tooltip', 'Recargar Launcher');

            instancesList?.classList.remove('instances-blocked');
        }
    }

    async IniciarEstadoDiscord() {
        ipcRenderer.send('new-status-discord');
        document.querySelector('.settings-btn')?.addEventListener('click', e => {
            if (this.isGameRunning) return;
            changePanel('settings');
        });

        const reloadBtn = document.getElementById('sidebar-reload-btn');
        if (reloadBtn) {
            reloadBtn.addEventListener('click', () => {
                if (this.isGameRunning) return;
                reloadBtn.classList.add('spinning');
                setTimeout(() => {
                    window.location.reload();
                }, 250);
            });
        }
    }

    async loadRatingsData() {
        try {
            let configClient = await this.db.readData('configClient');
            if (configClient && configClient.instance_ratings) {
                this.ratingsCache = { ...this.ratingsCache, ...configClient.instance_ratings };
            }

            let auth = await this.db.readData('accounts', configClient?.account_selected);
            let remoteRatings = await config.getRatings(null, auth?.name);
            if (remoteRatings && remoteRatings.ratings) {
                for (let [inst, rData] of Object.entries(remoteRatings.ratings)) {
                    this.ratingsCache[inst] = {
                        average: typeof rData.average === 'number' ? rData.average : 5.0,
                        total_votes: typeof rData.total_votes === 'number' ? rData.total_votes : 0,
                        user_rating: rData.user_rating || null
                    };
                }
                if (configClient) {
                    configClient.instance_ratings = this.ratingsCache;
                    await this.db.updateData('configClient', configClient);
                }
            }
        } catch (err) {
            console.debug('[Ratings] Usando datos de clasificación locales:', err);
        }
    }

    async updateRatingUI(instanceName) {
        let ratingCard = document.getElementById('instance-rating-card');
        if (!instanceName || !ratingCard) {
            if (ratingCard) ratingCard.style.display = 'none';
            return;
        }

        let instancesList = await config.getInstanceList();
        let instance = instancesList.find(i => i.name === instanceName);

        // Si la instancia tiene ratingActive: false en el servidor, ocultar completamente las estrellas
        if (instance && instance.ratingActive === false) {
            ratingCard.style.display = 'none';
            return;
        }

        let scoreText = document.getElementById('main-rating-score');
        let votesCount = document.getElementById('main-rating-count');
        let userBadge = document.getElementById('main-rating-user-badge');
        let userVotedScore = document.getElementById('user-voted-score');
        let starsInline = document.querySelectorAll('#main-rating-stars .star-mini');

        let rData = this.ratingsCache[instanceName] || { average: 5.0, total_votes: 0, user_rating: null };
        let avg = typeof rData.average === 'number' ? rData.average : 5.0;
        let votes = typeof rData.total_votes === 'number' ? rData.total_votes : 0;

        if (scoreText) scoreText.textContent = avg.toFixed(1);
        if (votesCount) votesCount.textContent = `${votes} ${votes === 1 ? 'voto' : 'votos'}`;

        let rounded = Math.round(avg);
        starsInline.forEach(star => {
            let val = parseInt(star.getAttribute('data-val'));
            if (val <= rounded) {
                star.classList.add('filled');
            } else {
                star.classList.remove('filled');
            }
        });

        if (rData.user_rating && userBadge && userVotedScore) {
            userVotedScore.textContent = rData.user_rating;
            userBadge.style.display = 'inline-block';
        } else if (userBadge) {
            userBadge.style.display = 'none';
        }

        ratingCard.style.display = 'flex';
    }

    setupRatingListeners() {
        const rateBtn = document.getElementById('open-rate-modal-btn');
        const ratingCard = document.getElementById('instance-rating-card');
        const ratingPopup = document.getElementById('rating-popup');
        const closeBtn = document.getElementById('close-rating-popup');
        const cancelBtn = document.getElementById('rating-btn-cancel');
        const submitBtn = document.getElementById('rating-btn-submit');
        const interactiveStars = document.querySelectorAll('.interactive-star');
        const feedbackLabel = document.getElementById('rating-score-feedback');
        const modalInstanceName = document.getElementById('rating-modal-instance-name');
        const commentInput = document.getElementById('rating-comment-textarea');

        const openModal = async () => {
            let configClient = await this.db.readData('configClient');
            let instanceName = configClient?.instance_selct || 'Instancia';
            this.currentRatedInstance = instanceName;

            if (modalInstanceName) modalInstanceName.textContent = instanceName;
            if (commentInput) commentInput.value = '';

            let existingRating = this.ratingsCache[instanceName]?.user_rating || 0;
            this.selectedRating = existingRating;

            this.renderModalStars(existingRating);

            if (existingRating > 0) {
                if (feedbackLabel) feedbackLabel.textContent = `Tu voto actual: ${this.ratingDescriptions[existingRating] || existingRating + ' estrellas'}`;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.querySelector('span').textContent = 'Actualizar Calificación';
                }
            } else {
                if (feedbackLabel) feedbackLabel.textContent = '¡Haz clic en una estrella para calificar!';
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.querySelector('span').textContent = 'Enviar Calificación';
                }
            }

            if (ratingPopup) ratingPopup.style.display = 'flex';
        };

        if (rateBtn) rateBtn.addEventListener('click', e => { e.stopPropagation(); openModal(); });
        if (ratingCard) ratingCard.addEventListener('click', () => openModal());

        const closeModal = () => {
            if (ratingPopup) ratingPopup.style.display = 'none';
        };

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

        interactiveStars.forEach(star => {
            let ratingVal = parseInt(star.getAttribute('data-rating'));

            star.addEventListener('mouseenter', () => {
                this.renderModalStars(ratingVal, true);
                if (feedbackLabel) feedbackLabel.textContent = this.ratingDescriptions[ratingVal] || `${ratingVal} estrellas`;
            });

            star.addEventListener('mouseleave', () => {
                this.renderModalStars(this.selectedRating, false);
                if (this.selectedRating > 0) {
                    if (feedbackLabel) feedbackLabel.textContent = this.ratingDescriptions[this.selectedRating];
                } else {
                    if (feedbackLabel) feedbackLabel.textContent = '¡Haz clic en una estrella para calificar!';
                }
            });

            star.addEventListener('click', () => {
                this.selectedRating = ratingVal;
                this.renderModalStars(this.selectedRating, false);
                if (feedbackLabel) feedbackLabel.textContent = this.ratingDescriptions[this.selectedRating];
                if (submitBtn) submitBtn.disabled = false;
            });
        });

        if (submitBtn) {
            submitBtn.addEventListener('click', async () => {
                if (!this.selectedRating || !this.currentRatedInstance) return;

                let configClient = await this.db.readData('configClient');
                let auth = await this.db.readData('accounts', configClient?.account_selected);
                let userName = auth?.name || 'Jugador';
                let uuid = auth?.uuid || '';
                let comment = commentInput ? commentInput.value.trim() : '';

                let instanceName = this.currentRatedInstance;
                let current = this.ratingsCache[instanceName] || { average: 5.0, total_votes: 0, user_rating: null };

                let previousUserRating = current.user_rating;
                let newTotalVotes = current.total_votes;
                let newAvg = current.average;

                if (previousUserRating) {
                    let totalSum = (current.average * current.total_votes) - previousUserRating + this.selectedRating;
                    newAvg = parseFloat((totalSum / current.total_votes).toFixed(1));
                } else {
                    newTotalVotes = current.total_votes + 1;
                    let totalSum = (current.average * current.total_votes) + this.selectedRating;
                    newAvg = parseFloat((totalSum / newTotalVotes).toFixed(1));
                }

                this.ratingsCache[instanceName] = {
                    average: newAvg,
                    total_votes: newTotalVotes,
                    user_rating: this.selectedRating
                };

                if (configClient) {
                    configClient.instance_ratings = this.ratingsCache;
                    await this.db.updateData('configClient', configClient);
                }

                config.submitRating(instanceName, userName, this.selectedRating, comment, uuid).catch(() => {});

                closeModal();

                this.updateRatingUI(instanceName);
                this.updateInstancesData();

                let popupSuccess = new popup();
                popupSuccess.openPopup({
                    title: '¡Calificación Enviada! ⭐',
                    content: `Has calificado <b>${instanceName}</b> con <b>${this.selectedRating} estrellas</b>. ¡Gracias por tu opinión!`,
                    color: 'green',
                    options: true
                });
            });
        }
    }

    renderModalStars(ratingVal, isHover = false) {
        const interactiveStars = document.querySelectorAll('.interactive-star');
        interactiveStars.forEach(star => {
            let val = parseInt(star.getAttribute('data-rating'));
            star.classList.remove('hovered', 'selected');
            if (val <= ratingVal) {
                if (isHover) {
                    star.classList.add('hovered');
                } else {
                    star.classList.add('selected');
                }
            }
        });
    }

    setupEventListeners() {
        const instanceBTN = document.querySelector('.play-instance');
        const instancePopup = document.querySelector('.instance-popup');
        const instancesListPopup = document.querySelector('.instances-List');
        const instanceCloseBTN = document.querySelector('.close-popup');

        // Click en el botón JUGAR
        instanceBTN.addEventListener('click', async e => {
            let configClient = await this.db.readData('configClient');
            let instancesList = await config.getInstanceList();
            let auth = await this.db.readData('accounts', configClient?.account_selected);

            if (e.target.classList.contains('instance-select')) {
                instancesListPopup.innerHTML = '';
                for (let instance of instancesList) {
                    if (!instance) continue;
                    let isRatingActive = instance.ratingActive !== false;
                    let ratingBadgeHtml = '';

                    if (isRatingActive) {
                        let rData = this.ratingsCache[instance.name] || { average: 5.0, total_votes: 0 };
                        let ratingScore = (typeof rData.average === 'number' ? rData.average : 5.0).toFixed(1);
                        let ratingVotes = typeof rData.total_votes === 'number' ? rData.total_votes : 0;

                        ratingBadgeHtml = `
                            <div class="instance-rating-pill">
                                <span class="pill-star">★</span>
                                <span class="pill-score">${ratingScore}</span>
                                <span class="pill-votes">(${ratingVotes})</span>
                            </div>
                        `;
                    }

                    let isAllowed = true;
                    if (instance.whitelistActive) {
                        isAllowed = instance.whitelist.some(w => w.toLowerCase() === auth?.name?.toLowerCase());
                    }

                    if (isAllowed) {
                        let rScore = (this.ratingsCache[instance.name]?.average || 5.0).toFixed(1);
                        instancesListPopup.innerHTML += `
                            <div class="tooltip-container">
                                <div id="${instance.name}" class="instance-elements${instance.name === configClient.instance_selct ? ' active-instance' : ''}">
                                    <span class="instance-element-name">${instance.name}</span>
                                    ${ratingBadgeHtml}
                                </div>
                                <span class="tooltip-text">Seleccionar ${instance.name}${isRatingActive ? ` (★ ${rScore})` : ''}</span>
                            </div>`;
                    }
                }

                instancePopup.style.display = 'flex';
            } else {
                if (!configClient?.instance_selct) {
                    instanceBTN.classList.remove('shake-no-instance');
                    void instanceBTN.offsetWidth;
                    instanceBTN.classList.add('shake-no-instance');
                    setTimeout(() => instanceBTN.classList.remove('shake-no-instance'), 450);
                    return;
                }
                this.startGame();
            }
        });

        // Click en el popup de instancias
        instancePopup.addEventListener('click', async e => {
            let target = e.target.closest('.instance-elements');
            if (target) {
                let configClient = await this.db.readData('configClient');
                let newInstanceSelect = target.id;
                let activeInstanceSelect = document.querySelector('.active-instance');

                if (activeInstanceSelect) activeInstanceSelect.classList.remove('active-instance');
                target.classList.add('active-instance');

                configClient.instance_selct = newInstanceSelect;
                await this.db.updateData('configClient', configClient);
                instancePopup.style.display = 'none';
                
                let instance = await config.getInstanceList();
                let options = instance.find(i => i.name == configClient.instance_selct);
                if (options) {
                    await setStatus(options.status, options.name);
                }
                await setInstanceBackground(newInstanceSelect);
                await this.updateRatingUI(newInstanceSelect);
                await this.updatePlayButtonState(newInstanceSelect);
            }
        });

        // Botón cerrar popup
        instanceCloseBTN.addEventListener('click', () => instancePopup.style.display = 'none');
    }

    async updateInstancesData() {
        let configClient = await this.db.readData('configClient');
        let auth = await this.db.readData('accounts', configClient?.account_selected);
        let instancesList = await config.getInstanceList();
        let instanceSelect = instancesList.find(i => i.name == configClient?.instance_selct) ? configClient?.instance_selct : null;

        let instanceBTN = document.querySelector('.play-instance');
        let instancesVisibleList = document.querySelector('.instances-visible-list');

        if (instancesList.length === 1 && document.querySelector('.instance-select')) {
            document.querySelector('.instance-select').style.display = 'none';
            instanceBTN.style.paddingRight = '0';
        }

        // Si la instancia seleccionada ya no existe o no tiene acceso por whitelist, deseleccionar
        if (instanceSelect) {
            let currentInst = instancesList.find(i => i.name === instanceSelect);
            if (currentInst && currentInst.whitelistActive) {
                let isAllowed = currentInst.whitelist?.some(w => w.toLowerCase() === auth?.name?.toLowerCase());
                if (!isAllowed) {
                    configClient.instance_selct = null;
                    await this.db.updateData('configClient', configClient);
                    instanceSelect = null;
                }
            }
        }

        // Actualizar fondo y clasificación de la instancia activa solo si hay una seleccionada
        if (instanceSelect) {
            await setInstanceBackground(instanceSelect);
            await this.updateRatingUI(instanceSelect);
        } else {
            await this.updateRatingUI(null);
        }

        // Sidebar instancias visibles con iconos
        instancesVisibleList.innerHTML = '';

        for (let instance of instancesList) {
            if (!instance) continue;
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(w => w.toLowerCase() === auth?.name?.toLowerCase());
                if (!whitelist) continue;
            }

            if (instanceSelect && instance.name == instanceSelect) {
                setStatus(instance.status, instance.name);
                await setInstanceBackground(instance.name);
                await this.updateRatingUI(instance.name);
            }

            let isRatingActive = instance.ratingActive !== false;
            let rData = this.ratingsCache[instance.name] || { average: 5.0, total_votes: 0 };
            let ratingScore = (typeof rData.average === 'number' ? rData.average : 5.0).toFixed(1);

            let instanceDiv = document.createElement('div');
            instanceDiv.id = instance.name;
            instanceDiv.className = `instance-main-item${instance.name === instanceSelect ? ' active-instance' : ''}`;
            instanceDiv.title = isRatingActive ? `${instance.name} (★ ${ratingScore})` : instance.name;

            // Crear imagen con fallback
            let img = document.createElement('img');
            let serverUrl = pkg.user ? `${pkg.url}/${pkg.user}` : pkg.url;
            img.src = `${serverUrl}/files/logoins/${encodeURIComponent(instance.name)}.png`;
            img.alt = instance.name;
            img.className = 'instance-icon';
            img.onerror = () => {
                img.onerror = null;
                img.src = './assets/images/icon.png';
            };

            // Etiqueta flotante con nombre
            let badge = document.createElement('span');
            badge.className = 'instance-active-badge';
            badge.textContent = instance.name;

            // Insertar elementos dentro del div
            instanceDiv.appendChild(img);
            instanceDiv.appendChild(badge);

            instanceDiv.addEventListener('click', async () => {
                let configClient = await this.db.readData('configClient');
                configClient.instance_selct = instance.name;
                await this.db.updateData('configClient', configClient);

                document.querySelectorAll('.instance-main-item').forEach(el => el.classList.remove('active-instance'));
                instanceDiv.classList.add('active-instance');

                this.updateMagicIndicator(instanceDiv);

                setStatus(instance.status, instance.name);
                await setInstanceBackground(instance.name);
                await this.updateRatingUI(instance.name);
                await this.updatePlayButtonState(instance.name);
            });

            instancesVisibleList.appendChild(instanceDiv);
        }

        // Posicionar el indicador dinámico mágico sobre la instancia activa y actualizar estado del botón JUGAR/DESCARGAR
        setTimeout(async () => {
            this.updateMagicIndicator();
            await this.updatePlayButtonState(instanceSelect);
        }, 60);
    }

    async isInstanceInstalled(instanceName) {
        try {
            if (!instanceName) return false;
            let appDataPath = await appdata();
            let dataDir = this.config.dataDirectory || 'mdklauncher/launcher/data';
            let folderName = process.platform === 'darwin' ? dataDir : `.${dataDir}`;
            let localInstancePath = path.join(appDataPath, folderName, 'instances', instanceName);

            if (!fs.existsSync(localInstancePath)) return false;

            let files = fs.readdirSync(localInstancePath);
            return files && files.length > 0;
        } catch (e) {
            return false;
        }
    }

    async updatePlayButtonState(instanceName) {
        const playBtn = document.querySelector('.play-btn');
        const playInstance = document.querySelector('.play-instance');
        if (!playBtn || !playInstance) return;

        if (!instanceName) {
            let configClient = await this.db.readData('configClient');
            instanceName = configClient?.instance_selct;
        }

        if (!instanceName) {
            playBtn.innerHTML = 'Seleccione Instancia';
            playInstance.classList.remove('is-download');
            playInstance.classList.add('no-instance');
            playInstance.setAttribute('data-tooltip', 'Selecciona una instancia en la lista lateral');
            return;
        }

        const isInstalled = await this.isInstanceInstalled(instanceName);

        playInstance.classList.remove('no-instance');
        if (isInstalled) {
            playBtn.innerHTML = 'JUGAR';
            playInstance.classList.remove('is-download');
            playInstance.setAttribute('data-tooltip', 'Juega en tu servidor favorito');
        } else {
            playBtn.innerHTML = `<span class="btn-download-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></span> DESCARGAR`;
            playInstance.classList.add('is-download');
            playInstance.setAttribute('data-tooltip', 'Descargar e instalar esta instancia');
        }
    }

    updateMagicIndicator(targetEl) {
        const magicIndicator = document.getElementById('magic-indicator');
        const navbar = document.querySelector('.dynamic-glass-navbar');
        if (!magicIndicator || !navbar) return;

        if (!targetEl) {
            targetEl = document.querySelector('.instance-main-item.active-instance');
        }

        if (targetEl) {
            const navbarRect = navbar.getBoundingClientRect();
            const targetRect = targetEl.getBoundingClientRect();
            const targetY = targetRect.top - navbarRect.top + (targetRect.height / 2) - 26;

            magicIndicator.style.transform = `translateY(${targetY}px)`;
            magicIndicator.style.opacity = '1';
        } else {
            magicIndicator.style.opacity = '0';
        }
    }

    async startGame() {
        let launch = new Launch()
        let configClient = await this.db.readData('configClient')
        
        // Validar que configClient existe y tiene valores por defecto
        if (!configClient) {
            let popupError = new popup();
            popupError.openPopup({
                title: 'Error',
                content: 'No se pudo leer la configuración del juego. Recarga la aplicación.',
                options: true,
                color: 'red'
            });
            return;
        }

        if (!configClient.instance_selct) {
            let playInstanceBTN = document.querySelector('.play-instance');
            if (playInstanceBTN) {
                playInstanceBTN.classList.remove('shake-no-instance');
                void playInstanceBTN.offsetWidth;
                playInstanceBTN.classList.add('shake-no-instance');
                setTimeout(() => playInstanceBTN.classList.remove('shake-no-instance'), 450);
            }
            return;
        }
        
        // Asegurar que las propiedades anidadas existen
        configClient.launcher_config = configClient.launcher_config || {};
        configClient.java_config = configClient.java_config || {};
        configClient.game_config = configClient.game_config || {};
        configClient.java_config.java_memory = configClient.java_config.java_memory || { min: 1, max: 2 };
        configClient.game_config.screen_size = configClient.game_config.screen_size || { width: 1920, height: 1080 };
        
        let instance = await config.getInstanceList()
        let authenticator = await this.db.readData('accounts', configClient.account_selected)
        
        // Asegurar que el authenticator tiene todas las propiedades necesarias
        if (authenticator) {
            // Asegurar propiedades básicas
            authenticator.user_properties = authenticator.user_properties || '{}';
            authenticator.properties = authenticator.properties || [];
            
            // Si no tiene accessToken, generar uno con el UUID
            if (!authenticator.access_token && !authenticator.accessToken) {
                authenticator.access_token = authenticator.access_token || 'offline_' + authenticator.uuid;
            }
        }
        
        let options = instance.find(i => i.name == configClient.instance_selct)
        if (!options) {
            let playInstanceBTN = document.querySelector('.play-instance');
            if (playInstanceBTN) {
                playInstanceBTN.classList.remove('shake-no-instance');
                void playInstanceBTN.offsetWidth;
                playInstanceBTN.classList.add('shake-no-instance');
                setTimeout(() => playInstanceBTN.classList.remove('shake-no-instance'), 450);
            }
            return;
        }

        this.setSidebarActionsBlocked(true);

        let playInstanceBTN = document.querySelector('.play-instance')
        let infoStartingBOX = document.querySelector('.info-starting-game')
        let infoStarting = document.querySelector(".info-starting-game-text")
        let progressBar = document.querySelector('.progress-bar')

        playInstanceBTN.style.display = "none"
        infoStartingBOX.style.display = "block"
        progressBar.style.display = "";
        infoStarting.innerHTML = `Sincronizando archivos con el servidor...`
        ipcRenderer.send('main-window-progress-load')

        let appDataPath = await appdata();
        let dataDir = this.config.dataDirectory || 'mdklauncher/launcher/data';
        let folderName = process.platform === 'darwin' ? dataDir : `.${dataDir}`;
        let localInstancePath = path.join(appDataPath, folderName, 'instances', options.name);

        let launchUrl = options.url;
        if (typeof launchUrl === 'string') {
            launchUrl = launchUrl.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i, 'https://servicio.mdkgameteam.xyz');
            launchUrl = launchUrl.replace(/^http:\/\/servicio\./i, 'https://servicio.');
        }

        // Limpieza automática y migración inteligente in-place de mods (Opción 2: SHA-256)
        await this.cleanObsoleteInstanceFiles(localInstancePath, launchUrl, options.ignored, !!options.encrypt_mods);

        // Enrutamiento inteligente Dual Stack (IPv6 Directa vs IPv4 Playit.gg)
        try {
            await applyDualStackRouting(localInstancePath, options.network, options.name);
        } catch (err) {
            console.warn('[DualStack] Aviso al aplicar enrutamiento previo al lanzamiento:', err.message || err);
        }

        applyMjcHashPatch();

        let opt = {
            url: launchUrl,
            authenticator: authenticator,
            timeout: 300000,
            path: `${appDataPath}/${process.platform == 'darwin' ? dataDir : `.${dataDir}`}`,
            instance: options.name,
            version: options.loadder.minecraft_version,
            detached: configClient.launcher_config.closeLauncher == "close-all" ? false : true,
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,

            loader: {
                type: options.loadder.loadder_type,
                build: options.loadder.loadder_version,
                enable: (options.loadder.loadder_type == 'none' || options.loadder.loadder_type == 'vanilla') ? false : true
            },

            // verify es manejado por cleanObsoleteInstanceFiles de forma segura sin borrar versiones locales
            verify: false,

            ignored: [...options.ignored],

            javaPath: configClient.java_config.java_path,

            screen: {
                width: configClient.game_config.screen_size.width,
                height: configClient.game_config.screen_size.height
            },

            fullscreen: false,

            memory: {
                min: `${configClient.java_config.java_memory.min * 1024}M`,
                max: `${configClient.java_config.java_memory.max * 1024}M`
            }
        }

        launch.Launch(opt);

        console.log('Configuración de lanzamiento:', {
            instance: options.name,
            version: options.loadder.minecraft_version,
            allowOfflineMode: true,
            accountType: authenticator?.meta?.type,
            isPremium: !(authenticator?.meta?.type === 'Mojang' && authenticator?.meta?.online === false)
        });

        launch.on('extract', extract => {
            ipcRenderer.send('main-window-progress-load')
            console.log(extract);
        });

        let currentSpeed = '';
        launch.on('speed', (speed) => {
            if (speed > 0) {
                let mbps = (speed / 1048576).toFixed(1);
                currentSpeed = `${mbps} MB/s`;
            }
        });

        let lastProgressTime = 0;
        launch.on('progress', (progress, size) => {
            let now = Date.now();
            if (now - lastProgressTime > 75 || progress >= size) {
                lastProgressTime = now;
                let percent = ((progress / size) * 100).toFixed(0);
                let currentMB = (progress / 1048576).toFixed(1);
                let totalMB = (size / 1048576).toFixed(1);
                let speedText = currentSpeed ? ` · ${currentSpeed}` : '';
                infoStarting.innerHTML = `Descargando archivos.. ${percent}% (${currentMB} / ${totalMB} MB${speedText})`;
                ipcRenderer.send('main-window-progress', { progress, size });
                progressBar.value = progress;
                progressBar.max = size;
            }
        });

        let lastCheckTime = 0;
        launch.on('check', (progress, size) => {
            let now = Date.now();
            if (now - lastCheckTime > 75 || progress >= size) {
                lastCheckTime = now;
                let percent = ((progress / size) * 100).toFixed(0);
                infoStarting.innerHTML = `Verificando archivos.. ${percent}%`;
                ipcRenderer.send('main-window-progress', { progress, size });
                progressBar.value = progress;
                progressBar.max = size;
            }
        });

        launch.on('estimated', (time) => {
            let hours = Math.floor(time / 3600);
            let minutes = Math.floor((time - hours * 3600) / 60);
            let seconds = Math.floor(time - hours * 3600 - minutes * 60);
            console.log(`${hours}h ${minutes}m ${seconds}s`);
        })

        launch.on('speed', (speed) => {
            console.log(`${(speed / 1067008).toFixed(2)} Mb/s`)
        })

        launch.on('patch', async patch => {
            console.log(patch);
            ipcRenderer.send('main-window-progress-load')
            infoStarting.innerHTML = `Abriendo el juego...`

            // Re-aplicar Dual Stack por si servers.dat o FancyMenu fueron sincronizados/descargados
            try {
                await applyDualStackRouting(localInstancePath, options.network, options.name);
            } catch (err) {
                console.warn('[DualStack] Aviso al re-aplicar enrutamiento en evento patch:', err.message || err);
            }
        });

        let activeErrorPopup = null;
        let gameRunningNow = false;

        launch.on('data', (e) => {
            gameRunningNow = true;
            progressBar.style.display = "none";
            
            // Si el juego arrancó con éxito, cerrar inmediatamente cualquier popup de error no fatal
            if (activeErrorPopup) {
                try { activeErrorPopup.closePopup(); } catch (_) {}
                activeErrorPopup = null;
            }
            
            // Asegurar que launcher_config existe con valor por defecto
            const closeLauncher = configClient.launcher_config?.closeLauncher || 'close-launcher';
            console.log('closeLauncher config:', closeLauncher);
            
            if (closeLauncher === 'close-launcher') {
                console.log('Ocultando launcher...');
                ipcRenderer.send("main-window-hide");
                ipcRenderer.send('delete-status-discord');
            } else {
                console.log('Launcher se mantiene visible');
            }
            new logger('Minecraft - MDK Client', '#36b030');
            ipcRenderer.send('main-window-progress-load')
            infoStarting.innerHTML = `Jugando...`
            console.log(e);

        });

        launch.on('close', code => {
            console.log('Minecraft cerrado, mostrando launcher...');
            gameRunningNow = false;

            // Al cerrar el juego, limpiar cualquier popup de error zombi anterior
            if (activeErrorPopup) {
                try { activeErrorPopup.closePopup(); } catch (_) {}
                activeErrorPopup = null;
            }

            const closeLauncher = configClient.launcher_config?.closeLauncher || 'close-launcher';
            
            if (closeLauncher === 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            this.setSidebarActionsBlocked(false);
            this.updatePlayButtonState(options.name);
            infoStarting.innerHTML = `Volviendo al juego..`
            new logger(pkg.name, '#7289da');
            console.log('Close');
            
            ipcRenderer.send('delete-and-new-status-discord')

        });

        launch.on('error', err => {
            let errorMsg = typeof err === 'string' ? err : (err?.error || err?.message || JSON.stringify(err));

            // Si el juego ya está arrancando o corriendo, ignorar avisos de abort no fatales
            if (gameRunningNow && (errorMsg.includes('abort') || errorMsg.includes('AbortError'))) {
                console.warn('[Launch] Aviso de timeout no fatal ignorado (el juego ya está en ejecución):', errorMsg);
                return;
            }

            if (!activeErrorPopup) {
                activeErrorPopup = new popup();
            }

            activeErrorPopup.openPopup({
                title: 'Ha ocurrido un error',
                content: errorMsg,
                color: 'red',
                options: true
            });

            const closeLauncher = configClient.launcher_config?.closeLauncher || 'close-launcher';
            if (closeLauncher === 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            this.setSidebarActionsBlocked(false);
            this.updatePlayButtonState(options.name);
            infoStarting.innerHTML = `Vérification`
            new logger(pkg.name, '#7289da');
            console.log(err);
        });
    }

    async cleanObsoleteInstanceFiles(instancePath, serverUrl, ignoredList = [], encryptMods = false) {
        if (!fs.existsSync(instancePath)) return;
        if (!serverUrl) return;

        if (typeof serverUrl === 'string') {
            serverUrl = serverUrl.replace(/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?/i, 'https://servicio.mdkgameteam.xyz');
            serverUrl = serverUrl.replace(/^http:\/\/servicio\./i, 'https://servicio.');
        }

        try {
            console.log(`[CleanSync] Sincronizando y verificando archivos obsoletos para: ${instancePath}`);
            let fetchFn;
            try {
                fetchFn = require('node-fetch');
            } catch (e) {
                fetchFn = typeof fetch !== 'undefined' ? fetch : null;
            }
            if (!fetchFn) return;
            const response = await fetchFn(serverUrl, { timeout: 30000 });
            if (!response.ok) {
                console.warn(`[CleanSync] No se pudo obtener la lista de archivos del servidor (HTTP ${response.status}). Se omite la limpieza.`);
                return;
            }

            const serverData = await response.json();
            if (!Array.isArray(serverData)) {
                console.warn('[CleanSync] Respuesta del servidor no válida para la instancia. Se omite la limpieza.');
                return;
            }

            // Conjunto de archivos válidos en el servidor (normalizados a minúsculas y /)
            const serverFilesSet = new Set(
                serverData
                    .filter(item => item && item.path)
                    .map(item => item.path.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase())
            );

            // Mapeo de mods del servidor indexados por su hash SHA-256 para migración in-place
            const serverModsByHash = new Map();
            for (const item of serverData) {
                if (!item || !item.path || !item.hash) continue;
                const normPath = item.path.replace(/\\/g, '/').replace(/^\/+/, '');
                if (normPath.toLowerCase().startsWith('mods/') && normPath.toLowerCase().endsWith('.jar')) {
                    serverModsByHash.set(item.hash.toLowerCase(), item);
                }
            }

            // Migración inteligente in-place de la carpeta mods/ (Opción 2: SHA-256)
            // Renombra mods locales si coinciden con el SHA-256 del servidor (0 redescargas),
            // y elimina mods locales viejos, corruptos o no autorizados.
            const modsDir = path.join(instancePath, 'mods');
            if (fs.existsSync(modsDir)) {
                console.log(`[CleanSync] Sincronizando mods locales in-place con hashes SHA-256...`);
                const scanJars = (dir) => {
                    let jars = [];
                    try {
                        const list = fs.readdirSync(dir, { withFileTypes: true });
                        for (const entry of list) {
                            const full = path.join(dir, entry.name);
                            if (entry.isDirectory()) {
                                jars.push(...scanJars(full));
                            } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jar')) {
                                jars.push(full);
                            }
                        }
                    } catch (e) {
                        console.warn(`[CleanSync] Error al listar archivos en ${dir}:`, e.message || e);
                    }
                    return jars;
                };

                const localJars = scanJars(modsDir);
                for (const jarPath of localJars) {
                    let localHash = null;
                    try {
                        localHash = await computeFileHash(jarPath, 'sha256');
                    } catch (err) {
                        console.warn(`[CleanSync] Error calculando SHA-256 para ${jarPath}:`, err.message || err);
                        continue;
                    }

                    const matchedServerMod = serverModsByHash.get(localHash.toLowerCase());
                    if (matchedServerMod) {
                        // Mod válido reconocido por el servidor
                        const targetRelPath = matchedServerMod.path.replace(/\\/g, '/').replace(/^\/+/, '');
                        const targetFullPath = path.join(instancePath, targetRelPath);

                        if (path.resolve(jarPath) !== path.resolve(targetFullPath)) {
                            try {
                                const targetFolder = path.dirname(targetFullPath);
                                if (!fs.existsSync(targetFolder)) {
                                    fs.mkdirSync(targetFolder, { recursive: true });
                                }

                                if (fs.existsSync(targetFullPath)) {
                                    // Ya existe el archivo objetivo con el mismo hash; remover el redundante
                                    fs.unlinkSync(jarPath);
                                    console.log(`[CleanSync] 🔄 Mod duplicado eliminado (ya existe migrado): ${path.basename(jarPath)}`);
                                } else {
                                    fs.renameSync(jarPath, targetFullPath);
                                    console.log(`[CleanSync] 🔄 Mod migrado in-place (0 redescarga): ${path.basename(jarPath)} -> ${path.basename(targetFullPath)}`);
                                }
                            } catch (renameErr) {
                                console.warn(`[CleanSync] Error al migrar mod in-place ${path.basename(jarPath)}:`, renameErr.message || renameErr);
                            }
                        }
                    } else {
                        // Mod local desconocido, modificado o no autorizado: eliminarlo
                        try {
                            fs.unlinkSync(jarPath);
                            console.log(`[CleanSync] 🗑️ Mod no autorizado o sobrante eliminado: ${path.basename(jarPath)}`);
                        } catch (unlinkErr) {
                            console.warn(`[CleanSync] Error al eliminar mod no autorizado ${path.basename(jarPath)}:`, unlinkErr.message || unlinkErr);
                        }
                    }
                }
            }

            // Lista de carpetas y archivos locales que NUNCA deben borrarse (archivos del usuario del juego)
            const defaultProtected = [
                'saves',
                'screenshots',
                'logs',
                'crash-reports',
                'options.txt',
                'optionsof.txt',
                'servers.dat',
                'usercache.json',
                'usernamecache.json',
                'command_history.txt',
                'hotbar.nbt',
                'realms_persistence.json',
                'natives',
                '.fabric',
                '.mixin.out'
            ];

            const allIgnored = [...(ignoredList || []), ...defaultProtected];

            const isIgnored = (relPath) => {
                const norm = relPath.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
                const parts = norm.split('/');

                for (let item of allIgnored) {
                    if (!item) continue;
                    let ignoredNorm = item.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').toLowerCase();
                    
                    // Coincidencia exacta
                    if (norm === ignoredNorm) return true;
                    // Coincidencia de prefijo de carpeta (ej: saves/world1/level.dat)
                    if (norm.startsWith(ignoredNorm + '/')) return true;
                    // Coincidencia de cualquier segmento
                    if (parts.includes(ignoredNorm)) return true;
                }
                return false;
            };

            // Escaneo recursivo de archivos locales en la instancia
            const scanDirectory = (dir) => {
                let results = [];
                try {
                    const list = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of list) {
                        const fullPath = path.join(dir, entry.name);
                        const relPath = path.relative(instancePath, fullPath).replace(/\\/g, '/');

                        if (isIgnored(relPath)) {
                            // Ignorar esta carpeta o archivo
                            continue;
                        }

                        if (entry.isDirectory()) {
                            results.push(...scanDirectory(fullPath));
                        } else if (entry.isFile()) {
                            results.push({ fullPath, relPath });
                        }
                    }
                } catch (e) {
                    console.warn(`[CleanSync] Error al escanear directorio ${dir}:`, e.message || e);
                }
                return results;
            };

            // Identificar qué carpetas y subcarpetas están gestionadas activamente por el servidor
            const serverManagedFolders = new Set();
            for (let serverFile of serverFilesSet) {
                let parts = serverFile.split('/');
                if (parts.length > 1) {
                    // Carpeta de primer nivel (ej: "mods", "resourcepacks", "shaderpacks", "config")
                    serverManagedFolders.add(parts[0]);
                    // Si está dentro de config/, registrar la subcarpeta (ej: "config/animatedframes", "config/fancymenu", "config/paxi")
                    if (parts[0] === 'config' && parts.length > 2) {
                        serverManagedFolders.add(`config/${parts[1]}`);
                    }
                }
            }

            // Función para determinar si un archivo local debe ser validado contra el servidor
            const shouldCheckObsolete = (normRel) => {
                let parts = normRel.split('/');
                let topFolder = parts[0];
                
                // 1. mods/ siempre se sincroniza estrictamente (elimina mods obsoletos, viejos o no autorizados)
                if (topFolder === 'mods') return true;

                // 2. resourcepacks/ y shaderpacks/ se sincronizan si existen en el servidor
                if (topFolder === 'resourcepacks' || topFolder === 'shaderpacks') {
                    return serverManagedFolders.has(topFolder);
                }

                // 3. En config/, SOLO sincronizar subcarpetas gestionadas por el servidor (ej: config/animatedframes, config/fancymenu)
                // Esto protege las configuraciones locales de los mods (sodium, voicechat, keybinds, iris, etc.)
                if (topFolder === 'config') {
                    if (parts.length > 2) {
                        let subFolder = `config/${parts[1]}`;
                        return serverManagedFolders.has(subFolder);
                    }
                    // Configs sueltos generados por mods en la raíz de config/ se preservan
                    return false;
                }

                // Otras carpetas personalizadas del servidor
                return serverManagedFolders.has(topFolder);
            };

            const localFiles = scanDirectory(instancePath);
            let deletedCount = 0;

            for (const file of localFiles) {
                const normRel = file.relPath.toLowerCase();
                // Preservar respaldos originales de red (servers.dat.original y FancyMenu *.txt.original)
                if (normRel.endsWith('.original')) continue;

                if (shouldCheckObsolete(normRel) && !serverFilesSet.has(normRel)) {
                    try {
                        fs.unlinkSync(file.fullPath);
                        console.log(`[CleanSync] 🗑️ Archivo obsoleto eliminado: ${file.relPath}`);
                        deletedCount++;
                    } catch (e) {
                        console.warn(`[CleanSync] Error al eliminar archivo obsoleto ${file.relPath}:`, e.message || e);
                    }
                }
            }

            // Eliminar carpetas vacías sobrantes (bottom-up)
            const removeEmptyDirs = (dir) => {
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory()) {
                            const fullSub = path.join(dir, entry.name);
                            const relSub = path.relative(instancePath, fullSub).replace(/\\/g, '/');
                            if (!isIgnored(relSub) && shouldCheckObsolete(relSub.toLowerCase())) {
                                removeEmptyDirs(fullSub);
                            }
                        }
                    }
                    if (dir !== instancePath) {
                        const remaining = fs.readdirSync(dir);
                        const relDir = path.relative(instancePath, dir).replace(/\\/g, '/').toLowerCase();
                        if (remaining.length === 0 && shouldCheckObsolete(relDir)) {
                            fs.rmdirSync(dir);
                            console.log(`[CleanSync] 📁 Carpeta vacía eliminada: ${path.relative(instancePath, dir)}`);
                        }
                    }
                } catch (e) {
                    // Ignorar errores al limpiar carpetas vacías
                }
            };

            removeEmptyDirs(instancePath);

            if (deletedCount > 0) {
                console.log(`[CleanSync] ✅ Sincronización limpia completada: ${deletedCount} archivo(s) obsoleto(s) eliminado(s).`);
            } else {
                console.log(`[CleanSync] ✅ Todos los archivos locales están sincronizados con el servidor.`);
            }
        } catch (err) {
            console.error('[CleanSync] Error durante la sincronización limpia de la instancia:', err);
        }
    }

    getdate(e) {
        let date = new Date(e)
        let year = date.getFullYear()
        let month = date.getMonth() + 1
        let day = date.getDate()
        let allMonth = ['n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n', 'n']
        return { year: year, month: allMonth[month - 1], day: day }
    }

    initTooltips() {
        // Los tooltips se inicializan automáticamente con CSS desde los atributos data-tooltip
        // No se necesita código JavaScript adicional, los estilos CSS manejan todo
    }
}
export default Home;
