/* ==========================================================
   CFB Predictions — SPA front-end
   ========================================================== */

// ---- State -------------------------------------------------------
const state = {
  season: null,
  snapshots: [],
  latestSnapshot: null,
  weeks: [],
  latestWeek: null,
  currentPage: 'games',  // 'games' | 'postseason' | 'pbp' | 'rankings' | 'players' | 'about'
  previousPage: 'games',
  currentWeek: null,
  currentSnapshot: null,
  forecastMode: 'free',  // 'free' (market-free model) | 'blend' (market-blended); chosen in the snapshot dropdown
  currentGameId: null,
  currentGameMeta: null,
  currentPos: 'all',
  playerLimit: 50,       // 25 | 50 | 100 | 'all'
  pbpSource: 'actual',   // 'actual' (CFBD play log, names the players) | 'simulated'
  teams: {},             // school -> { logo, color, abbreviation, conference }
  sortCol: null,
  sortDir: 1,
};

// ---- DOM refs ----------------------------------------------------
const app = document.getElementById('app');
const weekSelect = document.getElementById('week-select');
const snapSelect = document.getElementById('snapshot-select');
const navSeason = document.getElementById('nav-season');
const syncBtn = document.getElementById('sync-cfbd-btn');

function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(100%)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ---- Init --------------------------------------------------------
async function init() {
  const meta = await apiFetch('/api/meta');
  state.season = meta.season;
  state.snapshots = meta.snapshots;
  state.latestSnapshot = meta.latest_snapshot;
  state.weeks = meta.weeks;
  state.latestWeek = meta.latest_week;
  state.currentWeek = meta.current_week ?? meta.latest_week;
  state.currentSnapshot = meta.latest_snapshot;
  state.forecastMode = loadForecastMode();

  // Logos are optional: without them the app shows team initials instead.
  state.teams = await apiFetch(`/api/teams?season=${meta.season}`).catch(() => ({}));

  navSeason.textContent = `${meta.season}`;
  buildWeekSelect();
  buildSnapSelect();
  setupNavTabs();
  setupControls();

  const { page, gameId, week } = parseHashRoute();
  if (page) {
    openRoute(page, gameId, week);
  } else {
    const path = window.location.pathname.replace(/^\//, '');
    navigateTo(PAGES.includes(path) ? path : 'games');
  }
}

// ---- Selectors ---------------------------------------------------
function buildWeekSelect() {
  weekSelect.innerHTML = '';
  state.weeks.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = `Week ${w}`;
    if (w === state.currentWeek) opt.selected = true;
    weekSelect.appendChild(opt);
  });
}

// Each snapshot is offered twice: the market-free model and the market-blended forecast, model + beta*(line - model)
// (evaluation/market_blend.py). The mode changes only the game cards; simulated play-by-play, rankings and player values
// stay market-free (design invariants 1 and 2). Option values are "<snapshot>|<mode>".
const FORECAST_MODES = [['free', 'Market-free'], ['blend', 'Market-blended']];

function buildSnapSelect() {
  snapSelect.innerHTML = '';
  const snaps = [state.latestSnapshot, ...state.snapshots.slice().reverse().filter(s => s !== state.latestSnapshot)];
  snaps.forEach(s => {
    FORECAST_MODES.forEach(([mode, label]) => {
      const opt = document.createElement('option');
      opt.value = `${s ?? ''}|${mode}`;
      opt.textContent = `As of Week ${s}${s === state.latestSnapshot ? ' (latest)' : ''} · ${label}`;
      if (s === state.currentSnapshot && mode === state.forecastMode) opt.selected = true;
      snapSelect.appendChild(opt);
    });
  });
}

function loadForecastMode() {
  try {
    const m = localStorage.getItem('forecastMode');
    return m === 'blend' ? 'blend' : 'free';
  } catch { return 'free'; }
}

function setupControls() {
  weekSelect.addEventListener('change', () => {
    state.currentWeek = parseInt(weekSelect.value);
    if (state.currentPage === 'games') renderGames();
    else if (state.currentPage === 'rankings') renderRankings();
    else if (state.currentPage === 'players') renderPlayers();
  });
  snapSelect.addEventListener('change', () => {
    const [snap, mode] = snapSelect.value.split('|');
    state.currentSnapshot = parseInt(snap) || state.latestSnapshot;
    state.forecastMode = mode === 'blend' ? 'blend' : 'free';
    try { localStorage.setItem('forecastMode', state.forecastMode); } catch { /* storage unavailable: keep in memory */ }
    if (state.currentPage === 'games') renderGames();
    else if (state.currentPage === 'postseason') renderPostseason();
    else if (state.currentPage === 'rankings') renderRankings();
    else if (state.currentPage === 'players') renderPlayers();
  });

  if (syncBtn && typeof STATIC_MODE !== 'undefined' && STATIC_MODE) {
    syncBtn.style.display = 'none';
  }

  if (syncBtn) {
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      const icon = syncBtn.querySelector('.sync-icon');
      if (icon) icon.classList.add('spinning');
      showToast('Fetching latest game scores from CFBD...', 'info');

      try {
        const res = await fetch(`/api/sync-cfbd?season=${state.season}`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Failed to sync with CFBD');

        showToast(data.message || 'CFBD sync successful!', 'success');
        // Refresh current page view with updated real scores
        if (state.currentPage === 'games') renderGames();
        else if (state.currentPage === 'postseason') renderPostseason();
        else if (state.currentPage === 'pbp' && state.currentGameId) renderPBP(state.currentGameId);
      } catch (err) {
        showToast(`Sync error: ${err.message}`, 'error', 5000);
      } finally {
        syncBtn.disabled = false;
        if (icon) icon.classList.remove('spinning');
      }
    });
  }
}

// ---- Nav tabs ----------------------------------------------------
function setupNavTabs() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(tab.dataset.page);
    });
  });
}

function setActiveTab(page) {
  const activeTabPage = page === 'pbp' ? state.previousPage : page;
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.page === activeTabPage);
  });
  // Show week selector on games, team rankings, and player rankings
  weekSelect.style.display = (page === 'games' || page === 'rankings' || page === 'players') ? '' : 'none';
  snapSelect.style.display = (page === 'about') ? 'none' : '';
}

// A route is `#/<page>`, or `#/pbp/<game id>/<week>` for a game (postseason games have no week). The week lets a shared
// link find the game's card, which holds the team names, scores and win probability.
const PAGES = ['games', 'postseason', 'rankings', 'players', 'about', 'pbp'];
const isPostseasonId = id => id >= 900000 && id < 950000;

function parseHashRoute() {
  const hash = window.location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/');
  const gameId = parts[1] ? parseInt(parts[1], 10) : null;
  const week = parts[2] ? parseInt(parts[2], 10) : null;
  return { page: parts[0] || '', gameId: Number.isNaN(gameId) ? null : gameId, week: Number.isNaN(week) ? null : week };
}

// Open the page a link names (the hash is already in the URL). Unknown pages, such as an old bookmark, show the games.
function openRoute(page, gameId, week) {
  if (!PAGES.includes(page) || (page === 'pbp' && !gameId)) page = 'games';
  if (page === 'pbp') {
    // navigateTo records the page we came from as the back target, so name the page the link belongs to
    state.currentPage = isPostseasonId(gameId) ? 'postseason' : 'games';
    if (state.weeks.includes(week)) {
      state.currentWeek = week;
      weekSelect.value = week;
    }
  }
  navigateTo(page, page === 'pbp' ? gameId : null, null, false);
}

window.addEventListener('hashchange', () => {
  const { page, gameId, week } = parseHashRoute();
  if (page && (state.currentPage !== page || state.currentGameId !== gameId)) {
    openRoute(page, gameId, week);
  }
});

function navigateTo(page, gameId = null, gameMeta = null, updateHash = true) {
  if (page === 'pbp' && state.currentPage !== 'pbp') {
    state.previousPage = state.currentPage;
  }
  state.currentPage = page;
  state.currentGameId = gameId;
  state.currentGameMeta = gameMeta;
  setActiveTab(page);

  if (updateHash) {
    const week = gameMeta?.week;
    const targetHash = gameId ? `#/${page}/${gameId}${week ? '/' + week : ''}` : `#/${page}`;
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
  }

  if (page === 'games') renderGames();
  else if (page === 'postseason') renderPostseason();
  else if (page === 'pbp') renderPBP(gameId);
  else if (page === 'rankings') renderRankings();
  else if (page === 'players') renderPlayers();
  else if (page === 'about') renderAbout();
  else renderGames();
}

// ---- API helper (Dual-mode: dynamic API or static pre-rendered JSON) ----
const IS_STATIC_MODE = (typeof STATIC_MODE !== 'undefined' && Boolean(STATIC_MODE));
const STATIC_BASE = (typeof DATA_ROOT !== 'undefined' ? DATA_ROOT : './data');

