// ===== 세션 관리 =====
function getOrCreateSessionId() {
  let id = localStorage.getItem('wc_session_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('wc_session_id', id);
  }
  return id;
}

// ===== 닉네임 생성 (클라이언트 미리보기용) =====
function generateNickname(sessionId, displayName, adjectives, places) {
  const hex  = sessionId.replace(/-/g, '');
  const seg1 = parseInt(hex.slice(0, 8),  16);
  const seg2 = parseInt(hex.slice(8, 16), 16);
  const seg3 = parseInt(hex.slice(16, 24), 16);

  const adj1  = adjectives[seg1 % adjectives.length];
  const place = places[seg2 % places.length];
  let   adj2  = adjectives[seg3 % adjectives.length];
  if (adj1 === adj2) adj2 = adjectives[(seg3 + 1) % adjectives.length];

  return `${adj1} ${place}의 ${adj2} ${displayName}`;
}

// ===== 한국어 음절 처리 =====
const I_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20]);

function decomposeSyllable(char) {
  const code = char.charCodeAt(0) - 0xAC00;
  if (code < 0 || code > 11171) return null;
  const jong = code % 28;
  const jung = Math.floor((code - jong) / 28) % 21;
  const cho  = Math.floor(code / 28 / 21);
  return { cho, jung, jong };
}

function composeSyllable(cho, jung, jong) {
  return String.fromCharCode((cho * 21 + jung) * 28 + jong + 0xAC00);
}

function getDuemVariants(char) {
  const d = decomposeSyllable(char);
  if (!d) return [char];
  const { cho, jung, jong } = d;
  const variants = [char];
  if (cho === 5) {
    const newCho = I_VOWELS.has(jung) ? 11 : 2;
    const v = composeSyllable(newCho, jung, jong);
    if (v !== char) variants.push(v);
  } else if (cho === 2 && I_VOWELS.has(jung)) {
    const v = composeSyllable(11, jung, jong);
    if (v !== char) variants.push(v);
  }
  return variants;
}

function getRequiredChars(word) {
  const chars = [...word];
  const lastChar = chars[chars.length - 1];
  const variants = getDuemVariants(lastChar);
  return variants.map((c, i) => ({ char: c, isDueum: i > 0 }));
}

// ===== 게임 상태 =====
const state = {
  // 세션
  sessionId:      null,
  displayName:    null,
  nickname:       null,
  currentGameId:  null,
  nicknameWords:  null,   // { adjectives, places }

  // 게임
  usedWords:      [],
  chain:          [],
  requiredChars:  [],
  isFirstWord:    true,
  playerTurn:     true,
  options: { allowPersonNames: false, allowPlaceNames: false },
  gameOver:       false,
  turns:          0,
  playerWordCount: 0,     // 플레이어가 이은 단어 수
};

// ===== DOM =====
const $ = id => document.getElementById(id);

const nicknameScreen     = $('nicknameScreen');
const displayNameInput   = $('displayNameInput');
const nicknamePreview    = $('nicknamePreview');
const nicknameConfirmBtn = $('nicknameConfirmBtn');

const setupScreen        = $('setupScreen');
const allowPersonNames   = $('allowPersonNames');
const allowPlaceNames    = $('allowPlaceNames');
const startBtn           = $('startBtn');

const gameScreen         = $('gameScreen');
const playerNicknameBadge= $('playerNicknameBadge');
const chainContainer     = $('chainContainer');
const chainStartHint     = $('chainStartHint');
const requiredCharsDisplay = $('requiredCharsDisplay');
const requiredBar        = $('requiredBar');
const wordInput          = $('wordInput');
const submitBtn          = $('submitBtn');
const errorMsg           = $('errorMsg');
const aiLoading          = $('aiLoading');
const turnBadge          = $('turnBadge');
const resetBtn           = $('resetBtn');
const settingsToggleBtn  = $('settingsToggleBtn');
const ingameSettings     = $('ingameSettings');
const ingamePersonNames  = $('ingamePersonNames');
const ingamePlaceNames   = $('ingamePlaceNames');
const rankingToggleBtn   = $('rankingToggleBtn');
const rankingPanel       = $('rankingPanel');
const rankingList        = $('rankingList');

// Helper to switch screens
function showScreen(screenToShow) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.add('hidden');
  });
  screenToShow.classList.remove('hidden');
}

// ===== 초기화 =====
async function init() {
  state.sessionId = getOrCreateSessionId();

  // 닉네임 단어 로드
  try {
    const res = await fetch('/api/nickname-words');
    state.nicknameWords = await res.json();
  } catch {
    state.nicknameWords = { adjectives: ['신비로운'], places: ['어딘가'] };
  }

  // 이미 등록된 세션인지 확인 (이름 재입력 없이 바로 설정 화면으로)
  const savedName = localStorage.getItem('wc_display_name');
  const savedNickname = localStorage.getItem('wc_nickname');
  if (savedName && savedNickname) {
    state.displayName = savedName;
    state.nickname    = savedNickname;
    showScreen(setupScreen);
  } else {
    showScreen(nicknameScreen);
  }
}

