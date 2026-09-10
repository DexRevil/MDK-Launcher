/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
// import panel
import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';

// import modules
import { logger, config, changePanel, database, popup, setBackground, setInstanceBackground, accountSelect, addAccount, pkg } from './utils.js';
const { AZauth, Microsoft, Mojang } = require('minecraft-java-core');

// libs
const { ipcRenderer } = require('electron');
const fs = require('fs');
const os = require('os');

class Launcher {
    async init() {
        this.initLog();
        console.log('Cargando MDK Launcher - Main Screen');
        this.shortcut()
        await setBackground()
        this.initFrame();
        this.config = await config.GetConfig().then(res => res).catch(err => err);
        if (await this.config.error) return this.errorConnect()
        this.db = new database();
        await this.initConfigClient();
        this.createPanels(Login, Home, Settings);
        await this.checkTermsAndConditions();
        this.startLauncher();
    }

    initLog() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
                ipcRenderer.send('main-window-dev-tools-close');
                ipcRenderer.send('main-window-dev-tools');
            }
        })
        new logger(pkg.name, '#7289da')
    }

    shortcut() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.keyCode == 87) {
                ipcRenderer.send('main-window-close');
            }
        })
    }


    errorConnect() {
        new popup().openPopup({
            title: this.config.error.code,
            content: this.config.error.message,
            color: 'red',
            exit: true,
            options: true
        });
    }

    initFrame() {
        console.log('Cargando Menus...')
        const platform = os.platform() === 'darwin' ? "darwin" : "other";

        document.querySelector(`.${platform} .frame`).classList.toggle('hide')

        document.querySelector(`.${platform} .frame #minimize`).addEventListener('click', () => {
            ipcRenderer.send('main-window-minimize');
        });

        let maximized = false;
        let maximize = document.querySelector(`.${platform} .frame #maximize`);
        maximize.addEventListener('click', () => {
            if (maximized) ipcRenderer.send('main-window-maximize')
            else ipcRenderer.send('main-window-maximize');
            maximized = !maximized
            maximize.classList.toggle('icon-maximize')
            maximize.classList.toggle('icon-restore-down')
        });

        document.querySelector(`.${platform} .frame #close`).addEventListener('click', () => {
            ipcRenderer.send('main-window-close');
        })

        // Help button handler (only for non-Darwin)
        if (platform !== 'darwin') {
            const helpBtn = document.querySelector(`.${platform} .frame #help`);
            if (helpBtn) {
                helpBtn.addEventListener('click', () => {
                    const helpPopup = document.querySelector('.help-popup');
                    if (helpPopup) {
                        helpPopup.classList.toggle('show');
                    }
                });
            }
        }

        // Close help popup handlers
        const helpClose = document.querySelector('.help-close');
        const helpPopup = document.querySelector('.help-popup');
        
        if (helpClose) {
            helpClose.addEventListener('click', () => {
                if (helpPopup) helpPopup.classList.remove('show');
            });
        }

        if (helpPopup) {
            helpPopup.addEventListener('click', (e) => {
                if (e.target === helpPopup) {
                    helpPopup.classList.remove('show');
                }
            });
        }
    }

    async initConfigClient() {
        console.log('Cargando Configs del cliente')
        let configClient = await this.db.readData('configClient')

        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                instance_selct: null,
                java_config: {
                    java_path: null,
                    java_memory: {
                        min: 2,
                        max: 4
                    }
                },
                game_config: {
                    screen_size: {
                        width: 854,
                        height: 480
                    }
                },
                launcher_config: {
                    download_multi: 10,
                    theme: 'auto',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true
                }
            })
        }
    }

    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels')
        for (let panel of panels) {
            console.log(`Cargando ${panel.name}...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id)
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            panelsElem.appendChild(div);
            new panel().init(this.config);
        }
    }

    async checkTermsAndConditions() {
        const CURRENT_TERMS_VERSION = '2026.1';

        // Registrar listener para abrir y consultar términos desde el menú de Ayuda o Configuración
        const helpTermsBtn = document.getElementById('btnOpenTermsFromHelp');
        if (helpTermsBtn) {
            helpTermsBtn.addEventListener('click', () => {
                const helpPopup = document.querySelector('.help-popup');
                if (helpPopup) helpPopup.classList.remove('show');
                this.showTermsModal({ reviewOnly: true });
            });
        }

        const settingsTermsBtn = document.getElementById('btnOpenTermsFromSettings');
        if (settingsTermsBtn) {
            settingsTermsBtn.addEventListener('click', () => {
                this.showTermsModal({ reviewOnly: true });
            });
        }

        let configClient = await this.db.readData('configClient');
        if (configClient && configClient.terms_accepted_version === CURRENT_TERMS_VERSION) {
            return;
        }

        // Si es la primera vez que se abre o una actualización, requerir aceptación obligatoria
        return new Promise((resolve) => {
            this.showTermsModal({
                reviewOnly: false,
                onAccept: async () => {
                    let currentConfig = await this.db.readData('configClient') || {};
                    currentConfig.terms_accepted_version = CURRENT_TERMS_VERSION;
                    currentConfig.terms_accepted_date = new Date().toISOString();
                    await this.db.updateData('configClient', currentConfig);
                    resolve();
                },
                onDecline: () => {
                    ipcRenderer.send('main-window-close');
                }
            });
        });
    }

    showTermsModal({ reviewOnly = false, onAccept = null, onDecline = null } = {}) {
        const modal = document.getElementById('termsModal');
        if (!modal) return;

        const checkboxContainer = document.getElementById('termsCheckboxContainer');
        const checkbox = document.getElementById('termsAcceptCheckbox');
        const btnAccept = document.getElementById('btnTermsAccept');
        const btnDecline = document.getElementById('btnTermsDecline');
        const closeBtn = document.getElementById('termsModalClose');

        if (reviewOnly) {
            if (closeBtn) {
                closeBtn.style.display = 'flex';
                closeBtn.onclick = () => { modal.style.display = 'none'; };
            }
            if (checkboxContainer) checkboxContainer.style.display = 'none';
            if (btnDecline) btnDecline.style.display = 'none';
            if (btnAccept) {
                btnAccept.style.display = 'block';
                btnAccept.disabled = false;
                btnAccept.textContent = 'Cerrar';
                btnAccept.onclick = () => { modal.style.display = 'none'; };
            }
            modal.onclick = (e) => {
                if (e.target === modal) modal.style.display = 'none';
            };
        } else {
            if (closeBtn) closeBtn.style.display = 'none';
            if (checkboxContainer) checkboxContainer.style.display = 'flex';
            if (checkbox) checkbox.checked = false;
            modal.onclick = null; // En modo obligatorio no se cierra haciendo clic fuera

            if (btnDecline) {
                btnDecline.style.display = 'block';
                btnDecline.onclick = () => {
                    if (onDecline) onDecline();
                };
            }

            if (btnAccept) {
                btnAccept.style.display = 'block';
                btnAccept.disabled = true;
                btnAccept.textContent = 'Aceptar y Continuar';
                btnAccept.onclick = () => {
                    if (!checkbox.checked) return;
                    modal.style.display = 'none';
                    if (onAccept) onAccept();
                };
            }

            if (checkbox) {
                checkbox.onchange = () => {
                    if (btnAccept) {
                        btnAccept.disabled = !checkbox.checked;
                    }
                };
            }
        }

        modal.style.display = 'flex';
    }

    async startLauncher() {
        let accounts = await this.db.readAllData('accounts')
        let configClient = await this.db.readData('configClient')
        let account_selected = configClient ? configClient.account_selected : null
        let popupRefresh = new popup();

        if (accounts?.length) {
            let activeAccount = accounts.find(a => a.ID == account_selected) || accounts[0];
            let typeLabel = (activeAccount?.meta?.type || 'MOJANG').toUpperCase();

            popupRefresh.openPopup({
                title: 'Iniciando Perfil...',
                content: `
                    <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: center; font-size: 1.05rem; padding: 0.4rem 0;">
                        <div><span style="color: var(--text-muted); font-weight: 500;">Tipo de Cuenta:</span> <b style="color: var(--color); font-weight: 800; letter-spacing: 0.5px;">${typeLabel}</b></div>
                        <div><span style="color: var(--text-muted); font-weight: 500;">Usuario:</span> <b style="color: var(--element-color, #6366f1); font-weight: 800; font-size: 1.15rem;">${activeAccount.name}</b></div>
                    </div>
                `,
                color: 'var(--color)',
                background: false
            });

            for (let account of accounts) {
                let account_ID = account.ID
                if (account.error) {
                    await this.db.deleteData('accounts', account_ID)
                    continue
                }
                if (account.meta.type === 'Xbox') {
                    console.log(`Cuenta: ${account.meta.type} | USUARIO: ${account.name}`);
                    let refresh_accounts = await new Microsoft(this.config.client_id).refresh(account);

                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            await this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    await this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'AZauth') {
                    console.log(`TIPO: ${account.meta.type} | USUARIO: ${account.name}`);
                    // AZauth only works when the config.online value is a valid URL string
                    let refresh_accounts;
                    if (typeof this.config.online === 'string' && this.config.online.match(/^(http|https):\/\/[^ "]+$/)) {
                        try {
                            refresh_accounts = await new AZauth(this.config.online).verify(account);
                        } catch (err) {
                            console.error('[AZauth] error while creating client', err);
                            refresh_accounts = { error: true, message: 'invalid auth server URL' };
                        }
                    } else {
                        // launcher was switched out of AZauth mode, skip verification
                        console.warn('[Launcher] skipping AZauth verify because online flag is not a URL');
                        continue;
                    }

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.message}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else if (account.meta.type == 'Mojang') {
                    console.log(`TIPO: ${account.meta.type} | USUARIO: ${account.name}`);
                    if (account.meta.online == false) {
                        let refresh_accounts = await Mojang.login(account.name);

                        refresh_accounts.ID = account_ID
                        await addAccount(refresh_accounts)
                        this.db.updateData('accounts', refresh_accounts, account_ID)
                        if (account_ID == account_selected) accountSelect(refresh_accounts)
                        continue;
                    }

                    let refresh_accounts = await Mojang.refresh(account);

                    if (refresh_accounts.error) {
                        this.db.deleteData('accounts', account_ID)
                        if (account_ID == account_selected) {
                            configClient.account_selected = null
                            this.db.updateData('configClient', configClient)
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }

                    refresh_accounts.ID = account_ID
                    this.db.updateData('accounts', refresh_accounts, account_ID)
                    await addAccount(refresh_accounts)
                    if (account_ID == account_selected) accountSelect(refresh_accounts)
                } else {
                    console.error(`[Account] ${account.name}: Account Type Not Found`);
                    this.db.deleteData('accounts', account_ID)
                    if (account_ID == account_selected) {
                        configClient.account_selected = null
                        this.db.updateData('configClient', configClient)
                    }
                }
            }

            accounts = await this.db.readAllData('accounts')
            configClient = await this.db.readData('configClient')
            account_selected = configClient ? configClient.account_selected : null

            if (!account_selected && accounts.length) {
                let uuid = accounts[0].ID
                if (uuid) {
                    configClient.account_selected = uuid
                    await this.db.updateData('configClient', configClient)
                    accountSelect(accounts[0])
                }
            }

            if (!accounts.length) {
                config.account_selected = null
                await this.db.updateData('configClient', config);
                popupRefresh.closePopup()
                return changePanel("login");
            }

            if (configClient) {
                configClient.instance_selct = null;
                await this.db.updateData('configClient', configClient);
            }

            // Tiempo óptimo de presentación y precarga
            await new Promise(resolve => setTimeout(resolve, 1500));

            popupRefresh.closePopup()
            changePanel("home");
        } else {
            popupRefresh.closePopup()
            changePanel('login');
        }
    }
}

new Launcher().init();