function mapToStaticPath(apiUrl) {
  const u = new URL(apiUrl, window.location.origin);
  const path = u.pathname;
  const p = u.searchParams;

  const snapRaw = p.get('snapshot');
  // No snapshot only happens when the season has no from_week runs, and then the server serves the full run too
  const snapTag = (snapRaw !== null && snapRaw !== '' && snapRaw !== 'undefined') ? `s${snapRaw}` : 'sfull';
  const weekRaw = p.get('week');
  const weekTag = weekRaw ? `w${String(weekRaw).padStart(2, '0')}` : '';

  // 1. Meta
  if (path === '/api/meta') {
    return { filePath: `${STATIC_BASE}/meta.json` };
  }
  // 2. Teams
  if (path.startsWith('/api/teams')) {
    return { filePath: `${STATIC_BASE}/teams.json` };
  }
  // 3. Games
  if (path === '/api/games') {
    return { filePath: `${STATIC_BASE}/games/${weekTag}_${snapTag}.json` };
  }
  // 4-5. Play-by-play and box score. The public site publishes only the simulated ones (export_static.py); the real
  // world appears only as final scores, so every source resolves to the simulated file.
  const pbpMatch = path.match(/\/api\/games\/(\d+)\/pbp/);
  if (pbpMatch) {
    return { filePath: `${STATIC_BASE}/pbp/${pbpMatch[1]}_${snapTag}_simulated.json` };
  }
  const boxMatch = path.match(/\/api\/games\/(\d+)\/boxscore/);
  if (boxMatch) {
    return { filePath: `${STATIC_BASE}/boxscore/${boxMatch[1]}_${snapTag}_simulated.json` };
  }
  // 6. Postseason game meta
  const psGameMatch = path.match(/\/api\/postseason\/games\/(\d+)/);
  if (psGameMatch) {
    const id = psGameMatch[1];
    return { filePath: `${STATIC_BASE}/postseason/game_${id}_${snapTag}.json` };
  }
  // 7. Postseason bracket
  if (path.startsWith('/api/postseason')) {
    return { filePath: `${STATIC_BASE}/postseason/bracket_${snapTag}.json` };
  }
  // 8. Team rankings
  if (path === '/api/rankings/teams') {
    return { filePath: `${STATIC_BASE}/rankings/teams/${weekTag ? weekTag + '_' : ''}${snapTag}.json` };
  }
  // 9. Player rankings
  if (path === '/api/rankings/players') {
    const pos = (p.get('pos') || 'all').toLowerCase();
    const limit = p.get('limit') ? parseInt(p.get('limit'), 10) : null;
    return {
      filePath: `${STATIC_BASE}/rankings/players/${pos}_${weekTag ? weekTag + '_' : ''}${snapTag}.json`,
      limit: (limit && !isNaN(limit)) ? limit : null,
    };
  }

  return { filePath: apiUrl };
}

