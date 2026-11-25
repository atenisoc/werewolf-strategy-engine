// 公開ページのみ集計。ゲーム用localStorageとは独立し、Cookie/Storageを使用しない。
(() => {
  if (location.hostname !== 'kayaigoing.org' || !/^\/hitori-jinro\/?$/.test(location.pathname)) return;
  if (window.__hitoriJinroCounted) return;
  window.__hitoriJinroCounted = true;
  const query = new URLSearchParams(location.search);
  function send(event, label = '') {
    try {
      const payload = {
        v: 2, site: 'hitori-jinro', page_id: 'hitori-jinro', path: '/hitori-jinro/', event, label,
        ref: document.referrer.slice(0, 1024),
        utm_source: (query.get('utm_source') || '').slice(0, 80),
        utm_medium: (query.get('utm_medium') || '').slice(0, 80),
        utm_campaign: (query.get('utm_campaign') || '').slice(0, 120),
        event_id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `hj-${Date.now()}-${Math.random()}`,
        client_ts: Date.now()
      };
      fetch('/ring-api/hit', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), credentials: 'same-origin', keepalive: true }).catch(() => {});
    } catch (_) { /* 計測失敗でゲームを止めない */ }
  }
  send('pageview');
  const labels = { startBtn: 'new-game', codeBtn: 'replay-click', setupBtn: 'settings' };
  document.addEventListener('click', e => {
    const button = e.target.closest?.('button');
    if (button && labels[button.id]) send('click', labels[button.id]);
  });
})();
