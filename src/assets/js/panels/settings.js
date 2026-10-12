/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground, pkg, getGamePaths } from '../utils.js'
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
        this.instancesPath()
        this.instancesManagement()
        this.ram()
        this.javaPath()
        this.resolution()
        this.launcher()
        this.networkRepair()
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
                    this.updateInstancePathDisplay();
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

        let maxDownloadFiles = configClient?.launcher_config?.download_multi || 10;
        let maxDownloadFilesInput = document.querySelector(".max-files");
        let maxDownloadFilesReset = document.querySelector(".max-files-reset");
        maxDownloadFilesInput.value = maxDownloadFiles;

        maxDownloadFilesInput.addEventListener("change", async () => {
            let configClient = await this.db.readData('configClient')
            configClient.launcher_config.download_multi = parseInt(maxDownloadFilesInput.value) || 10;
            await this.db.updateData('configClient', configClient);
        })

        maxDownloadFilesReset.addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient')
            maxDownloadFilesInput.value = 10
            configClient.launcher_config.download_multi = 10;
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

    async updateInstancePathDisplay() {
        const pathInput = document.getElementById('instance-path-display');
        const badge = document.getElementById('instance-path-status-badge');
        if (!pathInput) return;

        const paths = await getGamePaths(this.config);
        pathInput.value = paths.instancesDir;

        if (badge) {
            if (paths.isCustom) {
                badge.className = 'instance-path-badge badge-custom';
                badge.innerHTML = '⚡ Ruta Personalizada';
            } else {
                badge.className = 'instance-path-badge badge-default';
                badge.innerHTML = '📂 Ruta Predeterminada';
            }
        }
    }

    async instancesPath() {
        await this.updateInstancePathDisplay();

        const btnChange = document.getElementById('btn-change-instance-path');
        const btnOpen = document.getElementById('btn-open-instance-path');
        const btnReset = document.getElementById('btn-reset-instance-path');

        if (btnOpen) {
            btnOpen.addEventListener('click', async () => {
                const paths = await getGamePaths(this.config);
                await ipcRenderer.invoke('open-directory', paths.instancesDir);
            });
        }

        if (btnChange) {
            btnChange.addEventListener('click', async () => {
                const currentPaths = await getGamePaths(this.config);
                const selectedDir = await ipcRenderer.invoke('select-directory', currentPaths.instancesDir || currentPaths.rootDir);
                if (!selectedDir) return;

                const normalizedSelected = selectedDir.replace(/\\/g, '/').replace(/\/+$/, '');
                const currentInstancesNormalized = currentPaths.instancesDir.replace(/\\/g, '/').replace(/\/+$/, '');
                const currentRootNormalized = currentPaths.rootDir.replace(/\\/g, '/').replace(/\/+$/, '');

                if (normalizedSelected === currentInstancesNormalized || normalizedSelected === currentRootNormalized) {
                    return;
                }

                let newInstancesDir = normalizedSelected;
                if (path.basename(normalizedSelected).toLowerCase() !== 'instances') {
                    newInstancesDir = path.join(normalizedSelected, 'instances').replace(/\\/g, '/');
                }

                let existingInstances = [];
                let totalSize = 0;
                if (fs.existsSync(currentPaths.instancesDir)) {
                    try {
                        const entries = fs.readdirSync(currentPaths.instancesDir, { withFileTypes: true });
                        for (const entry of entries) {
                            if (entry.isDirectory()) {
                                const instP = path.join(currentPaths.instancesDir, entry.name);
                                const sz = this.calculateFolderSize(instP);
                                if (sz > 0) {
                                    existingInstances.push({ name: entry.name, path: instP, size: sz });
                                    totalSize += sz;
                                }
                            }
                        }
                    } catch (e) {
                        console.warn('Error al verificar instancias existentes:', e);
                    }
                }

                if (existingInstances.length > 0) {
                    this.pendingPathChange = {
                        newRawPath: normalizedSelected,
                        newInstancesDir: newInstancesDir,
                        oldInstancesDir: currentPaths.instancesDir
                    };
                    this.promptMoveInstances(existingInstances.length, this.formatBytes(totalSize), newInstancesDir);
                } else {
                    await this.applyNewInstancePath(normalizedSelected);
                }
            });
        }

        if (btnReset) {
            btnReset.addEventListener('click', async () => {
                const currentPaths = await getGamePaths(this.config);
                if (!currentPaths.isCustom) {
                    let p = new popup();
                    p.openPopup({
                        title: 'Ruta de Instancias',
                        content: 'Ya estás utilizando la ruta predeterminada de la aplicación.',
                        color: 'var(--color)',
                        options: true
                    });
                    return;
                }
                const resetModal = document.getElementById('instanceResetModal');
                if (resetModal) resetModal.style.display = 'flex';
            });
        }

        document.addEventListener('click', async (e) => {
            if (e.target && (e.target.id === 'btnCancelResetInstancePath' || e.target.closest('#btnCancelResetInstancePath'))) {
                const resetModal = document.getElementById('instanceResetModal');
                if (resetModal) resetModal.style.display = 'none';
            } else if (e.target && (e.target.id === 'btnConfirmResetInstancePath' || e.target.closest('#btnConfirmResetInstancePath'))) {
                const resetModal = document.getElementById('instanceResetModal');
                if (resetModal) resetModal.style.display = 'none';
                await this.resetInstancePath();
            }
        });

        document.addEventListener('click', async (e) => {
            if (e.target && (e.target.id === 'btnCancelMoveInstance' || e.target.closest('#btnCancelMoveInstance'))) {
                const moveModal = document.getElementById('instanceMoveModal');
                if (moveModal) moveModal.style.display = 'none';
                this.pendingPathChange = null;
            } else if (e.target && (e.target.id === 'btnSkipMoveInstance' || e.target.closest('#btnSkipMoveInstance'))) {
                const moveModal = document.getElementById('instanceMoveModal');
                if (moveModal) moveModal.style.display = 'none';
                if (this.pendingPathChange) {
                    await this.applyNewInstancePath(this.pendingPathChange.newRawPath);
                    this.pendingPathChange = null;
                }
            } else if (e.target && (e.target.id === 'btnConfirmMoveInstance' || e.target.closest('#btnConfirmMoveInstance'))) {
                if (this.pendingPathChange) {
                    await this.executeMoveInstances(this.pendingPathChange);
                    this.pendingPathChange = null;
                }
            }
        });
    }

    promptMoveInstances(count, formattedSize, newPath) {
        const modal = document.getElementById('instanceMoveModal');
        const desc = document.getElementById('moveModalDesc');
        const anim = document.getElementById('moveStatusAnim');
        const actions = document.getElementById('moveModalActions');

        if (desc) {
            desc.innerHTML = `Se encontraron <b>${count}</b> instancia(s) instalada(s) (~${formattedSize}).<br><br>¿Deseas mover los archivos a la nueva ubicación?<br><span style="color:#818cf8; font-family: monospace; font-size: 0.8rem; word-break: break-all;">${newPath}</span>`;
        }
        if (anim) anim.style.display = 'none';
        if (actions) actions.style.display = 'flex';
        if (modal) modal.style.display = 'flex';
    }

    async executeMoveInstances(changeInfo) {
        const modal = document.getElementById('instanceMoveModal');
        const anim = document.getElementById('moveStatusAnim');
        const statusText = document.getElementById('moveStatusText');
        const actions = document.getElementById('moveModalActions');

        if (anim) anim.style.display = 'flex';
        if (actions) actions.style.display = 'none';
        if (statusText) statusText.textContent = 'Transfiriendo archivos de instancias a la nueva ubicación...';

        try {
            await new Promise(r => setTimeout(r, 400));
            await this.transferDirectoryFiles(changeInfo.oldInstancesDir, changeInfo.newInstancesDir, (name) => {
                if (statusText) statusText.textContent = `Transfiriendo "${name}"...`;
            });

            await this.applyNewInstancePath(changeInfo.newRawPath, false);

            if (modal) modal.style.display = 'none';

            let pSuccess = new popup();
            pSuccess.openPopup({
                title: 'Instancias Transferidas',
                content: `La ruta fue actualizada y tus instancias se transfirieron correctamente a:<br><br><span style="color:#34d399; font-family: monospace; font-size: 0.82rem; word-break: break-all;">${changeInfo.newInstancesDir}</span>`,
                color: '#34d399',
                options: true
            });
        } catch (err) {
            console.error('Error al transferir instancias:', err);
            if (modal) modal.style.display = 'none';
            let pErr = new popup();
            pErr.openPopup({
                title: 'Aviso de Transferencia',
                content: `No se pudieron mover algunos archivos (pueden estar en uso por Minecraft): ${err.message || err}. Se actualizó la ruta.`,
                color: '#ef4444',
                options: true
            });
            await this.applyNewInstancePath(changeInfo.newRawPath, false);
        }
    }

    async transferDirectoryFiles(srcDir, dstDir, onProgress) {
        if (!fs.existsSync(srcDir)) return;
        if (!fs.existsSync(dstDir)) {
            fs.mkdirSync(dstDir, { recursive: true });
        }

        const entries = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const srcItem = path.join(srcDir, entry.name);
            const dstItem = path.join(dstDir, entry.name);

            if (onProgress) onProgress(entry.name);

            try {
                fs.renameSync(srcItem, dstItem);
            } catch (err) {
                if (err.code === 'EXDEV' || err) {
                    fs.cpSync(srcItem, dstItem, { recursive: true, force: true });
                    try {
                        fs.rmSync(srcItem, { recursive: true, force: true });
                    } catch (_) {}
                }
            }
        }
    }

    async applyNewInstancePath(newPath, showPopup = true) {
        let configClient = await this.db.readData('configClient');
        configClient.game_config = configClient.game_config || {};
        configClient.game_config.instances_path = newPath;
        await this.db.updateData('configClient', configClient);

        await this.updateInstancePathDisplay();
        await this.loadInstancesClientList();

        if (showPopup) {
            let p = new popup();
            p.openPopup({
                title: 'Ruta Actualizada',
                content: `La ruta de instalación de instancias ahora es:<br><br><span style="color:#34d399; font-family: monospace; font-size: 0.82rem; word-break: break-all;">${newPath}</span>`,
                color: '#34d399',
                options: true
            });
        }
    }

    async resetInstancePath() {
        let configClient = await this.db.readData('configClient');
        if (configClient?.game_config) {
            configClient.game_config.instances_path = null;
        }
        configClient.instances_path = null;
        await this.db.updateData('configClient', configClient);

        await this.updateInstancePathDisplay();
        await this.loadInstancesClientList();

        let p = new popup();
        p.openPopup({
            title: 'Ruta Restablecida',
            content: 'Se ha restablecido la ruta de instancias a la ubicación predeterminada.',
            color: '#34d399',
            options: true
        });
    }

    async instancesManagement() {
        const refreshBtn = document.getElementById('btn-refresh-instances');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadInstancesClientList();
            });
        }

        const listContainer = document.getElementById('instances-client-list');
        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                let openBtn = e.target.closest('.btn-open-instance-folder');
                if (openBtn) {
                    let folderPath = openBtn.getAttribute('data-path');
                    if (folderPath) {
                        ipcRenderer.invoke('open-directory', folderPath);
                    }
                    return;
                }

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
        const paths = await getGamePaths(this.config);
        return paths.getInstancePath(instanceName);
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

        const paths = await getGamePaths(this.config);
        let instancesRoot = paths.instancesDir;

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

            if (sInst.whitelistActive) {
                let isAllowed = sInst.whitelist && sInst.whitelist.some(w => w.toLowerCase() === auth?.name?.toLowerCase());
                if (!isAllowed) {
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
                        ${inst.isInstalled ? `<span class="instance-client-path-hint" title="${inst.path}">📁 ${inst.path}</span>` : ''}
                    </div>
                </div>
                <div class="instance-client-actions">
                    ${inst.isInstalled ? `
                        <button class="btn-open-instance-folder" 
                            title="Abrir carpeta de ${inst.name} en el explorador de archivos" 
                            data-path="${inst.path}">
                            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z"></path>
                            </svg>
                            Abrir Carpeta
                        </button>
                    ` : ''}
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

    networkRepair() {
        const btnRepair = document.querySelector("#btnRepairNetworkSettings");
        if (!btnRepair) return;

        btnRepair.addEventListener("click", async () => {
            const popupRepair = new popup();
            popupRepair.openPopup({
                title: 'Reparación de Red y DNS',
                content: 'Limpiando caché DNS del sistema y optimizando conexiones...',
                color: 'var(--color)'
            });

            try {
                let dnsResolver = null;
                try {
                    dnsResolver = require('../utils/dnsResolver.js');
                } catch (_) {
                    dnsResolver = global.dnsResolver || global.__MDK_DNS_RESOLVER__;
                }

                // 1. Limpieza de caché DNS de Windows y proceso local
                if (dnsResolver && typeof dnsResolver.flushSystemDnsCache === 'function') {
                    await dnsResolver.flushSystemDnsCache();
                }

                // 2. Permisos de Firewall de Windows para Java si existe ruta configurada
                let configClient = await this.db.readData('configClient');
                if (configClient?.java_config?.java_path && dnsResolver && typeof dnsResolver.repairWindowsFirewallForJava === 'function') {
                    await dnsResolver.repairWindowsFirewallForJava(configClient.java_config.java_path);
                }

                popupRepair.openPopup({
                    title: '✅ Conexión y DNS Reparados',
                    content: `¡Caché de red limpiada exitosamente!<br><br>Se eliminaron bloqueos temporales de DNS de Windows y se activó la resolución optimizada con Cloudflare y Google (DoH) para tus servidores.`,
                    color: '#10b981',
                    options: true
                });
            } catch (err) {
                console.error('[NetworkRepair] Error en reparación de red:', err);
                popupRepair.openPopup({
                    title: 'Diagnóstico de Red',
                    content: `La caché de red fue limpiada. Puedes reiniciar el launcher y probar entrar de nuevo.`,
                    color: 'var(--color)',
                    options: true
                });
            }
        });
    }
}
export default Settings;