async function apiFetch(url) {
  if (!IS_STATIC_MODE) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error ${res.status}: ${url}`);
    return res.json();
  }

  // A snapshot holds only the weeks it simulated; for the others the server reads the full-season run
  // (data_layer._scoresheet, _pbp_week), and the export stores those once under the `sfull` tag (export_static.py).
  const mapped = mapToStaticPath(url);
  let res = await fetch(mapped.filePath);
  const fallback = mapped.filePath.replace(/_s\d+(?=[_.])/, '_sfull');
  if (res.status === 404 && fallback !== mapped.filePath) res = await fetch(fallback);
  if (!res.ok) throw new Error(`Static data not found ${res.status}: ${mapped.filePath}`);
  let data = await res.json();

  if (mapped.limit && Array.isArray(data)) {
    data = data.slice(0, mapped.limit);
  }
  return data;
}

function showLoader() {
  app.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';
}

// ---- Team identity (logo with initials fallback) -----------------
function teamInitials(name) {
  const words = String(name ?? '').split(/\s+/).filter(w => /[A-Za-z]/.test(w));
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function teamLogo(name, cls = 'team-logo') {
  const logo = state.teams[name]?.logo;
  if (logo) {
    return `<img class="${cls}" src="${escHtml(logo)}" alt="" loading="lazy" data-team="${escHtml(name)}">`;
  }
  return `<span class="${cls} team-logo-fallback" aria-hidden="true">${escHtml(teamInitials(name))}</span>`;
}

// If a logo fails to load, swap in the initials badge rather than a broken image.
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('team-logo')) return;
  const span = document.createElement('span');
  span.className = `${img.className} team-logo-fallback`;
  span.setAttribute('aria-hidden', 'true');
  span.textContent = teamInitials(img.dataset.team || '');
  img.replaceWith(span);
}, true);

// "Team by X.X" from a home-relative margin.
function favoriteText(g, margin) {
  if (margin == null) return '—';
  if (Math.abs(margin) < 0.05) return 'Even';
  return `${escHtml(margin > 0 ? g.home_team : g.away_team)} by ${Math.abs(margin).toFixed(1)}`;
}

// The market-free and market-blended margins side by side (design invariant 2), on every card that has both.
function marketCompareLine(g) {
  if (g.model_margin == null || g.blend_margin == null) return '';
  const active = state.forecastMode === 'blend' ? 'blend' : 'free';
  return `
    <div class="market-compare" title="Blend = model + β × (line − model), β = ${g.blend_beta?.toFixed(2)} fit on earlier weeks' forecasts">
      <span class="${active === 'free' ? 'active' : ''}">Model: ${favoriteText(g, g.model_margin)}</span>
      <span class="${active === 'blend' ? 'active' : ''}">Blended: ${favoriteText(g, g.blend_margin)}</span>
    </div>`;
}

// Badge that says where a game's win probability and score came from.
function forecastBadge(g) {
  if (state.forecastMode === 'blend' && g.blend_home_score != null) {
    return `<span class="badge badge-blend" title="Market-blended: model + β × (line − model), β = ${g.blend_beta?.toFixed(2)}. Not a simulated game; the play-by-play stays market-free.">Blended</span>`;
  }
  if (g.has_ensemble) {
    return `<span class="badge badge-ensemble" title="${escHtml(g.forecast_note || 'Average of the seed ensemble')}">Ensemble</span>`;
  }
  return `<span class="badge badge-single" title="${escHtml(g.forecast_note || 'Single seed')}">Single seed</span>`;
}

// ----------------------------------------------------------------
// PAGE: GAMES
// ----------------------------------------------------------------
async function renderGames() {
  showLoader();
  const params = new URLSearchParams({
    week: state.currentWeek,
    snapshot: state.currentSnapshot ?? '',
  });
  let games;
  try {
    games = await apiFetch(`/api/games?${params}`);
  } catch (e) {
    app.innerHTML = `<div class="empty-state">No games found for Week ${state.currentWeek}.</div>`;
    return;
  }

  const completedCount = games.filter(g => g.completed).length;
  const ensembleCount = games.filter(g => g.has_ensemble).length;
  const blendCount = games.filter(g => g.blend_home_score != null).length;
  const blendMode = state.forecastMode === 'blend';
  const html = `
    <div class="section-header">
      <h1 class="section-title">Week ${state.currentWeek} Games${blendMode ? ' · Market-blended' : ''}</h1>
      <span>${games.length} games &nbsp;·&nbsp; ${completedCount} completed &nbsp;·&nbsp; ${ensembleCount} on ensemble${blendMode ? ` &nbsp;·&nbsp; ${blendCount} blended` : ''}</span>
    </div>
    <p class="forecast-legend">
      <span class="badge badge-ensemble">Ensemble</span> average of five model seeds.
      <span class="badge badge-single">Single seed</span> one model run. The ensemble covers FBS-vs-FBS games.
      ${blendMode
        ? `<span class="badge badge-blend">Blended</span> model + β × (line − model), β fit on earlier weeks only.`
        : ''}
    </p>
    <div class="games-grid" id="games-grid"></div>
  `;
  app.innerHTML = html;

  const grid = document.getElementById('games-grid');
  games.forEach(g => {
    grid.appendChild(buildGameCard(g));
  });
}

function buildGameCard(g) {
  const isCompleted = g.completed && g.real_home_score !== null && g.real_away_score !== null;

  // Determine winners
  const realHomeWon = isCompleted ? g.real_home_score > g.real_away_score : null;
  const realAwayWon = isCompleted ? g.real_away_score > g.real_home_score : null;
  const isRealTie = isCompleted ? g.real_home_score === g.real_away_score : false;

  // Blended mode shows the market-blended score and win probability where the game has one; otherwise the market-free card.
  const blended = state.forecastMode === 'blend' && g.blend_home_score != null;
  const shownHome = blended ? g.blend_home_score : g.sim_home_score;
  const shownAway = blended ? g.blend_away_score : g.sim_away_score;
  const scoreTitle = blended ? 'Market-blended projected score' : 'Model Predicted Score';

  const simHomeWon = shownHome > shownAway;
  const simAwayWon = shownAway > shownHome;

  let modelResult = 'unplayed'; // 'correct' | 'incorrect' | 'unplayed'
  if (isCompleted) {
    if (isRealTie) {
      modelResult = (shownHome === shownAway) ? 'correct' : 'incorrect';
    } else {
      modelResult = ((simHomeWon && realHomeWon) || (simAwayWon && realAwayWon)) ? 'correct' : 'incorrect';
    }
  }

  // Win probability
  const winProb = blended ? g.blend_home_win_prob : g.home_win_prob;
  const homeWinPct = winProb !== null && winProb !== undefined
    ? Math.round(winProb * 100)
    : (g.sim_margin >= 0 ? Math.min(95, 50 + Math.abs(g.sim_margin) * 1.5) : null);
  const awayWinPct = homeWinPct !== null ? 100 - homeWinPct : null;

  const badge = isCompleted
    ? `<span class="badge ${modelResult === 'correct' ? 'badge-correct' : 'badge-incorrect'}">${modelResult === 'correct' ? '✓ Predicted Correctly' : '✗ Predicted Incorrectly'}</span>`
    : '<span class="badge badge-predicted">Predicted</span>';

  const vegasLine = g.vegas_spread !== null
    ? `<span${g.line_asof ? ` title="Lines snapshot used by the forecast: ${escHtml(g.line_asof)}"` : ''}>Line: ${g.vegas_spread > 0 ? '+' : ''}${g.vegas_spread} &nbsp;|&nbsp; O/U: ${g.vegas_ou}</span>`
    : '';

  const homeRealScore = isCompleted ? g.real_home_score : '—';
  const awayRealScore = isCompleted ? g.real_away_score : '—';

  const card = document.createElement('div');
  card.className = `game-card ${isCompleted ? 'completed ' + modelResult : 'unplayed'}`;
  card.innerHTML = `
    <div class="game-card-header">
      <span>${badge} ${forecastBadge(g)}</span>
      <span>${g.start_date ? escHtml(formatDate(g.start_date)) : ''}</span>
    </div>
    <div class="game-matchup">
      <div class="team-row">
        <span class="team-name${realAwayWon ? ' winner' : ''}">${teamLogo(g.away_team)}${escHtml(g.away_team)}</span>
        <div class="score-col">
          <span class="score-sim ${modelResult}" title="${scoreTitle}">${Math.round(shownAway)}</span>
          ${isCompleted ? `<span class="score-real${realAwayWon ? ' winner' : ''}" title="Actual Real Score"><span class="score-label-sub">Final</span>${awayRealScore}</span>` : ''}
        </div>
      </div>
      <div class="team-row">
        <span class="team-name${realHomeWon ? ' winner' : ''}">${teamLogo(g.home_team)}${escHtml(g.home_team)}</span>
        <div class="score-col">
          <span class="score-sim ${modelResult}" title="${scoreTitle}">${Math.round(shownHome)}</span>
          ${isCompleted ? `<span class="score-real${realHomeWon ? ' winner' : ''}" title="Actual Real Score"><span class="score-label-sub">Final</span>${homeRealScore}</span>` : ''}
        </div>
      </div>
    </div>
    ${marketCompareLine(g)}
    ${homeWinPct !== null ? `
      <div class="win-prob-label">
        <span>${escHtml(g.away_team)} <strong>${awayWinPct}%</strong></span>
        <span style="color:var(--text-muted);font-size:.72rem">Win Probability</span>
        <span><strong>${homeWinPct}%</strong> ${escHtml(g.home_team)}</span>
      </div>
      <div class="win-bar-wrap">
        <div class="win-bar-away" style="width:${awayWinPct}%"></div>
        <div class="win-bar-home" style="width:${homeWinPct}%"></div>
      </div>
    ` : ''}
    <div class="game-card-footer">
      <span>${vegasLine}${g.has_actual_pbp ? ' <span class="pbp-avail" title="Actual play-by-play is available">● Actual PBP</span>' : ''}</span>
      <span>${g.neutral_site ? '🏟 Neutral' : '🏠 Home'}</span>
    </div>
  `;
  card.addEventListener('click', () => navigateTo('pbp', g.game_id, g));
  return card;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

// ----------------------------------------------------------------
// PAGE: PBP
// ----------------------------------------------------------------
async function renderPBP(gameId) {
  showLoader();

  let game = state.currentGameMeta ?? null;
  const isPostseasonGame = isPostseasonId(gameId) || state.previousPage === 'postseason';

  if (!game) {
    if (isPostseasonGame) {
      try {
        game = await apiFetch(`/api/postseason/games/${gameId}?snapshot=${state.currentSnapshot ?? ''}`);
      } catch { game = {}; }
    } else {
      const params = new URLSearchParams({
        week: state.currentWeek,
        snapshot: state.currentSnapshot ?? '',
      });
      let games = [];
      try { games = await apiFetch(`/api/games?${params}`); } catch {}
      game = games.find(g => g.game_id === gameId) ?? {};
    }
  }

  const targetWeek = game?.week ?? state.currentWeek;
  const hasActual = Boolean(game?.has_actual_pbp) && !isPostseasonGame;
  const source = hasActual ? state.pbpSource : 'simulated';

  const pbpParams = new URLSearchParams({
    snapshot: state.currentSnapshot ?? '',
    source,
  });
  if (!isPostseasonGame && targetWeek) {
    pbpParams.set('week', targetWeek);
  }
  let plays = [];
  try {
    plays = await apiFetch(`/api/games/${gameId}/pbp?${pbpParams}`);
  } catch {
    app.innerHTML = `<div class="empty-state">No play-by-play data available for this game.</div>`;
    return;
  }

  // Player box score for the selected source: official (CFBD) for actual plays, built from the attributed plays for simulated
  // ones. Games with neither fall back to team totals from their plays.
  let boxTeams = [];
  if (source === 'simulated' || (game?.completed && targetWeek)) {
    const boxParams = new URLSearchParams({ season: state.season, source });
    if (state.currentSnapshot != null) boxParams.set('snapshot', state.currentSnapshot);
    if (!isPostseasonGame && targetWeek) boxParams.set('week', targetWeek);
    try {
      boxTeams = await apiFetch(`/api/games/${gameId}/boxscore?${boxParams}`);
    } catch { boxTeams = []; }
  }

  const drives = groupByDrive(plays);

  // Teams from the game record, else from the first play
  const lastPlay = plays[plays.length - 1];
  const homeTeam = game?.home_team ?? lastPlay?.home ?? 'Home';
  const awayTeam = game?.away_team ?? lastPlay?.away ?? 'Away';

  let simHomeScore = Math.round(game?.sim_home_score ?? 0);
  let simAwayScore = Math.round(game?.sim_away_score ?? 0);

  const isCompleted = Boolean(game?.completed && game?.real_home_score !== null && game?.real_away_score !== null);

  const realHomeWon = isCompleted ? game.real_home_score > game.real_away_score : null;
  const realAwayWon = isCompleted ? game.real_away_score > game.real_home_score : null;
  const isRealTie = isCompleted ? game.real_home_score === game.real_away_score : false;
  const simHomeWon = simHomeScore > simAwayScore;
  const simAwayWon = simAwayScore > simHomeScore;

  let modelResult = 'unplayed';
  if (isCompleted) {
    if (isRealTie) {
      modelResult = (simHomeScore === simAwayScore) ? 'correct' : 'incorrect';
    } else {
      modelResult = ((simHomeWon && realHomeWon) || (simAwayWon && realAwayWon)) ? 'correct' : 'incorrect';
    }
  }

  const homeWinPct = game?.home_win_prob != null
    ? Math.round(game.home_win_prob * 100)
    : Math.round((1.0 / (1.0 + Math.exp(-0.075 * (simHomeScore - simAwayScore)))) * 100);
  const awayWinPct = homeWinPct !== null ? 100 - homeWinPct : null;

  const backTarget = state.previousPage === 'postseason' ? 'postseason' : 'games';
  const backLabel = state.previousPage === 'postseason' ? '← Back to Postseason Bracket' : `← Back to Week ${state.currentWeek}`;
  const stageTitle = game?.title || game?.bowl_name || game?.stage || '';
  const awaySeedBadge = game?.away_seed ? `<span class="seed-pill">#${game.away_seed}</span> ` : '';
  const homeSeedBadge = game?.home_seed ? `<span class="seed-pill">#${game.home_seed}</span> ` : '';

  const sourceToggle = hasActual ? `
    <div class="source-toggle" role="group" aria-label="Play-by-play source">
      <button class="src-btn${source === 'actual' ? ' active' : ''}" data-src="actual">Actual play-by-play</button>
      <button class="src-btn${source === 'simulated' ? ' active' : ''}" data-src="simulated">Simulated</button>
    </div>` : '';

  const sourceBadge = source === 'actual'
    ? ''
    : '<span class="badge badge-predicted">Simulated Play-by-Play</span>';

  app.innerHTML = `
    <span class="back-link" id="back-btn">${escHtml(backLabel)}</span>

    <div class="pbp-page">
      <div class="pbp-header">
        <div class="pbp-header-top">
          <div>
            ${stageTitle ? `<div class="pbp-stage-banner">🏆 ${escHtml(stageTitle)}</div>` : ''}
            <div class="pbp-teams">
              ${awaySeedBadge}${teamLogo(awayTeam, 'team-logo team-logo-lg')}${escHtml(awayTeam)}
              <span class="pbp-at">${game?.neutral_site ? 'vs' : '@'}</span>
              ${homeSeedBadge}${teamLogo(homeTeam, 'team-logo team-logo-lg')}${escHtml(homeTeam)}
            </div>
            <div class="pbp-badges">
              ${isCompleted
                ? `<span class="badge ${modelResult === 'correct' ? 'badge-correct' : 'badge-incorrect'}">${modelResult === 'correct' ? '✓ Predicted Correctly' : '✗ Predicted Incorrectly'} (Final)</span>`
                : ''}
              ${sourceBadge}
              ${game?.has_ensemble !== undefined && !isPostseasonGame ? forecastBadge(game) : ''}
              <span class="badge" style="background:var(--surface2);color:var(--text-muted)">${game?.neutral_site ? '🏟 Neutral Site' : '🏠 On Campus'}</span>
            </div>
            ${sourceToggle}
          </div>
          <div class="pbp-score-box">
            <div class="pbp-score-label">Simulated Final</div>
            <div class="pbp-score-block ${modelResult}">${simAwayScore} – ${simHomeScore}</div>
            ${isCompleted
              ? `<div class="pbp-score-label" style="margin-top:.4rem">Actual Final: <strong>${game.real_away_score} – ${game.real_home_score}</strong></div>`
              : ''}
            ${game?.vegas_spread != null
              ? `<div class="pbp-score-label">Line: ${game.vegas_spread > 0 ? '+' : ''}${game.vegas_spread} &nbsp;|&nbsp; O/U: ${game.vegas_ou}</div>`
              : ''}
          </div>
        </div>
        ${homeWinPct !== null ? `
          <div class="win-prob-label">
            <span>${escHtml(awayTeam)} <strong>${awayWinPct}%</strong></span>
            <span style="color:var(--text-muted);font-size:.72rem">Win Probability</span>
            <span><strong>${homeWinPct}%</strong> ${escHtml(homeTeam)}</span>
          </div>
          <div class="win-bar-wrap">
            <div class="win-bar-away" style="width:${awayWinPct}%"></div>
            <div class="win-bar-home" style="width:${homeWinPct}%"></div>
          </div>
        ` : ''}
      </div>

      <div class="pbp-tabs">
        <div class="pbp-tab active" data-tab="pbp">Play-by-Play</div>
        <div class="pbp-tab" data-tab="drives">Drive Summary</div>
        <div class="pbp-tab" data-tab="boxscore">Box Score</div>
      </div>

      <div id="tab-pbp">
        ${renderDriveAccordion(drives, homeTeam, awayTeam)}
      </div>
      <div id="tab-drives" style="display:none">
        ${renderDriveSummaryTable(drives, homeTeam, awayTeam)}
      </div>
      <div id="tab-boxscore" style="display:none">
        ${boxTeams.length
          ? renderOfficialBox(boxTeams, awayTeam, homeTeam)
          : renderSimBox(plays, homeTeam, awayTeam, source)}
      </div>
    </div>
  `;

  document.getElementById('back-btn').addEventListener('click', () => navigateTo(backTarget));

  // Source toggle keeps the same game and re-fetches its plays
  document.querySelectorAll('.src-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.pbpSource = btn.dataset.src;
      renderPBP(gameId);
    });
  });

  // Tab switching
  document.querySelectorAll('.pbp-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pbp-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      ['pbp', 'drives', 'boxscore'].forEach(id => {
        document.getElementById(`tab-${id}`).style.display = tab.dataset.tab === id ? '' : 'none';
      });
    });
  });

  // Drive accordion toggle
  document.querySelectorAll('.drive-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('open');
    });
  });

  // Expand or collapse every drive at once
  const toggleAll = document.getElementById('drives-toggle');
  if (toggleAll) {
    toggleAll.addEventListener('click', () => {
      const blocks = [...document.querySelectorAll('.drive-block')];
      const anyClosed = blocks.some(b => !b.classList.contains('open'));
      blocks.forEach(b => b.classList.toggle('open', anyClosed));
      toggleAll.textContent = anyClosed ? 'Collapse all drives' : 'Expand all drives';
    });
  }
}

