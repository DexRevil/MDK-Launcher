/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground, pkg } from '../utils.js'
const { ipcRenderer, shell } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');

class Settings {
    static id = "settings";
    async init(config) {
        this.config = config;
        this.db = new database();
        this.navBTN()
        this.accounts()
        this.instancesManagement()
        this.ram()
        this.javaPath()
        this.resolution()
        this.launcher()
    }

    navBTN() {
        document.querySelector('.nav-box').addEventListener('click', e => {
            if (e.target.classList.contains('nav-settings-btn')) {
                let id = e.target.id

                let activeSettingsBTN = document.querySelector('.active-settings-BTN')
                let activeContainerSettings = document.querySelector('.active-container-settings')

                if (id == 'save') {
                    if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
                    document.querySelector('#account').classList.add('active-settings-BTN');

                    if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
                    document.querySelector(`#account-tab`).classList.add('active-container-settings');
                    return changePanel('home')
                }

                if (activeSettingsBTN) activeSettingsBTN.classList.toggle('active-settings-BTN');
                e.target.classList.add('active-settings-BTN');

                if (activeContainerSettings) activeContainerSettings.classList.toggle('active-container-settings');
                let targetTab = document.querySelector(`#${id}-tab`);
                if (targetTab) targetTab.classList.add('active-container-settings');

                if (id === 'instances') {
                    this.loadInstancesClientList();
                }
            }
        })
    }

    accounts() {
        document.querySelector('.accounts-list').addEventListener('click', async e => {
            let popupAccount = new popup()
            try {
                let deleteBtn = e.target.closest('.delete-profile');
                let accountBtn = e.target.closest('.account');

                if (deleteBtn) {
                    let id = deleteBtn.id;
                    popupAccount.openPopup({
                        title: 'Cuentas',
                        content: 'Eliminando...',
                        color: 'var(--color)'
                    })
                    await this.db.deleteData('accounts', id);
                    let deleteProfile = document.getElementById(`${id}`);
                    let accountListElement = document.querySelector('.accounts-list');
                    if (deleteProfile) accountListElement.removeChild(deleteProfile);

                    if (accountListElement.children.length == 1) return changePanel('login');

                    let configClient = await this.db.readData('configClient');

                    if (configClient.account_selected == id) {
                        let allAccounts = await this.db.readAllData('accounts');
                        configClient.account_selected = allAccounts[0].ID
                        accountSelect(allAccounts[0]);
                        let newInstanceSelect = await this.setInstance(allAccounts[0]);
                        configClient.instance_selct = newInstanceSelect.instance_selct
                        return await this.db.updateData('configClient', configClient);
                    }
                } else if (accountBtn) {
                    let id = accountBtn.id;
                    popupAccount.openPopup({
                        title: 'Cuentas',
                        content: 'Cargando, porfavor espere...',
                        color: 'var(--color)'
                    })

                    if (id == 'add') {
                        document.querySelector('.cancel-home').style.display = 'inline'
                        return changePanel('login')
                    }

                    let account = await this.db.readData('accounts', id);
                    let configClient = await this.setInstance(account);
                    await accountSelect(account);
                    configClient.account_selected = account.ID;
                    return await this.db.updateData('configClient', configClient);
                }
            } catch (err) {
                console.error(err)
            } finally {
                popupAccount.closePopup();
            }
        })
    }

