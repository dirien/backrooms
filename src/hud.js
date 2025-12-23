import * as THREE from 'three';
import { PHONE_INTERACT_DIST } from './constants.js';

// Detect if mobile for prompt text
let isMobileHUD = false;

/**
 * HUD system for sanity bar and phone interaction prompts
 */

let hudScene = null;
let hudCamera = null;
let sanityBarBg = null;
let sanityBarFill = null;
let sanityLabelMesh = null;
let sanityPercentMesh = null;
let sanityLabelCanvas = null;
let sanityLabelCtx = null;
let sanityLabelTexture = null;
let sanityPercentCanvas = null;
let sanityPercentCtx = null;
let sanityPercentTexture = null;
let phoneInteractPromptMesh = null;
let phoneInteractCanvas = null;
let phoneInteractCtx = null;
let phoneInteractTexture = null;

export function getHudScene() {
    return hudScene;
}

export function getHudCamera() {
    return hudCamera;
}

export function createHUD() {
    hudScene = new THREE.Scene();

    const aspect = window.innerWidth / window.innerHeight;
    hudCamera = new THREE.OrthographicCamera(-aspect, aspect, 1, -1, 0.1, 10);
    hudCamera.position.z = 1;

    const barWidth = 0.7;
    const barHeight = 0.05;
    const padding = 0.06;

    const barX = -aspect + padding + barWidth / 2;
    const barY = 1 - padding - barHeight / 2 - 0.04;

    // Sanity bar background
    const bgGeo = new THREE.PlaneGeometry(barWidth + 0.01, barHeight + 0.01);
    const bgMat = new THREE.MeshBasicMaterial({
        color: 0x000000,
        transparent: true,
        opacity: 0.7
    });
    sanityBarBg = new THREE.Mesh(bgGeo, bgMat);
    sanityBarBg.position.set(barX, barY, 0);
    hudScene.add(sanityBarBg);

    // Border
    const borderGeo = new THREE.PlaneGeometry(barWidth + 0.02, barHeight + 0.02);
    const borderMat = new THREE.MeshBasicMaterial({
        color: 0xd1c28c,
        transparent: true,
        opacity: 0.4
    });
    const border = new THREE.Mesh(borderGeo, borderMat);
    border.position.set(barX, barY, -0.01);
    hudScene.add(border);

    // Sanity bar fill
    const fillGeo = new THREE.PlaneGeometry(barWidth, barHeight);
    const fillMat = new THREE.MeshBasicMaterial({
        color: 0xd1c28c,
        transparent: true,
        opacity: 0.9
    });
    sanityBarFill = new THREE.Mesh(fillGeo, fillMat);
    sanityBarFill.position.set(barX, barY, 0.01);
    hudScene.add(sanityBarFill);

    sanityBarFill.userData.originalWidth = barWidth;
    sanityBarFill.userData.originalX = barX;

    // Create canvas texture for "SANITY" label
    sanityLabelCanvas = document.createElement('canvas');
    sanityLabelCanvas.width = 512;
    sanityLabelCanvas.height = 128;
    sanityLabelCtx = sanityLabelCanvas.getContext('2d');

    sanityLabelTexture = new THREE.CanvasTexture(sanityLabelCanvas);
    sanityLabelTexture.minFilter = THREE.LinearFilter;

    sanityLabelCtx.fillStyle = 'rgba(0, 0, 0, 0)';
    sanityLabelCtx.fillRect(0, 0, 512, 128);
    sanityLabelCtx.font = '700 48px "Courier New", Courier, monospace';
    sanityLabelCtx.fillStyle = 'rgba(209, 194, 140, 0.9)';
    sanityLabelCtx.letterSpacing = '8px';
    sanityLabelCtx.fillText('S A N I T Y', 15, 75);
    sanityLabelTexture.needsUpdate = true;

    const labelGeo = new THREE.PlaneGeometry(0.38, 0.1);
    const labelMat = new THREE.MeshBasicMaterial({
        map: sanityLabelTexture,
        transparent: true
    });
    sanityLabelMesh = new THREE.Mesh(labelGeo, labelMat);
    sanityLabelMesh.position.set(barX - barWidth / 2 + 0.19, barY + barHeight / 2 + 0.035, 0.01);
    hudScene.add(sanityLabelMesh);

    // Create canvas texture for percentage
    sanityPercentCanvas = document.createElement('canvas');
    sanityPercentCanvas.width = 256;
    sanityPercentCanvas.height = 128;
    sanityPercentCtx = sanityPercentCanvas.getContext('2d');

    sanityPercentTexture = new THREE.CanvasTexture(sanityPercentCanvas);
    sanityPercentTexture.minFilter = THREE.LinearFilter;

    const percentGeo = new THREE.PlaneGeometry(0.18, 0.08);
    const percentMat = new THREE.MeshBasicMaterial({
        map: sanityPercentTexture,
        transparent: true
    });
    sanityPercentMesh = new THREE.Mesh(percentGeo, percentMat);
    sanityPercentMesh.position.set(barX + barWidth / 2 + 0.12, barY, 0.01);
    hudScene.add(sanityPercentMesh);

    // Create "Press E to interact" or "Tap to answer" prompt (will update text based on device)
    phoneInteractCanvas = document.createElement('canvas');
    phoneInteractCanvas.width = 512;
    phoneInteractCanvas.height = 128;
    phoneInteractCtx = phoneInteractCanvas.getContext('2d');

    phoneInteractTexture = new THREE.CanvasTexture(phoneInteractCanvas);
    phoneInteractTexture.minFilter = THREE.LinearFilter;

    // Default text (desktop), will be updated if mobile
    updatePhonePromptText();

    const promptGeo = new THREE.PlaneGeometry(0.6, 0.15);
    const promptMat = new THREE.MeshBasicMaterial({
        map: phoneInteractTexture,
        transparent: true
    });
    phoneInteractPromptMesh = new THREE.Mesh(promptGeo, promptMat);
    phoneInteractPromptMesh.position.set(0, -0.3, 0);
    phoneInteractPromptMesh.visible = false;
    hudScene.add(phoneInteractPromptMesh);

    hudScene.visible = false;

    return { hudScene, hudCamera };
}

