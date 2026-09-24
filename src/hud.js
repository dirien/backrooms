import { PHONE_INTERACT_DIST } from './constants.js';

let sanityMeter = null;
let sanityLabel = null;
let phonePrompt = null;
let hudVisible = false;
let mobile = false;

export function createHUD() {
    const hud = document.getElementById('field-hud');
    const sanity = document.createElement('div');
    sanity.className = 'field-sanity';
    sanity.innerHTML = '<label>SANITY <meter id="sanity-meter" min="0" max="100" value="100"></meter><span id="sanity-value">100%</span></label>';
    phonePrompt = document.createElement('div');
    phonePrompt.className = 'phone-prompt';
    phonePrompt.hidden = true;
    hud.append(sanity, phonePrompt);
    sanityMeter = document.getElementById('sanity-meter');
    sanityLabel = document.getElementById('sanity-value');
    setMobileHUD(false);
}

export function updateHUDSanity(sanity) {
    if (!sanityMeter) return;
    sanityMeter.value = sanity;
    sanityLabel.textContent = `${Math.ceil(sanity)}%`;
    sanityLabel.classList.toggle('critical', sanity < 30);
}

export function updatePhoneInteractPrompt(distance, interacting) {
    if (phonePrompt) phonePrompt.hidden = !hudVisible || distance > PHONE_INTERACT_DIST || interacting;
}

export function showHUD() { hudVisible = true; }
export function hideHUD() {
    hudVisible = false;
    if (phonePrompt) phonePrompt.hidden = true;
}
export function setMobileHUD(isMobile) {
    mobile = isMobile;
    if (phonePrompt) phonePrompt.textContent = mobile ? 'Tap ANSWER to connect this line' : '[ E ]  CONNECT THIS LINE';
}
export function updateHUDCamera(sanity) { updateHUDSanity(sanity); }
// Compatibility with the runtime: all HUD elements now use accessible DOM.
export function getHudScene() { return null; }
export function getHudCamera() { return null; }
