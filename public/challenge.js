// ===== 세션 =====
function getSessionId() {
  let id = localStorage.getItem('wc_session_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('wc_session_id', id); }
  return id;
}

// ===== 한국어 음절 처리 (game.js와 동일) =====
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

// ===== 상태 =====
const state = {
  sessionId:    getSessionId(),
  nickname:     localStorage.getItem('wc_nickname') || localStorage.getItem('wc_display_name') || '나',
  usedWords:    [],
  chain:        [],
  requiredChars: [],
  isFirstWord:  true,
  gameOver:     false,
  streak:       0,
  bestStreak:   parseInt(localStorage.getItem('wc_challenge_best') || '0', 10),
};

// ===== DOM =====
const $ = id => document.getElementById(id);

const playerNicknameBadge  = $('playerNicknameBadge');
const chainContainer       = $('chainContainer');
const chainStartHint       = $('chainStartHint');
const requiredCharsDisplay = $('requiredCharsDisplay');
const requiredBar          = $('requiredBar');
const wordInput            = $('wordInput');
const submitBtn            = $('submitBtn');
const errorMsg             = $('errorMsg');
const streakBadge          = $('streakBadge');
const bestBadge            = $('bestBadge');
const resetBtn             = $('resetBtn');
const processLog           = $('processLog');
const wordInfoModal        = $('wordInfoModal');
const modalWord            = $('modalWord');
const modalDefinitions     = $('modalDefinitions');
const modalClose           = $('modalClose');
const challengeBtn         = $('challengeBtn');

// ===== 초기화 =====
function init() {
  playerNicknameBadge.textContent = state.nickname;
  updateBadges();
  wordInput.focus();
}

function updateBadges() {
  streakBadge.textContent = `${state.streak}단어`;
  bestBadge.textContent   = `최고 ${state.bestStreak}`;
}

// ===== 이벤트 =====
submitBtn.addEventListener('click', handleSubmit);
wordInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
resetBtn.addEventListener('click', resetChallenge);

function resetChallenge() {
  if (state.streak > 0 && !confirm('챌린지를 다시 시작할까요? 현재 기록이 사라집니다.')) return;

  state.usedWords    = [];
  state.chain        = [];
  state.requiredChars = [];
  state.isFirstWord  = true;
  state.gameOver     = false;
  state.streak       = 0;

  chainContainer.innerHTML = '';
  chainContainer.appendChild(chainStartHint);
  chainStartHint.classList.remove('hidden');
  requiredCharsDisplay.innerHTML = '';
  requiredBar.style.opacity = '0.4';

  const banner = $('gameOverBanner');
  if (banner) banner.remove();

  updateBadges();
  setInputEnabled(true);
  hideError();
  hideProcessLog();
  wordInput.value = '';
  wordInput.focus();
}

// ===== 입력 처리 =====
async function handleSubmit() {
  if (state.gameOver) return;

  const raw = wordInput.value.trim();
  if (!raw) return;

  hideError();
  hideProcessLog();

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
        allowPersonNames: false,
        allowPlaceNames:  false,
        sessionId:        state.sessionId,
      }),
    });
    result = await res.json();
  } catch {
    showError('네트워크 오류가 발생했습니다. 다시 시도해주세요.');
    setInputEnabled(true);
    return;
  }

  if (result.steps) showProcessLog(result.steps);

  if (!result.valid) {
    showError(result.reason || '유효하지 않은 단어입니다.');
    // 단어 오류 → 게임 오버
    endGame();
    return;
  }

  hideProcessLog();
  addToChain(raw);
  state.usedWords.push(raw);
  state.isFirstWord = false;
  state.streak++;
  wordInput.value = '';

  const required = getRequiredChars(raw);
  state.requiredChars = required;
  updateRequiredBar(required);
  updateBadges();

  setInputEnabled(true);
  wordInput.focus();
}