// Plays group into drives by CFBD's driveId. driveNumber restarts each half, so it cannot key a drive.
function groupByDrive(plays) {
  const map = new Map();
  plays.forEach(p => {
    const key = p.drive_id ?? p.drive_number;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(p);
  });
  return [...map.values()];
}

// Score as "away – home" for a play, whichever side had the ball.
function scoreLine(p) {
  const awayScore = p.offense === p.away ? p.offense_score : p.defense_score;
  const homeScore = p.offense === p.home ? p.offense_score : p.defense_score;
  return `${awayScore} – ${homeScore}`;
}

function driveResult(plays) {
  // Look at the last play of the drive
  const last = plays[plays.length - 1];
  const pt = (last?.play_type ?? '').toLowerCase();
  // Many touchdowns are typed "Rush" or "Pass Completion" with scoring set, so the text decides too
  const touchdown = last?.scoring && /touchdown/.test(`${pt} ${(last?.play_text ?? '').toLowerCase()}`);
  if (pt.includes('field goal good')) return 'FG';
  if (pt.includes('field goal') && (pt.includes('miss') || pt.includes('block'))) return 'Missed FG';
  if (touchdown) {
    // A pick-six or fumble return scores for the defence, so the drive turned the ball over
    return /interception|fumble/.test(pt) ? 'Turnover' : 'TD';
  }
  if (pt.includes('punt')) return 'Punt';
  if (pt.includes('interception') || pt.includes('fumble')) return 'Turnover';
  if (pt.includes('end period') || pt.includes('end of') || pt.includes('end half')) return 'End of Half';
  if (last?.scoring) return 'Score';
  if (last?.down === 4) return 'Turnover on Downs';
  return 'Drive ended';
}

function resultClass(result) {
  if (result === 'TD' || result === 'Score') return 'result-td';
  if (result === 'FG') return 'result-fg';
  if (result === 'Punt') return 'result-punt';
  if (result === 'Turnover on Downs') return 'result-downs';
  if (result === 'Turnover') return 'result-to';
  return 'result-end';
}

// Play text as HTML: plain text, with each named player as a span carrying the team and position.
function renderSegments(segments) {
  return (segments ?? []).map(s => {
    if (!s.player) return escHtml(s.text ?? '');
    const pl = s.player;
    const title = pl.team ? `${pl.team}${pl.pos ? ' · ' + pl.pos : ''}` : 'Player not matched to the roster';
    return `<span class="player-ref${pl.name ? '' : ' unresolved'}" title="${escHtml(title)}">${escHtml(pl.label)}</span>`;
  }).join('');
}

function renderDriveAccordion(drives, homeTeam, awayTeam) {
  if (!drives.length) return '<div class="empty-state">No play-by-play data.</div>';
  const controls = `<div class="drive-controls"><button class="drive-toggle-all" id="drives-toggle">Collapse all drives</button></div>`;
  return `${controls}<div class="drive-list">${drives.map((plays, i) => {
    const first = plays[0];
    const last = plays[plays.length - 1];
    const team = first.offense;
    const result = driveResult(plays);
    const rc = resultClass(result);
    const totalYards = plays.reduce((s, p) => s + p.yards_gained, 0);

    const playsHtml = plays.map(p => {
      const yd = p.yards_gained;
      const ydClass = yd > 0 ? 'positive' : yd < 0 ? 'negative' : '';
      const ydSign = yd > 0 ? '+' : '';
      const down = p.down ? `${p.down}&amp;${p.distance}` : '—';
      return `
        <div class="play-row${p.scoring ? ' scoring' : ''}">
          <span class="play-clock">Q${p.period} ${escHtml(p.clock)}</span>
          <span class="play-down">${down}</span>
          <span class="play-spot" title="Ball on the ${escHtml(p.start_position ?? '')} before the play">${escHtml(p.start_position ?? '')}</span>
          <span class="play-text">
            ${p.scoring ? '🏈 ' : ''}${renderSegments(p.segments)}
            <div class="play-score-inline">${escHtml(scoreLine(p))}</div>
          </span>
          <span class="play-yards ${ydClass}">${ydSign}${yd}</span>
        </div>`;
    }).join('');

    return `
      <div class="drive-block open">
        <div class="drive-header">
          <span class="drive-num">${i + 1}</span>
          ${teamLogo(team, 'team-logo team-logo-sm')}
          <span class="drive-team-badge">${escHtml(team)}</span>
          <span class="drive-start">from ${escHtml(first.start_position ?? '—')}</span>
          <span class="drive-result-badge ${rc}">${escHtml(result)}</span>
          <span class="drive-meta">${plays.length} plays · ${totalYards > 0 ? '+' : ''}${totalYards} yds · ${escHtml(scoreLine(last))}</span>
          <span class="drive-chevron">▶</span>
        </div>
        <div class="drive-plays">${playsHtml}</div>
      </div>`;
  }).join('')}</div>`;
}

