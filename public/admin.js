let adminPassword = '';
let currentTab    = 'rejected';

// ===== 두음법칙 (game.js와 동일) =====
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
  const variants = getDuemVariants(chars[chars.length - 1]);
  return variants.map((c, i) => ({ char: c, isDueum: i > 0 }));
}

const loginSection      = document.getElementById('loginSection');
const mainSection       = document.getElementById('mainSection');
const pwInput           = document.getElementById('pwInput');
const loginBtn          = document.getElementById('loginBtn');
const loginError        = document.getElementById('loginError');
const wordCount         = document.getElementById('wordCount');
const tableLoading      = document.getElementById('tableLoading');
const wordTable         = document.getElementById('wordTable');
const wordTableBody     = document.getElementById('wordTableBody');
const emptyMsg          = document.getElementById('emptyMsg');
const refreshBtn        = document.getElementById('refreshBtn');
const challengeLoading  = document.getElementById('challengeLoading');
const challengeTable    = document.getElementById('challengeTable');
const challengeTableBody= document.getElementById('challengeTableBody');
const challengeEmptyMsg = document.getElementById('challengeEmptyMsg');

// ===== 로그인 =====
loginBtn.addEventListener('click', login);
pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

async function login() {
  const pw = pwInput.value;
  if (!pw) return;

  loginBtn.disabled = true;
  loginBtn.textContent = '확인 중...';

  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, action: 'list' }),
    });

    if (res.status === 401) {
      loginError.classList.remove('hidden');
      loginBtn.disabled = false;
      loginBtn.textContent = '로그인';
      return;
    }

    adminPassword = pw;
    loginSection.style.display = 'none';
    mainSection.style.display  = 'block';

    const hash = location.hash.replace('#', '');
    if (['word-input', 'challenges', 'word-mgmt'].includes(hash)) {
      switchTab(hash);
    } else {
      const data = await res.json();
      renderTable(data.words ?? []);
    }
  } catch {
    loginError.textContent = '서버 오류가 발생했습니다.';
    loginError.classList.remove('hidden');
    loginBtn.disabled = false;
    loginBtn.textContent = '로그인';
  }
}

// ===== 탭 전환 =====
function switchTab(tab) {
  currentTab = tab;
  document.getElementById('tabRejected').classList.toggle('active', tab === 'rejected');
  document.getElementById('tabChallenges').classList.toggle('active', tab === 'challenges');
  document.getElementById('tabWordInput').classList.toggle('active', tab === 'word-input');
  document.getElementById('tabWordMgmt').classList.toggle('active', tab === 'word-mgmt');
  
  document.getElementById('panelRejected').style.display   = tab === 'rejected'   ? '' : 'none';
  document.getElementById('panelChallenges').style.display = tab === 'challenges' ? '' : 'none';
  document.getElementById('panelWordInput').style.display  = tab === 'word-input' ? '' : 'none';
  document.getElementById('panelWordMgmt').style.display   = tab === 'word-mgmt'  ? '' : 'none';

  if (tab === 'challenges') loadChallenges();
  if (tab === 'word-input') initWordInput();
  if (tab === 'word-mgmt') initWordMgmt();
}

// ===== 목록 로드 =====
refreshBtn.addEventListener('click', () => {
  if (currentTab === 'rejected') loadList();
  else if (currentTab === 'challenges') loadChallenges();
});

async function loadList() {
  tableLoading.classList.remove('hidden');
  wordTable.style.display = 'none';
  emptyMsg.classList.add('hidden');

  const res = await fetch('/api/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword, action: 'list' }),
  });
  const data = await res.json();
  renderTable(data.words ?? []);
}

