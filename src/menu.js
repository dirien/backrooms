export function createLevelMenu(levels, onLaunch) {
    const startScreen = document.getElementById('start-screen');
    const titleElement = document.getElementById('menu-title');
    const subtitleElement = document.getElementById('menu-subtitle');
    const selectionView = document.getElementById('selection-view');
    const detailView = document.getElementById('detail-view');
    const levelGrid = document.getElementById('level-grid');
    const detailBadge = document.getElementById('detail-badge');
    const detailHeading = document.getElementById('detail-heading');
    const detailTagline = document.getElementById('detail-tagline');
    const detailSummary = document.getElementById('detail-summary');
    const detailBody = document.getElementById('detail-body');
    const detailFeatures = document.getElementById('detail-features');
    const detailObjective = document.getElementById('detail-objective');
    const launchButton = document.getElementById('launch-level');
    const backButton = document.getElementById('back-to-selection');
    const desktopControls = document.getElementById('desktop-controls');
    const mobileControls = document.getElementById('mobile-controls');

    const levelMap = new Map(levels.map((level) => [level.id, level]));
    let currentLevelId = levels[0]?.id ?? null;

    renderTiles();
    updateControlsHint();
    showSelection();
    backButton.addEventListener('click', showSelection);
    launchButton.addEventListener('click', () => onLaunch(levelMap.get(currentLevelId)));
    startScreen.addEventListener('click', handleTileSelection);

    return {
        getSelectedLevel() {
            return levelMap.get(currentLevelId);
        },
        showDetails(levelId) {
            currentLevelId = levelId;
            renderDetail(levelMap.get(levelId));
        },
        showSelection,
    };

    function renderTiles() {
        const tileMarkup = levels.map((level) => {
            const isPlayable = level.id === 'lobby';
            const classes = ['level-tile'];
            if (level.id === currentLevelId) classes.push('selected');
            if (!isPlayable) classes.push('locked');

            return `
            <button
                class="${classes.join(' ')}"
                data-level-id="${level.id}"
                type="button"
                ${isPlayable ? '' : 'disabled'}
            >
                <span class="tile-static"></span>
                <span class="level-badge">${level.badge}</span>
                <span class="level-name">${level.menuLabel}</span>
                <span class="level-status">${level.menuStatus}</span>
                <span class="level-teaser">${level.teaser}</span>
            </button>`;
        }).join('');

        levelGrid.innerHTML = tileMarkup;
    }

    function handleTileSelection(event) {
        const button = event.target.closest('[data-level-id]');
        if (!button) {
            return;
        }

        currentLevelId = button.dataset.levelId;
        renderTiles();
        renderDetail(levelMap.get(currentLevelId));
        showDetailView();
    }

    function renderDetail(level) {
        if (!level) {
            return;
        }

        startScreen.style.setProperty('--level-accent', level.theme.accent);
        titleElement.textContent = 'BACKROOMS';
        subtitleElement.textContent = 'Choose your descent';
        detailBadge.textContent = level.badge;
        detailHeading.textContent = level.detailTitle;
        detailTagline.textContent = level.detailSubtitle;
        detailSummary.textContent = level.summary;
        detailObjective.textContent = level.objective;
        detailBody.innerHTML = level.detailParagraphs.map((paragraph) => `<p>${paragraph}</p>`).join('');
        detailFeatures.innerHTML = level.features.map((feature) => `<li>${feature}</li>`).join('');
        launchButton.textContent = level.callToAction;
        showDetailView();
    }

    function showSelection() {
        selectionView.hidden = false;
        detailView.hidden = true;
    }

    function showDetailView() {
        selectionView.hidden = true;
        detailView.hidden = false;
    }

    function updateControlsHint() {
        const isTouchDevice = 'ontouchstart' in globalThis || navigator.maxTouchPoints > 0;
        desktopControls.style.display = isTouchDevice ? 'none' : 'block';
        mobileControls.style.display = isTouchDevice ? 'block' : 'none';
    }
}
