(function () {
  'use strict';

  const nativeBridge = window.AzotaNative;
  if (!nativeBridge) return;

  if (window.AZX_APP && window.AZX_APP.version >= 3) {
    try { window.AZX_APP.scanVisible(); } catch (_) {}
    return;
  }

  const state = {
    q: {},
    scanning: false,
    timer: null,
    lastNotice: 0,
    sectionTotals: {},
    currentSection: {
      key: 'I',
      title: 'PHẦN I',
      index: 1
    }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const flat = s => String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const clean = s => String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .trim();

  function qNumber(text) {
    const m = flat(text).match(/^(?:Câu|Cau)\s*(\d+)\s*[:.]?$/i);
    return m ? Number(m[1]) : null;
  }

  function romanToInt(s) {
    s = String(s || '').toUpperCase();
    const map = {I:1,V:5,X:10,L:50,C:100};
    let total = 0, last = 0;

    for (let i = s.length - 1; i >= 0; i--) {
      const v = map[s[i]] || 0;
      total += v < last ? -v : v;
      if (v > last) last = v;
    }
    return total || 1;
  }

  function visible(el) {
    if (!(el instanceof Element)) return false;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();

    return cs.display !== 'none' &&
      cs.visibility !== 'hidden' &&
      cs.opacity !== '0' &&
      r.width > 0 &&
      r.height > 0;
  }

  function absoluteUrl(value) {
    if (!value) return '';
    if (/^data:/i.test(value)) return value;
    try {
      return new URL(value, location.href).href;
    } catch (_) {
      return value;
    }
  }

  function markers() {
    return [...document.querySelectorAll(
      'div,span,p,h1,h2,h3,h4,h5,h6,strong,b'
    )].filter(el => {
      const t = flat(el.textContent);
      return visible(el) &&
        qNumber(t) !== null &&
        t.length <= 20;
    });
  }

  function sectionHeaders() {
    const all = [...document.querySelectorAll(
      'div,p,span,h1,h2,h3,h4,h5,h6,strong,b'
    )];

    return all.filter(el => {
      if (!visible(el)) return false;

      const t = flat(el.textContent);

      if (!/^PHẦN\s+([IVXLC]+|\d+)\b/i.test(t)) return false;
      if (t.length > 600) return false;

      const questions = t.match(/Câu\s*\d+/gi) || [];

      return questions.length <= 1;
    });
  }

  function parseSection(header) {
    const text = flat(header ? header.textContent : '');
    const m = text.match(/^PHẦN\s+([IVXLC]+|\d+)\b/i);

    if (!m) return state.currentSection;

    const raw = m[1].toUpperCase();
    const index = /^\d+$/.test(raw)
      ? Number(raw)
      : romanToInt(raw);

    const key = raw;

    return {
      key,
      index,
      title: text
    };
  }

  function isBefore(a, b) {
    if (!a || !b || a === b) return false;

    return !!(
      a.compareDocumentPosition(b) &
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  }

  function sectionFor(marker, headers) {
    let selected = null;

    for (const h of headers) {
      if (isBefore(h, marker)) selected = h;
    }

    if (selected) {
      const info = parseSection(selected);
      state.currentSection = info;

      const t = flat(selected.textContent);

      const range = t.match(
        /(?:từ\s*)?câu\s*\d+\s*(?:đến|tới|-)\s*(?:câu\s*)?(\d+)/i
      );

      if (range) {
        state.sectionTotals[info.key] =
          Math.max(
            state.sectionTotals[info.key] || 0,
            Number(range[1]) || 0
          );
      }

      return info;
    }

    return state.currentSection;
  }

  function markerCount(root, ms) {
    let n = 0;
    for (const m of ms) {
      if (root.contains(m)) n++;
    }
    return n;
  }

  function containsSectionHeader(root, hs) {
    for (const h of hs) {
      if (root.contains(h)) return true;
    }
    return false;
  }

  function rootFor(marker, ms, hs) {
    let current = marker;
    let best = marker.parentElement || marker;

    while (
      current &&
      current.parentElement &&
      current.parentElement !== document.body
    ) {
      const parent = current.parentElement;

      if (markerCount(parent, ms) > 1) break;

      if (
        containsSectionHeader(parent, hs) &&
        !containsSectionHeader(best, hs)
      ) {
        break;
      }

      const text = clean(
        parent.innerText ||
        parent.textContent ||
        ''
      );

      if (text.length > 30000) break;

      best = parent;
      current = parent;
    }

    return best;
  }

  function prepareClone(root) {
    const clone = root.cloneNode(true);

    clone.querySelectorAll(
      'script,noscript,template,iframe'
    ).forEach(x => x.remove());

    clone.querySelectorAll(
      'input,textarea,select'
    ).forEach(x => x.remove());

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

        if (
          name.startsWith('on') ||
          name === 'contenteditable' ||
          name === 'tabindex'
        ) {
          el.removeAttribute(a.name);
        }
      });
    });

    const originalImages = root.querySelectorAll('img');
    const cloneImages = clone.querySelectorAll('img');

    cloneImages.forEach((img, i) => {
      const original = originalImages[i];
      if (!original) return;

      const src =
        original.currentSrc ||
        original.getAttribute('src') ||
        original.getAttribute('data-src') ||
        '';

      if (src) img.src = absoluteUrl(src);

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

  function totals() {
    const observed = {};

    Object.values(state.q).forEach(q => {
      observed[q.sectionKey] = Math.max(
        observed[q.sectionKey] || 0,
        q.n
      );
    });

    const keys = new Set([
      ...Object.keys(observed),
      ...Object.keys(state.sectionTotals)
    ]);

    let total = 0;

    for (const key of keys) {
      total += Math.max(
        observed[key] || 0,
        state.sectionTotals[key] || 0
      );
    }

    return total;
  }

  function missingNumbers() {
    const out = [];

    const sections = {};

    Object.values(state.q).forEach(q => {
      if (!sections[q.sectionKey]) {
        sections[q.sectionKey] = {
          index: q.sectionIndex,
          max: 0
        };
      }

      sections[q.sectionKey].max = Math.max(
        sections[q.sectionKey].max,
        q.n
      );
    });

    for (const [key, expected] of Object.entries(state.sectionTotals)) {
      if (!sections[key]) {
        sections[key] = {
          index: romanToInt(key),
          max: 0
        };
      }

      sections[key].max = Math.max(
        sections[key].max,
        expected
      );
    }

    const ordered = Object.entries(sections)
      .sort((a, b) => a[1].index - b[1].index);

    for (const [key, info] of ordered) {
      const expected = Math.max(
        info.max,
        state.sectionTotals[key] || 0
      );

      for (let i = 1; i <= expected; i++) {
        if (!state.q[key + ':' + i]) {
          out.push(key + '-' + i);
        }
      }
    }

    return out;
  }

  function notify(message) {
    try {
      nativeBridge.onProgress(JSON.stringify({
        count: Object.keys(state.q).length,
        total: totals(),
        missing: missingNumbers(),
        message: message || ''
      }));
    } catch (_) {}
  }

  function scanVisible() {
    const ms = markers();
    const hs = sectionHeaders();

    let changed = false;

    for (const marker of ms) {
      const n = qNumber(marker.textContent);
      if (!n) continue;

      const section = sectionFor(marker, hs);
      const key = section.key + ':' + n;

      const root = rootFor(marker, ms, hs);
      if (!root) continue;

      const text = clean(
        root.innerText ||
        root.textContent ||
        ''
      );

      if (text.length < 15) continue;

      const clone = prepareClone(root);
      const html = clone.outerHTML;

      const images = [];

      root.querySelectorAll('img').forEach(img => {
        const src = absoluteUrl(
          img.currentSrc ||
          img.getAttribute('src') ||
          img.getAttribute('data-src') ||
          ''
        );

        if (src) images.push(src);
      });

      root.querySelectorAll('canvas').forEach(canvas => {
        try {
          images.push(canvas.toDataURL('image/png'));
        } catch (_) {}
      });

      const score =
        text.length +
        Math.min(html.length, 50000) * 0.12 +
        images.length * 200;

      const old = state.q[key];

      if (!old || score > old.score) {
        state.q[key] = {
          key,
          n,
          label: 'Câu ' + n,
          sectionKey: section.key,
          sectionIndex: section.index,
          sectionTitle: section.title,
          text,
          html,
          images: [...new Set(images)],
          score
        };

        changed = true;
      }

      state.sectionTotals[section.key] = Math.max(
        state.sectionTotals[section.key] || 0,
        n
      );
    }

    if (
      changed ||
      Date.now() - state.lastNotice > 1200
    ) {
      state.lastNotice = Date.now();

      notify(
        state.scanning
          ? 'Đang thu thập câu hỏi'
          : 'Theo dõi khi bạn cuộn'
      );
    }

    return changed;
  }

  function pageScroller(scroller) {
    return (
      scroller === document.scrollingElement ||
      scroller === document.documentElement ||
      scroller === document.body
    );
  }

  function currentTop(scroller) {
    return pageScroller(scroller)
      ? (scrollY || scroller.scrollTop || 0)
      : scroller.scrollTop;
  }

  function setTop(scroller, y) {
    if (pageScroller(scroller)) {
      scrollTo(0, y);
    } else {
      scroller.scrollTop = y;
    }
  }

  function viewportHeight(scroller) {
    return pageScroller(scroller)
      ? innerHeight
      : scroller.clientHeight;
  }

  function maxTop(scroller) {
    if (pageScroller(scroller)) {
      const se =
        document.scrollingElement ||
        document.documentElement;

      return Math.max(
        0,
        se.scrollHeight - innerHeight
      );
    }

    return Math.max(
      0,
      scroller.scrollHeight - scroller.clientHeight
    );
  }

  function scrollCandidates() {
    const candidates = [
      document.scrollingElement ||
      document.documentElement
    ];

    for (const el of document.querySelectorAll('*')) {
      if (
        el.scrollHeight <=
        el.clientHeight + 260
      ) continue;

      const cs = getComputedStyle(el);

      if (/auto|scroll|overlay/i.test(cs.overflowY)) {
        candidates.push(el);
      }
    }

    return [...new Set(candidates)]
      .filter(Boolean)
      .sort(
        (a, b) =>
          (b.scrollHeight - b.clientHeight) -
          (a.scrollHeight - a.clientHeight)
      )
      .slice(0, 3);
  }

  async function pass(scroller, reverse) {
    let max = maxTop(scroller);

    const step = Math.max(
      160,
      Math.floor(viewportHeight(scroller) * 0.28)
    );

    const points = [];

    if (!reverse) {
      for (
        let y = 0;
        y <= max + step;
        y += step
      ) {
        points.push(Math.min(y, max));
      }
    } else {
      for (
        let y = max;
        y >= -step;
        y -= step
      ) {
        points.push(Math.max(0, y));
      }
    }

    for (const y of points) {
      setTop(scroller, y);

      await sleep(500);

      scanVisible();

      max = Math.max(
        max,
        maxTop(scroller)
      );
    }
  }

  async function startScan() {
    if (state.scanning) return;

    state.scanning = true;

    notify('Bắt đầu quét');

    try {
      scanVisible();

      const scrollers = scrollCandidates();

      const originals = scrollers.map(s => ({
        s,
        top: currentTop(s)
      }));

      let unchangedRounds = 0;
      let lastCount =
        Object.keys(state.q).length;

      for (let round = 0; round < 5; round++) {
        for (const s of scrollers) {
          await pass(s, false);
          await pass(s, true);
        }

        scanVisible();

        const count =
          Object.keys(state.q).length;

        notify(
          'Lượt quét ' + (round + 1)
        );

        if (count === lastCount) {
          unchangedRounds++;
        } else {
          unchangedRounds = 0;
        }

        lastCount = count;

        if (unchangedRounds >= 2) break;
      }

      originals.forEach(x =>
        setTop(x.s, x.top)
      );

      await sleep(250);

      scanVisible();

      const questions =
        Object.values(state.q)
          .sort((a, b) => {
            if (
              a.sectionIndex !== b.sectionIndex
            ) {
              return (
                a.sectionIndex -
                b.sectionIndex
              );
            }

            return a.n - b.n;
          });

      const styles = [
        ...document.querySelectorAll(
          'link[rel="stylesheet"]'
        )
      ]
        .map(link => absoluteUrl(link.href))
        .filter(Boolean);

      nativeBridge.onResult(JSON.stringify({
        title:
          document.title ||
          'Đề Azota',

        url: location.href,

        total: totals(),

        missing: missingNumbers(),

        styles,

        questions
      }));

    } catch (e) {
      try {
        nativeBridge.onError(
          String(
            e && e.message
              ? e.message
              : e
          )
        );
      } catch (_) {}

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

      try {
        scanVisible();
      } catch (_) {}
    }, 180);
  };

  new MutationObserver(scheduleScan)
    .observe(
      document.documentElement,
      {
        childList: true,
        subtree: true
      }
    );

  addEventListener(
    'scroll',
    scheduleScan,
    {
      passive: true,
      capture: true
    }
  );

  state.timer =
    setInterval(
      scanVisible,
      1400
    );

  window.AZX_APP = {
    version: 3,
    state,
    scanVisible,
    startScan
  };

  scanVisible();
})();