// ===== 닉네임 화면 이벤트 =====
displayNameInput.addEventListener('input', () => {
  const name = displayNameInput.value.trim();
  nicknameConfirmBtn.disabled = name.length === 0;

  if (name.length > 0 && state.nicknameWords) {
    const { adjectives, places } = state.nicknameWords;
    const preview = generateNickname(state.sessionId, name, adjectives, places);
    nicknamePreview.textContent = '✨ ' + preview;
    nicknamePreview.classList.remove('hidden');
  } else {
    nicknamePreview.classList.add('hidden');
  }
});

displayNameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !nicknameConfirmBtn.disabled) confirmNickname();
});

nicknameConfirmBtn.addEventListener('click', confirmNickname);

async function confirmNickname() {
  const name = displayNameInput.value.trim();
  if (!name) return;

  nicknameConfirmBtn.disabled = true;
  nicknameConfirmBtn.textContent = '등록 중...';

  try {
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId, display_name: name }),
    });
    const data = await res.json();

    state.displayName = data.display_name;
    state.nickname    = data.nickname;
    localStorage.setItem('wc_display_name', data.display_name);
    localStorage.setItem('wc_nickname',     data.nickname);

    showScreen(setupScreen);
  } catch {
    nicknameConfirmBtn.disabled  = false;
    nicknameConfirmBtn.textContent = '다음';
    alert('서버 오류가 발생했습니다. 다시 시도해주세요.');
  }
}

// ===== 설정 화면 =====
startBtn.addEventListener('click', startGame);

async function startGame() {
  state.options.allowPersonNames = allowPersonNames.checked;
  state.options.allowPlaceNames  = allowPlaceNames.checked;
  ingamePersonNames.checked = state.options.allowPersonNames;
  ingamePlaceNames.checked  = state.options.allowPlaceNames;

  showScreen(gameScreen);

  // 닉네임 배지
  if (state.nickname) {
    playerNicknameBadge.textContent = state.nickname;
    playerNicknameBadge.className = 'player-nickname-badge';
  }

  // 게임 시작 기록
  try {
    const res = await fetch('/api/game-start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: state.sessionId }),
    });
    const data = await res.json();
    state.currentGameId = data.game_id ?? null;
  } catch {
    state.currentGameId = null;
  }

  resetGameState();
  loadRanking();
}

// ===== 게임 상태 초기화 =====
function resetGameState() {
  state.usedWords      = [];
  state.chain          = [];
  state.requiredChars  = [];
  state.isFirstWord    = true;
  state.playerTurn     = true;
  state.gameOver       = false;
  state.turns          = 0;
  state.playerWordCount = 0;

  chainContainer.innerHTML = '';
  chainContainer.appendChild(chainStartHint);
  chainStartHint.classList.remove('hidden');
  requiredCharsDisplay.innerHTML = '';
  requiredBar.style.opacity = '0.4';
  turnBadge.textContent = '0턴';

  const banner = $('gameOverBanner');
  if (banner) banner.remove();

  setInputEnabled(true);
  hideError();
  wordInput.value = '';
  wordInput.focus();
}

function resetGame() {
  if (!confirm('게임을 다시 시작할까요?')) return;

  // 새 게임 세션 시작
  fetch('/api/game-start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: state.sessionId }),
  }).then(r => r.json()).then(d => {
    state.currentGameId = d.game_id ?? null;
  }).catch(() => {
    state.currentGameId = null;
  });

  resetGameState();
  loadRanking();
}

// ===== 인게임 이벤트 =====
submitBtn.addEventListener('click', handleSubmit);
wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
resetBtn.addEventListener('click', resetGame);
settingsToggleBtn.addEventListener('click', () => ingameSettings.classList.toggle('hidden'));
rankingToggleBtn.addEventListener('click', () => rankingPanel.classList.toggle('hidden'));
ingamePersonNames.addEventListener('change', () => {
  state.options.allowPersonNames = ingamePersonNames.checked;
});
ingamePlaceNames.addEventListener('change', () => {
  state.options.allowPlaceNames = ingamePlaceNames.checked;
});

