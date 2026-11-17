// Rebuilds the Level 37 (Poolrooms) footstep sprite in public/ from its CC0
// source. Run with `npm run assets:pools`. Needs network access and ffmpeg.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { dirname, join } = path;

const root = fileURLToPath(new URL('..', import.meta.url));
const work = join(tmpdir(), 'backrooms-pool-assets');
const output = join(root, 'public/sounds/pools');

// "Footsteps, barefoot on wet tile" by SpliceSound, CC0:
// https://freesound.org/people/SpliceSound/sounds/338106/
const BAREFOOT_SOURCE = 'https://cdn.freesound.org/previews/338/338106_1480854-hq.mp3';
// Where eight clean footfalls begin in the recording, in seconds.
const STEP_ONSETS = [1.655, 2.56, 3.93, 5.585, 10.795, 12.97, 13.93, 15.15];
// Every footfall gets a slot of this length in the sprite; src/levels/pools/index.js relies on it.
const SLOT_SECONDS = 0.4;
const LEAD_SECONDS = 0.03;
const STEP_SECONDS = 0.36;
const PEAK_DB = -5;

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

const ffmpeg = findTool('ffmpeg');
const source = await download(BAREFOOT_SOURCE, join(work, 'barefoot-wet-tile.mp3'));

// Cuts one footfall out of the recording; `gain` is in decibels.
function stepFilter(onset, gain) {
    return [
        `atrim=start=${(onset - LEAD_SECONDS).toFixed(3)}:duration=${STEP_SECONDS}`,
        'asetpts=PTS-STARTPTS',
        'highpass=f=70',
        'afade=t=in:d=0.004',
        `afade=t=out:st=${(STEP_SECONDS - 0.09).toFixed(3)}:d=0.09`,
        `volume=${gain.toFixed(2)}dB`,
    ].join(',');
}

// The footfalls differ in loudness; bring each to the same peak.
function peakOf(onset) {
    // ffmpeg reports the measurement on stderr.
    const { stderr } = spawnSync(ffmpeg, ['-hide_banner', '-i', source, '-ac', '1', '-af', `${stepFilter(onset, 0)},volumedetect`, '-f', 'null', '-'], { encoding: 'utf8' });
    const match = /max_volume: (-?[\d.]+) dB/.exec(stderr);
    if (!match) throw new Error(`Could not measure the footfall at ${onset}s`);
    return Number(match[1]);
}

const chains = STEP_ONSETS.map((onset, index) => `[0:a]${stepFilter(onset, PEAK_DB - peakOf(onset))},apad=whole_dur=${SLOT_SECONDS}[step${index}]`);
const inputs = STEP_ONSETS.map((_, index) => `[step${index}]`).join('');
await mkdir(output, { recursive: true });
execFileSync(ffmpeg, [
    '-y', '-loglevel', 'error', '-i', source,
    '-filter_complex', `${chains.join(';')};${inputs}concat=n=${STEP_ONSETS.length}:v=0:a=1[out]`,
    '-map', '[out]', '-ac', '1', '-ar', '44100', '-b:a', '112k', join(output, 'barefoot-wet-tile.mp3'),
], { stdio: 'inherit' });
console.warn(`sound barefoot-wet-tile.mp3 (${STEP_ONSETS.length} footfalls, ${SLOT_SECONDS}s slots)`);
