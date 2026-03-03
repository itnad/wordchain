window.APP_VERSION = 'v2';

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.version-tag').forEach(el => {
    el.textContent = window.APP_VERSION;
  });
});
