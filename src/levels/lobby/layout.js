import { CHUNK_SIZE } from '../../constants.js';

/**
 * Level 0 layout rules: a 3 x 3 room grid per chunk with guaranteed passages.
 * Pure data, so tests and lighting contexts can use it without building meshes.
 */

export const GRID_SIZE = 3;
export const CELL_SIZE = CHUNK_SIZE / GRID_SIZE;
export const WALL_THICKNESS = 0.3;
export const WALL_HEIGHT = 3;
export const WALL_LENGTH_V = CELL_SIZE + 0.31;
export const WALL_LENGTH_H = CELL_SIZE - 0.01;

const tempShuffleArray = [];

function seededRandom(seed) {
    let state = seed;
    return () => {
        state = (state * 1103515245 + 12345) & 0x7fffffff;
        return state / 0x7fffffff;
    };
}

function createCellSides(x, z) {
    return [
        { type: 'h', i: z + 1, j: x },
        { type: 'h', i: z, j: x },
        { type: 'v', i: x + 1, j: z },
        { type: 'v', i: x, j: z },
    ];
}

function getWallArray(side, horizontalWalls, verticalWalls) {
    return side.type === 'h' ? horizontalWalls : verticalWalls;
}

function countOpenSides(sides, horizontalWalls, verticalWalls) {
    let openSides = 0;

    for (const side of sides) {
        const walls = getWallArray(side, horizontalWalls, verticalWalls);
        if (!walls[side.i][side.j]) {
            openSides++;
        }
    }

    return openSides;
}

function countWalls(sides, horizontalWalls, verticalWalls) {
    let wallCount = 0;

    for (const side of sides) {
        const walls = getWallArray(side, horizontalWalls, verticalWalls);
        if (walls[side.i][side.j]) {
            wallCount++;
        }
    }

    return wallCount;
}

function getShuffledSides(sides, random) {
    tempShuffleArray.length = 0;
    tempShuffleArray.push(...sides);

    for (let index = tempShuffleArray.length - 1; index > 0; index--) {
        const swapIndex = Math.floor(random() * (index + 1));
        [tempShuffleArray[index], tempShuffleArray[swapIndex]] = [tempShuffleArray[swapIndex], tempShuffleArray[index]];
    }

    return tempShuffleArray;
}

function openRandomWallsUntilBalanced(sides, horizontalWalls, verticalWalls, random, minOpenSides, maxWalls) {
    let openSides = countOpenSides(sides, horizontalWalls, verticalWalls);
    let wallCount = countWalls(sides, horizontalWalls, verticalWalls);

    while (openSides < minOpenSides || wallCount > maxWalls) {
        const shuffledSides = getShuffledSides(sides, random);

        for (const side of shuffledSides) {
            const walls = getWallArray(side, horizontalWalls, verticalWalls);
            if (!walls[side.i][side.j]) {
                continue;
            }

            walls[side.i][side.j] = false;
            openSides++;
            wallCount--;

            if (openSides >= minOpenSides && wallCount <= maxWalls) {
                return;
            }
        }
    }
}

function removeBoundaryWalls(horizontalWalls, verticalWalls, gridSize) {
    const midPoint = Math.floor(gridSize / 2);

    for (let index = 0; index < gridSize; index++) {
        if (index !== midPoint) {
            continue;
        }

        horizontalWalls[gridSize][index] = false;
        horizontalWalls[0][index] = false;
        verticalWalls[gridSize][index] = false;
        verticalWalls[0][index] = false;
    }
}

export function generateWallGrid(cx, cz, gridSize) {
    const seed = ((cx * 73856093) ^ (cz * 19349663)) >>> 0;
    const random = seededRandom(seed);
    const horizontalWalls = [];
    const verticalWalls = [];

    for (let row = 0; row <= gridSize; row++) {
        horizontalWalls[row] = [];
        verticalWalls[row] = [];

        for (let column = 0; column < gridSize; column++) {
            horizontalWalls[row][column] = random() > 0.45;
            verticalWalls[row][column] = random() > 0.45;
        }
    }

    removeBoundaryWalls(horizontalWalls, verticalWalls, gridSize);

    for (let z = 0; z < gridSize; z++) {
        for (let x = 0; x < gridSize; x++) {
            openRandomWallsUntilBalanced(createCellSides(x, z), horizontalWalls, verticalWalls, random, 2, 2);
        }
    }

    connectRooms(horizontalWalls, verticalWalls, gridSize, random);
    return { horizontalWalls, verticalWalls };
}

// Carve a spanning tree so no generated room can be isolated from a boundary exit.
function connectRooms(horizontal, vertical, size, random) {
    const visited = new Set(['0,0']);
    const stack = [[0, 0]];
    while (stack.length > 0) {
        const [x, z] = stack.at(-1);
        const neighbors = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]
            .filter(([nx, nz]) => nx >= 0 && nz >= 0 && nx < size && nz < size && !visited.has(`${nx},${nz}`));
        if (neighbors.length === 0) {
            stack.pop();
            continue;
        }
        const [nx, nz] = neighbors[Math.floor(random() * neighbors.length)];
        if (nx === x) {horizontal[Math.max(z, nz)][x] = false;}
        else {vertical[Math.max(x, nx)][z] = false;}
        visited.add(`${nx},${nz}`);
        stack.push([nx, nz]);
    }
}

function noise(seed) {
    return Math.abs(Math.sin(seed) * 10000) % 1;
}

export function isFixturePowered(cx, cz, panelIndex) {
    // Whole circuits fail as well as individual tubes. The arrival room is lit.
    if (cx === 0 && cz === 0 && panelIndex === 4) return true;
    const circuitFailed = (cx !== 0 || cz !== 0) && noise(cx * 719 + cz * 1433 + 59) < 0.22;
    return !circuitFailed && noise(cx * 147 + cz * 317 + panelIndex * 37 + 11) > 0.18;
}
