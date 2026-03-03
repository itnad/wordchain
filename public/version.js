window.APP_VERSION = 'v1.0.5';

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.version-tag').forEach(el => {
    el.textContent = window.APP_VERSION;
  });
});
