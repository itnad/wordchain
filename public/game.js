--- a/public/game.js
+++ b/public/game.js
@@ -10,6 +10,16 @@
 
   let userNickname = ''; // Global-like variable to store the user's nickname
 
+  // --- Start: Added logic for Issue #8 (Nickname session) ---
+  // 1. Load nickname from session storage on page load
+  const storedNickname = sessionStorage.getItem('userNickname');
+  if (storedNickname) {
+    displayNameInput.value = storedNickname;
+    userNickname = storedNickname; // Initialize global userNickname
+  }
+  // --- End: Added logic for Issue #8 ---
+
   // Function to update the nickname preview and button state based on input
   function updateNicknameScreenState() {
     const name = displayNameInput.value.trim();
@@ -29,6 +39,9 @@
       const name = displayNameInput.value.trim();
       if (name.length > 0) {
         userNickname = name; // Store the nickname for later use
+        // --- Start: Added logic for Issue #8 (Save nickname to session storage) ---
+        sessionStorage.setItem('userNickname', userNickname);
+        // --- End: Added logic for Issue #8 ---
         if (playerNicknameBadge) { // Update the nickname in the game header
           playerNicknameBadge.textContent = userNickname;
         }