function renderDriveSummaryTable(drives, homeTeam, awayTeam) {
  const rows = drives.map((plays, i) => {
    const first = plays[0];
    const last = plays[plays.length - 1];
    const result = driveResult(plays);
    const totalYards = plays.reduce((s, p) => s + p.yards_gained, 0);
    return `<tr>
      <td>${i + 1}</td>
      <td>${teamLogo(first.offense, 'team-logo team-logo-sm')}${escHtml(first.offense)}</td>
      <td>${escHtml(first.start_position ?? '—')}</td>
      <td>${plays.length}</td>
      <td>${totalYards > 0 ? '+' : ''}${totalYards}</td>
      <td><span class="drive-result-badge ${resultClass(result)}">${escHtml(result)}</span></td>
      <td>Q${first.period} ${escHtml(first.clock)}</td>
      <td>${escHtml(scoreLine(last))}</td>
    </tr>`;
  });
  return `
    <div class="rankings-table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>#</th><th>Team</th><th>Start</th><th>Plays</th><th>Yards</th><th>Result</th><th>Time</th><th>Score (away – home)</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

const CATEGORY_TITLES = {
  passing: 'Passing',
  rushing: 'Rushing',
  receiving: 'Receiving',
  fumbles: 'Fumbles',
  defensive: 'Defense',
  interceptions: 'Interceptions',
  kickReturns: 'Kick Returns',
  puntReturns: 'Punt Returns',
  kicking: 'Kicking',
  punting: 'Punting',
};

// Official box score: each team's stat categories with a line per player (CFBD game player stats).
function renderOfficialBox(teams, awayTeam, homeTeam) {
  const ordered = teams.slice().sort((a, b) => (a.home_away === 'away' ? 0 : 1) - (b.home_away === 'away' ? 0 : 1));
  return ordered.map(t => {
    const tot = t.totals ?? {};
    const cats = (t.categories ?? []).filter(c => c.rows && c.rows.length).map(c => `
      <div class="box-cat">
        <h3 class="box-cat-title">${escHtml(CATEGORY_TITLES[c.name] ?? c.name)}</h3>
        <div class="rankings-table-wrap">
          <table class="data-table box-player-table">
            <thead><tr><th>Player</th>${c.labels.map(l => `<th>${escHtml(l)}</th>`).join('')}</tr></thead>
            <tbody>${c.rows.map(r => `<tr>
              <td>${r.jersey != null ? `<span class="box-num">#${r.jersey}</span> ` : ''}${escHtml(r.name)}${r.pos ? ` <span class="box-pos">${escHtml(r.pos)}</span>` : ''}</td>
              ${c.labels.map(l => `<td>${escHtml(r.stats[l] ?? '')}</td>`).join('')}
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`).join('');
    return `
      <section class="box-team">
        <div class="box-team-head">
          ${teamLogo(t.team, 'team-logo team-logo-lg')}
          <h2>${escHtml(t.team)}</h2>
          <span class="box-team-score">${escHtml(t.points ?? '')}</span>
        </div>
        <div class="box-team-totals">
          Total yards <strong>${tot.total_yds ?? 0}</strong> (pass ${tot.pass_yds ?? 0}, rush ${tot.rush_yds ?? 0})
          &nbsp;·&nbsp; Turnovers <strong>${tot.turnovers ?? 0}</strong>
        </div>
        ${cats}
      </section>`;
  }).join('');
}

// Team totals from the play log, for games with no player box score.
function renderSimBox(plays, homeTeam, awayTeam, source) {
  const stats = {};
  [homeTeam, awayTeam].forEach(t => {
    stats[t] = { pass_yds: 0, rush_yds: 0, tds: 0, turnovers: 0, plays: 0, sacks: 0 };
  });
  plays.forEach(p => {
    const t = p.offense;
    if (!stats[t]) return;
    const pt = (p.play_type ?? '').toLowerCase();
    stats[t].plays++;
    if (pt.includes('sack')) {
      stats[t].sacks++;
    } else if (pt.includes('rush') && !pt.includes('touchdown')) {
      stats[t].rush_yds += p.yards_gained;
    } else if (/pass (reception|completion)|passing touchdown/.test(pt)) {
      stats[t].pass_yds += p.yards_gained;
    }
    if (p.scoring && pt.includes('touchdown') && !pt.includes('return')) stats[t].tds++;
    if (pt.includes('interception') && !pt.includes('return')) stats[t].turnovers++;
    if (pt.includes('recovery (opponent)')) stats[t].turnovers++;
  });

  const rows = [homeTeam, awayTeam].map(t => {
    const s = stats[t] ?? {};
    return `<tr>
      <td><strong>${teamLogo(t, 'team-logo team-logo-sm')}${escHtml(t)}</strong></td>
      <td>${s.pass_yds ?? 0}</td>
      <td>${s.rush_yds ?? 0}</td>
      <td>${(s.pass_yds ?? 0) + (s.rush_yds ?? 0)}</td>
      <td>${s.tds ?? 0}</td>
      <td>${s.turnovers ?? 0}</td>
      <td>${s.sacks ?? 0}</td>
      <td>${s.plays ?? 0}</td>
    </tr>`;
  });
  const note = source === 'simulated'
    ? 'Simulated team totals. No player box score was saved for this game (it predates player attribution).'
    : 'Team totals from play-by-play. The official player box score is not available for this game.';
  return `
    <p class="box-note">${escHtml(note)}</p>
    <div class="rankings-table-wrap">
      <table class="data-table box-score-table">
        <thead><tr>
          <th>Team</th><th>Pass Yds</th><th>Rush Yds</th><th>Total Yds</th><th>TDs</th><th>TOs</th><th>Sacks</th><th>Plays</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>`;
}

// ----------------------------------------------------------------
// PAGE: POSTSEASON (CFP Bracket, Conference Championships, Bowls)
// ----------------------------------------------------------------
async function renderPostseason() {
  showLoader();
  let data;
  try {
    data = await apiFetch(`/api/postseason?snapshot=${state.currentSnapshot ?? ''}`);
  } catch (e) {
    app.innerHTML = `<div class="empty-state">No postseason simulation found for Season ${state.season}.</div>`;
    return;
  }

  const confGames = data.conference_championships ?? [];
  const tree = data.cfp_bracket ?? {};
  const seeds = data.cfp_seeds ?? tree.seeds ?? [];
  const bowls = data.bowl_games ?? [];
  const champGame = tree.championship ?? null;
  const champion = tree.national_champion ?? champGame?.winner ?? 'TBD';
  const championSeed = tree.national_champion_seed ?? champGame?.winner_seed ?? '';

  // Order Round 1 games to align visually with Quarterfinals:
  // QF1: Winner(8/9) vs #1  -> R1 Game 4 (#9 @ #8)
  // QF2: Winner(5/12) vs #4 -> R1 Game 1 (#12 @ #5)
  // QF3: Winner(7/10) vs #2 -> R1 Game 3 (#10 @ #7)
  // QF4: Winner(6/11) vs #3 -> R1 Game 2 (#11 @ #6)
  const r1Raw = tree.round_1 ?? [];
  const findR1 = (hSeed) => r1Raw.find(g => g.home_seed === hSeed);
  const r1Ordered = [findR1(8), findR1(5), findR1(7), findR1(6)].filter(Boolean);
  const r1Display = r1Ordered.length === 4 ? r1Ordered : r1Raw;

  const qfList = tree.quarterfinals ?? [];
  const sfList = tree.semifinals ?? [];

  const seedsHtml = seeds.map(s => {
    const isBye = Boolean(s.bye ?? s.first_round_bye);
    const isChamp = Boolean(s.is_champ ?? s.is_conf_champ);
    return `
      <div class="seed-chip ${isBye ? 'seed-bye' : ''}" title="Power Rating: ${escHtml(s.power_rating)}">
        <span class="seed-num">#${escHtml(s.seed)}</span>
        ${teamLogo(s.team, 'team-logo team-logo-sm')}
        <span class="seed-team">${escHtml(s.team)}</span>
        ${s.record ? `<span class="seed-rec">(${escHtml(s.record)})</span>` : ''}
        <span class="seed-tag">${isBye ? 'BYE · ' + escHtml(s.conference || 'Champ') : (isChamp ? 'Champ' : 'At-Large')}</span>
      </div>
    `;
  }).join('');

  app.innerHTML = `
    <div class="champion-banner" id="champ-banner">
      <div class="champion-trophy">🏆</div>
      <div class="champion-info">
        <div class="champion-eyebrow">${state.season} Simulated CFP National Champion</div>
        <div class="champion-name">
          ${championSeed ? `<span class="seed-pill champ-seed">#${escHtml(championSeed)}</span>` : ''}
          ${teamLogo(champion, 'team-logo team-logo-lg')}${escHtml(champion)}
        </div>
        ${champGame ? `
          <div class="champion-sub">
            Defeated #${champGame.winner === champGame.home_team ? escHtml(champGame.away_seed) : escHtml(champGame.home_seed)}
            ${escHtml(champGame.winner === champGame.home_team ? champGame.away_team : champGame.home_team)}
            <strong>${Math.max(champGame.sim_home_score, champGame.sim_away_score)}–${Math.min(champGame.sim_home_score, champGame.sim_away_score)}</strong>
            &nbsp;·&nbsp; <span class="champ-pbp-link">Click to view National Championship Play-by-Play →</span>
          </div>
        ` : ''}
      </div>
    </div>

    <div class="postseason-subtabs">
      <button class="pos-tab active" data-sec="all">All Postseason</button>
      <button class="pos-tab" data-sec="cfp">12-Team CFP Bracket</button>
      <button class="pos-tab" data-sec="conf">Conference Championships (${confGames.length})</button>
      <button class="pos-tab" data-sec="bowls">Bowl Games (${bowls.length})</button>
    </div>

    <div id="sec-cfp" class="postseason-section">
      <div class="section-header">
        <h2 class="section-title">12-Team College Football Playoff Bracket</h2>
        <span style="color:var(--text-muted);font-size:.82rem">Click any matchup card to inspect full Play-by-Play &amp; Box Score</span>
      </div>

      <div class="seeds-strip">${seedsHtml}</div>

      <div class="bracket-scroll-wrap">
        <div class="bracket-tree">
          <div class="bracket-col">
            <div class="bracket-col-header">
              <span>First Round</span>
              <span class="bracket-col-sub">Seeds 5–8 Host on Campus</span>
            </div>
            <div class="bracket-col-body" id="bracket-r1"></div>
          </div>

          <div class="bracket-col">
            <div class="bracket-col-header">
              <span>Quarterfinals</span>
              <span class="bracket-col-sub">NY6 Bowls · Neutral Site</span>
            </div>
            <div class="bracket-col-body" id="bracket-qf"></div>
          </div>

          <div class="bracket-col">
            <div class="bracket-col-header">
              <span>Semifinals</span>
              <span class="bracket-col-sub">NY6 Bowls · Neutral Site</span>
            </div>
            <div class="bracket-col-body" id="bracket-sf"></div>
          </div>

          <div class="bracket-col bracket-col-final">
            <div class="bracket-col-header">
              <span>National Championship</span>
              <span class="bracket-col-sub">Neutral Site Final</span>
            </div>
            <div class="bracket-col-body" id="bracket-final"></div>
          </div>
        </div>
      </div>
    </div>

    <div id="sec-conf" class="postseason-section">
      <div class="section-header" style="margin-top:2rem">
        <h2 class="section-title">FBS Conference Championships</h2>
        <span style="color:var(--text-muted);font-size:.82rem">${confGames.length} Neutral-Site Title Games</span>
      </div>
      <div class="games-grid" id="conf-grid"></div>
    </div>

    <div id="sec-bowls" class="postseason-section">
      <div class="section-header" style="margin-top:2rem">
        <h2 class="section-title">Bowl Season Projections</h2>
        <span style="color:var(--text-muted);font-size:.82rem">${bowls.length} Bowl Matchups (6+ Win Teams)</span>
      </div>
      <div class="games-grid" id="bowls-grid"></div>
    </div>
  `;

  if (champGame) {
    document.getElementById('champ-banner').addEventListener('click', () => {
      navigateTo('pbp', champGame.game_id, {
        ...champGame,
        title: champGame.title || 'CFP National Championship',
        stage: 'CFP National Championship',
      });
    });
  }

  // Populate CFP Bracket columns
  const r1El = document.getElementById('bracket-r1');
  r1Display.forEach(g => r1El.appendChild(buildBracketNode(g, 'First Round')));

  const qfEl = document.getElementById('bracket-qf');
  qfList.forEach(g => qfEl.appendChild(buildBracketNode(g, g.bowl_name || 'Quarterfinal')));

  const sfEl = document.getElementById('bracket-sf');
  sfList.forEach(g => sfEl.appendChild(buildBracketNode(g, g.bowl_name || 'Semifinal')));

  const finalEl = document.getElementById('bracket-final');
  if (champGame) {
    finalEl.appendChild(buildBracketNode(champGame, 'CFP National Championship', true));
  }

  // Populate Conference Championships
  const confGrid = document.getElementById('conf-grid');
  confGames.forEach(g => confGrid.appendChild(buildPostseasonCard(g, 'Conference Championship')));

  // Populate Bowls
  const bowlsGrid = document.getElementById('bowls-grid');
  bowls.forEach(g => bowlsGrid.appendChild(buildPostseasonCard(g, g.bowl_name || 'Bowl Game')));

  // Section filter tabs
  document.querySelectorAll('.postseason-subtabs .pos-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.postseason-subtabs .pos-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const sec = btn.dataset.sec;
      document.getElementById('sec-cfp').style.display = (sec === 'all' || sec === 'cfp') ? '' : 'none';
      document.getElementById('sec-conf').style.display = (sec === 'all' || sec === 'conf') ? '' : 'none';
      document.getElementById('sec-bowls').style.display = (sec === 'all' || sec === 'bowls') ? '' : 'none';
    });
  });
}

function buildBracketNode(g, subtitle, isFinal = false) {
  const homeWon = g.sim_home_score > g.sim_away_score;
  const awayWon = g.sim_away_score > g.sim_home_score;
  const node = document.createElement('div');
  node.className = `bracket-node${isFinal ? ' bracket-node-final' : ''}`;
  const venueLabel = g.neutral_site ? '🏟 Neutral' : `🏠 @ ${g.home_team}`;

  node.innerHTML = `
    <div class="bracket-node-header">
      <span class="bracket-bowl-name">${escHtml(subtitle)}</span>
      <span class="bracket-venue">${escHtml(venueLabel)}</span>
    </div>
    <div class="bracket-team-row ${awayWon ? 'winner' : 'loser'}">
      <div class="bracket-team-left">
        ${g.away_seed ? `<span class="seed-pill">#${escHtml(g.away_seed)}</span>` : ''}
        ${teamLogo(g.away_team, 'team-logo team-logo-sm')}
        <span class="bracket-team-name">${escHtml(g.away_team)}</span>
      </div>
      <span class="bracket-score">${Math.round(g.sim_away_score)}</span>
    </div>
    <div class="bracket-team-row ${homeWon ? 'winner' : 'loser'}">
      <div class="bracket-team-left">
        ${g.home_seed ? `<span class="seed-pill">#${escHtml(g.home_seed)}</span>` : ''}
        ${teamLogo(g.home_team, 'team-logo team-logo-sm')}
        <span class="bracket-team-name">${escHtml(g.home_team)}</span>
        ${g.home_seed && g.home_seed <= 4 ? '<span class="bye-tag">BYE</span>' : ''}
      </div>
      <span class="bracket-score">${Math.round(g.sim_home_score)}</span>
    </div>
    <div class="bracket-node-footer">
      <span>Play-by-Play →</span>
    </div>
  `;

  node.addEventListener('click', () => {
    navigateTo('pbp', g.game_id, {
      ...g,
      title: g.title || g.bowl_name || subtitle,
      stage: subtitle,
    });
  });
  return node;
}

function buildPostseasonCard(g, defaultTitle) {
  const homeWon = g.sim_home_score > g.sim_away_score;
  const awayWon = g.sim_away_score > g.sim_home_score;
  const title = g.title || g.bowl_name || defaultTitle;
  const simMargin = g.sim_home_score - g.sim_away_score;
  const homeWinPct = Math.round((1.0 / (1.0 + Math.exp(-0.075 * simMargin))) * 100);
  const awayWinPct = 100 - homeWinPct;

  const awayRec = g.away_record ? ` <span class="team-rec">(${escHtml(g.away_record)})</span>` : '';
  const homeRec = g.home_record ? ` <span class="team-rec">(${escHtml(g.home_record)})</span>` : '';
  const awayConf = g.away_conf ? ` <span class="conf-badge">${escHtml(g.away_conf)}</span>` : '';
  const homeConf = g.home_conf ? ` <span class="conf-badge">${escHtml(g.home_conf)}</span>` : '';

  const card = document.createElement('div');
  card.className = 'game-card unplayed postseason-card';
  card.innerHTML = `
    <div class="game-card-header">
      <span class="badge badge-postseason">🏆 ${escHtml(title)}</span>
      <span>${g.neutral_site ? '🏟 Neutral' : '🏠 Campus'}</span>
    </div>
    <div class="game-matchup">
      <div class="team-row">
        <span class="team-name${awayWon ? ' winner' : ''}">
          ${teamLogo(g.away_team)}${escHtml(g.away_team)}${awayRec}${awayConf}
        </span>
        <div class="score-col">
          <span class="score-sim ${awayWon ? 'correct' : 'unplayed'}">${Math.round(g.sim_away_score)}</span>
        </div>
      </div>
      <div class="team-row">
        <span class="team-name${homeWon ? ' winner' : ''}">
          ${teamLogo(g.home_team)}${escHtml(g.home_team)}${homeRec}${homeConf}
        </span>
        <div class="score-col">
          <span class="score-sim ${homeWon ? 'correct' : 'unplayed'}">${Math.round(g.sim_home_score)}</span>
        </div>
      </div>
    </div>
    <div class="win-prob-label">
      <span>${escHtml(g.away_team)} <strong>${awayWinPct}%</strong></span>
      <span style="color:var(--text-muted);font-size:.72rem">Sim Win Prob</span>
      <span><strong>${homeWinPct}%</strong> ${escHtml(g.home_team)}</span>
    </div>
    <div class="win-bar-wrap">
      <div class="win-bar-away" style="width:${awayWinPct}%"></div>
      <div class="win-bar-home" style="width:${homeWinPct}%"></div>
    </div>
    <div class="game-card-footer">
      <span>Winner: <strong>${escHtml(g.winner)}</strong></span>
      <span style="color:var(--accent)">Play-by-Play →</span>
    </div>
  `;
  card.addEventListener('click', () => {
    navigateTo('pbp', g.game_id, {
      ...g,
      title,
      stage: defaultTitle,
    });
  });
  return card;
}

// ----------------------------------------------------------------
// PAGE: RANKINGS (Teams)
// ----------------------------------------------------------------
async function renderRankings() {
  showLoader();
  const weekParam = state.currentWeek ? `&week=${state.currentWeek}` : '';
  let rows;
  try {
    rows = await apiFetch(`/api/rankings/teams?snapshot=${state.currentSnapshot ?? ''}${weekParam}`);
  } catch {
    app.innerHTML = `<div class="empty-state">No team rankings available for Week ${state.currentWeek}.</div>`;
    return;
  }
  state.rankRows = rows;
  drawRankings();
}

const RANK_VIEWS = ['committee', 'power', 'resume'];

function getRankView(available) {
  if (!state.rankView) {
    try { state.rankView = localStorage.getItem('rankView'); } catch { state.rankView = null; }
  }
  // Default is the committee view; fall back to the first view this week's data supports
  if (!RANK_VIEWS.includes(state.rankView) || !available.includes(state.rankView)) {
    return available[0];
  }
  return state.rankView;
}

function setRankView(view) {
  state.rankView = view;
  try { localStorage.setItem('rankView', view); } catch { /* private window: keep the choice in memory only */ }
  drawRankings();
}

function drawRankings() {
  const rows = state.rankRows || [];
  const isEnsemble = rows[0]?.source === 'ensemble';
  const present = col => rows.some(r => r[col] !== undefined && r[col] !== null && r[col] !== '');
  const hasResume = present('sor_rank');
  const hasCommittee = present('committee_rank');
  const available = [...(hasCommittee ? ['committee'] : []), 'power', ...(hasResume ? ['resume'] : [])];
  const view = getRankView(available);
  const hasShift = rows.some(r => r.graph_shift !== undefined && r.graph_shift !== null && r.graph_shift !== '');
  const sourceBadge = isEnsemble
    ? '<span class="badge badge-ensemble" title="Average of the five-seed ensemble for this week">Ensemble</span>'
    : '<span class="badge badge-single" title="Projected end-of-season ratings from the season simulation">Single seed · projected final</span>';
  const weekLabel = state.currentWeek ? `(Week ${state.currentWeek})` : '';
  const viewTitles = {
    committee: ['Committee', 'Default view and the simulated playoff selection: the power rank and the résumé rank (wins above an elite benchmark) averaged 50/50'],
    power: ['Power', 'Ranked by the power rating (expected neutral margin vs an average FBS team); the predictive number'],
    resume: ['Résumé', 'Ranked by strength of record: most wins above benchmark, and how unlikely an elite (top-5) team would be to match these wins against the same FBS schedule'],
  };
  const toggle = available.length > 1 ? `
    <div class="rank-view-toggle" role="group" aria-label="Ranking view">
      ${available.map(v => `<button type="button" data-rank-view="${v}" class="${view === v ? 'active' : ''}" title="${viewTitles[v][1]}">${viewTitles[v][0]}</button>`).join('')}
    </div>` : '';

  let header, body;
  if (view === 'committee') {
    header = `
      <th data-col="committee_rank" title="Power rank and wins-above-benchmark rank, averaged 50/50">Rank</th>
      <th data-col="team">Team</th>
      <th data-col="conference">Conf</th>
      <th data-col="record">Record</th>
      <th data-col="power_rank" title="Rank by power rating (expected neutral margin)">Power Rank</th>
      <th data-col="wins_above_benchmark" title="FBS wins minus the wins an elite (top-5) team would expect on the same schedule">Wins Above Benchmark</th>
      <th data-col="sor_prob" title="Rarity of matching this record: chance an elite benchmark team achieves fewer wins on the same schedule (100% - P(Benchmark >= Wins)). Higher = stronger résumé.">SOR Score</th>
      <th data-col="power_rating">Power Rating</th>`;
    body = [...rows].sort((a, b) => (+a.committee_rank || 9999) - (+b.committee_rank || 9999));
  } else if (view === 'resume') {
    header = `
      <th data-col="sor_rank" title="Ranked by strength of record: most wins above benchmark, then lowest benchmark match probability">Rank</th>
      <th data-col="team">Team</th>
      <th data-col="conference">Conf</th>
      <th data-col="record">Record</th>
      <th data-col="fbs_record" title="Record against FBS opponents only (FCS games excluded)">FBS Record</th>
      <th data-col="wins_above_benchmark" title="Actual FBS wins minus the expected wins of an elite (top-5) team on the same schedule">Wins Above Benchmark</th>
      <th data-col="sor_prob" title="Rarity of matching this record: chance an elite benchmark team achieves fewer wins on the same schedule (100% - P(Benchmark >= Wins)). Higher = stronger résumé. FCS games excluded.">SOR Score</th>
      <th data-col="rank_mean">Power Rank</th>`;
    const sorted = [...rows].sort((a, b) => (+a.sor_rank || 9999) - (+b.sor_rank || 9999));
    body = sorted;
  } else {
    header = `
      <th data-col="rank_mean">Rank</th>
      <th data-col="team">Team</th>
      <th data-col="conference">Conf</th>
      <th data-col="record">Record</th>
      <th data-col="power_rating">Power Rating</th>
      ${isEnsemble ? '<th data-col="rating_sd">± SD</th><th data-col="rank_lo80">Rank Range</th>' : `${hasShift ? '<th data-col="graph_shift" title="Points the in-season graph fit moved this team (offense + defense shifts)">Graph Shift</th>' : ''}<th data-col="sos">SOS</th><th data-col="win_expectancy">Win Exp.</th><th data-col="off_epa">Off EPA</th><th data-col="def_epa">Def EPA</th>`}`;
    body = rows;
  }

  app.innerHTML = `
    <div class="section-header">
      <h1 class="section-title">Team Rankings ${weekLabel} ${sourceBadge}</h1>
      ${toggle}
    </div>
    <div class="rankings-table-wrap">
      <table class="data-table" id="team-table">
        <thead><tr>${header}</tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  if (view === 'committee') populateCommitteeTable(body);
  else if (view === 'resume') populateResumeTable(body);
  else populateTeamTable(body, isEnsemble);
  app.querySelectorAll('[data-rank-view]').forEach(b => b.addEventListener('click', () => setRankView(b.dataset.rankView)));
  setupSortableTable('team-table');
}

function populateCommitteeTable(rows) {
  const tbody = document.querySelector('#team-table tbody');
  tbody.innerHTML = rows.map(r => {
    const teamName = r.team ?? r.Team ?? '';
    const conf = r.conference ?? r.Conference ?? '';
    const confBadge = conf ? `<span class="conf-badge">${escHtml(conf)}</span>` : '—';
    const rank = +r.committee_rank;
    const rankStr = rank <= 3 ? `<span class="rank-top3">${rank}</span>` : `<span class="rank-num">${escHtml(r.committee_rank)}</span>`;
    const wab = +r.wins_above_benchmark || 0;
    const powerRank = r.power_rank ?? r.rank ?? r.rank_mean ?? '';
    const rating = r.power_rating ?? r['power rating'];
    const sorScore = (r.sor_prob === undefined || r.sor_prob === null || r.sor_prob === '')
      ? '—'
      : `${(100 * Math.max(0, 1 - (+r.sor_prob || 0))).toFixed(1)}%`;
    return `<tr>
      <td>${rankStr}</td>
      <td><strong>${teamLogo(teamName, 'team-logo team-logo-sm')}${escHtml(teamName)}</strong></td>
      <td>${confBadge}</td>
      <td><strong>${escHtml(r.record ?? '—')}</strong></td>
      <td>${powerRank === '' ? '—' : Math.round(+powerRank)}</td>
      <td>${wab > 0 ? '+' : ''}${wab.toFixed(1)}</td>
      <td>${sorScore}</td>
      <td>${rating === undefined || rating === '' ? '—' : (+rating).toFixed(1)}</td>
    </tr>`;
  }).join('');
}

function populateResumeTable(rows) {
  const tbody = document.querySelector('#team-table tbody');
  tbody.innerHTML = rows.map(r => {
    const teamName = r.team ?? r.Team ?? '';
    const conf = r.conference ?? r.Conference ?? '';
    const confBadge = conf ? `<span class="conf-badge">${escHtml(conf)}</span>` : '—';
    const sorPct = (r.sor_prob === undefined || r.sor_prob === null || r.sor_prob === '')
      ? '—'
      : `${(100 * Math.max(0, 1 - (+r.sor_prob || 0))).toFixed(1)}%`;
    const wab = +r.wins_above_benchmark || 0;
    const wabStr = `${wab > 0 ? '+' : ''}${wab.toFixed(1)}`;
    const powerRank = r.rank_mean ?? r.rank ?? '';
    return `<tr>
      <td><span class="rank-num">${escHtml(r.sor_rank)}</span></td>
      <td><strong>${teamLogo(teamName, 'team-logo team-logo-sm')}${escHtml(teamName)}</strong></td>
      <td>${confBadge}</td>
      <td><strong>${escHtml(r.record ?? '—')}</strong></td>
      <td>${escHtml(r.fbs_record ?? '—')}</td>
      <td>${wabStr}</td>
      <td>${sorPct}</td>
      <td>${powerRank === '' ? '—' : Math.round(+powerRank)}</td>
    </tr>`;
  }).join('');
}

function populateTeamTable(rows, isEnsemble) {
  const tbody = document.querySelector('#team-table tbody');
  const hasShift = rows.some(r => r.graph_shift !== undefined && r.graph_shift !== null && r.graph_shift !== '');
  tbody.innerHTML = rows.map((r, i) => {
    const rank = r.rank_mean ?? r.rank ?? (i + 1);
    const rating = r.power_rating ?? r['power rating'] ?? 0;
    const rankStr = rank <= 3 ? `<span class="rank-top3">${Math.round(rank)}</span>` : `<span class="rank-num">${Math.round(rank)}</span>`;
    const teamName = r.team ?? r.Team ?? '';
    const conf = r.conference ?? r.Conference ?? '';
    const confBadge = conf ? `<span class="conf-badge">${escHtml(conf)}</span>` : '—';
    const record = r.record ?? r.Record ?? '—';
    const teamCell = `<strong>${teamLogo(teamName, 'team-logo team-logo-sm')}${escHtml(teamName)}</strong>`;

    if (isEnsemble) {
      const lo = r.rank_lo80 ?? '—';
      const hi = r.rank_hi80 ?? '—';
      return `<tr>
        <td>${rankStr}</td>
        <td>${teamCell}</td>
        <td>${confBadge}</td>
        <td><strong>${escHtml(record)}</strong></td>
        <td>${(+rating).toFixed(1)}</td>
        <td>${(+(r.rating_sd ?? 0)).toFixed(1)}</td>
        <td>${escHtml(lo)} – ${escHtml(hi)}</td>
      </tr>`;
    } else {
      return `<tr>
        <td>${rankStr}</td>
        <td>${teamCell}</td>
        <td>${confBadge}</td>
        <td><strong>${escHtml(record)}</strong></td>
        <td>${(+rating).toFixed(1)}</td>
        ${hasShift ? `<td>${r.graph_shift === '' || r.graph_shift === undefined ? '—' : (+r.graph_shift).toFixed(1)}</td>` : ''}
        <td>${escHtml(r.sos ?? r.SOS ?? '—')}</td>
        <td>${escHtml(r.win_expectancy ?? r['win expectancy'] ?? '—')}</td>
        <td>${(+(r.off_epa ?? r['off epa'] ?? 0)).toFixed(2)}</td>
        <td>${(+(r.def_epa ?? r['def epa'] ?? 0)).toFixed(2)}</td>
      </tr>`;
    }
  }).join('');
}

// ----------------------------------------------------------------
// PAGE: PLAYERS
// ----------------------------------------------------------------
const POSITIONS = ['all', 'QB', 'RB', 'WR', 'TE', 'OT', 'IOL', 'EDGE', 'DT', 'LB', 'CB', 'S', 'K', 'P', 'RS'];

async function renderPlayers() {
  showLoader();

  const posTabs = POSITIONS.map(p => `
    <button class="pos-tab${state.currentPos === p ? ' active' : ''}" data-pos="${p}">${p === 'all' ? 'All' : p}</button>
  `).join('');

  const weekLabel = state.currentWeek ? ` (Week ${state.currentWeek})` : '';

  app.innerHTML = `
    <div class="section-header">
      <h1 class="section-title">Player Rankings<span id="player-week-title">${weekLabel}</span> <span id="player-source-badge"></span></h1>
      <span class="section-note">Ranked within each position. Cross-position comparisons are not supported by game results.</span>
    </div>
    <div class="player-controls-bar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.75rem; margin-bottom: 1rem;">
      <div class="pos-tabs" id="pos-tabs" style="margin-bottom: 0;">${posTabs}</div>
      <div class="limit-selector-wrap" style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted);">
        <label for="player-limit-select">Show:</label>
        <select id="player-limit-select" class="styled-select" style="padding: 0.25rem 0.5rem; border-radius: 6px; background: var(--surface); color: var(--text); border: 1px solid var(--border);">
          <option value="25"${state.playerLimit === 25 ? ' selected' : ''}>Top 25</option>
          <option value="50"${state.playerLimit === 50 ? ' selected' : ''}>Top 50</option>
          <option value="100"${state.playerLimit === 100 ? ' selected' : ''}>Top 100</option>
          <option value="all"${state.playerLimit === 'all' ? ' selected' : ''}>All Players</option>
        </select>
      </div>
    </div>
    <div id="player-table-wrap"><div class="loading-spinner"><div class="spinner"></div></div></div>
  `;

  document.querySelectorAll('#pos-tabs .pos-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#pos-tabs .pos-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.currentPos = btn.dataset.pos;
      await loadPlayerTable(state.currentPos);
    });
  });

  const limitSelect = document.getElementById('player-limit-select');
  if (limitSelect) {
    limitSelect.addEventListener('change', async () => {
      const val = limitSelect.value;
      state.playerLimit = val === 'all' ? 'all' : parseInt(val);
      await loadPlayerTable(state.currentPos);
    });
  }

  await loadPlayerTable(state.currentPos);
}

