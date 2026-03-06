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
const wiState = { chain: [], usedWords: [], requiredChars: [], isFirstWord: true, newCount: 0, existingCount: 0, newWords: [] };
let wiInitialized = false;
function initWordInput() {
  if (wiInitialized) return;
  wiInitialized = true;
  document.getElementById('wiSubmitBtn').addEventListener('click', wiSubmit);
  document.getElementById('wiWordInput').addEventListener('keydown', e => { if (e.key === 'Enter') wiSubmit(); });
}
async function wiSubmit() {
  const input = document.getElementById('wiWordInput');
  const word  = input.value.trim();
  if (word.length !== 3) return;
  const btn = document.getElementById('wiSubmitBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/admin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, action: 'add-word', word }),
    });
    const data = await res.json();
    if (data.success) {
      const isNew = !data.alreadyExists;
      const chain = document.getElementById('wiChain');
      const badge = document.createElement('span');
      badge.className = isNew ? 'wi-badge' : 'wi-badge wi-badge-existing';
      badge.innerHTML = `${word}${isNew ? '' : ' <span class="wi-existing-label">기존</span>'}`;
      chain.appendChild(badge);
      if (isNew) wiState.newCount++; else wiState.existingCount++;
      document.getElementById('wiCount').textContent = wiState.newCount;
      input.value = '';
      showToast(`"${word}" 추가 완료`);
    }
  } catch {} finally { btn.disabled = false; input.focus(); }
}

// ===== 단어 관리 (신규) =====
let wmInitialized = false;
function initWordMgmt() {
  if (wmInitialized) return;
  wmInitialized = true;
  document.getElementById('wmSearchBtn').addEventListener('click', wmSearch);
  document.getElementById('wmSearchInput').addEventListener('keydown', e => { if (e.key === 'Enter') wmSearch(); });
}

async function wmSearch() {
  const word = document.getElementById('wmSearchInput').value.trim();
  if (!word) return;
  const area = document.getElementById('wmResultArea');
  area.innerHTML = '<div class="loading">검색 중...</div>';
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: adminPassword, action: 'search-word', word }),
    });
    const data = await res.json();
    if (!data.word) {
      area.innerHTML = '<div class="empty">단어를 찾을 수 없습니다.</div>';
      return;
    }
    renderWordMgmtForm(data.word);
  } catch {
    area.innerHTML = '<div class="empty">검색 중 오류가 발생했습니다.</div>';
  }
}

function renderWordMgmtForm(wordObj) {
  const area = document.getElementById('wmResultArea');
  area.innerHTML = `
    <div class="wm-edit-form">
      <div class="wm-field"><span class="wm-label">단어</span><strong class="wm-val" style="font-size:1.2rem">${wordObj.word}</strong></div>
      <div class="wm-field"><span class="wm-label">유효 여부</span><input type="checkbox" id="wm-valid" ${wordObj.is_valid ? 'checked' : ''}></div>
      <div class="wm-field"><span class="wm-label">인명 여부</span><input type="checkbox" id="wm-person" ${wordObj.is_person_name ? 'checked' : ''}></div>
      <div class="wm-field"><span class="wm-label">지명 여부</span><input type="checkbox" id="wm-place" ${wordObj.is_place_name ? 'checked' : ''}></div>
      <div class="wm-field"><span class="wm-label">킬러 점수</span><input type="number" id="wm-killer" class="wm-input" value="${wordObj.killer_score || 0}" style="width:80px"></div>
      <div class="wm-field"><span class="wm-label">출처</span><span class="wm-val">${wordObj.source || '-'}</span></div>
      <div class="wm-field"><span class="wm-label">시작/끝</span><span class="wm-val">${wordObj.first_char} / ${wordObj.last_char}</span></div>
      <button class="wm-save-btn" id="wmSaveBtn">저장하기</button>
    </div>
  `;
  document.getElementById('wmSaveBtn').addEventListener('click', () => wmSave(wordObj.word));
}

async function wmSave(word) {
  const btn = document.getElementById('wmSaveBtn');
  btn.disabled = true;
  btn.textContent = '저장 중...';
  const payload = {
    password: adminPassword,
    action: 'update-word',
    word,
    is_valid: document.getElementById('wm-valid').checked,
    is_person_name: document.getElementById('wm-person').checked,
    is_place_name: document.getElementById('wm-place').checked,
    killer_score: parseInt(document.getElementById('wm-killer').value, 10) || 0
  };
  try {
    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.success) showToast(`"${word}" 정보가 수정되었습니다.`);
    else showToast('수정 실패', true);
  } catch {
    showToast('서버 오류', true);
  } finally {
    btn.disabled = false;
    btn.textContent = '저장하기';
  }
}

function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast';
  if (isError) t.style.color = 'var(--error)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}