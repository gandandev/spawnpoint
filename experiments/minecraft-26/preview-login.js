document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  const error = document.getElementById('error');
  button.disabled = true; error.textContent = '';
  try {
    const response = await fetch('/preview-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '로그인에 실패했어요.');
    location.href = '/';
  } catch (failure) { error.textContent = failure.message; button.disabled = false; }
});