async function loadPlayerTable(pos) {
  const wrap = document.getElementById('player-table-wrap');
  wrap.innerHTML = '<div class="loading-spinner"><div class="spinner"></div></div>';

  let rows;
  const weekParam = state.currentWeek ? `&week=${state.currentWeek}` : '';
  const limitParam = state.playerLimit !== 'all' ? `&limit=${state.playerLimit}` : '';
  try {
    rows = await apiFetch(
      `/api/rankings/players?snapshot=${state.currentSnapshot ?? ''}&pos=${pos}${weekParam}${limitParam}`
    );
  } catch {
    const message = state.currentWeek === 1
      ? 'No games have been played before Week 1, so there are no player ratings yet.'
      : `No data for position: ${escHtml(pos)}`;
    wrap.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  const isEnsemble = rows[0]?.source === 'ensemble';
  const hasProj = !isEnsemble && rows.some(r => r.proj_cf_war !== undefined && r.proj_cf_war !== null && r.proj_cf_war !== '');
  const hasPtsPerGame = !isEnsemble && rows.some(r => r['cf_pts/g'] !== undefined && r['cf_pts/g'] !== null && r['cf_pts/g'] !== '');
  const hasGames = !isEnsemble && rows.some(r => r.games !== undefined && r.games !== null && r.games !== '');

  const badgeEl = document.getElementById('player-source-badge');
  if (badgeEl) {
    badgeEl.innerHTML = isEnsemble
      ? '<span class="badge badge-ensemble" title="Average of the five-seed ensemble for this week">Ensemble</span>'
      : hasProj
        ? '<span class="badge badge-single" title="Projected end-of-season player values and stats from single-seed simulation">Single seed · projected final</span>'
        : '<span class="badge badge-single" title="Player values come from single model run / empirical-Bayes">Single seed · in-season</span>';
  }

  wrap.innerHTML = `
    <div class="rankings-table-wrap">
      <table class="data-table" id="player-table">
        <thead><tr>
          <th data-col="rank">Rank</th>
          <th data-col="player">Player</th>
          <th data-col="team">Team</th>
          <th data-col="pos">Pos</th>
          <th data-col="stars">Stars</th>
          ${hasProj
            ? '<th data-col="proj_cf_war" title="Projected full-season Counterfactual Wins Above Replacement (sort key)">Proj CF WAR</th><th data-col="cf_war" title="Counterfactual Wins Above Replacement accrued in games played so far">CF WAR (To Date)</th>'
            : '<th data-col="cf_war">CF WAR</th>'}
          ${isEnsemble ? '<th data-col="war_sd">± SD</th>' : ''}
          ${hasPtsPerGame ? '<th data-col="cf_pts_g" title="Counterfactual team margin impact in points per game">CF Pts/G</th>' : ''}
          ${hasGames ? `<th data-col="games" title="${hasProj ? 'Games played so far / projected full-season games' : 'Games played so far'}">${hasProj ? 'G / Proj G' : 'Games'}</th>` : ''}
          <th data-col="stats">${hasProj ? 'Stats (Proj)' : 'Stats'}</th>
        </tr></thead>
        <tbody></tbody>
      </table>
    </div>`;

  populatePlayerTable(rows, { isEnsemble, hasProj, hasPtsPerGame, hasGames });
  setupSortableTable('player-table');
}

function populatePlayerTable(rows, opts = {}) {
  const {
    isEnsemble = false,
    hasProj = false,
    hasPtsPerGame = false,
    hasGames = false,
  } = typeof opts === 'boolean' ? { isEnsemble: opts } : opts;
  const tbody = document.querySelector('#player-table tbody');
  tbody.innerHTML = rows.map(r => {
    const rank = (state.currentPos !== 'all' && r.pos_rank) ? r.pos_rank : (r.rank ?? r.pos_rank ?? '—');
    const rankStr = rank <= 3
      ? `<span class="rank-top3">${escHtml(rank)}</span>`
      : `<span class="rank-num">${escHtml(rank)}</span>`;
    const stars = '★'.repeat(Math.min(5, +(r.stars ?? 0)));
    const war = r.cf_war ?? r['cf war'] ?? 0;
    const projWar = r.proj_cf_war ?? r['proj cf war'] ?? war;
    const ptsPerGame = r['cf_pts/g'] ?? r.cf_pts_g;
    const games = r.games;
    const projGames = r.proj_games;
    const team = r.team ?? r.Team ?? '';
    const warCells = hasProj
      ? `<td><strong>${(+projWar).toFixed(2)}</strong></td><td>${(+war).toFixed(2)}</td>`
      : `<td>${(+war).toFixed(isEnsemble ? 3 : 2)}</td>`;
    const sdCell = isEnsemble
      ? `<td>${r.war_sd != null ? '± ' + (+r.war_sd).toFixed(3) : '—'}</td>`
      : '';
    const ppgCell = hasPtsPerGame
      ? `<td>${ptsPerGame != null && ptsPerGame !== '' ? (+ptsPerGame >= 0 ? '+' : '') + (+ptsPerGame).toFixed(2) : '—'}</td>`
      : '';
    const gamesCell = hasGames
      ? `<td>${games != null && games !== '' ? (hasProj && projGames != null && projGames !== '' ? `${escHtml(games)} / ${escHtml(projGames)}` : escHtml(games)) : '—'}</td>`
      : '';
    return `<tr>
      <td>${rankStr}</td>
      <td><strong>${escHtml(r.player ?? r.Player ?? '')}</strong></td>
      <td><span class="conf-badge">${teamLogo(team, 'team-logo team-logo-sm')}${escHtml(team)}</span></td>
      <td>${escHtml(r.pos ?? r.Pos ?? '')}</td>
      <td><span class="star-rating" title="${escHtml(r.stars ?? 0)} stars">${stars}</span></td>
      ${warCells}
      ${sdCell}
      ${ppgCell}
      ${gamesCell}
      <td class="player-stats-cell">${escHtml(r.stats ?? r.Stats ?? '')}</td>
    </tr>`;
  }).join('');
}

// ----------------------------------------------------------------
// Sortable tables
// ----------------------------------------------------------------
function setupSortableTable(tableId) {
  const table = document.getElementById(tableId);
  if (!table) return;
  table.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortCol === col) state.sortDir *= -1;
      else { state.sortCol = col; state.sortDir = 1; }
      table.querySelectorAll('th').forEach(h => h.classList.remove('sorted'));
      th.classList.add('sorted');
      sortTable(table, col, state.sortDir);
    });
  });
}

