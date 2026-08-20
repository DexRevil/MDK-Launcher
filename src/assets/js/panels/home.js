/**
 * @author ElFo2Ks
 */
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup, setInstanceBackground } from '../utils.js'

const { Launch } = require('minecraft-java-core')
const { shell, ipcRenderer } = require('electron')

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

        // Llamadas iniciales
        this.setupEventListeners();
        this.setupRatingListeners();
        await this.loadRatingsData();
        this.updateInstancesData();
        this.IniciarEstadoDiscord();
        this.initTooltips();

        // 🔁 Actualización automática cada 30s
        setInterval(() => {
            this.updateInstancesData();
        }, 30000); // 30,000 ms = 30 segundos
    }

    async IniciarEstadoDiscord() {
        ipcRenderer.send('new-status-discord');
        document.querySelector('.settings-btn').addEventListener('click', e => changePanel('settings'))
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

        if (!instanceSelect) {
            let newInstanceSelect = instancesList.find(i => i.whitelistActive == false);
            if (newInstanceSelect) {
                let configClient = await this.db.readData('configClient');
                configClient.instance_selct = newInstanceSelect.name;
                instanceSelect = newInstanceSelect.name;
                await this.db.updateData('configClient', configClient);
            } else {
                instanceSelect = null;
            }
        }

        // Actualizar fondo y clasificación de la instancia activa
        if (instanceSelect) {
            await setInstanceBackground(instanceSelect);
            await this.updateRatingUI(instanceSelect);
        }

        // Sidebar instancias visibles con iconos
        instancesVisibleList.innerHTML = '';

        for (let instance of instancesList) {
            if (!instance) continue;
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(w => w.toLowerCase() === auth?.name?.toLowerCase());
                if (!whitelist) continue;

                if (instance.name == instanceSelect) {
                    let newInstanceSelect = instancesList.find(i => i.whitelistActive == false);
                    if (newInstanceSelect) {
                        let configClient = await this.db.readData('configClient');
                        configClient.instance_selct = newInstanceSelect.name;
                        instanceSelect = newInstanceSelect.name;
                        await this.db.updateData('configClient', configClient);
                        setStatus(newInstanceSelect.status, newInstanceSelect.name);
                        await setInstanceBackground(newInstanceSelect.name);
                        await this.updateRatingUI(newInstanceSelect.name);
                    }
                }
            } else {
                if (instance.name == instanceSelect) {
                    setStatus(instance.status, instance.name);
                    await setInstanceBackground(instance.name);
                    await this.updateRatingUI(instance.name);
                }
            }

            let isRatingActive = instance.ratingActive !== false;
            let rData = this.ratingsCache[instance.name] || { average: 5.0, total_votes: 0 };
            let ratingScore = (typeof rData.average === 'number' ? rData.average : 5.0).toFixed(1);

            let instanceDiv = document.createElement('div');
            instanceDiv.id = instance.name;
            instanceDiv.className = `instance-main-item${instance.name === instanceSelect ? ' active-instance' : ''}`;
            instanceDiv.title = isRatingActive ? `${instance.name} (★ ${ratingScore})` : instance.name;

            // Crear imagen
            let img = document.createElement('img');
            img.src = `http://147.185.221.30:13602/files/logoins/${instance.name}.png`;
            img.alt = instance.name;
            img.className = 'instance-icon';

            // Insertar imagen dentro del div
            instanceDiv.appendChild(img);

            instanceDiv.addEventListener('click', async () => {
                let configClient = await this.db.readData('configClient');
                configClient.instance_selct = instance.name;
                await this.db.updateData('configClient', configClient);

                document.querySelectorAll('.instance-main-item').forEach(el => el.classList.remove('active-instance'));
                instanceDiv.classList.add('active-instance');

                setStatus(instance.status, instance.name);
                await setInstanceBackground(instance.name);
                await this.updateRatingUI(instance.name);
            });

            instancesVisibleList.appendChild(instanceDiv);
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

        let playInstanceBTN = document.querySelector('.play-instance')
        let infoStartingBOX = document.querySelector('.info-starting-game')
        let infoStarting = document.querySelector(".info-starting-game-text")
        let progressBar = document.querySelector('.progress-bar')

        let opt = {
            url: options.url,
            authenticator: authenticator,
            timeout: 10000,
            path: `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}`,
            instance: options.name,
            version: options.loadder.minecraft_version,
            detached: configClient.launcher_config.closeLauncher == "close-all" ? false : true,
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,

            loader: {
                type: options.loadder.loadder_type,
                build: options.loadder.loadder_version,
                enable: options.loadder.loadder_type == 'none' ? false : true
            },

            verify: options.verify,

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

        playInstanceBTN.style.display = "none"
        infoStartingBOX.style.display = "block"
        progressBar.style.display = "";
        ipcRenderer.send('main-window-progress-load')

        launch.on('extract', extract => {
            ipcRenderer.send('main-window-progress-load')
            console.log(extract);
        });

        launch.on('progress', (progress, size) => {
            infoStarting.innerHTML = `Descargando assets.. | ${((progress / size) * 100).toFixed(0)}%`
            ipcRenderer.send('main-window-progress', { progress, size })
            progressBar.value = progress;
            progressBar.max = size;
        });

        launch.on('check', (progress, size) => {
            infoStarting.innerHTML = `Verificando Archivos.. | ${((progress / size) * 100).toFixed(0)}%`
            ipcRenderer.send('main-window-progress', { progress, size })
            progressBar.value = progress;
            progressBar.max = size;
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

        launch.on('patch', patch => {
            console.log(patch);
            ipcRenderer.send('main-window-progress-load')
            infoStarting.innerHTML = `Abriendo el juego...`
        });

        launch.on('data', (e) => {
            progressBar.style.display = "none"
            
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
            const closeLauncher = configClient.launcher_config?.closeLauncher || 'close-launcher';
            
            if (closeLauncher === 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "block"
            infoStarting.innerHTML = `Volviendo al juego..`
            new logger(pkg.name, '#7289da');
            console.log('Close');
            
            ipcRenderer.send('delete-and-new-status-discord')

        });

        launch.on('error', err => {
            let popupError = new popup()

            popupError.openPopup({
                title: 'Ha ocurrido un error',
                content: err.error,
                color: 'red',
                options: true
            })

            const closeLauncher = configClient.launcher_config?.closeLauncher || 'close-launcher';
            if (closeLauncher === 'close-launcher') {
                ipcRenderer.send("main-window-show")
            };
            ipcRenderer.send('main-window-progress-reset')
            infoStartingBOX.style.display = "none"
            playInstanceBTN.style.display = "flex"
            infoStarting.innerHTML = `Vérification`
            new logger(pkg.name, '#7289da');
            console.log(err);
        });
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