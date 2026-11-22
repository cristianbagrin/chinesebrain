// The review page opens only for an account with the `plus.anki` switch; with no signal it opens what this device kept.
(async () => {
  let token = '';
  try {
    token = localStorage.getItem('cb-token') ?? '';
  } catch {}
  const signIn = () => location.replace('/account?next=' + encodeURIComponent(location.pathname));
  if (!token) return signIn();
  if (navigator.onLine) {
    const res = await fetch('/api/plus/me', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }).catch(() => null);
    if (res?.status === 401) return signIn();
    if (res && !res.ok) return location.replace('/404');
    if (res && !(await res.json()).flags?.includes('plus.anki')) return location.replace('/404');
  }
  const s = document.createElement('script');
  s.src = '/plus/anki.js';
  document.body.append(s);
  document.documentElement.classList.remove('locked');
})();
