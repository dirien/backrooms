import { BACKROOM_LEVELS } from './levels.js';
import { createLevelMenu } from './menu.js';

let runtimePromise = null;

async function loadRuntime() {
    runtimePromise ??= import('./runtime.js');
    return runtimePromise;
}

const menuController = createLevelMenu(BACKROOM_LEVELS, async (level) => {
    const runtime = await loadRuntime();
    await runtime.initGame(level, menuController);
});