// ===== 입력 처리 =====
async function handleSubmit() {
  if (state.gameOver || !state.playerTurn) return;

  const raw = wordInput.value.trim();
  if (!raw) return;

  hideError();

  const chars = [...raw];
  if (chars.length !== 3) {
    showError('정확히 3글자 단어만 입력할 수 있습니다.');
    return;
  }
  if (!chars.every(c => /[가-힣]/.test(c))) {
    showError('한글 단어만 입력할 수 있습니다.');
    return;
  }
  if (state.usedWords.includes(raw)) {
    showError('이미 사용된 단어입니다.');
    return;
  }

  if (!state.isFirstWord) {
    const allowed = state.requiredChars.map(r => r.char);
    if (!allowed.includes(chars[0])) {
      const display = state.requiredChars.map(r => `'${r.char}'`).join(' 또는 ');
      showError(`${display}(으)로 시작하는 단어를 입력해야 합니다.`);
      return;
    }
  }

  setInputEnabled(false);

  let result;
  try {
    const res = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word:             raw,
        allowPersonNames: state.options.allowPersonNames,
        allowPlaceNames:  state.options.allowPlaceNames,
        sessionId:        state.sessionId,
        nickname:         state.nickname,
        gameId:           state.currentGameId,
      }),
    });
    result = await res.json();
  } catch {
    showError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    setInputEnabled(true);
    return;
  }

  if (!result.valid) {
    showError(result.reason || '유효하지 않은 단어입니다.');
    setInputEnabled(true);
    return;
  }

  addToChain(raw, 'user', result.fromCache);
  state.usedWords.push(raw);
  state.isFirstWord = false;
  state.turns++;
  state.playerWordCount++;
  turnBadge.textContent = `${state.turns}턴`;
  wordInput.value = '';

  state.playerTurn = false;
  await aiTurn(raw);
}

// ===== AI 차례 =====
async function aiTurn(previousWord) {
  const required = getRequiredChars(previousWord);
  state.requiredChars = required;
  updateRequiredBar(required);

  showAiLoading(true);

  let result;
  try {
    const res = await fetch('/api/ai-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requiredChars:    required.map(r => r.char),
        usedWords:        state.usedWords,
        allowPersonNames: state.options.allowPersonNames,
        allowPlaceNames:  state.options.allowPlaceNames,
      }),
    });
    result = await res.json();
  } catch {
    showAiLoading(false);
    showGameOver('네트워크 오류로 AI가 응답하지 못했습니다. AI 패배!', 'player_win');
    return;
  }

  showAiLoading(false);

  if (!result.word || result.surrender) {
    showGameOver('AI가 단어를 찾지 못했습니다. 플레이어 승리!', 'player_win');
    return;
  }

  addToChain(result.word, 'ai', result.fromCache);
  state.usedWords.push(result.word);
  state.turns++;
  turnBadge.textContent = `${state.turns}턴`;

  const nextRequired = getRequiredChars(result.word);
  state.requiredChars = nextRequired;
  updateRequiredBar(nextRequired);

  state.playerTurn = true;
  setInputEnabled(true);
  wordInput.focus();
}

// ===== UI 업데이트 =====
function addToChain(word, turn, fromCache) {
  chainStartHint.classList.add('hidden');

  const chars = [...word];
  const first = chars[0];
  const last  = chars[chars.length - 1];
  const mid   = chars.slice(1, -1).join('');

  const bubble = document.createElement('div');
  bubble.className = `word-bubble ${turn}`;

  const label = turn === 'user' ? (state.nickname || '나') : 'AI';
  bubble.innerHTML = `
    <div class="bubble-top">
      <span class="bubble-label">${label}</span>
      <button class="btn-word-info" title="뜻 보기 / 이의 제기">?</button>
    </div>
    <div class="bubble-word">
      <span class="hl-first">${first}</span>${mid}<span class="hl-last">${last}</span>
    </div>
  `;

  bubble.querySelector('.btn-word-info').addEventListener('click', () => openWordInfo(word));

  chainContainer.appendChild(bubble);
  chainContainer.scrollTop = chainContainer.scrollHeight;

  state.chain.push({ word, turn, timestamp: new Date().toISOString() });
}

function updateRequiredBar(required) {
  requiredBar.style.opacity = '1';
  requiredCharsDisplay.innerHTML = '';

  required.forEach((r, i) => {
    if (i > 0) {
      const or = document.createElement('span');
      or.className = 'req-or';
      or.textContent = '또는';
      requiredCharsDisplay.appendChild(or);
    }
    const span = document.createElement('span');
    span.className = `req-char${r.isDueum ? ' dueum' : ''}`;
    span.innerHTML = r.isDueum
      ? `${r.char} <span class="dueum-badge">두음</span>`
      : r.char;
    requiredCharsDisplay.appendChild(span);
  });
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  errorMsg.style.animation = 'none';
  errorMsg.offsetHeight;
  errorMsg.style.animation = '';
}

function hideError() {
  errorMsg.classList.add('hidden');
  errorMsg.textContent = '';
}

function setInputEnabled(enabled) {
  wordInput.disabled = !enabled;
  submitBtn.disabled = !enabled;
}

function showAiLoading(show) {
  aiLoading.classList.toggle('hidden', !show);
}

async function showGameOver(message, result) {
  state.gameOver   = true;
  state.playerTurn = false;
  setInputEnabled(false);

  // 게임 종료 기록
  let personalBest   = 0;
  let isNewRecord    = false;
  if (state.currentGameId) {
    try {
      const res = await fetch('/api/game-end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game_id:           state.currentGameId,
          session_id:        state.sessionId,
          result:            result ?? 'ai_win',
          player_word_count: state.playerWordCount,
          total_turns:       state.turns,
          word_history:      state.chain,
        }),
      });
      const data = await res.json();
      personalBest = data.personal_best ?? 