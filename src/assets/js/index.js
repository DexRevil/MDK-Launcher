/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

const { ipcRenderer, shell } = require('electron');
const os = require('os');

// Cargar resolver DNS de forma segura sin romper rutas
let dnsResolver = (typeof global !== 'undefined' && (global.__MDK_DNS_RESOLVER__ || global.dnsResolver)) || null;
if (!dnsResolver) {
    try {
        dnsResolver = require('./assets/js/utils/dnsResolver.js');
    } catch (e1) {
        try {
            dnsResolver = require('./utils/dnsResolver.js');
        } catch (e2) {}
    }
}

let pkg;
try {
    pkg = require('../../../package.json');
} catch (e1) {
    try {
        pkg = require('../package.json');
    } catch (e2) {
        pkg = { repository: { url: "https://github.com/DexRevil/MDK-Launcher.git" } };
    }
}
import { config, database } from './utils.js';
const nodeFetch = require("node-fetch");


class Splash {
    constructor() {
        this.splash = document.querySelector(".splash");
        this.splashMessage = document.querySelector(".splash-message");
        this.splashAuthor = document.querySelector(".splash-author");
        this.message = document.querySelector(".message");
        this.progress = document.querySelector(".progress");

        const init = async () => {
            try {
                let databaseLauncher = new database();
                let configClient = await databaseLauncher.readData('configClient');
                let theme = configClient?.launcher_config?.theme || "auto";
                let isDarkTheme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res).catch(() => true);
                document.body.className = isDarkTheme ? 'dark global' : 'light global';
            } catch (err) {
                console.warn('Error inicializando tema en Splash:', err);
                document.body.className = 'dark global';
            }
            if (process.platform == 'win32') {
                try { ipcRenderer.send('update-window-progress-load'); } catch (e) {}
            }
            this.startAnimation();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    async startAnimation() {
        let splashes = [
            { "message": "Capibaras trabajando...", "author": "MDK Team" },
            { "message": "Capibaras descansando...", "author": "MDK Team" }
        ];
        let splash = splashes[Math.floor(Math.random() * splashes.length)];
        this.splashMessage.textContent = splash.message;
        this.splashAuthor.children[0].textContent = "@" + splash.author;
        await sleep(100);
        document.querySelector("#splash").style.display = "block";
        await sleep(500);
        this.splash.classList.add("opacity");
        await sleep(500);
        this.splash.classList.add("translate");
        this.splashMessage.classList.add("opacity");
        this.splashAuthor.classList.add("opacity");
        this.message.classList.add("opacity");
        await sleep(1000);
        this.checkUpdate();
    }

    async checkUpdate() {
        this.setStatus(`Verificando version...`);

        let updateTriggered = false;

        ipcRenderer.invoke('update-app').then(res => {
            if (res && res.error) {
                console.warn('[Updater] Aviso comprobando actualización:', res.message);
                if (!updateTriggered) {
                    this.maintenanceCheck();
                }
            }
        }).catch(err => {
            console.warn('[Updater] No se pudo verificar versión:', err);
            if (!updateTriggered) {
                this.maintenanceCheck();
            }
        });

        ipcRenderer.on('updateAvailable', () => {
            updateTriggered = true;
            this.setStatus(`Actualizacion Disponible !`);
            if (os.platform() == 'win32') {
                this.toggleProgress();
                ipcRenderer.send('start-update');
            }
            else return this.dowloadUpdate();
        });

        ipcRenderer.on('error', (event, err) => {
            console.warn('[Updater] Error en autoUpdater:', err);
            // Si el error ocurrió durante la verificación de GitHub (ej: 404 durante compilación), continuar
            if (!updateTriggered) {
                this.maintenanceCheck();
            } else {
                this.setStatus(`Error al descargar actualización.<br>Abriendo launcher...`);
                setTimeout(() => this.maintenanceCheck(), 2000);
            }
        });

        ipcRenderer.on('download-progress', (event, progress) => {
            ipcRenderer.send('update-window-progress', { progress: progress.transferred, size: progress.total })
            this.setProgress(progress.transferred, progress.total);
        });

        ipcRenderer.on('update-not-available', () => {
            this.maintenanceCheck();
        });
    }

    getLatestReleaseForOS(os, preferredFormat, asset) {
        return asset.filter(asset => {
            const name = asset.name.toLowerCase();
            const isOSMatch = name.includes(os);
            const isFormatMatch = name.endsWith(preferredFormat);
            return isOSMatch && isFormatMatch;
        }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    }

    async dowloadUpdate() {
        const repoURL = (pkg?.repository?.url || "https://github.com/DexRevil/MDK-Launcher.git").replace("git+", "").replace(".git", "").replace("https://github.com/", "").split("/");
        const fetchOpts = dnsResolver?.customHttpsAgent ? { agent: dnsResolver.customHttpsAgent } : {};
        const githubAPI = await nodeFetch('https://api.github.com', fetchOpts).then(res => res.json()).catch(err => err);

        const githubAPIRepoURL = githubAPI?.repository_url?.replace("{owner}", repoURL[0]).replace("{repo}", repoURL[1]);
        if (!githubAPIRepoURL) return this.shutdown("Error al consultar actualización.");
        const githubAPIRepo = await nodeFetch(githubAPIRepoURL, fetchOpts).then(res => res.json()).catch(err => err);

        const releases_url = await nodeFetch(githubAPIRepo?.releases_url?.replace("{/id}", '') || '', fetchOpts).then(res => res.json()).catch(err => err);
        const latestRelease = releases_url?.[0]?.assets;
        let latest;

        if (os.platform() == 'darwin') latest = this.getLatestReleaseForOS('mac', '.dmg', latestRelease);
        else if (os == 'linux') latest = this.getLatestReleaseForOS('linux', '.appimage', latestRelease);


        this.setStatus(`Nueva version disponible!<br><div class="download-update">Descargando...</div>`);
        document.querySelector(".download-update").addEventListener("click", () => {
            shell.openExternal(latest.browser_download_url);
            return this.shutdown("Téléchargement en cours...");
        });
    }


    async maintenanceCheck() {
        config.GetConfig().then(res => {
            if (res.maintenance) return this.shutdown(res.maintenance_message);
            this.startLauncher();
        }).catch(e => {
            console.error(e);
            return this.shutdown("El Launcher no esta disponible :(<br>Intente mas tarde.");
        })
    }

    startLauncher() {
        this.setStatus(`Cargando launcher...`);
        ipcRenderer.send('main-window-open');
        ipcRenderer.send('update-window-close');
    }

    shutdown(text) {
        this.setStatus(`${text}<br>Cerrando launcher 5s`);
        let i = 4;
        setInterval(() => {
            this.setStatus(`${text}<br>Cerrando launcher ${i--}s`);
            if (i < 0) ipcRenderer.send('update-window-close');
        }, 1000);
    }

    setStatus(text) {
        this.message.innerHTML = text;
    }

    toggleProgress() {
        if (this.progress.classList.toggle("show")) this.setProgress(0, 1);
    }

    setProgress(value, max) {
        this.progress.value = value;
        this.progress.max = max;
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
        ipcRenderer.send("update-window-dev-tools");
    }
})
new Splash();