function renderTable(words) {
  tableLoading.classList.add('hidden');
  if (words.length === 0) {
    emptyMsg.classList.remove('hidden');
    return;
  }
  wordCount.textContent = `총 ${words.length}개`;
  wordTableBody.innerHTML = '';
  words.forEach(row => {
    const tr = document.createElement('tr');
    tr.id = `row-${row.word}`;
    const statusHtml = row.already_decided === true
      ? '<span class="status-approved">허용됨</span>'
      : row.already_decided === false
        ? '<span class="status-rejected">거부됨</span>'
        : '<span class="status-none">미결정</span>';
    const date = row.last_rejected_at
      ? new Date(row.last_rejected_at).toLocaleDateString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
      : '-';
    tr.innerHTML = `
      <td class="word-cell">${row.word}</td>
      <td class="count-cell">${row.reject_count}회</td>
      <td class="date-cell">${date}</td>
      <td class="status-cell">${statusHtml}</td>
      <td class="action-cell">
        <button class="btn-approve" onclick="decide('${row.word}', 'approve', this)">허용</button>
        <button class="btn-reject"  onclick="decide('${row.word}', 'reject',  this)">거부</button>
      </td>
    `;
    wordTableBody.appendChild(tr);
  });
  wordTable.style.display = 'table';
}

// ===== 이의 제기 목록 =====
async function loadChallenges() {
  challengeLoading.classList.remove('hidden');
  challengeTable.style.display = 'none';
  challengeEmptyMsg.classList.add('hidden');
  const res  = await fetch('/api/admin', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: adminPassword, action: 'list-challenges' }),
  });
  const data = await res.json();
  renderChallenges(data.challenges ?? []);
}

function renderChallenges(challenges) {
  challengeLoading.classList.add('hidden');
  if (challenges.length === 0) {
    challengeEmptyMsg.classList.remove('hidden');
    return;
  }
  wordCount.textContent = `총 ${challenges.length}개`;
  challengeTableBody.innerHTML = '';
  challenges.forEach(row => {
    const tr = document.createElement('tr');
    tr.id = `ch-row-${row.word}`;
    const date = row.last_challenged_at
      ? new Date(row.last_challenged_at).toLocaleDateString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      : '-';
    tr.innerHTML = `
      <td class="word-cell">${row.word}</td>
      <td class="count-cell">${row.challenge_count}회</td>
      <td class="date-cell">${date}</td>
      <td class="action-cell">
        <button class="btn-dismiss" onclick="handleChallenge('${row.word}', 'dismiss', this)">유지</button>
        <button class="btn-uphold"  onclick="handleChallenge('${row.word}', 'uphold',  this)">제외</button>
      </td>
    `;
    challengeTableBody.appendChild(tr);
  });
  challengeTable.style.display = 'table';
}

async function handleChallenge(word, action, btn) {
  btn.disabled = true;
  const row = document.getElementById(`ch-row-${word}`);
  if (row) row.style.opacity = '0.5';
  try {
    const res  = await fetch('/api/admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, action: `challenge-${action}`, word }),
    });
    const data = await res.json();
    if (data.success) {
      if (row) row.remove();
      showToast(`"${word}" ${action === 'dismiss' ? '유지' : '제외'} 처리 완료`);
    } else {
      showToast('처리 중 오류가 발생했습니다.', true);
      if (row) row.style.opacity = '1';
      btn.disabled = false;
    }
  } catch {
    showToast('서버 오류가 발생했습니다.', true);
    if (row) row.style.opacity = '1';
    btn.disabled = false;
  }
}

async function decide(word, action, btn) {
  btn.disabled = true;
  const row = document.getElementById(`row-${word}`);
  if (row) row.style.opacity = '0.5';
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, action, word }),
    });
    const data = await res.json();
    if (data.success) {
      const statusCell = row?.querySelector('.status-cell');
      if (statusCell) {
        statusCell.innerHTML = action === 'approve'
          ? '<span class="status-approved">허용됨</span>'
          : '<span class="status-rejected">거부됨</span>';
      }
      showToast(`"${word}" ${action === 'approve' ? '허용' : '거부'} 처리 완료`);
    } else {
      showToast('처리 중 오류가 발생했습니다.', true);
    }
  } catch {
    showToast('서버 오류가 발생했습니다.', true);
  } finally {
    if (row) row.style.opacity = '1';
    btn.disabled = false;
  }
}

// ===== 단어 입력 =====
const wiState = {
  chain: [], usedWords: [],
  requiredChars: [], isFirstWord: true,
  newCount: 0,       // 실제 신규 추가된 단어 수
  existingCount: 0,  // 이미 DB에 있던 단어 수
  newWords: [],      // 신규 추가된 단어 목록
};
let wiInitialized = false;
function initWordInput() {
  if (wiInitialized) return;
  wiInitialized = true;
  document.getElementById('wiSubmitBtn').addEventListener('click', wiSubmit);
  document.getElementById('wiWordInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') wiSubmit();
  });
  document.getElementById('wiWordInput').focus();
}

