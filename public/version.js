window.APP_VERSION = 'v1';

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.version-tag').forEach(el => {
    el.textContent = window.APP_VERSION;
  });
});
