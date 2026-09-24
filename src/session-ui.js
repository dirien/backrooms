import { formatTime, REQUIRED_CALLS } from './expedition.js';
import './session.css';

export const settings = { sensitivity: 1, volume: 0.7, motion: !matchMedia('(prefers-reduced-motion: reduce)').matches, difficulty: 'standard', quality: 'auto' };
try {
    const saved = JSON.parse(localStorage.getItem('backrooms-settings') || '{}');
    for (const key of Object.keys(settings)) {
        if (typeof saved[key] === typeof settings[key]) settings[key] = saved[key];
    }
} catch (error) {
    console.warn('Settings unavailable; using defaults.', error);
}
settings.sensitivity = Math.max(0.3, Math.min(2, settings.sensitivity));
settings.volume = Math.max(0, Math.min(1, settings.volume));

const root = document.createElement('div');
root.innerHTML = `
<section id="field-hud" hidden aria-label="Expedition status">
    <div class="field-top"><span><i class="record-light"></i> REC <b id="field-time">00:00</b></span><span>ARCHIVE 001 / LEVEL 0</span></div>
    <div class="field-objective"><small>ESTABLISH A WAY OUT</small><strong id="field-objective">Connect three telephone lines</strong><div id="call-progress">○ ○ ○</div></div>
    <div class="field-signal"><small>RECEIVER</small><strong id="field-signal">Searching for a line…</strong></div>
    <div class="field-vitals"><label>STAMINA <meter id="stamina" min="0" max="100" value="100"></meter></label><label>TORCH <meter id="battery" min="0" max="100" value="100"></meter><span id="torch-state">ON</span></label></div>
    <div class="field-help">WASD move · SHIFT sprint · F torch · E answer · ESC pause</div>
    <p id="transmission" role="status" aria-live="polite"></p>
</section>
<section id="session-overlay" class="session-overlay" hidden aria-labelledby="session-title">
    <div class="session-panel"><p class="eyebrow" id="session-eyebrow">SIGNAL INTERRUPTED</p><h2 id="session-title">Still there?</h2><p id="session-copy">The rooms can wait. Take a breath.</p><p id="session-stats"></p>
    <div id="session-settings"></div><div class="session-actions"><button id="resume-game" class="primary-action">Resume exploration</button><button id="leave-game" class="secondary-action">Return to archive</button></div></div>
</section>
<div id="mobile-actions" hidden><button id="mobile-pause" aria-label="Pause">Ⅱ</button><button id="mobile-torch">Torch</button><button id="mobile-sprint">Sprint</button><button id="mobile-answer">Answer</button></div>`;
document.body.append(root);
const byId = (id) => document.getElementById(id);
const hud = byId('field-hud');
const overlay = byId('session-overlay');
let messageUntil = 0;
let onSettings = () => {};

function makeSettings() {
    const section = document.createElement('div');
    section.className = 'field-settings';
    section.innerHTML = `<label>Mouse sensitivity <input data-setting="sensitivity" aria-label="Mouse sensitivity" type="range" min="0.3" max="2" step="0.1" value="${settings.sensitivity}"></label>
    <label>Volume <input data-setting="volume" aria-label="Volume" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label>
    <label>Camera effects <input data-setting="motion" type="checkbox" ${settings.motion ? 'checked' : ''}></label>
    <label>Difficulty <select data-setting="difficulty"><option value="standard">Survival</option><option value="explore">Wander (no sanity loss)</option></select></label>
    <label>Graphics <select data-setting="quality"><option value="auto">Automatic</option><option value="desktop">High</option><option value="mobile">Balanced</option><option value="low">Low</option></select></label>`;
    for (const select of section.querySelectorAll('select')) select.value = settings[select.dataset.setting];
    section.addEventListener('input', (event) => {
        const input = event.target;
        const key = input.dataset.setting;
        if (!key) return;
        let value = input.value;
        if (input.type === 'checkbox') value = input.checked;
        if (input.type === 'range') value = Number(input.value);
        settings[key] = value;
        try { localStorage.setItem('backrooms-settings', JSON.stringify(settings)); } catch (error) { console.warn('Could not save settings.', error); }
        for (const control of document.querySelectorAll(`[data-setting="${key}"]`)) {
            if (control.type === 'checkbox') control.checked = value;
            else control.value = String(value);
        }
        onSettings();
    });
    return section;
}
const menuSettings = document.createElement('details');
menuSettings.className = 'menu-settings';
menuSettings.innerHTML = '<summary>Field equipment & settings</summary>';
menuSettings.append(makeSettings());
document.querySelector('.menu-footer').before(menuSettings);