// ===== UI =====
function addToChain(word) {
  chainStartHint.classList.add('hidden');

  const chars = [...word];
  const first = chars[0];
  const last  = chars[chars.length - 1];
  const mid   = chars.slice(1, -1).join('');

  const bubble = document.createElement('div');
  bubble.className = 'word-bubble user';
  bubble.innerHTML = `
    <div class="bubble-top">
      <span class="bubble-label">${state.nickname}</span>
      <button class="btn-word-info" title="뜻 보기 / 이의 제기">?</button>
    </div>
    <div class="bubble-word">
      <span class="hl-first">${first}</span>${mid}<span class="hl-last">${last}</span>
    </div>
  `;
  bubble.querySelector('.btn-word-info').addEventListener('click', () => openWordInfo(word));

  chainContainer.appendChild(bubble);
  chainContainer.scrollTop = chainContainer.scrollHeight;

  state.chain.push(word);
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

function endGame() {
  state.gameOver = true;
  setInputEnabled(false);

  const isNew = state.streak > state.bestStreak;
  if (isNew) {
    state.bestStreak = state.streak;
    localStorage.setItem('wc_challenge_best', state.bestStreak);
  }
  updateBadges();

  const banner = document.createElement('div');
  banner.id        = 'gameOverBanner';
  banner.className = 'game-over-banner';
  banner.innerHTML = `
    <div class="game-over-message">챌린지 종료!</div>
    <div class="game-over-score">이번 기록: ${state.streak} 단어</div>
    ${isNew
      ? `<div class="game-over-record">✨ 신기록 달성!</div>`
      : `<div class="game-over-record">최고 기록: ${state.bestStreak} 단어</div>`
    }
    <button class="btn-restart" onclick="resetChallenge()">다시 시작</button>
  `;
  $('challengeScreen').appendChild(banner);
}

// ===== 에러 / 로그 =====
function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
  errorMsg.style.animation = 'none';
  errorMsg.offsetHeight;
  errorMsg.style.animation = '';
}
function hideError() { errorMsg.classList.add('hidden'); errorMsg.textContent = ''; }

function showProcessLog(steps) {
  if (!processLog || !steps?.length) return;
  processLog.innerHTML = steps.map(s => {
    const cls  = s.ok === true ? 'log-ok' : s.ok === false ? 'log-err' : 'log-dim';
    const icon = s.ok === true ? '✓' : s.ok === false ? '✗' : '–';
    return `<span class="log-step ${cls}">[${s.label}] ${icon} ${s.detail}</span>`;
  }).join('<span class="log-arr">›</span>');
  processLog.classList.remove('hidden');
}
function hideProcessLog() { if (processLog) processLog.classList.add('hidden'); }

function setInputEnabled(enabled) {
  wordInput.disabled = !enabled;
  submitBtn.disabled = !enabled;
}

// ===== 단어 정보 모달 =====
function openWordInfo(word) {
  modalWord.textContent = word;
  modalDefinitions.innerHTML = '<p class="no-definition">사전 연동 준비 중입니다.</p>';
  challengeBtn.disabled = false;
  wordInfoModal.classList.remove('hidden');
}

modalClose.addEventListener('click', () => wordInfoModal.classList.add('hidden'));

challengeBtn.addEventListener('click', async () => {
  const word = modalWord.textContent;
  if (!word || !confirm(`단어 '${word}'에 대해 이의를 제기하시겠습니까?`)) return;

  challengeBtn.disabled = true;
  challengeBtn.textContent = '제출 중...';

  try {
    const res = await fetch('/api/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word, sessionId: state.sessionId }),
    });
    const data = await res.json();
    if (data.success) {
      alert('이의 제기가 접수되었습니다.');
      wordInfoModal.classList.add('hidden');
    } else {
      alert(data.message || '이의 제기에 실패했습니다.');
    }
  } catch {
    alert('네트워크 오류가 발생했습니다.');
  } finally {
    challengeBtn.disabled = false;
    challengeBtn.textContent = '이의 제기';
  }
});

// ===== 모바일 키보드 대응 =====
if (window.visualViewport) {
  const challengeScreen = $('challengeScreen');
  window.visualViewport.addEventListener('resize', () => {
    challengeScreen.style.height = window.visualViewport.height + 'px';
    chainContainer.scrollTop = chainContainer.scrollHeight;
  });
}

// ===== 시작 =====
init();
