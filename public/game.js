async function init() {
  state.sessionId = getOrCreateSessionId();

  // 닉네임 단어 로드
  try {
    const res = await fetch('/api/nickname-words');
    state.nicknameWords = await res.json();
  } catch {
    state.nicknameWords = { adjectives: ['신비로운'], places: ['어딘가'] };
  }

  // 항상 닉네임 화면을 먼저 보여줍니다.
  showScreen(nicknameScreen);

  // 이전에 저장된 닉네임이 있다면 입력 필드를 미리 채웁니다.
  const savedName = localStorage.getItem('wc_display_name');
  const savedNickname = localStorage.getItem('wc_nickname');
  if (savedName && savedNickname) {
    displayNameInput.value = savedName;
    state.displayName = savedName;
    state.nickname    = savedNickname;
    // 입력 이벤트를 수동으로 발생시켜 미리보기와 버튼 활성화 로직을 실행합니다.
    displayNameInput.dispatchEvent(new Event('input'));
  }
}