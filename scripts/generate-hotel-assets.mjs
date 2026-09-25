// Rebuilds the Level 5 (Terror Hotel) assets in public/ from their CC0 and
// public-domain sources. Run with `npm run assets:hotel [textures|models|audio]`.
// Needs network access, Playwright Chromium, and ffmpeg (audio step only).
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { dirname, join } = path;

const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(tmpdir(), 'backrooms-hotel-assets');
const output = {
    graphics: join(root, 'public/graphics/hotel'),
    models: join(root, 'public/models/hotel'),
    sounds: join(root, 'public/sounds/hotel'),
};

// Poly Haven assets are CC0: https://polyhaven.com/license
const TEXTURE_SOURCES = {
    carpetDetail: 'dirty_carpet',
    damask: 'quatrefoil_jacquard_fabric',
    plaster: 'white_stucco',
};
const MODEL_SOURCES = [
    { id: 'fancy_picture_frame_01', file: 'painting.glb', simplify: 1 },
    { id: 'vintage_telephone_wall_clock', file: 'house-phone.glb', simplify: 0.3 },
    { id: 'vintage_grandfather_clock_01', file: 'grandfather-clock.glb', simplify: 0.3 },
    { id: 'ClassicConsole_01', file: 'console-table.glb', simplify: 0.4 },
];
// "Whispering", Paul Whiteman and His Ambassador Orchestra, Victor 18690-A (1920). Public domain.
const JAZZ_SOURCE = 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Paul_Whiteman_and_His_Ambassador_Orchestra_-_Whispering.flac';

// Resolve external tools from fixed directories rather than the caller's PATH.
function findTool(name) {
    const directories = [dirname(process.execPath), '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'];
    const found = directories.map((directory) => join(directory, name)).find((candidate) => existsSync(candidate));
    if (!found) throw new Error(`${name} not found in ${directories.join(', ')}`);
    return found;
}

async function download(url, target) {
    const response = await fetch(url, { headers: { 'User-Agent': 'backrooms-asset-builder/1.0' } });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
    return target;
}

async function polyHavenFiles(id) {
    const response = await fetch(`https://api.polyhaven.com/files/${id}`);
    if (!response.ok) throw new Error(`Poly Haven lookup failed for ${id}`);
    return response.json();
}

async function dataUrl(file, mime) {
    const contents = await readFile(file);
    return `data:${mime};base64,${contents.toString('base64')}`;
}

async function buildTextures() {
    const sources = {};
    for (const [key, id] of Object.entries(TEXTURE_SOURCES)) {
        const files = await polyHavenFiles(id);
        const file = await download(files.Diffuse['1k'].jpg.url, join(work, 'textures', `${id}.jpg`));
        sources[key] = await dataUrl(file, 'image/jpeg');
    }
    const browser = await chromium.launch({ args: ['--no-sandbox'] });
    try {
        const page = await browser.newPage();
        await page.goto(new URL('hotel-textures.html', import.meta.url).href);
        const textures = await page.evaluate((input) => globalThis.renderHotelTextures(input), sources);
        await mkdir(output.graphics, { recursive: true });
        for (const [name, url] of Object.entries(textures)) {
            await writeFile(join(output.graphics, `${name}.webp`), Buffer.from(url.split(',')[1], 'base64'));
            console.warn(`texture ${name}.webp`);
        }
    } finally {
        await browser.close();
    }
}

async function buildModels() {
    await mkdir(output.models, { recursive: true });
    const npx = findTool('npx');
    for (const model of MODEL_SOURCES) {
        const files = await polyHavenFiles(model.id);
        const gltf = files.gltf['1k'].gltf;
        const source = await download(gltf.url, join(work, 'models', model.id, `${model.id}.gltf`));
        for (const [relative, include] of Object.entries(gltf.include)) {
            await download(include.url, join(work, 'models', model.id, relative));
        }
        const simplify = model.simplify < 1
            ? ['--simplify-ratio', String(model.simplify), '--simplify-error', '0.002']
            : ['--simplify', 'false'];
        execFileSync(npx, [
            '--yes', '@gltf-transform/cli@4', 'optimize', source, join(output.models, model.file),
            '--compress', 'false', '--instance', 'false', '--palette', 'false',
            '--texture-compress', 'webp', '--texture-size', '512', ...simplify,
        ], { stdio: 'inherit' });
    }
}

async function buildAudio() {
    const source = await download(JAZZ_SOURCE, join(work, 'audio', 'whispering-1920.flac'));
    await mkdir(output.sounds, { recursive: true });
    // Loop-friendly excerpt; the runtime adds the gramophone filtering and crackle.
    execFileSync(findTool('ffmpeg'), [
        '-y', '-loglevel', 'error', '-ss', '3', '-t', '104', '-i', source,
        '-af', 'highpass=f=90,afade=t=in:d=2,afade=t=out:st=100:d=4,loudnorm=I=-18:TP=-2',
        '-ac', '1', '-ar', '44100', '-b:a', '72k', join(output.sounds, 'whispering-1920.mp3'),
    ], { stdio: 'inherit' });
}

const steps = { textures: buildTextures, models: buildModels, audio: buildAudio };
const requested = process.argv.slice(2).filter((step) => step in steps);
for (const step of requested.length > 0 ? requested : Object.keys(steps)) {
    await steps[step]();
}