function sortTable(table, col, dir) {
  const tbody = table.querySelector('tbody');
  const rows = [...tbody.querySelectorAll('tr')];
  const colIndex = [...table.querySelectorAll('th')].findIndex(h => h.dataset.col === col);
  rows.sort((a, b) => {
    const av = cellVal(a, colIndex);
    const bv = cellVal(b, colIndex);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
  rows.forEach(r => tbody.appendChild(r));
}

// Numeric value of a cell for sorting. Records sort by wins, then losses. Other text sorts as text.
function cellVal(row, idx) {
  const td = row.querySelectorAll('td')[idx];
  if (!td) return null;
  const raw = td.textContent.trim();
  if (!raw || raw === '—') return null;
  const recMatch = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (recMatch) {
    return parseInt(recMatch[1], 10) - parseInt(recMatch[2], 10) * 0.01;
  }
  const numeric = /^[+-]?\d+(\.\d+)?$/.test(raw.replace(/,/g, ''));
  if (numeric) return parseFloat(raw.replace(/,/g, ''));
  // Leading number (for example "± 2.1", "#3", "0.45 (ok)")
  const lead = raw.match(/^[+-]?\d+(\.\d+)?/);
  if (lead) return parseFloat(lead[0]);
  return raw;
}

// ----------------------------------------------------------------
// PAGE: ABOUT
// ----------------------------------------------------------------
function renderAbout() {
  app.innerHTML = `
    <article class="about">
      <header class="about-head">
        <h1>About</h1>
        <p class="about-lede">
          Every game on this site is simulated play by play by a neural network trained on recent seasons of college
          football. The forecasts, team ratings and player values all come from that one model, and the model never
          sees a betting line.
        </p>
      </header>

      <section class="about-section">
        <h2>How a forecast is made</h2>
        <ol class="about-steps">
          <li>
            <h3>Players</h3>
            <p>Each player gets a learned profile. Until he has played much, it rests on his recruiting rating and
            measurables; as he logs snaps, his own production takes over.</p>
          </li>
          <li>
            <h3>Units</h3>
            <p>A roster is combined into eight units: offense and defense, plus pass offense, rush offense, offensive
            line, pass coverage, run defense and pass rush.</p>
          </li>
          <li>
            <h3>Plays</h3>
            <p>Given both teams' units and the situation (down, distance, field position, clock and score), the network
            predicts what the next play does. A game is played out one snap at a time, fourth-down calls and overtime
            included.</p>
          </li>
          <li>
            <h3>Many games</h3>
            <p>Each matchup is simulated hundreds of times, and win probabilities are averaged over five independently
            trained copies of the model.</p>
          </li>
          <li>
            <h3>No hindsight</h3>
            <p>A forecast for a given week uses only games played before it. Earlier forecasts are kept as they were
            made; choose one from the <em>As of Week</em> menu.</p>
          </li>
        </ol>
      </section>

      <section class="about-section">
        <h2>Reading the numbers</h2>
        <dl class="about-terms">
          <dt>Score</dt>
          <dd>One simulated playing of the game, picked so its winner is the model's pick and its margin and total sit
          near the model's average. Open a game to see that simulation's play-by-play and box score.</dd>

          <dt>Power rating</dt>
          <dd>Expected margin in points against an average FBS team on a neutral field: how good the model thinks a
          team is right now.</dd>

          <dt>Résumé</dt>
          <dd>How hard a team's record would be to match. It asks how often a team ranked around No. 3 in power rating
          would have done as well against the same schedule.</dd>

          <dt>Committee</dt>
          <dd>The default ranking, and the one that picks the simulated playoff field. It weighs power rating and wins
          above that No. 3 benchmark equally.</dd>

          <dt>Player value</dt>
          <dd>How much the team's expected margin drops when a player is swapped for a low-snap backup at his position,
          times games played. Compare players within a position; across positions the numbers are not on a reliable
          common scale. Kickers, punters and returners are rated by a separate statistical model.</dd>
        </dl>
      </section>

      <section class="about-section">
        <h2>Betting lines</h2>
        <p>Spreads and totals appear on game cards for reference. The <em>Market-blended</em> option shows a second
        forecast that moves the model part of the way toward the line, by an amount fit on earlier weeks. Ratings,
        player values and play-by-play are always the model's own.</p>
        <p>The one indirect use: when choosing which simulation to show for each game, the picks are balanced so the
        week's combined points match the combined betting totals. No single game is moved toward its line.</p>
      </section>

      <section class="about-section">
        <h2>Limits</h2>
        <ul class="about-list">
          <li>Early in the season the model leans on recruiting and last year's production, so September forecasts are
          the least reliable.</li>
          <li>Injuries are only partly captured. Players ruled out or doubtful in a game's official conference availability
          report are taken out of their units. Reports go up three days before kickoff and are updated through game day,
          so a forecast is only as current as the last time they were checked. Where a conference has not published a
          report, a third-party injury list fills in, and it is less complete. Questionable players are treated as
          playing.</li>
          <li>Simulated box scores share each play out among players by their usage so far. Read them as an
          illustration of the game, not a stat projection.</li>
        </ul>
      </section>

      <footer class="about-fine">
        <p>Schedules, final scores, rosters and betting lines come from
        <a href="https://collegefootballdata.com" target="_blank" rel="noopener noreferrer">CollegeFootballData.com</a>.
        Every play-by-play and box score on this site is simulated.</p>
        <p>This is an independent, non-commercial project. It is not affiliated with or endorsed by the NCAA, any
        conference or any school. Team names and logos belong to their owners and are used only to identify teams.
        Forecasts are published for information and entertainment.</p>
      </footer>
    </article>
  `;
}

// ---- Utility ----
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---- Boot ----
init().catch(err => {
  document.getElementById('app').innerHTML =
    `<div class="empty-state">Failed to load: ${escHtml(err.message)}</div>`;
});
