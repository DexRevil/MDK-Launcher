/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */

const { ipcRenderer } = require('electron')
const { Status } = require('minecraft-java-core')
const fs = require('fs');
const pkg = require('../package.json');

import config from './utils/config.js';
import database from './utils/database.js';
import logger from './utils/logger.js';
import popup from './utils/popup.js';
import { skin2D } from './utils/skin.js';
import slider from './utils/slider.js';

async function setBackground(theme) {
    if (typeof theme == 'undefined') {
        let databaseLauncher = new database();
        let configClient = await databaseLauncher.readData('configClient');
        theme = configClient?.launcher_config?.theme || "auto"
        theme = await ipcRenderer.invoke('is-dark-theme', theme).then(res => res)
    }
    let background
    let body = document.body;
    body.className = theme ? 'dark global' : 'light global';
    if (fs.existsSync(`${__dirname}/assets/images/background/easterEgg`) && Math.random() < 0.005) {
        let backgrounds = fs.readdirSync(`${__dirname}/assets/images/background/easterEgg`);
        let Background = backgrounds[Math.floor(Math.random() * backgrounds.length)];
        background = `url(./assets/images/background/easterEgg/${Background})`;
    } else if (fs.existsSync(`${__dirname}/assets/images/background/${theme ? 'dark' : 'light'}`)) {
        let backgrounds = fs.readdirSync(`${__dirname}/assets/images/background/${theme ? 'dark' : 'light'}`);
        let Background = backgrounds[Math.floor(Math.random() * backgrounds.length)];
        background = `linear-gradient(#00000080, #00000080), url(./assets/images/background/${theme ? 'dark' : 'light'}/${Background})`;
    }
    body.style.backgroundImage = background ? background : theme ? '#000' : '#fff';
    body.style.backgroundSize = 'cover';
}

async function changePanel(id) {
    let panel = document.querySelector(`.${id}`);
    let active = document.querySelector(`.active`)
    if (active) active.classList.toggle("active");
    panel.classList.add("active");
}

async function appdata() {
    return await ipcRenderer.invoke('appData').then(path => path)
}

async function addAccount(data) {
    let skin = false
    if (data?.profile?.skins[0]?.base64) skin = await new skin2D().creatHeadTexture(data.profile.skins[0].base64);
    else {
        try {
            if (data?.name) {
                let response = await fetch(`https://mineskin.eu/helm/${data.name}`);
                if (response.ok) skin = `https://mineskin.eu/helm/${data.name}`;
                else skin = false;
            }
        } catch (error) {
            skin = false;
        }
    }
    
    // Detectar si es premium o no-premium
    let isPremium = true;
    let premiumBadge = '✓ Premium';
    let premiumClasses = [];
    
    // Las cuentas Mojang offline son NO premium
    if (data?.meta?.type === 'Mojang' && data?.meta?.online === false) {
        isPremium = false;
        premiumBadge = '✗ No Premium';
        premiumClasses = ['no-premium-account'];
    }
    // Las cuentas Xbox siempre son premium
    else if (data?.meta?.type === 'Xbox') {
        isPremium = true;
        premiumBadge = '🎮 Xbox (Premium)';
        premiumClasses = ['premium-account', 'xbox-account'];
    }
    // Otros casos son premium por defecto
    else {
        premiumClasses = ['premium-account'];
    }
    
    let div = document.createElement("div");
    div.classList.add("account", "card", ...premiumClasses);
    div.id = data.ID;
    div.innerHTML = `
        <div class="profile-image" ${skin ? 'style="background-image: url(' + skin + ');"' : ''}></div>
        <div class="profile-infos">
            <div class="profile-pseudo">${data.name || 'Unknown'}</div>
            <div class="profile-uuid">${data.uuid || 'N/A'}</div>
            <div class="premium-badge ${isPremium ? 'premium' : 'no-premium'}">${premiumBadge}</div>
        </div>
        <div class="delete-profile" id="${data.ID}">
            <div class="icon-account-delete delete-profile-icon"></div>
        </div>
    `
    return document.querySelector('.accounts-list').appendChild(div);
}

async function accountSelect(data) {
    let account = document.getElementById(`${data.ID}`);
    let activeAccount = document.querySelector('.account-select')

    if (activeAccount) activeAccount.classList.toggle('account-select');
    account.classList.add('account-select');
    
    // Actualizar el badge de estado premium/no-premium
    let statusBadge = document.querySelector('.account-status-badge');
    if (statusBadge) {
        statusBadge.classList.remove('premium', 'no-premium');
        
        // Determinar si la cuenta es premium
        let isPremium = !(data?.meta?.type === 'Mojang' && data?.meta?.online === false);
        
        if (isPremium) {
            statusBadge.classList.add('premium');
        } else {
            statusBadge.classList.add('no-premium');
        }
    }
    
    if (data?.profile?.skins[0]?.base64) headplayer(data.profile.skins[0].base64); 
    else if (data?.name) {
        let img = new Image();
        img.onerror = function() {
            console.warn("Error al cargar la imagen de la cabeza del jugador, se cargará la imagen por defecto");
            document.querySelector(".player-head").style.backgroundImage = 'url("assets/images/default/steve.png")';
        }
        img.onload = function() {
            document.querySelector(".player-head").style.backgroundImage = `url(${img.src})`;
        }
        img.src = `https://mineskin.eu/helm/${data.name}`;
    }
}

async function headplayer(skinBase64) {
    let skin = await new skin2D().creatHeadTexture(skinBase64);
    document.querySelector(".player-head").style.backgroundImage = `url(${skin})`;
}

async function setStatus(opt) {
    let nameServerElement = document.querySelector('.server-status-name')
    let statusServerElement = document.querySelector('.server-status-text')
    let playersOnline = document.querySelector('.status-player-count .player-count')

    // Si los elementos no existen, salir sin error
    if (!nameServerElement || !statusServerElement || !playersOnline) {
        return;
    }

    if (!opt) {
        statusServerElement.classList.add('red')
        statusServerElement.innerHTML = `Ferme - 0 ms`
        document.querySelector('.status-player-count').classList.add('red')
        playersOnline.innerHTML = '0'
        return
    }

    let { ip, port, nameServer } = opt
    nameServerElement.innerHTML = nameServer
    let status = new Status(ip, port);
    let statusServer = await status.getStatus().then(res => res).catch(err => err);

    if (!statusServer.error) {
        statusServerElement.classList.remove('red')
        document.querySelector('.status-player-count').classList.remove('red')
        statusServerElement.innerHTML = `En ligne - ${statusServer.ms} ms`
        playersOnline.innerHTML = statusServer.playersConnect
    } else {
        statusServerElement.classList.add('red')
        statusServerElement.innerHTML = `Ferme - 0 ms`
        document.querySelector('.status-player-count').classList.add('red')
        playersOnline.innerHTML = '0'
    }
}


export {
    appdata as appdata,
    changePanel as changePanel,
    config as config,
    database as database,
    logger as logger,
    popup as popup,
    setBackground as setBackground,
    skin2D as skin2D,
    addAccount as addAccount,
    accountSelect as accountSelect,
    slider as Slider,
    pkg as pkg,
    setStatus as setStatus
}