    async setInstance(auth) {
        let configClient = await this.db.readData('configClient')
        let instanceSelect = configClient.instance_selct
        let instancesList = await config.getInstanceList()

        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist.toLowerCase() === auth.name?.toLowerCase())
                if (!whitelist) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        configClient.instance_selct = newInstanceSelect.name
                        await setStatus(newInstanceSelect.status, newInstanceSelect.name)
                    }
                }
            }
        }
        return configClient
    }

    async ram() {
        let config = await this.db.readData('configClient');
        let totalMem = Math.trunc(os.totalmem() / 1073741824 * 10) / 10;
        let freeMem = Math.trunc(os.freemem() / 1073741824 * 10) / 10;

        document.getElementById("total-ram").textContent = `${totalMem} Go`;
        document.getElementById("free-ram").textContent = `${freeMem} Go`;

        let sliderDiv = document.querySelector(".memory-slider");
        sliderDiv.setAttribute("max", Math.trunc((80 * totalMem) / 100));

        let ram = config?.java_config?.java_memory ? {
            ramMin: config.java_config.java_memory.min,
            ramMax: config.java_config.java_memory.max
        } : { ramMin: "1", ramMax: "2" };

        if (totalMem < ram.ramMin) {
            config.java_config.java_memory = { min: 1, max: 2 };
            this.db.updateData('configClient', config);
            ram = { ramMin: "1", ramMax: "2" }
        };

        let slider = new Slider(".memory-slider", parseFloat(ram.ramMin), parseFloat(ram.ramMax));

        let minSpan = document.querySelector(".slider-touch-left span");
        let maxSpan = document.querySelector(".slider-touch-right span");

        minSpan.setAttribute("value", `${ram.ramMin} Go`);
        maxSpan.setAttribute("value", `${ram.ramMax} Go`);

        slider.on("change", async (min, max) => {
            let config = await this.db.readData('configClient');
            minSpan.setAttribute("value", `${min} Go`);
            maxSpan.setAttribute("value", `${max} Go`);
            config.java_config.java_memory = { min: min, max: max };
            this.db.updateData('configClient', config);
        });
    }

    async javaPath() {
        let javaPathText = document.querySelector(".java-path-txt")
        if (javaPathText) {
            javaPathText.textContent = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/runtime`;
        }

        let configClient = await this.db.readData('configClient')
        let javaPath = configClient?.java_config?.java_path || 'Utiliser la version de java livre avec le launcher';
        let javaPathInputTxt = document.querySelector(".java-path-input-text");
        let javaPathInputFile = document.querySelector(".java-path-input-file");
        let javaPathSetBtn = document.querySelector(".java-path-set");
        let javaPathResetBtn = document.querySelector(".java-path-reset");

        if (!javaPathInputTxt || !javaPathInputFile || !javaPathSetBtn || !javaPathResetBtn) {
            console.warn("Java path elements not found in DOM");
            return;
        }

        javaPathInputTxt.value = javaPath;

        javaPathSetBtn.addEventListener("click", async () => {
            javaPathInputFile.value = '';
            javaPathInputFile.click();
            await new Promise((resolve) => {
                let interval;
                interval = setInterval(() => {
                    if (javaPathInputFile.value != '') resolve(clearInterval(interval));
                }, 100);
            });

            if (javaPathInputFile.value.replace(".exe", '').endsWith("java") || javaPathInputFile.value.replace(".exe", '').endsWith("javaw")) {
                let configClient = await this.db.readData('configClient')
                let file = javaPathInputFile.files[0].path;
                javaPathInputTxt.value = file;
                configClient.java_config.java_path = file
                await this.db.updateData('configClient', configClient);
            } else alert("Le nom du fichier doit être java ou javaw");
        });

        javaPathResetBtn.addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            javaPathInputTxt.value = 'Utiliser la version de java livre avec le launcher';
            configClient.java_config.java_path = null
            await this.db.updateData('configClient', configClient);
        });
    }

    async resolution() {
        let configClient = await this.db.readData('configClient')
        let resolution = configClient?.game_config?.screen_size || { width: 1920, height: 1080 };

        let width = document.querySelector(".width-size");
        let height = document.querySelector(".height-size");
        let resolutionReset = document.querySelector(".size-reset");

        width.value = resolution.width;
        height.value = resolution.height;

        width.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size.width = width.value;
            await this.db.updateData('configClient', configClient);
        })

        height.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size.height = height.value;
            await this.db.updateData('configClient', configClient);
        })

        resolutionReset.addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.game_config.screen_size = { width: '854', height: '480' };
            width.value = '854';
            height.value = '480';
            await this.db.updateData('configClient', configClient);
        })
    }

    async launcher() {
        let configClient = await this.db.readData('configClient');

        let maxDownloadFiles = configClient?.launcher_config?.download_multi || 3;
        let maxDownloadFilesInput = document.querySelector(".max-files");
        let maxDownloadFilesReset = document.querySelector(".max-files-reset");
        maxDownloadFilesInput.value = maxDownloadFiles;

        maxDownloadFilesInput.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.launcher_config.download_multi = parseInt(maxDownloadFilesInput.value) || 3;
            await this.db.updateData('configClient', configClient);
        })

        maxDownloadFilesReset.addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            maxDownloadFilesInput.value = 3
            configClient.launcher_config.download_multi = 3;
            await this.db.updateData('configClient', configClient);
        })

        let themeBox = document.querySelector(".theme-box");
        let theme = configClient?.launcher_config?.theme || "auto";

        if (theme == "auto") {
            document.querySelector('.theme-btn-auto').classList.add('active-theme');
        } else if (theme == "dark") {
            document.querySelector('.theme-btn-sombre').classList.add('active-theme');
        } else if (theme == "light") {
            document.querySelector('.theme-btn-clair').classList.add('active-theme');
        }

        themeBox.addEventListener("click", async e => {
            if (e.target.classList.contains('theme-btn')) {
                let activeTheme = document.querySelector('.active-theme');
                if (e.target.classList.contains('active-theme')) return
                activeTheme?.classList.remove('active-theme');

                if (e.target.classList.contains('theme-btn-auto')) {
                    setBackground();
                    theme = "auto";
                    e.target.classList.add('active-theme');
                } else if (e.target.classList.contains('theme-btn-sombre')) {
                    setBackground(true);
                    theme = "dark";
                    e.target.classList.add('active-theme');
                } else if (e.target.classList.contains('theme-btn-clair')) {
                    setBackground(false);
                    theme = "light";
                    e.target.classList.add('active-theme');
                }

                let configClient = await this.db.readData('configClient')
                configClient.launcher_config.theme = theme;
                await this.db.updateData('configClient', configClient);
            }
        })

        let closeBox = document.querySelector(".close-box");
        if (closeBox) {
            let closeLauncher = configClient?.launcher_config?.closeLauncher || "close-launcher";

            if (closeLauncher == "close-launcher") {
                document.querySelector('.close-launcher')?.classList.add('active-close');
            } else if (closeLauncher == "close-all") {
                document.querySelector('.close-all')?.classList.add('active-close');
            } else if (closeLauncher == "close-none") {
                document.querySelector('.close-none')?.classList.add('active-close');
            }

            closeBox.addEventListener("click", async e => {
                if (e.target.classList.contains('close-btn')) {
                    let activeClose = document.querySelector('.active-close');
                    if (e.target.classList.contains('active-close')) return
                    activeClose?.classList.toggle('active-close');

                    let configClient = await this.db.readData('configClient')

                    if (e.target.classList.contains('close-launcher')) {
                        e.target.classList.toggle('active-close');
                        configClient.launcher_config.closeLauncher = "close-launcher";
                        await this.db.updateData('configClient', configClient);
                    } else if (e.target.classList.contains('close-all')) {
                        e.target.classList.toggle('active-close');
                        configClient.launcher_config.closeLauncher = "close-all";
                        await this.db.updateData('configClient', configClient);
                    } else if (e.target.classList.contains('close-none')) {
                        e.target.classList.toggle('active-close');
                        configClient.launcher_config.closeLauncher = "close-none";
                        await this.db.updateData('configClient', configClient);
                    }
                }
            })
        }
    }

    async instancesManagement() {
        const refreshBtn = document.getElementById('btn-refresh-instances');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadInstancesClientList();
            });
        }

        // Delegación de eventos para la lista de instancias
        const listContainer = document.getElementById('instances-client-list');
        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                let deleteBtn = e.target.closest('.btn-delete-instance-trash');
                if (deleteBtn) {
                    let isInstalled = deleteBtn.getAttribute('data-installed') === 'true';
                    if (!isInstalled || deleteBtn.classList.contains('disabled')) return;
                    let name = deleteBtn.getAttribute('data-instance');
                    let path = deleteBtn.getAttribute('data-path');
                    let size = deleteBtn.getAttribute('data-size');
                    this.promptDeleteInstance(name, path, size);
                }
            });
        }

        // Delegación de eventos para los botones del modal de eliminación
        document.addEventListener('click', (e) => {
            if (e.target && (e.target.id === 'btnCancelDeleteInstance' || e.target.closest('#btnCancelDeleteInstance'))) {
                const modal = document.getElementById('instanceDeleteModal');
                if (modal) modal.style.display = 'none';
                this.instanceToDelete = null;
            } else if (e.target && (e.target.id === 'btnConfirmDeleteInstance' || e.target.closest('#btnConfirmDeleteInstance'))) {
                if (this.instanceToDelete) {
                    this.executeDeleteInstance(this.instanceToDelete);
                }
            }
        });

        await this.loadInstancesClientList();
    }

    async getLocalInstancePath(instanceName) {
        let appDataPath = await appdata();
        let dataDir = this.config?.dataDirectory || pkg?.dataDirectory || 'mdklauncher/launcher/data';
        let folderName = process.platform === 'darwin' ? dataDir : `.${dataDir}`;
        return path.join(appDataPath, folderName, 'instances', instanceName);
    }

    calculateFolderSize(dirPath) {
        if (!fs.existsSync(dirPath)) return 0;
        let totalSize = 0;
        try {
            const files = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const file of files) {
                const filePath = path.join(dirPath, file.name);
                if (file.isDirectory()) {
                    totalSize += this.calculateFolderSize(filePath);
                } else if (file.isFile()) {
                    const stat = fs.statSync(filePath);
                    totalSize += stat.size;
                }
            }
        } catch (e) {
            // Error ignorado
        }
        return totalSize;
    }

    formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    async loadInstancesClientList() {
        const listContainer = document.getElementById('instances-client-list');
        const countSpan = document.getElementById('instances-count-num');
        if (!listContainer) return;

        listContainer.innerHTML = '<div style="text-align:center; padding: 2rem; color: #a1a1aa;">Cargando lista de instancias...</div>';

        let appDataPath = await appdata();
        let dataDir = this.config?.dataDirectory || pkg?.dataDirectory || 'mdklauncher/launcher/data';
        let folderName = process.platform === 'darwin' ? dataDir : `.${dataDir}`;
        let instancesRoot = path.join(appDataPath, folderName, 'instances');

        // 1. Obtener carpetas locales reales en el disco
        let localFolders = [];
        if (fs.existsSync(instancesRoot)) {
            try {
                localFolders = fs.readdirSync(instancesRoot, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name);
            } catch (e) {
                console.warn('Error al leer directorio de instancias:', e);
            }
        }

        // 2. Obtener cuenta actual y lista de instancias del servidor
        let configClient = await this.db.readData('configClient');
        let auth = await this.db.readData('accounts', configClient?.account_selected);

        let serverInstances = [];
        try {
            serverInstances = await config.getInstanceList() || [];
        } catch (e) {
            serverInstances = [];
        }

        let combinedInstances = [];
        let processedNames = new Set();

        // 3. Añadir solo las instancias disponibles en el servidor donde el usuario tenga acceso (Whitelist)
        for (let sInst of serverInstances) {
            if (!sInst) continue;

            // Verificar si tiene whitelist activa y si el usuario está agregado
            if (sInst.whitelistActive) {
                let isAllowed = sInst.whitelist && sInst.whitelist.some(w => w.toLowerCase() === auth?.name?.toLowerCase());
                if (!isAllowed) {
                    // Si el usuario no está en la lista de la instancia, NO aparece
                    continue;
                }
            }

            let instPath = path.join(instancesRoot, sInst.name);
            let isInstalled = fs.existsSync(instPath);
            let size = isInstalled ? this.calculateFolderSize(instPath) : 0;

            combinedInstances.push({
                name: sInst.name,
                isServer: true,
                isInstalled: isInstalled,
                version: sInst.loadder?.minecraft_version || '1.20.1',
                loader: sInst.loadder?.loadder_type || 'vanilla',
                path: instPath,
                size: size,
                formattedSize: isInstalled ? this.formatBytes(size) : ''
            });
            processedNames.add(sInst.name.toLowerCase());
        }

        // 4. Si hay carpetas locales en el disco de instancias antiguas/eliminadas, mostrarlas para poder borrarlas
        for (let folder of localFolders) {
            if (!processedNames.has(folder.toLowerCase())) {
                let serverMatch = serverInstances.find(s => s.name.toLowerCase() === folder.toLowerCase());
                // Si es una instancia de servidor donde el usuario no tiene acceso, no mostrarla si no está instalada
                if (serverMatch && serverMatch.whitelistActive) {
                    let isAllowed = serverMatch.whitelist && serverMatch.whitelist.some(w => w.toLowerCase() === auth?.name?.toLowerCase());
                    if (!isAllowed) continue;
                }

                let instPath = path.join(instancesRoot, folder);
                let size = this.calculateFolderSize(instPath);
                combinedInstances.push({
                    name: folder,
                    isServer: false,
                    isInstalled: true,
                    version: 'Archivos locales',
                    loader: 'Personalizado',
                    path: instPath,
                    size: size,
                    formattedSize: this.formatBytes(size)
                });
            }
        }

        if (countSpan) countSpan.textContent = combinedInstances.length;

        if (combinedInstances.length === 0) {
            listContainer.innerHTML = `
                <div style="text-align:center; padding: 3rem 1.5rem; color: #94a3b8; background: rgba(255,255,255,0.02); border-radius: 14px; border: 1px dashed rgba(255,255,255,0.1);">
                    <div style="font-size: 2.2rem; margin-bottom: 0.6rem;">🛡️</div>
                    <b style="color: #f8fafc; font-size: 1.05rem; display: block;">No tienes instancias disponibles</b>
                    <p style="font-size: 0.85rem; margin-top: 0.4rem; color: #a1a1aa; line-height: 1.4;">
                        No tienes ninguna instancia descargada en tu PC ni estás agregado a la lista de acceso (Whitelist) del servidor.
                    </p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = '';

        for (let inst of combinedInstances) {
            let serverUrl = pkg.user ? `${pkg.url}/${pkg.user}` : pkg.url;
            let logoUrl = `${serverUrl}/files/logoins/${encodeURIComponent(inst.name)}.png`;

            let card = document.createElement('div');
            card.className = 'instance-client-card';
            card.id = `inst-card-${inst.name}`;
            card.innerHTML = `
                <div class="instance-client-left">
                    <img class="instance-client-avatar" src="${logoUrl}" alt="${inst.name}" onerror="this.src='./assets/images/icon.png'">
                    <div class="instance-client-details">
                        <div class="instance-client-title-row">
                            <span class="instance-client-name">${inst.name}</span>
                            ${inst.isInstalled 
                                ? `<span class="instance-client-badge badge-installed">🟢 Instalada (${inst.formattedSize})</span>`
                                : `<span class="instance-client-badge badge-not-installed">⚪ No descargada</span>`
                            }
                            ${!inst.isServer ? `<span class="instance-client-badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);">⚠️ Evento / Antigua</span>` : ''}
                        </div>
                        <span class="instance-client-subtext">Minecraft ${inst.version} · Loader: ${inst.loader.toUpperCase()}</span>
                    </div>
                </div>
                <div class="instance-client-actions">
                    <button class="btn-delete-instance-trash ${inst.isInstalled ? '' : 'disabled'}" 
                        title="${inst.isInstalled ? 'Eliminar archivos de la instancia de tu PC' : 'Esta instancia aún no está descargada'}" 
                        data-instance="${inst.name}" 
                        data-path="${inst.path}"
                        data-size="${inst.formattedSize}"
                        data-installed="${inst.isInstalled}"
                        ${inst.isInstalled ? '' : 'disabled'}>
                        <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                        Eliminar
                    </button>
                </div>
            `;

            listContainer.appendChild(card);
        }
    }

    async promptDeleteInstance(instanceName, instancePath, formattedSize) {
        const modal = document.getElementById('instanceDeleteModal');
        const title = document.getElementById('deleteModalTitle');
        const desc = document.getElementById('deleteModalDesc');
        const anim = document.getElementById('deleteStatusAnim');
        const actions = document.getElementById('deleteModalActions');

        if (!instancePath) {
            instancePath = await this.getLocalInstancePath(instanceName);
        }

        this.instanceToDelete = { name: instanceName, path: instancePath };

        if (title) title.textContent = `¿Eliminar Instancia "${instanceName}"?`;
        if (desc) desc.innerHTML = `Se eliminarán todos los archivos locales descargados de <b>${instanceName}</b> (~${formattedSize || '0 B'}).<br><br><small style="color:#94a3b8;">La próxima vez que juegues, el launcher volverá a descargar la instancia si lo deseas.</small>`;
        
        if (anim) anim.style.display = 'none';
        if (actions) actions.style.display = 'flex';
        if (modal) {
            modal.style.display = 'flex';
        }
    }

    async executeDeleteInstance(instanceInfo) {
        const modal = document.getElementById('instanceDeleteModal');
        const anim = document.getElementById('deleteStatusAnim');
        const statusText = document.getElementById('deleteStatusText');
        const actions = document.getElementById('deleteModalActions');

        if (anim) anim.style.display = 'flex';
        if (actions) actions.style.display = 'none';
        if (statusText) statusText.textContent = `Eliminando archivos de "${instanceInfo.name}"...`;

        try {
            await new Promise(r => setTimeout(r, 600));

            if (fs.existsSync(instanceInfo.path)) {
                fs.rmSync(instanceInfo.path, { recursive: true, force: true });
            }

            // Verificar si la instancia se eliminó
            let isDeleted = !fs.existsSync(instanceInfo.path);

            if (isDeleted) {
                if (statusText) statusText.textContent = `¡Instancia "${instanceInfo.name}" eliminada con éxito!`;
                await new Promise(r => setTimeout(r, 800));

                modal.style.display = 'none';
                this.instanceToDelete = null;

                let popupSuccess = new popup();
                popupSuccess.openPopup({
                    title: 'Instancia Eliminada',
                    content: `Se eliminaron correctamente los archivos de la instancia <b>${instanceInfo.name}</b> de tu computadora.`,
                    color: '#34d399',
                    options: true
                });

                await this.loadInstancesClientList();
            } else {
                throw new Error('Algunos archivos pueden estar en uso por el juego. Cierra Minecraft e inténtalo de nuevo.');
            }
        } catch (err) {
            console.error('Error al eliminar instancia:', err);
            modal.style.display = 'none';
            this.instanceToDelete = null;

            let popupErr = new popup();
            popupErr.openPopup({
                title: 'Error al Eliminar',
                content: `No se pudo eliminar la carpeta: ${err.message || err}`,
                color: '#ef4444',
                options: true
            });
            await this.loadInstancesClientList();
        }
    }
}
export default Settings;