function wiShowError(msg) {
  const el = document.getElementById('wiError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function wiHideError() {
  const el = document.getElementById('wiError');
  el.classList.add('hidden');
  el.textContent = '';
}

function wiUpdateRequiredBar(required) {
  const bar    = document.getElementById('wiRequiredBar');
  const display = document.getElementById('wiRequiredCharsDisplay');
  bar.style.opacity = '1';
  display.innerHTML = '';
  required.forEach((r, i) => {
    if (i > 0) {
      const or = document.createElement('span');
      or.className = 'req-or';
      or.textContent = '또는';
      display.appendChild(or);
    }
    const span = document.createElement('span');
    span.className = `req-char${r.isDueum ? ' dueum' : ''}`;
    span.innerHTML = r.isDueum
      ? `${r.char} <span class="dueum-badge">두음</span>`
      : r.char;
    display.appendChild(span);
  });
}

function wiAddToChain(word, isNew) {
  const chain = document.getElementById('wiChain');
  const badge = document.createElement('span');
  badge.className = isNew ? 'wi-badge' : 'wi-badge wi-badge-existing';
  const chars = [...word];
  const label = isNew ? '' : ' <span class="wi-existing-label">기존</span>';
  badge.innerHTML = `<span class="hl-first">${chars[0]}</span>${chars.slice(1,-1).join('')}<span class="hl-last">${chars[chars.length-1]}</span>${label}`;
  chain.appendChild(badge);
  chain.scrollTop = chain.scrollHeight;
}

function wiUpdateStats() {
  document.getElementById('wiCount').textContent = wiState.newCount;

  const existingInfo = document.getElementById('wiExistingInfo');
  if (wiState.existingCount > 0) {
    document.getElementById('wiExistingCount').textContent = wiState.existingCount;
    existingInfo.style.display = '';
  }

  // 신규 단어 목록 업데이트
  const summary  = document.getElementById('wiSummary');
  const summaryW = document.getElementById('wiSummaryWords');
  if (wiState.newWords.length > 0) {
    summaryW.innerHTML = wiState.newWords.map(w => {
      const c = [...w];
      return `<span class="wi-badge wi-badge-sm"><span class="hl-first">${c[0]}</span>${c.slice(1,-1).join('')}<span class="hl-last">${c[c.length-1]}</span></span>`;
    }).join('');
    summary.style.display = '';
  }
}

async function wiSubmit() {
  const input = document.getElementById('wiWordInput');
  const word  = input.value.trim();
  wiHideError();

  const chars = [...word];
  if (chars.length !== 3) { wiShowError('정확히 3글자 단어를 입력하세요.'); return; }
  if (!chars.every(c => /[가-힣]/.test(c))) { wiShowError('한글 단어만 입력 가능합니다.'); return; }
  if (wiState.usedWords.includes(word)) { wiShowError('이미 추가한 단어입니다.'); return; }

  const btn = document.getElementById('wiSubmitBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, action: 'add-word', word }),
    });
    const data = await res.json();
    if (!data.success) {
      wiShowError(data.error || '추가 실패');
      return;
    }

    const isNew = !data.alreadyExists;
    wiAddToChain(word, isNew);
    wiState.usedWords.push(word);
    wiState.isFirstWord = false;

    if (isNew) {
      wiState.newCount++;
      wiState.newWords.push(word);
      showToast(`"${word}" 신규 추가 완료`);
    } else {
      wiState.existingCount++;
      showToast(`"${word}" 이미 등록된 단어`, 'warn');
    }
    wiUpdateStats();

    const required = getRequiredChars(word);
    wiState.requiredChars = required;
    wiUpdateRequiredBar(required);

    input.value = '';
  } catch {
    wiShowError('서버 오류가 발생했습니다.');
  } finally {
  btn.disabled = false;
  input.focus();
  }
}

function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.borderColor = color;
  t.style.color = color;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
