import { firebaseConfig } from '../firebase-config.js';

const appModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js');
const authModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js');
const storeModule = await import('https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js');

const app = appModule.getApps().length ? appModule.getApp() : appModule.initializeApp(firebaseConfig);
const auth = authModule.getAuth(app);
const db = storeModule.getFirestore(app);

let patching = false;

function patchCategoryView() {
  if (patching) return;
  const view = document.querySelector('#categories-view');
  const bulkForm = document.querySelector('#categories-bulk-form');
  if (!view || !bulkForm || bulkForm.dataset.individualSave === 'true') return;

  patching = true;
  bulkForm.dataset.individualSave = 'true';

  const bulkSave = bulkForm.querySelector('.bulk-save-actions');
  if (bulkSave) bulkSave.remove();

  bulkForm.addEventListener('submit', (event) => event.preventDefault(), true);

  document.querySelectorAll('.category-edit-row').forEach((row) => {
    const nameInput = row.querySelector('[name="name"]');
    const hoursInput = row.querySelector('[name="hours"]');
    const deleteButton = row.querySelector('.category-delete');
    if (!nameInput || !hoursInput || !deleteButton || row.querySelector('.category-update')) return;

    const actions = document.createElement('div');
    actions.className = 'category-row-actions';

    const updateButton = document.createElement('button');
    updateButton.type = 'button';
    updateButton.className = 'secondary-button category-update';
    updateButton.textContent = '수정';

    deleteButton.remove();
    actions.append(updateButton, deleteButton);
    row.append(actions);

    updateButton.addEventListener('click', async () => {
      const user = auth.currentUser;
      const name = nameInput.value.trim();
      const hours = Number(hoursInput.value);

      if (!user) return alert('로그인이 필요합니다.');
      if (!name) return alert('대분류 이름을 입력하세요.');
      if (!Number.isFinite(hours) || hours < 0) return alert('기본 예산 시간을 확인하세요.');

      updateButton.disabled = true;
      updateButton.textContent = '저장 중…';
      try {
        await storeModule.setDoc(
          storeModule.doc(db, 'users', user.uid, 'categories', row.dataset.id),
          { name, budgetMinutes: hours * 60 },
          { merge: true },
        );
        updateButton.textContent = '저장됨';
        setTimeout(() => {
          updateButton.disabled = false;
          updateButton.textContent = '수정';
        }, 900);
      } catch (error) {
        console.error(error);
        updateButton.disabled = false;
        updateButton.textContent = '수정';
        alert(`수정하지 못했습니다: ${error.message}`);
      }
    });
  });

  patching = false;
}

const observer = new MutationObserver(patchCategoryView);
observer.observe(document.body, { childList: true, subtree: true });
patchCategoryView();