export function bindSessionUI(actions) {
    byId('resume-game').addEventListener('click', actions.resume);
    byId('leave-game').addEventListener('click', actions.leave);
    byId('mobile-pause').addEventListener('click', actions.pause);
    byId('mobile-torch').addEventListener('click', actions.torch);
    byId('mobile-answer').addEventListener('click', actions.answer);
    const sprint = byId('mobile-sprint');
    sprint.addEventListener('pointerdown', (event) => { sprint.setPointerCapture(event.pointerId); actions.sprint(true); });
    sprint.addEventListener('pointerup', () => actions.sprint(false));
    sprint.addEventListener('pointercancel', () => actions.sprint(false));
    onSettings = actions.settings;
}

export function showFieldHUD(visible, mobile = false) {
    hud.hidden = !visible;
    byId('mobile-actions').hidden = !visible || !mobile;
    hud.classList.toggle('mobile', mobile);
}

export function showSessionOverlay(mode, session) {
    const paused = mode === 'pause' || mode === 'ready';
    const escaped = mode === 'escaped';
    const eyebrow = escaped ? 'TRANSMISSION RECEIVED' : 'RECORDING ENDS';
    const title = escaped ? 'You made contact.' : 'Lost to the rooms.';
    const copy = escaped ? 'A voice on the other end. For the first time, you are not alone.' : 'The hum is all that remains. Follow the ringing. Each new line restores your sanity.';
    byId('session-eyebrow').textContent = paused ? 'SIGNAL INTERRUPTED' : eyebrow;
    byId('session-title').textContent = paused ? 'Still there?' : title;
    byId('session-copy').textContent = paused ? 'The rooms can wait. Take a breath.' : copy;
    byId('session-stats').textContent = `${session.calls.size} / ${REQUIRED_CALLS} lines connected · ${formatTime(session.elapsed)} · ${Math.round(session.distance)} m explored`;
    byId('resume-game').hidden = !paused;
    byId('leave-game').textContent = paused ? 'Return to archive' : 'Explore again';
    byId('session-settings').replaceChildren(...(mode === 'pause' ? [makeSettings()] : []));
    byId('session-stats').hidden = mode === 'ready';
    byId('resume-game').textContent = 'Resume exploration';
    if (mode === 'ready') {
        byId('session-eyebrow').textContent = 'RECORDING 001 / SIGNAL LOST';
        byId('session-title').textContent = 'Ready to explore';
        byId('session-copy').textContent = 'Click Begin exploration to enter Level 0. Use WASD to move and your mouse to look. Follow the ringing and press E to answer three different phones.';
        byId('resume-game').textContent = 'Begin exploration';
    }
    overlay.hidden = false;
    (paused ? byId('resume-game') : byId('leave-game')).focus();
}

export function hideSessionOverlay() { overlay.hidden = true; }
export function showTransmission(message, seconds = 7) {
    byId('transmission').textContent = message;
    messageUntil = performance.now() + seconds * 1000;
}

export function updateFieldHUD(session, distance, bearing) {
    byId('field-time').textContent = formatTime(session.elapsed);
    byId('call-progress').textContent = Array.from({ length: REQUIRED_CALLS }, (_, index) => index < session.calls.size ? '●' : '○').join('  ');
    byId('field-objective').textContent = session.calls.size === 2 ? 'Find the final line. Make contact.' : 'Connect three telephone lines';
    byId('stamina').value = session.stamina;
    byId('battery').value = session.battery;
    byId('torch-state').textContent = session.flashlight ? 'ON' : 'CHARGING';
    let strength = 'DISTANT';
    if (distance < 30) strength = 'FAINT';
    if (distance < 12) strength = 'STRONG';
    byId('field-signal').textContent = Number.isFinite(distance) ? `${strength} / ${bearing}` : 'Searching… Keep exploring';
    if (performance.now() > messageUntil) byId('transmission').textContent = '';
}
