let adminPassword = '';
let currentTab    = 'rejected';

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
    const data = await res.json();
    renderTable(data.words ?? []);
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
  document.getElementById('panelRejected').style.display   = tab === 'rejected'   ? '' : 'none';
  document.getElementById('panelChallenges').style.display = tab === 'challenges' ? '' : 'none';
  if (tab === 'challenges') loadChallenges();
}

// ===== 목록 로드 =====
refreshBtn.addEventListener('click', () => {
  if (currentTab === 'rejected') loadList();
  else loadChallenges();
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

// ===== 단어 처리 =====
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

// ===== 토스트 =====
function showToast(msg, isError = false) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.style.borderColor = isError ? 'var(--error)' : 'var(--accent)';
  t.style.color = isError ? 'var(--error)' : 'var(--accent)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
