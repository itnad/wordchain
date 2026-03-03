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

    // Check for HTTP errors (e.g., 4xx, 5xx status codes)
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ message: '알 수 없는 서버 오류' }));
      throw new Error(errorData.message || '서버가 오류를 반환했습니다.');
    }

    const data = await res.json();

    state.displayName = data.display_name;
    state.nickname    = data.nickname;
    localStorage.setItem('wc_display_name', data.display_name);
    localStorage.setItem('wc_nickname',     data.nickname);

    showScreen(setupScreen);
  } catch (error) {
    console.error('Nickname confirmation failed:', error);
    nicknameConfirmBtn.disabled  = false;
    nicknameConfirmBtn.textContent = '다음';
    alert(error.message || '서버 오류가 발생했습니다. 다시 시도해주세요.');
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
  if (!raw) {
    hideError(); // Clear previous error if any, but don't show new error for empty input
    return;
  }

  hideError();

  const validationLog = [];
  let isValidClientSide = true;

  const chars = [...raw];
  validationLog.push(`➡️ 입력 단어 '${raw}' 유효성 검증 시작...`);

  // 1. 단어 길이 검증
  if (chars.length !== 3) {
    validationLog.push('❌ 단어 길이 검증: 3글자 단어만 입력 가능합니다.');
    isValidClientSide = false;
  } else {
    validationLog.push('✅ 단어 길이 검증: (3글자)');
  }

  // 2. 한글 여부 검증
  if (isValidClientSide && !chars.every(c => /[가-힣]/.test(c))) {
    validationLog.push('❌ 한글 여부 검증: 한글 단어만 입력할 수 있습니다.');
    isValidClientSide = false;
  } else if (isValidClientSide) {
    validationLog.push('✅ 한글 여부 검증: (한글)');
  }

  // 3. 중복 단어 검증
  if (isValidClientSide && state.usedWords.includes(raw)) {
    validationLog.push('❌ 단어 중복 검증: 이미 사용된 단어입니다.');
    isValidClientSide = false;
  } else if (isValidClientSide) {
    validationLog.push('✅ 단어 중복 검증: (미사용)');
  }

  // 4. 시작 글자 일치 검증 (첫 단어가 아닐 경우)
  if (isValidClientSide && !state.isFirstWord) {
    const allowed = state.requiredChars.map(r => r.char);
    if (!allowed.includes(chars[0])) {
      const display = state.requiredChars.map(r => `'${r.char}'`).join(' 또는 ');
      validationLog.push(`❌ 시작 글자 검증: '${chars[0]}'(으)로 시작할 수 없습니다. ${display}(으)로 시작해야 합니다.`);
      isValidClientSide = false;
    } else {
      validationLog.push(`✅ 시작 글자 검증: ('${chars[0]}'으로 시작)`);
    }
  } else if (isValidClientSide && state.isFirstWord) {
    validationLog.push('✅ 시작 글자 검증: (첫 단어이므로 제한 없음)');
  }

  // 클라이언트 측 유효성 검증 실패 시 즉시 오류 표시
  if (!isValidClientSide) {
    showError(validationLog);
    setInputEnabled(true);
    return;
  }

  setInputEnabled(false);
  validationLog.push('➡️ 서버 단어 유효성 검증 시작...');

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

    // HTTP 오류 상태 코드 (4xx, 5xx 등) 처리
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ message: '응답 본문에 오류 메시지 없음' }));
      validationLog.push(`❌ 서버 응답 오류: ${res.status} ${res.statusText}`);
      validationLog.push(`   상세: ${errorData.message || '알 수 없는 서버 오류가 발생했습니다.'}`);
      showError(validationLog);
      setInputEnabled(true);
      return;
    }

    result = await res.json();
  } catch (error) {
    // 네트워크 오류 또는 JSON 파싱 오류 처리
    validationLog.push('❌ 네트워크 통신 실패: 서버에 연결할 수 없습니다.');
    validationLog.push(`   상세: ${error.message || '알 수 없는 네트워크 오류'}`);
    showError(validationLog);
    setInputEnabled(true);
    return;
  }

  // 서버 측 유효성 검증 결과 처리
  if (!result.valid) {
    validationLog.push('❌ 서버 단어 유효성 검증: 실패');
    validationLog.push(`   이유: ${result.reason || '유효하지 않은 단어입니다.'}`);
    showError(validationLog);
    setInputEnabled(true);
    return;
  }

  validationLog.push('✅ 서버 단어 유효성 검증: 성공');
  // console.log(validationLog); // For debugging success flow

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

function showError(errorDetails) {
  errorMsg.innerHTML = ''; // Clear previous content
  errorMsg.classList.remove('hidden');
  errorMsg.style.animation = 'none';
  errorMsg.offsetHeight; // Trigger reflow for animation reset
  errorMsg.style.animation = ''; // Reapply animation

  const ul = document.createElement('ul');
  ul.className = 'error-detail-log'; // Add a class for potential styling
  if (Array.isArray(errorDetails)) {
    errorDetails.forEach(detail => {
      const li = document.createElement('li');
      li.textContent = detail;
      ul.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = errorDetails;
    ul.appendChild(li);
  }
  errorMsg.appendChild(ul);
}

function hideError() {
  errorMsg.classList.add('hidden');
  errorMsg.innerHTML = ''; // Clear innerHTML to remove list content
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
      const res
