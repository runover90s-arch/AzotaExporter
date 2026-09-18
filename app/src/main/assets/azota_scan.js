(function () {
  'use strict';

  const nativeBridge = window.AzotaNative;
  if (!nativeBridge) return;

  if (window.AZX_APP && window.AZX_APP.version >= 2) {
    try { window.AZX_APP.scanVisible(); } catch (_) {}
    return;
  }

  const state = {
    q: {},
    scanning: false,
    total: 0,
    timer: null,
    lastNotice: 0
  };

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const flat = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const clean = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();

  function qNumber(text) {
    const m = flat(text).match(/^(?:Câu|Cau)\s*(\d+)\s*[:.]?$/i);
    return m ? Number(m[1]) : null;
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0' && r.width > 0 && r.height > 0;
  }

  function absoluteUrl(value) {
    if (!value) return '';
    if (/^data:/i.test(value)) return value;
    try { return new URL(value, location.href).href; } catch (_) { return value; }
  }

  function markers() {
    return [...document.querySelectorAll('div,span,p,h1,h2,h3,h4,h5,h6,strong,b')]
      .filter(el => visible(el) && qNumber(el.textContent) !== null && flat(el.textContent).length <= 20);
  }

  function markerCount(root, ms) {
    let n = 0;
    for (const m of ms) if (root.contains(m)) n++;
    return n;
  }

  function rootFor(marker, ms) {
    let current = marker;
    let best = marker.parentElement || marker;
    while (current && current.parentElement && current.parentElement !== document.body) {
      const parent = current.parentElement;
      if (markerCount(parent, ms) > 1) break;
      const text = clean(parent.innerText || parent.textContent || '');
      if (text.length > 30000) break;
      best = parent;
      current = parent;
    }
    return best;
  }

  function prepareClone(root) {
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script,noscript,template,iframe').forEach(x => x.remove());
    clone.querySelectorAll('input,textarea,select').forEach(x => x.remove());
    clone.querySelectorAll('button').forEach(button => {
      const span = document.createElement('span');
      span.innerHTML = button.innerHTML;
      span.className = button.className;
      span.style.cssText = button.style.cssText;
      button.replaceWith(span);
    });
    clone.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        const name = a.name.toLowerCase();
        if (name.startsWith('on') || name === 'contenteditable' || name === 'tabindex') el.removeAttribute(a.name);
      });
    });

    const originalImages = root.querySelectorAll('img');
    const cloneImages = clone.querySelectorAll('img');
    cloneImages.forEach((img, i) => {
      const original = originalImages[i];
      if (!original) return;
      const src = original.currentSrc || original.getAttribute('src') || original.getAttribute('data-src') || '';
      if (src) img.setAttribute('src', absoluteUrl(src));
      img.removeAttribute('srcset');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    });

    const originalCanvases = root.querySelectorAll('canvas');
    const cloneCanvases = clone.querySelectorAll('canvas');
    cloneCanvases.forEach((canvas, i) => {
      try {
        const original = originalCanvases[i];
        if (!original) return;
        const img = document.createElement('img');
        img.src = original.toDataURL('image/png');
        img.alt = 'Hình vẽ';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        canvas.replaceWith(img);
      } catch (_) {}
    });
    return clone;
  }

  function detectTotal(ms) {
    let total = state.total || 0;
    for (const m of ms) total = Math.max(total, qNumber(m.textContent) || 0);
    for (const key of Object.keys(state.q)) total = Math.max(total, Number(key) || 0);

    const text = flat((document.body && document.body.innerText) || '').slice(0, 250000);
    const patterns = [
      /Số\s*lượng\s*câu\s*hỏi\s*[:\-]?\s*(\d+)/ig,
      /Tổng\s*số\s*câu\s*[:\-]?\s*(\d+)/ig,
      /(?:từ\s*)?câu\s*\d+\s*(?:đến|tới|-)\s*(?:câu\s*)?(\d+)/ig
    ];
    for (const re of patterns) {
      let match;
      while ((match = re.exec(text))) {
        const n = Number(match[1]);
        if (Number.isFinite(n) && n > 0 && n < 1000) total = Math.max(total, n);
      }
    }
    state.total = total;
    return total;
  }

  function missingNumbers(total) {
    if (!total || total > 500) return [];
    const out = [];
    for (let i = 1; i <= total; i++) if (!state.q[i]) out.push(i);
    return out;
  }

  function notify(message) {
    const count = Object.keys(state.q).length;
    const ms = markers();
    const total = detectTotal(ms);
    const payload = {
      count,
      total,
      missing: missingNumbers(total),
      message: message || ''
    };
    try { nativeBridge.onProgress(JSON.stringify(payload)); } catch (_) {}
  }

  function scanVisible() {
    const ms = markers();
    let changed = false;
    for (const marker of ms) {
      const n = qNumber(marker.textContent);
      if (!n) continue;
      const root = rootFor(marker, ms);
      if (!root) continue;
      const text = clean(root.innerText || root.textContent || '');
      if (text.length < 15) continue;

      const clone = prepareClone(root);
      const html = clone.outerHTML;
      const images = [];
      root.querySelectorAll('img').forEach(img => {
        const src = absoluteUrl(img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '');
        if (src) images.push(src);
      });
      root.querySelectorAll('canvas').forEach(canvas => {
        try { images.push(canvas.toDataURL('image/png')); } catch (_) {}
      });

      const score = text.length + Math.min(html.length, 50000) * 0.12 + images.length * 200;
      const old = state.q[n];
      if (!old || score > old.score) {
        state.q[n] = { n, text, html, images: [...new Set(images)], score };
        changed = true;
      }
    }
    detectTotal(ms);
    if (changed || Date.now() - state.lastNotice > 1200) {
      state.lastNotice = Date.now();
      notify(state.scanning ? 'Đang thu thập câu hỏi' : 'Theo dõi khi bạn cuộn');
    }
    return changed;
  }

  function pageScroller(scroller) {
    return scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
  }

  function currentTop(scroller) {
    return pageScroller(scroller) ? (scrollY || scroller.scrollTop || 0) : scroller.scrollTop;
  }

  function setTop(scroller, y) {
    if (pageScroller(scroller)) scrollTo(0, y);
    else scroller.scrollTop = y;
  }

  function viewportHeight(scroller) {
    return pageScroller(scroller) ? innerHeight : scroller.clientHeight;
  }

  function maxTop(scroller) {
    if (pageScroller(scroller)) {
      const se = document.scrollingElement || document.documentElement;
      return Math.max(0, se.scrollHeight - innerHeight);
    }
    return Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  }

  function scrollCandidates() {
    const candidates = [document.scrollingElement || document.documentElement];
    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight <= el.clientHeight + 260) continue;
      const cs = getComputedStyle(el);
      if (/auto|scroll|overlay/i.test(cs.overflowY)) candidates.push(el);
    }
    return [...new Set(candidates)]
      .filter(Boolean)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 2);
  }

  async function pass(scroller, reverse) {
    let max = maxTop(scroller);
    const step = Math.max(180, Math.floor(viewportHeight(scroller) * 0.32));
    const points = [];
    if (!reverse) {
      for (let y = 0; y <= max + step; y += step) points.push(Math.min(y, max));
    } else {
      for (let y = max; y >= -step; y -= step) points.push(Math.max(0, y));
    }
    for (const y of points) {
      setTop(scroller, y);
      await sleep(390);
      scanVisible();
      max = Math.max(max, maxTop(scroller));
    }
  }

  async function startScan() {
    if (state.scanning) return;
    state.scanning = true;
    notify('Bắt đầu quét');

    try {
      scanVisible();
      const scrollers = scrollCandidates();
      const originals = scrollers.map(s => ({ s, top: currentTop(s) }));
      let unchangedRounds = 0;
      let lastCount = Object.keys(state.q).length;

      for (let round = 0; round < 4; round++) {
        for (const s of scrollers) {
          await pass(s, false);
          await pass(s, true);
        }
        scanVisible();

        const count = Object.keys(state.q).length;
        const total = detectTotal(markers());
        notify('Lượt quét ' + (round + 1));

        if (count === lastCount) unchangedRounds++;
        else unchangedRounds = 0;
        lastCount = count;
        if ((total > 0 && count >= total) || unchangedRounds >= 2) break;
      }

      originals.forEach(x => setTop(x.s, x.top));
      await sleep(180);
      scanVisible();

      const questions = Object.values(state.q).sort((a, b) => a.n - b.n);
      const styles = [...document.querySelectorAll('link[rel="stylesheet"]')]
        .map(link => absoluteUrl(link.href)).filter(Boolean);
      const total = detectTotal(markers());
      nativeBridge.onResult(JSON.stringify({
        title: document.title || 'Đề Azota',
        url: location.href,
        total,
        missing: missingNumbers(total),
        styles,
        questions
      }));
    } catch (e) {
      try { nativeBridge.onError(String(e && e.message || e)); } catch (_) {}
    } finally {
      state.scanning = false;
      notify('Đã quét xong');
    }
  }

  let observerPending = false;
  const scheduleScan = () => {
    if (observerPending) return;
    observerPending = true;
    setTimeout(() => {
      observerPending = false;
      try { scanVisible(); } catch (_) {}
    }, 180);
  };

  new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('scroll', scheduleScan, { passive: true, capture: true });
  state.timer = setInterval(scanVisible, 1600);

  window.AZX_APP = { version: 2, state, scanVisible, startScan };
  scanVisible();
})();