export function updateHUDSanity(sanity) {
    if (!hudScene) return;

    const percent = sanity / 100;
    const originalWidth = sanityBarFill.userData.originalWidth;
    const originalX = sanityBarFill.userData.originalX;

    sanityBarFill.scale.x = Math.max(0.001, percent);
    sanityBarFill.position.x = originalX - (originalWidth / 2) * (1 - percent);

    let barColor;
    if (sanity <= 10) {
        barColor = new THREE.Color(0xff4444);
    } else if (sanity <= 30) {
        barColor = new THREE.Color(0xff8844);
    } else if (sanity <= 50) {
        barColor = new THREE.Color(0xffcc44);
    } else {
        barColor = new THREE.Color(0xd1c28c);
    }
    sanityBarFill.material.color = barColor;

    sanityPercentCtx.clearRect(0, 0, 256, 128);

    let textColor;
    if (sanity <= 10) {
        textColor = 'rgba(255, 68, 68, 1)';
    } else if (sanity <= 30) {
        textColor = 'rgba(255, 136, 68, 1)';
    } else if (sanity <= 50) {
        textColor = 'rgba(255, 204, 68, 1)';
    } else {
        textColor = 'rgba(209, 194, 140, 0.9)';
    }

    sanityPercentCtx.font = '700 52px "Courier New", Courier, monospace';
    sanityPercentCtx.fillStyle = textColor;
    sanityPercentCtx.fillText(Math.round(sanity) + '%', 15, 75);
    sanityPercentTexture.needsUpdate = true;

    // Pulsing effect at low sanity
    if (sanity <= 10) {
        const pulse = Math.sin(Date.now() * 0.01) * 0.3 + 0.7;
        sanityBarFill.material.opacity = pulse;
    } else if (sanity <= 30) {
        const pulse = Math.sin(Date.now() * 0.005) * 0.15 + 0.85;
        sanityBarFill.material.opacity = pulse;
    } else {
        sanityBarFill.material.opacity = 0.9;
    }
}

export function updateHUDCamera(playerSanity) {
    if (!hudCamera) return;
    const aspect = window.innerWidth / window.innerHeight;
    hudCamera.left = -aspect;
    hudCamera.right = aspect;
    hudCamera.updateProjectionMatrix();

    const barWidth = 0.7;
    const barHeight = 0.05;
    const padding = 0.06;
    const barX = -aspect + padding + barWidth / 2;
    const barY = 1 - padding - barHeight / 2 - 0.04;

    sanityBarBg.position.x = barX;
    sanityBarBg.position.y = barY;

    hudScene.children.forEach(child => {
        if (child !== sanityBarBg && child !== sanityBarFill &&
            child !== sanityLabelMesh && child !== sanityPercentMesh &&
            child.geometry && child.geometry.parameters.width > 0.7) {
            child.position.x = barX;
            child.position.y = barY;
        }
    });

    sanityBarFill.userData.originalX = barX;
    sanityBarFill.position.y = barY;

    sanityLabelMesh.position.x = barX - barWidth / 2 + 0.19;
    sanityLabelMesh.position.y = barY + barHeight / 2 + 0.035;

    sanityPercentMesh.position.x = barX + barWidth / 2 + 0.12;
    sanityPercentMesh.position.y = barY;

    updateHUDSanity(playerSanity);
}

export function updatePhoneInteractPrompt(nearestPhoneDist, isInteractingWithPhone) {
    if (!phoneInteractPromptMesh || !hudScene.visible) return;

    const shouldShow = nearestPhoneDist <= PHONE_INTERACT_DIST && !isInteractingWithPhone;
    phoneInteractPromptMesh.visible = shouldShow;

    if (shouldShow) {
        const pulse = Math.sin(Date.now() * 0.005) * 0.15 + 0.85;
        phoneInteractPromptMesh.material.opacity = pulse;
    }
}

export function showHUD() {
    if (hudScene) {
        hudScene.visible = true;
    }
}

export function hideHUD() {
    if (hudScene) {
        hudScene.visible = false;
    }
}

export function setMobileHUD(isMobile) {
    isMobileHUD = isMobile;
    updatePhonePromptText();
}

function updatePhonePromptText() {
    if (!phoneInteractCtx || !phoneInteractTexture) return;

    phoneInteractCtx.clearRect(0, 0, 512, 128);
    phoneInteractCtx.fillStyle = 'rgba(0, 0, 0, 0)';
    phoneInteractCtx.fillRect(0, 0, 512, 128);
    phoneInteractCtx.font = '700 36px "Courier New", Courier, monospace';
    phoneInteractCtx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    phoneInteractCtx.textAlign = 'center';

    const promptText = isMobileHUD ? 'Tap to answer' : 'Press E to answer';
    phoneInteractCtx.fillText(promptText, 256, 70);
    phoneInteractTexture.needsUpdate = true;
}
