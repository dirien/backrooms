/**
 * Input handling for keyboard, mouse, and touch controls
 */

// Movement state
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;

// Mobile touch controls
let isMobile = false;
let joystickInput = { x: 0, y: 0 };
let joystickActive = false;
let joystickTouchId = null;
let lookTouchId = null;
let lastLookPos = { x: 0, y: 0 };

export function getMovementState() {
    return { moveForward, moveBackward, moveLeft, moveRight };
}

export function getJoystickInput() {
    return joystickInput;
}

export function isJoystickActive() {
    return joystickActive;
}

export function isMobileDevice() {
    return isMobile;
}

export function resetMovementState() {
    moveForward = false;
    moveBackward = false;
    moveLeft = false;
    moveRight = false;
    joystickInput = { x: 0, y: 0 };
    joystickActive = false;
}

export function detectMobile() {
    isMobile = (
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    );
    return isMobile;
}

export function initKeyboardControls(onDebugToggle, onSanityCycle, onPhoneInteract) {
    document.addEventListener('keydown', (e) => {
        if (e.code === 'KeyW') moveForward = true;
        if (e.code === 'KeyA') moveLeft = true;
        if (e.code === 'KeyS') moveBackward = true;
        if (e.code === 'KeyD') moveRight = true;
        if (e.code === 'KeyO' && onDebugToggle) onDebugToggle();
        if (e.code === 'KeyN' && onSanityCycle) onSanityCycle(-1);
        if (e.code === 'KeyM' && onSanityCycle) onSanityCycle(1);
        if (e.code === 'KeyE' && onPhoneInteract) onPhoneInteract();
    });

    document.addEventListener('keyup', (e) => {
        if (e.code === 'KeyW') moveForward = false;
        if (e.code === 'KeyA') moveLeft = false;
        if (e.code === 'KeyS') moveBackward = false;
        if (e.code === 'KeyD') moveRight = false;
    });
}

export function initMouseControls(renderer, camera, onInteraction) {
    document.addEventListener('mousedown', () => {
        if (!isMobile) {
            renderer.domElement.requestPointerLock();
        }
        if (onInteraction) onInteraction();
    });

    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement === renderer.domElement) {
            camera.rotation.order = 'YXZ';
            camera.rotation.y -= e.movementX * 0.002;
            camera.rotation.x -= e.movementY * 0.002;
            camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        }
    });
}

export function initTouchControls(camera, onInteraction, onTapToInteract) {
    const touchControls = document.getElementById('touch-controls');
    const joystickZone = document.getElementById('joystick-zone');
    const joystickStick = document.getElementById('joystick-stick');
    const joystickBase = document.getElementById('joystick-base');
    const lookZone = document.getElementById('look-zone');

    if (!touchControls) return;

    touchControls.classList.add('active');

    const joystickRect = joystickBase.getBoundingClientRect();
    const maxJoystickDist = joystickRect.width / 2 - 25;

    // One-time touch listener for audio context
    document.addEventListener('touchstart', () => {
        if (onInteraction) onInteraction();
    }, { once: true });

    // Joystick touch handlers
    joystickZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (joystickTouchId !== null) return;

        const touch = e.changedTouches[0];
        joystickTouchId = touch.identifier;
        joystickActive = true;
        joystickStick.classList.add('active');
        updateJoystick(touch.clientX, touch.clientY, joystickBase, joystickStick, maxJoystickDist);
    }, { passive: false });

    joystickZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                updateJoystick(touch.clientX, touch.clientY, joystickBase, joystickStick, maxJoystickDist);
                break;
            }
        }
    }, { passive: false });

    joystickZone.addEventListener('touchend', (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === joystickTouchId) {
                joystickTouchId = null;
                joystickActive = false;
                joystickInput = { x: 0, y: 0 };
                joystickStick.classList.remove('active');
                joystickStick.style.transform = 'translate(-50%, -50%)';
                break;
            }
        }
    });

    joystickZone.addEventListener('touchcancel', () => {
        joystickTouchId = null;
        joystickActive = false;
        joystickInput = { x: 0, y: 0 };
        joystickStick.classList.remove('active');
        joystickStick.style.transform = 'translate(-50%, -50%)';
    });

    // Look zone touch handlers with tap detection for phone interaction
    let lookTouchStartPos = { x: 0, y: 0 };
    let lookTouchStartTime = 0;
    const TAP_THRESHOLD_DIST = 15; // Max movement in pixels to be considered a tap
    const TAP_THRESHOLD_TIME = 300; // Max time in ms to be considered a tap

    lookZone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (lookTouchId !== null) return;

        const touch = e.changedTouches[0];
        lookTouchId = touch.identifier;
        lastLookPos = { x: touch.clientX, y: touch.clientY };
        lookTouchStartPos = { x: touch.clientX, y: touch.clientY };
        lookTouchStartTime = Date.now();
    }, { passive: false });

    lookZone.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const touch of e.changedTouches) {
            if (touch.identifier === lookTouchId) {
                const dx = touch.clientX - lastLookPos.x;
                const dy = touch.clientY - lastLookPos.y;

                if (camera) {
                    camera.rotation.order = 'YXZ';
                    camera.rotation.y -= dx * 0.003;
                    camera.rotation.x -= dy * 0.003;
                    camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
                }

                lastLookPos = { x: touch.clientX, y: touch.clientY };
                break;
            }
        }
    }, { passive: false });

    lookZone.addEventListener('touchend', (e) => {
        for (const touch of e.changedTouches) {
            if (touch.identifier === lookTouchId) {
                // Check if this was a tap (short duration, minimal movement)
                const dx = touch.clientX - lookTouchStartPos.x;
                const dy = touch.clientY - lookTouchStartPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const duration = Date.now() - lookTouchStartTime;

                if (dist < TAP_THRESHOLD_DIST && duration < TAP_THRESHOLD_TIME) {
                    // This was a tap - check for phone interaction
                    if (onTapToInteract) {
                        onTapToInteract(touch.clientX, touch.clientY);
                    }
                }

                lookTouchId = null;
                break;
            }
        }
    });

    lookZone.addEventListener('touchcancel', () => {
        lookTouchId = null;
    });
}

function updateJoystick(touchX, touchY, joystickBase, joystickStick, maxJoystickDist) {
    const rect = joystickBase.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    let dx = touchX - centerX;
    let dy = touchY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > maxJoystickDist) {
        dx = (dx / dist) * maxJoystickDist;
        dy = (dy / dist) * maxJoystickDist;
    }

    joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

    joystickInput.x = dx / maxJoystickDist;
    joystickInput.y = dy / maxJoystickDist;
}
