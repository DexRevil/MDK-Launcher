/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
const { AZauth, Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');

import { popup, database, changePanel, accountSelect, addAccount, config, setStatus } from '../utils.js';

class Login {
    static id = "login";
    async init(config) {
        this.config = config;
        this.db = new database();

        // Check state initially
        await this.updateLoginState();

        // Check state every time the user opens the login panel
        document.addEventListener('panelChanged', async (e) => {
            if (e.detail === 'login') {
                await this.updateLoginState();
            }
        });

        if (typeof this.config.online == 'boolean') {
            this.config.online ? this.getMicrosoft() : this.getCrack()
        } else if (typeof this.config.online == 'string') {
            if (this.config.online.match(/^(http|https):\/\/[^ "]+$/)) {
                this.getAZauth();
            }
        }
        
        let cancelHome = document.querySelector('.cancel-home');
        let cancelOffline = document.querySelector('.cancel-offline');
        let cancelAZauth = document.querySelector('.cancel-AZauth');

        const goBackToSettings = () => {
            changePanel('settings');
        };

        if(cancelHome) cancelHome.addEventListener('click', goBackToSettings);
        if(cancelOffline) cancelOffline.addEventListener('click', goBackToSettings);
        if(cancelAZauth) cancelAZauth.addEventListener('click', goBackToSettings);
    }

    async updateLoginState() {
        // Update text & cancel buttons properly based on existing accounts length
        let accounts = await this.db.readAllData('accounts') || [];
        let isFirstTime = accounts.length === 0;
        let welcomeTitle = isFirstTime ? "Bienvenido a MDK" : "¿Qué cuenta desea agregar?";

        // Update titles
        let dynamicTitles = document.querySelectorAll('.dynamic-login-title');
        dynamicTitles.forEach(title => {
            title.innerHTML = welcomeTitle;
        });

        // Update cancel buttons visibility
        let cancelButtons = document.querySelectorAll('.cancel-home, .cancel-offline, .cancel-AZauth');
        cancelButtons.forEach(btn => {
            if (isFirstTime) {
                btn.style.display = 'none';
            } else {
                btn.style.display = 'inline';
            }
        });
    }

    async getMicrosoft() {
        console.log('Cargando Microsoft login...');
        let popupLogin = new popup();
        let loginHome = document.querySelector('.login-home');
        let microsoftBtn = document.querySelector('.connect-home');
        loginHome.style.display = 'flex';

        microsoftBtn.addEventListener("click", () => {
            popupLogin.openPopup({
                title: 'Connexion',
                content: 'Veuillez patienter...',
                color: 'var(--color)'
            });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id).then(async account_connect => {
                if (account_connect == 'cancel' || !account_connect) {
                    popupLogin.closePopup();
                    return;
                } else {
                    await this.saveData(account_connect)
                    popupLogin.closePopup();
                }

            }).catch(err => {
                popupLogin.openPopup({
                    title: 'Erreur',
                    content: err,
                    options: true
                });
            });
        })
    }

    async getCrack() {
        console.log('Cargando MDK Auth - Microsoft/Offline');
        let popupLogin = new popup();
        let loginOffline = document.querySelector('.login-offline');
        let microsoftcracked = document.querySelector(".connect-microsoftcracked");
        let emailOffline = document.querySelector('.email-offline');
        let connectOffline = document.querySelector('.connect-offline');
        loginOffline.style.display = 'flex';
        
        microsoftcracked.addEventListener("click", () => {
            popupLogin.openPopup({
                title: 'Microsoft',
                content: 'Cargando Microsoft Login...',
                color: 'var(--color)'
            });

            ipcRenderer.invoke('Microsoft-window', this.config.client_id).then(async account_connect => {
                if (account_connect == 'cancel' || !account_connect) {
                    popupLogin.closePopup();
                    return;
                } else {
                    await this.saveData(account_connect)
                    popupLogin.closePopup();
                }

            }).catch(err => {
                popupLogin.openPopup({
                    title: 'Erreur',
                    content: err,
                    options: true
                });
            });
        })

        connectOffline.addEventListener('click', async () => {
            if (emailOffline.value.length < 3) {
                popupLogin.openPopup({
                    title: 'Error al conectar!',
                    content: 'Tu nombre debe tener minimo 3 caracteres',
                    options: true
                });
                return;
            }

            if (emailOffline.value.match(/ /g)) {
                popupLogin.openPopup({
                    title: 'Error al conectar!',
                    content: 'Tu nombre no debe contener d\'espacios.',
                    options: true
                });
                return;
            }

            let MojangConnect = await Mojang.login(emailOffline.value);

            if (MojangConnect.error) {
                popupLogin.openPopup({
                    title: 'Erreur',
                    content: MojangConnect.message,
                    options: true
                });
                return;
            }
            await this.saveData(MojangConnect)
            popupLogin.closePopup();
        });
    }

    async getAZauth() {
        console.log('Initializing AZauth login...');
        let AZauthClient = new AZauth(this.config.online);
        let PopupLogin = new popup();
        let loginAZauth = document.querySelector('.login-AZauth');
        let loginAZauthA2F = document.querySelector('.login-AZauth-A2F');

        let AZauthEmail = document.querySelector('.email-AZauth');
        let AZauthPassword = document.querySelector('.password-AZauth');
        let AZauthA2F = document.querySelector('.A2F-AZauth');
        let connectAZauthA2F = document.querySelector('.connect-AZauth-A2F');
        let AZauthConnectBTN = document.querySelector('.connect-AZauth');
        let AZauthCancelA2F = document.querySelector('.cancel-AZauth-A2F');

        loginAZauth.style.display = 'flex';

        AZauthConnectBTN.addEventListener('click', async () => {
            PopupLogin.openPopup({
                title: 'Connexion en cours...',
                content: 'Veuillez patienter...',
                color: 'var(--color)'
            });

            if (AZauthEmail.value == '' || AZauthPassword.value == '') {
                PopupLogin.openPopup({
                    title: 'Erreur',
                    content: 'Veuillez remplir tous les champs.',
                    options: true
                });
                return;
            }

            let AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value);

            if (AZauthConnect.error) {
                PopupLogin.openPopup({
                    title: 'Erreur',
                    content: AZauthConnect.message,
                    options: true
                });
                return;
            } else if (AZauthConnect.A2F) {
                loginAZauthA2F.style.display = 'flex';
                loginAZauth.style.display = 'none';
                PopupLogin.closePopup();

                AZauthCancelA2F.addEventListener('click', () => {
                    loginAZauthA2F.style.display = 'none';
                    loginAZauth.style.display = 'flex';
                });

                connectAZauthA2F.addEventListener('click', async () => {
                    PopupLogin.openPopup({
                        title: 'Connexion en cours...',
                        content: 'Veuillez patienter...',
                        color: 'var(--color)'
                    });

                    if (AZauthA2F.value == '') {
                        PopupLogin.openPopup({
                            title: 'Erreur',
                            content: 'Veuillez entrer le code A2F.',
                            options: true
                        });
                        return;
                    }

                    AZauthConnect = await AZauthClient.login(AZauthEmail.value, AZauthPassword.value, AZauthA2F.value);

                    if (AZauthConnect.error) {
                        PopupLogin.openPopup({
                            title: 'Erreur',
                            content: AZauthConnect.message,
                            options: true
                        });
                        return;
                    }

                    await this.saveData(AZauthConnect)
                    PopupLogin.closePopup();
                });
            } else if (!AZauthConnect.A2F) {
                await this.saveData(AZauthConnect)
                PopupLogin.closePopup();
            }
        });
    }

    async saveData(connectionData) {
        // Validar si hay error
        if (connectionData.error) {
            let popupError = new popup();
            popupError.openPopup({
                title: 'Error de Autenticación',
                content: `${connectionData.error} - ${connectionData.errorType || 'Desconocido'}`,
                options: true,
                color: 'red'
            });
            return;
        }
        
        let configClient = await this.db.readData('configClient');
        
        // Si configClient no existe (primera ejecución), crear uno por defecto
        if (!configClient) {
            configClient = {
                instance_selct: 'Vanilla',
                account_selected: null,
                launcher_config: {},
                java_config: { java_path: '', java_memory: { min: 1, max: 2 } },
                game_config: { screen_size: { width: 1920, height: 1080 } }
            };
        }
        
        // Los datos de Microsoft/Mojang ya vienen con name y uuid en el objeto raíz
        let normalizedData = {
            ...connectionData,
            name: connectionData.name || 'Unknown',
            uuid: connectionData.uuid || ''
        };

        console.log('Cuenta guardada:', normalizedData.name, normalizedData.uuid);

        let account = await this.db.createData('accounts', normalizedData)
        let instanceSelect = configClient.instance_selct
        let instancesList = await config.getInstanceList()
        configClient.account_selected = account.ID;

        for (let instance of instancesList) {
            if (!instance) continue;
            if (instance.whitelistActive) {
                let whitelist = instance.whitelist.find(whitelist => whitelist.toLowerCase() === account.name?.toLowerCase())
                if (!whitelist) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false)
                        if (newInstanceSelect) {
                            configClient.instance_selct = newInstanceSelect.name
                            await setStatus(newInstanceSelect.status, newInstanceSelect.name)
                        }
                    }
                }
            }
        }

        configClient.account_selected = account.ID;
        await this.db.updateData('configClient', configClient);
        await addAccount(account);
        await accountSelect(account);
        changePanel('home');
    }
}
export default Login;