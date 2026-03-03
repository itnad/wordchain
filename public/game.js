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
        word: raw,
        allowPersonNames: state.options.allowPersonNames,
        allowPlaceNames: state.options.allowPlaceNames,
        sessionId: state.sessionId,
        nickname: state.nickname,
        gameId: state.currentGameId,
      }),
    });
    result = await res.json();
  } catch (error) {
    showError(`네트워크 오류가 발생했습니다. 다시 시도해주세요. (${error.message})`);
    setInputEnabled(true);
    return;
  }

  if (!result.valid) {
    if (result.reason) {
      showError(result.reason);
    } else {
      showError('유효하지 않은 단어입니다.');
    }
    setInputEnabled(true);
    return;
  }

  addToChain(raw, 'user', result.fromCache);
  state.usedWords.push(raw);
  state.isFirstWord = false;
  state.turns++;
  turnBadge.textContent = `${state.turns}턴`;
  wordInput.value = '';

  state.playerTurn = false;
  await aiTurn(raw);
}