document.addEventListener('DOMContentLoaded', () => {
  // --- Nickname Screen Interaction Logic (Added to address Issue #7) ---
  const nicknameScreen    = document.getElementById('nicknameScreen');
  const displayNameInput  = document.getElementById('displayNameInput');
  const nicknameConfirmBtn = document.getElementById('nicknameConfirmBtn');
  const nicknamePreview   = document.getElementById('nicknamePreview');
  const setupScreen       = document.getElementById('setupScreen');
  const playerNicknameBadge = document.getElementById('playerNicknameBadge'); // For displaying the chosen nickname in the game header

  let userNickname = ''; // Global-like variable to store the user's nickname

  // Function to update the nickname preview and button state based on input
  function updateNicknameScreenState() {
    const name = displayNameInput.value.trim();
    if (name.length > 0) {
      nicknameConfirmBtn.disabled = false;
      nicknamePreview.textContent = `"${name}" 님, 환영합니다!`;
      nicknamePreview.classList.remove('hidden');
    } else {
      nicknameConfirmBtn.disabled = true;
      nicknamePreview.classList.add('hidden');
    }
  }

  // Event listener for nickname input to enable/disable the confirm button and show preview
  if (displayNameInput) {
    displayNameInput.addEventListener('input', updateNicknameScreenState);
  }

  // Event listener for "다음" (Next) button click
  if (nicknameConfirmBtn) {
    nicknameConfirmBtn.addEventListener('click', () => {
      const name = displayNameInput.value.trim();
      if (name.length > 0) {
        userNickname = name; // Store the nickname for later use
        if (playerNicknameBadge) { // Update the nickname in the game header
          playerNicknameBadge.textContent = userNickname;
        }

        // Transition from nickname screen to setup screen
        if (nicknameScreen) nicknameScreen.classList.add('hidden');
        if (setupScreen) setupScreen.classList.remove('hidden');

        // Optionally, focus on the first interactive element of the setup screen
        // document.getElementById('allowPersonNames')?.focus();
      }
    });
  }

  // Initial call to set the button state correctly on page load
  if (displayNameInput) { // Only run if the input element exists on the page
    updateNicknameScreenState();
  }

  // --- End of Nickname Screen Interaction Logic ---

  // Original snippet from game.js (context for 'data' is assumed to be handled elsewhere in the full file)
  // If this snippet were to run directly without 'data' being defined, it would cause a ReferenceError.
  // This code might be part of a larger function that processes server responses, which is not provided.
  // For the purpose of fixing the reported client-side issue, this snippet is retained as-is
  // but commented to prevent immediate execution errors within this isolated file context.
  /*
  if (!data || !data.display_name || !data.nickname) {
    throw new Error('서버에서 필요한 사용자 정보(이름, 닉네임)를 받지 못했습니다. 서버 응답 형식을 확인해주세요.');
  }
  */
});
