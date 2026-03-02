// ===== 한국어 음절 처리 =====
const I_VOWELS = new Set([2, 3, 6, 7, 12, 17, 20]); // ㅑ,ㅒ,ㅕ,ㅖ,ㅛ,ㅠ,ㅣ

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

/**
 * 두음법칙: 어두에 올 때 바뀔 수 있는 글자 목록 반환
 * ㄹ(5) → ㄴ(2) 또는 ㅇ(11) / ㄴ(2) → ㅇ(11) (ㅣ계열 모음 앞)
 */
function getDuemVariants(char) {
  const d = decomposeSyllable(char);
  if (!d) return [char];
  const { cho, jung, jong } = d;
  const variants = [char];

  if (cho === 5) { // ㄹ
    const newCho = I_VOWELS.has(jung) ? 11 : 2; // ㅇ 또는 ㄴ
    const v = composeSyllable(newCho, jung, jong);
    if (v !== char) variants.push(v);
  } else if (cho === 2 && I_VOWELS.has(jung)) { // ㄴ + ㅣ계열
    const v = composeSyllable(11, jung, jong); // → ㅇ
    if (v !== char) variants.push(v);
  }
  return variants;
}

/**
 * 단어의 마지막 글자를 기준으로 다음 단어가 시작할 수 있는 글자 목록 반환
 * [{ char, isDueum }]
 */
function getRequiredChars(word) {
  const chars = [...word];
  const lastChar = chars[chars.length - 1];
  const variants = getDuemVariants(lastChar);
  return variants.map((c, i) => ({ char: c, isDueum: i > 0 }));
}

// ===== 게임 상태 =====
const state = {
  usedWords: [],      // 사용된 단어 목록
  chain: [],          // { word, turn: 'user'|'ai', fromCache: bool }
  requiredChars: [],  // [{ char, isDueum }]
  isFirstWord: true,
  playerTurn: true,
  options: { allowPersonNames: false, allowPlaceNames: false },
  gameOver: false,
  turns: 0,
};

// ===== DOM =====
const $ = id => document.getElementById(id);
const setupScreen      = $('setupScreen');
const gameScreen       = $('gameScreen');
const allowPersonNames = $('allowPersonNames');
const allowPlaceNames  = $('allowPlaceNames');
const startBtn         = $('startBtn');
const chainContainer   = $('chainContainer');
const chainStartHint   = $('chainStartHint');
const requiredCharsDisplay = $('requiredCharsDisplay');
const requiredBar      = $('requiredBar');
const wordInput        = $('wordInput');
const submitBtn        = $('submitBtn');
const errorMsg         = $('errorMsg');
const aiLoading        = $('aiLoading');
const turnBadge        = $('turnBadge');
const resetBtn         = $('resetBtn');
const settingsToggleBtn = $('settingsToggleBtn');
const ingameSettings   = $('ingameSettings');
const ingamePersonNames = $('ingamePersonNames');
const ingamePlaceNames  = $('ingamePlaceNames');

// ===== 이벤트 =====
startBtn.addEventListener('click', startGame);
submitBtn.addEventListener('click', handleSubmit);
wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
resetBtn.addEventListener('click', () => { if (confirm('게임을 다시 시작할까요?')) resetGame(); });
settingsToggleBtn.addEventListener('click', () => ingameSettings.classList.toggle('hidden'));
ingamePersonNames.addEventListener('change', () => {
  state.options.allowPersonNames = ingamePersonNames.checked;
});
ingamePlaceNames.addEventListener('change', () => {
  state.options.allowPlaceNames = ingamePlaceNames.checked;
});

// ===== 게임 시작 =====
function startGame() {
  state.options.allowPersonNames = allowPersonNames.checked;
  state.options.allowPlaceNames  = allowPlaceNames.checked;
  ingamePersonNames.checked = state.options.allowPersonNames;
  ingamePlaceNames.checked  = state.options.allowPlaceNames;

  setupScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  resetGame(false);
}

function resetGame(confirm = true) {
  state.usedWords = [];
  state.chain = [];
  state.requiredChars = [];
  state.isFirstWord = true;
  state.playerTurn = true;
  state.gameOver = false;
  state.turns = 0;

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

// ===== 입력 처리 =====
async function handleSubmit() {
  if (state.gameOver || !state.playerTurn) return;

  const raw = wordInput.value.trim();
  if (!raw) return;

  hideError();

  // 기본 유효성 검사 (클라이언트)
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

  // 시작 글자 검사
  if (!state.isFirstWord) {
    const allowed = state.requiredChars.map(r => r.char);
    if (!allowed.includes(chars[0])) {
      const display = state.requiredChars.map(r => `'${r.char}'`).join(' 또는 ');
      showError(`${display}(으)로 시작하는 단어를 입력해야 합니다.`);
      return;
    }
  }

  setInputEnabled(false);

  // API 검증
  let result;
  try {
    const res = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: raw,
        allowPersonNames: state.options.allowPersonNames,
        allowPlaceNames: state.options.allowPlaceNames,
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

  // 단어 추가
  addToChain(raw, 'user', result.fromCache);
  state.usedWords.push(raw);
  state.isFirstWord = false;
  state.turns++;
  turnBadge.textContent = `${state.turns}턴`;
  wordInput.value = '';

  // AI 차례
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
        requiredChars: required.map(r => r.char),
        usedWords: state.usedWords,
        allowPersonNames: state.options.allowPersonNames,
        allowPlaceNames: state.options.allowPlaceNames,
      }),
    });
    result = await res.json();
  } catch {
    showAiLoading(false);
    showGameOver('네트워크 오류로 AI가 응답하지 못했습니다. AI 패배!');
    return;
  }

  showAiLoading(false);

  if (!result.word || result.surrender) {
    showGameOver('🎉 AI가 단어를 찾지 못했습니다. 플레이어 승리!');
    return;
  }

  addToChain(result.word, 'ai', result.fromCache);
  state.usedWords.push(result.word);
  state.turns++;
  turnBadge.textContent = `${state.turns}턴`;

  // 다음 플레이어 차례 준비
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

  const label = turn === 'user' ? '나' : 'AI';
  bubble.innerHTML = `
    <div class="bubble-label">${label}</div>
    <div class="bubble-word">
      <span class="hl-first">${first}</span>${mid}<span class="hl-last">${last}</span>
    </div>
    ${fromCache ? '<div class="bubble-meta">📚 사전</div>' : ''}
  `;

  chainContainer.appendChild(bubble);
  chainContainer.scrollTop = chainContainer.scrollHeight;

  state.chain.push({ word, turn, fromCache });
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
  // 애니메이션 재실행
  errorMsg.style.animation = 'none';
  errorMsg.offsetHeight; // reflow
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

function showGameOver(message) {
  state.gameOver = true;
  state.playerTurn = false;
  setInputEnabled(false);

  const banner = document.createElement('div');
  banner.id = 'gameOverBanner';
  banner.className = 'game-over-banner';
  banner.innerHTML = `${message} <button onclick="resetGame()" style="margin-left:12px;padding:4px 12px;border:1.5px solid #fff;border-radius:6px;background:transparent;color:#fff;font-weight:700;cursor:pointer;">다시 시작</button>`;
  gameScreen.insertBefore(banner, $('inputArea'));
}
