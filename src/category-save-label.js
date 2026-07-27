function applySaveLabel() {
  const button = document.querySelector('#category-bulk-apply');
  if (!button || button.textContent !== '대분류 변경사항 적용') return;
  button.textContent = '저장';
}

const observer = new MutationObserver(applySaveLabel);
observer.observe(document.body, { childList: true, subtree: true });
applySaveLabel();
