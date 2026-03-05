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

const gameScreen           = $('gameScreen');
const playerNicknameBadge  = $('playerNicknameBadge');
const chainContainer       = $('chainContainer');
const chainStartHint       = $('chainStartHint');
const requiredCharsDisplay = $('requiredCharsDisplay');
const requiredBar          = $('requiredBar');
const wordInput            = $('wordInput');
const submitBtn            = $('submitBtn');
const errorMsg             = $('errorMsg');
const aiLoading            = $('aiLoading');
const turnBadge            = $('turnBadge');
const resetBtn             = $('resetBtn');
const rankingToggleBtn     = $('rankingToggleBtn');
const rankingPanel         = $('rankingPanel');
const rankingList          = $('rankingList');
const processLog           = $('processLog');

// Helper to switch screens
function showScreen(screenToShow) {
  document.querySelectorAll('.screen').forEach(screen => {
    screen.classList.add('hidden');
  });
  screenToShow.classList.remove('hidden');
}

// ===== 초기화 (수정본) =====
async function init() {
  state.sessionId = getOrCreateSessionId();

  // 1. 닉네임 단어 로드
  try {
    const res = await fetch('/api/nickname-words');
    state.nicknameWords = await res.json();
  } catch {
    state.nicknameWords = { adjectives: ['신비로운'], places: ['어딘가'] };
  }

  // 2. 로컬 스토리지에서 기존 이름 확인
  const savedName = localStorage.getItem('wc_display_name');
  
  // 3. 무조건 닉네임 입력 화면(nicknameScreen)을 먼저 보여줌
  showScreen(nicknameScreen);

  // 4. 저장된 이름이 있다면 입력창에 넣어주고 프리뷰 갱신
  if (savedName) {
    displayNameInput.value = savedName;

    // input 이벤트를 강제로 발생시켜 generateNickname이 실행되게 함
    const event = new Event('input', { bubbles: true });
    displayNameInput.dispatchEvent(event);

    // 버튼 활성화
    nicknameConfirmBtn.disabled = false;
  }

  // 5. 홈 랭킹 로드 (비동기, 독립적)
  loadHomeRanking();
}

// ===== 홈 랭킹 =====
function formatRankTime(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const da = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${mo}/${da} ${hh}:${mm}`;
}

async function loadHomeRanking() {
  const body = $('homeRankingBody');
  if (!body) return;

  try {
    const res = await fetch('/api/ranking');
    const { ranking } = await res.json();

    if (!ranking || ranking.length === 0) {
      body.innerHTML = '<div class="home-ranking-empty">아직 기록이 없어요 👋</div>';
      return;
    }

    const myName = localStorage.getItem('wc_display_name') || '';
    const medals = ['🥇', '🥈', '🥉'];

    body.innerHTML = ranking.map(r => {
      const isMine = myName && r.display_name === myName;
      const pos    = r.rank <= 3 ? medals[r.rank - 1] : r.rank;
      const time   = formatRankTime(r.ended_at);
      return `<div class="home-ranking-row${isMine ? ' mine' : ''}">
        <span class="hrank-pos">${pos}</span>
        <span class="hrank-name">${r.display_name}${isMine ? ' ★' : ''}</span>
        <span class="hrank-score">${r.player_word_count}단어</span>
        <span class="hrank-time">${time}</span>
      </div>`;
    }).join('');
  } catch {
    body.innerHTML = '<div class="home-ranking-empty">랭킹을 불러올 수 없습니다.</div>';
  }
}

document.getElementById('homeRankingRefresh')?.addEventListener('click', loadHomeRanking);

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

    await startGame();
  } catch (error) {
    console.error('Nickname confirmation failed:', error);
    nicknameConfirmBtn.disabled  = false;
    nicknameConfirmBtn.textContent = '게임 시작';
    alert(error.message || '서버 오류가 발생했습니다. 다시 시도해주세요.');
  }
}

async function startGame() {
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
  hideProcessLog();
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
rankingToggleBtn.addEventListener('click', () => rankingPanel.classList.toggle('hidden'));

// ===== 입력 처리 =====
async function handleSubmit() {
  if (state.gameOver || !state.playerTurn) return;

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
        word:      raw,
        sessionId: state.sessionId,
        nickname:  state.nickname,
        gameId:    state.currentGameId,
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
    setInputEnabled(true);
    return;
  }

  hideProcessLog();
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

// ===== 처리 로그 =====
function showProcessLog(steps) {
  if (!processLog || !steps?.length) return;
  processLog.innerHTML = steps.map(s => {
    const cls  = s.ok === true ? 'log-ok' : s.ok === false ? 'log-err' : 'log-dim';
    const icon = s.ok === true ? '✓' : s.ok === false ? '✗' : '–';
    return `<span class="log-step ${cls}">[${s.label}] ${icon} ${s.detail}</span>`;
  }).join('<span class="log-arr">›</span>');
  processLog.classList.remove('hidden');
}

function hideProcessLog() {
  if (processLog) processLog.classList.add('hidden');
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
          turns:             state.turns,
        }),
      });
      const data = await res.json();
      personalBest = data.personal_best ?? 0;
      isNewRecord  = data.is_new_record ?? false;
    } catch (e) {
      console.error('Failed to record game end:', e);
    }
  }

  const gameOverBanner = document.createElement('div');
  gameOverBanner.id        = 'gameOverBanner';
  gameOverBanner.className = 'game-over-banner';
  gameOverBanner.innerHTML = `
    <div class="game-over-message">${message}</div>
    <div class="game-over-score">이번 게임: ${state.playerWordCount} 단어</div>
    ${isNewRecord ? `<div class="game-over-record">✨ 신기록 달성! (${personalBest} 단어)</div>` : `<div class="game-over-record">최고 기록: ${personalBest} 단어</div>`}
    <button class="btn-restart" onclick="resetGame()">다시 시작</button>
  `;
  gameScreen.appendChild(gameOverBanner);
}

// ===== 단어 정보 모달 =====
const wordInfoModal    = $('wordInfoModal');
const modalWord        = $('modalWord');
const modalDefinitions = $('modalDefinitions');
const modalClose       = $('modalClose');
const challengeBtn     = $('challengeBtn');

function openWordInfo(word) {
  modalWord.textContent = word;
  modalDefinitions.innerHTML = '<p class="no-definition">사전 연동 준비 중입니다.</p>';
  challengeBtn.disabled = false;
  wordInfoModal.classList.remove('hidden');
}

modalClose.addEventListener('click', () => {
  wordInfoModal.classList.add('hidden');
});

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
      alert('이의 제기가 성공적으로 접수되었습니다. 검토 후 처리됩니다.');
      wordInfoModal.classList.add('hidden');
    } else {
      alert(data.message || '이의 제기에 실패했습니다.');
    }
  } catch (e) {
    console.error('Challenge failed:', e);
    alert('이의 제기 중 네트워크 오류가 발생했습니다. 다시 시도해주세요.');
  } finally {
    challengeBtn.disabled = false;
    challengeBtn.textContent = '이의 제기';
  }
});

// ===== 랭킹 =====
async function loadRanking() {
  try {
    const res = await fetch('/api/ranking');
    const ranking = await res.json();

    rankingList.innerHTML = ''; // Clear existing list

    if (ranking.length === 0) {
      const li = document.createElement('li');
      li.className = 'ranking-empty';
      li.textContent = '기록이 없습니다';
      rankingList.appendChild(li);
    } else {
      ranking.forEach((entry, index) => {
        const li = document.createElement('li');
        li.className = 'ranking-item';
        li.innerHTML = `
          <span class="ranking-rank">${index + 1}.</span>
          <span class="ranking-nickname">${entry.nickname}</span>
          <span class="ranking-score">${entry.player_word_count} 단어</span>
        `;
        rankingList.appendChild(li);
      });
    }
  } catch (e) {
    console.error('Failed to load ranking:', e);
    rankingList.innerHTML = '<li class="ranking-empty">랭킹을 불러올 수 없습니다.</li>';
  }
}

// ===== 모바일 키보드 대응 =====
// visualViewport.height  : 키보드를 제외한 실제 보이는 높이
// visualViewport.offsetTop: iOS Safari에서 레이아웃 뷰포트 대비 시각 뷰포트의 오프셋
//   → 두 값 모두 반영해야 iOS에서 헤더가 위로 밀리는 현상을 막을 수 있음
if (window.visualViewport) {
  const onViewportChange = () => {
    if (!gameScreen.classList.contains('hidden')) {
      const vv = window.visualViewport;
      gameScreen.style.top    = vv.offsetTop + 'px';
      gameScreen.style.height = vv.height + 'px';
      chainContainer.scrollTop = chainContainer.scrollHeight;
    }
  };
  window.visualViewport.addEventListener('resize', onViewportChange);
  window.visualViewport.addEventListener('scroll', onViewportChange);
}

// 타이핑 시작 시 체인 맨 아래로 복귀
wordInput.addEventListener('input', () => {
  chainContainer.scrollTop = chainContainer.scrollHeight;
});

// 앱 시작
init();
