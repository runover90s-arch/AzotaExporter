(function () {
  'use strict';

  const nativeBridge = window.AzotaNative;
  if (!nativeBridge) return;

  if (window.AZX_APP && window.AZX_APP.version >= 5) {
    try { window.AZX_APP.scanVisible(); } catch (_) {}
    return;
  }

  const state = {
    q: {},
    scanning: false,
    timer: null,
    lastNotice: 0,
    sectionTotals: {},
    currentSection: { key: 'I', title: 'PHẦN I', index: 1 }
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const flat = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  const clean = s => String(s || '').replace(/\u00a0/g, ' ').replace(/\r/g, '').trim();

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
    try { return new URL(value, location.href).href; }
    catch (_) { return value; }
  }

  function markers() {
    return [...document.querySelectorAll(
      'div,span,p,h1,h2,h3,h4,h5,h6,strong,b'
    )].filter(el => {
      const t = flat(el.textContent);
      return visible(el) && qNumber(t) !== null && t.length <= 20;
    });
  }

  function sectionHeaders() {
    return [...document.querySelectorAll(
      'div,p,span,h1,h2,h3,h4,h5,h6,strong,b'
    )].filter(el => {
      if (!visible(el)) return false;
      const t = flat(el.textContent);
      if (!/^PHẦN\s+([IVXLC]+|\d+)\b/i.test(t)) return false;
      if (t.length > 900) return false;
      const qs = t.match(/Câu\s*\d+/gi) || [];
      return qs.length <= 1;
    });
  }

  function parseSection(header) {
    const text = flat(header ? header.textContent : '');
    const m = text.match(/^PHẦN\s+([IVXLC]+|\d+)\b/i);
    if (!m) return state.currentSection;

    const raw = m[1].toUpperCase();
    const index = /^\d+$/.test(raw) ? Number(raw) : romanToInt(raw);

    return { key: raw, index, title: text };
  }

  function questionType(title) {
    const t = flat(title).toLowerCase();
    if (/đúng\s*[-\/]?\s*sai|đúng\s+hoặc\s+sai/.test(t)) return 'true_false';
    if (/trả\s*lời\s*ngắn/.test(t)) return 'short_answer';
    if (/nhiều\s*phương\s*án|bốn\s*phương\s*án|lựa\s*chọn/.test(t)) return 'multiple_choice';
    return 'other';
  }

  function canonicalSectionTitle(section, type) {
    const prefix = 'PHẦN ' + section.key + '. ';
    if (type === 'multiple_choice') return prefix + 'TRẮC NGHIỆM NHIỀU PHƯƠNG ÁN LỰA CHỌN';
    if (type === 'true_false') return prefix + 'TRẮC NGHIỆM ĐÚNG – SAI';
    if (type === 'short_answer') return prefix + 'TRẢ LỜI NGẮN';
    return section.title || ('PHẦN ' + section.key);
  }

  function sectionInstruction(section, type) {
    let t = flat(section.title);
    t = t.replace(/^PHẦN\s+([IVXLC]+|\d+)\s*[.:]?\s*/i, '');

    const parts = t.split(/\.\s+/).map(x => x.trim()).filter(Boolean);
    if (!parts.length) return '';

    const first = parts[0].toLowerCase();
    const looksLikeType =
      /trắc nghiệm|phương án|đúng\s*sai|đúng\s+hoặc\s+sai|trả lời ngắn/.test(first);

    if (looksLikeType) parts.shift();

    return parts.join('. ').replace(/\.$/, '') + (parts.length ? '.' : '');
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
        state.sectionTotals[info.key] = Math.max(
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
    for (const m of ms) if (root.contains(m)) n++;
    return n;
  }

  function containsSectionHeader(root, hs) {
    for (const h of hs) if (root.contains(h)) return true;
    return false;
  }

  function lowestCommonAncestor(a, b) {
    if (!a || !b) return null;
    const seen = new Set();
    let x = a;
    while (x) { seen.add(x); x = x.parentElement; }
    x = b;
    while (x) {
      if (seen.has(x)) return x;
      x = x.parentElement;
    }
    return null;
  }

  function directChildUnder(ancestor, node) {
    if (!ancestor || !node) return null;
    let cur = node;
    while (cur.parentElement && cur.parentElement !== ancestor) {
      cur = cur.parentElement;
    }
    return cur;
  }

  function rootFor(marker, ms, hs) {
    const section = sectionFor(marker, hs);
    const same = ms.filter(m => sectionFor(m, hs).key === section.key);
    const idx = same.indexOf(marker);

    let neighbor = null;
    if (idx >= 0 && idx + 1 < same.length) neighbor = same[idx + 1];
    else if (idx > 0) neighbor = same[idx - 1];

    if (neighbor) {
      const lca = lowestCommonAncestor(marker, neighbor);
      const card = directChildUnder(lca, marker);

      if (card && card !== marker) {
        const txt = clean(card.innerText || card.textContent || '');
        if (txt.length >= 15 && txt.length < 70000) return card;
      }
    }

    let current = marker;
    let best = marker.parentElement || marker;

    while (current && current.parentElement && current.parentElement !== document.body) {
      const parent = current.parentElement;

      if (markerCount(parent, ms) > 1) break;
      if (containsSectionHeader(parent, hs) && !containsSectionHeader(best, hs)) break;

      const text = clean(parent.innerText || parent.textContent || '');
      if (text.length > 70000) break;

      best = parent;
      current = parent;
    }

    return best;
  }

  function elementDepth(el) {
    let d = 0;
    while (el && el.parentElement) { d++; el = el.parentElement; }
    return d;
  }

  function uniqueSmallestExact(root, regex) {
    const all = [...root.querySelectorAll('button,div,span,label,strong,b')].filter(el => {
      if (!visible(el)) return false;
      return regex.test(flat(el.textContent));
    });

    all.sort((a, b) => elementDepth(b) - elementDepth(a));

    const picked = [];
    for (const el of all) {
      if (picked.some(p => el.contains(p))) continue;
      picked.push(el);
    }
    return picked;
  }

  function countContained(root, els) {
    let n = 0;
    for (const el of els) if (root.contains(el)) n++;
    return n;
  }

  function singleLabelRow(labelEl, allLabels, questionRoot) {
    let cur = labelEl;
    let best = labelEl.parentElement || labelEl;

    while (cur && cur.parentElement && cur.parentElement !== questionRoot.parentElement) {
      const p = cur.parentElement;
      if (!questionRoot.contains(p) && p !== questionRoot) break;

      const c = countContained(p, allLabels);
      if (c > 1) break;

      const txt = clean(p.innerText || p.textContent || '');
      if (txt.length > 10000) break;

      best = p;
      cur = p;

      if (p === questionRoot) break;
    }

    return best;
  }

  function optionRows(root) {
    const exact = uniqueSmallestExact(root, /^[ABCD]$/);
    const out = [];
    const used = new Set();

    for (const labelEl of exact) {
      const label = flat(labelEl.textContent);
      if (used.has(label)) continue;

      const row = singleLabelRow(labelEl, exact, root);
      const text = clean(row.innerText || row.textContent || '');

      if (text.length <= 1) continue;

      out.push({ label, row });
      used.add(label);
    }

    out.sort((a, b) => 'ABCD'.indexOf(a.label) - 'ABCD'.indexOf(b.label));
    return out;
  }

  function trueFalseRows(root) {
    const trueEls = uniqueSmallestExact(root, /^Đúng$/i);
    const falseEls = uniqueSmallestExact(root, /^Sai$/i);
    const rows = [];
    const seen = new Set();

    for (const t of trueEls) {
      let best = null;

      for (const f of falseEls) {
        const lca = lowestCommonAncestor(t, f);
        if (!lca || !root.contains(lca)) continue;

        const text = clean(lca.innerText || lca.textContent || '');
        if (text.length < 3 || text.length > 12000) continue;

        if (!best || elementDepth(lca) > elementDepth(best)) best = lca;
      }

      if (!best) continue;

      let row = best;
      while (row.parentElement && row.parentElement !== root) {
        const p = row.parentElement;
        const tCount = countContained(p, trueEls);
        const fCount = countContained(p, falseEls);

        if (tCount > 1 || fCount > 1) break;

        const txt = clean(p.innerText || p.textContent || '');
        if (txt.length > 12000) break;

        row = p;
      }

      if (!seen.has(row)) {
        seen.add(row);
        rows.push(row);
      }
    }

    return rows;
  }

  function childIndexPath(root, node) {
    const path = [];
    let cur = node;

    while (cur && cur !== root) {
      const p = cur.parentElement;
      if (!p) return null;
      const idx = [...p.children].indexOf(cur);
      if (idx < 0) return null;
      path.unshift(idx);
      cur = p;
    }

    return cur === root ? path : null;
  }

  function byPath(root, path) {
    let cur = root;
    for (const idx of path || []) {
      if (!cur || !cur.children || idx >= cur.children.length) return null;
      cur = cur.children[idx];
    }
    return cur;
  }

  function removeQuestionMarker(clone, n) {
    const re = new RegExp('^(?:Câu|Cau)\\s*' + n + '\\s*[:.]?$', 'i');

    [...clone.querySelectorAll('div,span,p,h1,h2,h3,h4,h5,h6,strong,b')].forEach(el => {
      if (el.children.length === 0 && re.test(flat(el.textContent))) el.remove();
    });
  }

  function removeCueElements(clone) {
    const re = /^(Chọn\s+một\s+đáp\s+án\s+đúng|Chọn\s+đúng\s+hoặc\s+sai|Nhập\s+đáp\s+án)$/i;

    [...clone.querySelectorAll('div,span,p,strong,b,label')].forEach(el => {
      if (el.children.length === 0 && re.test(flat(el.textContent))) el.remove();
    });
  }

  function normalizeInteractive(clone) {
    clone.querySelectorAll('input,textarea,select').forEach(x => x.remove());

    clone.querySelectorAll('button').forEach(button => {
      const t = flat(button.textContent);

      if (/^[ABCD]$/.test(t)) {
        const span = document.createElement('span');
        span.className = 'azx-choice-letter';
        span.textContent = t;
        button.replaceWith(span);
        return;
      }

      if (/^(Đúng|Sai)$/i.test(t)) {
        const span = document.createElement('span');
        span.className = 'azx-tf-label';
        span.textContent = t;
        button.replaceWith(span);
        return;
      }

      const span = document.createElement('span');
      span.innerHTML = button.innerHTML;
      span.className = button.className || '';
      button.replaceWith(span);
    });
  }

  function normalizeMath(clone) {
    clone.querySelectorAll('annotation[encoding="application/x-tex"]').forEach(ann => {
      const tex = clean(ann.textContent);
      if (!tex) return;
      const math = ann.closest('math') || ann.parentElement;
      if (math) math.setAttribute('data-latex', tex);
    });
  }

  function normalizeImages(original, clone) {
    const oImgs = original.querySelectorAll('img');
    const cImgs = clone.querySelectorAll('img');

    cImgs.forEach((img, i) => {
      const o = oImgs[i];
      if (!o) return;

      const src =
        o.currentSrc ||
        o.getAttribute('src') ||
        o.getAttribute('data-src') ||
        '';

      if (src) img.src = absoluteUrl(src);
      img.removeAttribute('srcset');
      img.style.maxWidth = '100%';
      img.style.height = 'auto';
    });

    const oCanvases = original.querySelectorAll('canvas');
    const cCanvases = clone.querySelectorAll('canvas');

    cCanvases.forEach((canvas, i) => {
      try {
        const o = oCanvases[i];
        if (!o) return;

        const img = document.createElement('img');
        img.src = o.toDataURL('image/png');
        img.alt = 'Hình vẽ';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        canvas.replaceWith(img);
      } catch (_) {}
    });
  }

  function sanitize(original, clone) {
    normalizeInteractive(clone);
    normalizeMath(clone);
    normalizeImages(original, clone);

    clone.querySelectorAll('script,noscript,template,iframe').forEach(x => x.remove());

    clone.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(a => {
        const name = a.name.toLowerCase();
        if (
          name.startsWith('on') ||
          name === 'contenteditable' ||
          name === 'tabindex' ||
          name === 'checked' ||
          name === 'aria-checked' ||
          name === 'aria-selected'
        ) {
          el.removeAttribute(a.name);
        }
      });
    });

    removeCueElements(clone);
    return clone;
  }

  function stemHtml(root, removeNodes, n) {
    const clone = root.cloneNode(true);

    const paths = (removeNodes || [])
      .map(node => childIndexPath(root, node))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    for (const path of paths) {
      const target = byPath(clone, path);
      if (target) target.remove();
    }

    sanitize(root, clone);
    removeQuestionMarker(clone, n);

    return clone.innerHTML;
  }

  function fragmentHtml(node, removeButtons) {
    const clone = node.cloneNode(true);
    sanitize(node, clone);

    if (removeButtons) {
      clone.querySelectorAll('.azx-tf-label').forEach(x => x.remove());
    }

    return clone.innerHTML;
  }

  function structuredQuestion(root, type, n) {
    if (type === 'multiple_choice') {
      const rows = optionRows(root);

      if (rows.length >= 2) {
        const options = rows.map(x => ({
          label: x.label,
          html: fragmentHtml(x.row, false)
        }));

        return {
          stemHtml: stemHtml(root, rows.map(x => x.row), n),
          options,
          compactOptions:
            options.length === 4 &&
            options.every(x => flat(x.html.replace(/<[^>]+>/g, ' ')).length <= 110)
        };
      }
    }

    if (type === 'true_false') {
      const rows = trueFalseRows(root);

      if (rows.length >= 2) {
        const statements = rows.map((row, i) => {
          let text = clean(row.innerText || row.textContent || '')
            .replace(/\bĐúng\b/gi, '')
            .replace(/\bSai\b/gi, '')
            .trim();

          let label = String.fromCharCode(97 + i) + ')';
          const m = text.match(/^([a-d])\s*[).]/i);
          if (m) label = m[1].toLowerCase() + ')';

          return {
            label,
            html: fragmentHtml(row, true)
          };
        });

        return {
          stemHtml: stemHtml(root, rows, n),
          statements
        };
      }
    }

    if (type === 'short_answer') {
      return {
        stemHtml: stemHtml(root, [], n)
      };
    }

    return {
      stemHtml: stemHtml(root, [], n)
    };
  }

  function totals() {
    const observed = {};

    Object.values(state.q).forEach(q => {
      observed[q.sectionKey] = Math.max(observed[q.sectionKey] || 0, q.n);
    });

    const keys = new Set([
      ...Object.keys(observed),
      ...Object.keys(state.sectionTotals)
    ]);

    let total = 0;
    for (const key of keys) {
      total += Math.max(observed[key] || 0, state.sectionTotals[key] || 0);
    }

    return total;
  }

  function missingNumbers() {
    const out = [];
    const sections = {};

    Object.values(state.q).forEach(q => {
      if (!sections[q.sectionKey]) {
        sections[q.sectionKey] = { index: q.sectionIndex, max: 0 };
      }

      sections[q.sectionKey].max = Math.max(sections[q.sectionKey].max, q.n);
    });

    for (const [key, expected] of Object.entries(state.sectionTotals)) {
      if (!sections[key]) sections[key] = { index: romanToInt(key), max: 0 };
      sections[key].max = Math.max(sections[key].max, expected);
    }

    const ordered = Object.entries(sections)
      .sort((a, b) => a[1].index - b[1].index);

    for (const [key, info] of ordered) {
      const expected = Math.max(info.max, state.sectionTotals[key] || 0);

      for (let i = 1; i <= expected; i++) {
        if (!state.q[key + ':' + i]) out.push(key + '-' + i);
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
      const type = questionType(section.title);
      const key = section.key + ':' + n;

      const root = rootFor(marker, ms, hs);
      if (!root) continue;

      const text = clean(root.innerText || root.textContent || '');
      if (text.length < 15) continue;

      const structured = structuredQuestion(root, type, n);

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
        try { images.push(canvas.toDataURL('image/png')); }
        catch (_) {}
      });

      const latex = [];
      root.querySelectorAll('annotation[encoding="application/x-tex"]').forEach(ann => {
        const tex = clean(ann.textContent);
        if (tex) latex.push(tex);
      });

      const score =
        text.length +
        JSON.stringify(structured).length * 0.15 +
        images.length * 200;

      const old = state.q[key];

      if (!old || score > old.score) {
        state.q[key] = {
          key,
          n,
          label: 'Câu ' + n,
          sectionKey: section.key,
          sectionIndex: section.index,
          sectionTitle: canonicalSectionTitle(section, type),
          sectionInstruction: sectionInstruction(section, type),
          type,
          text,
          latex: [...new Set(latex)],
          images: [...new Set(images)],
          score,
          ...structured
        };

        changed = true;
      }

      state.sectionTotals[section.key] = Math.max(
        state.sectionTotals[section.key] || 0,
        n
      );
    }

    if (changed || Date.now() - state.lastNotice > 1200) {
      state.lastNotice = Date.now();
      notify(state.scanning ? 'Đang thu thập câu hỏi' : 'Theo dõi khi bạn cuộn');
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
    const candidates = [
      document.scrollingElement || document.documentElement
    ];

    for (const el of document.querySelectorAll('*')) {
      if (el.scrollHeight <= el.clientHeight + 260) continue;
      const cs = getComputedStyle(el);

      if (/auto|scroll|overlay/i.test(cs.overflowY)) candidates.push(el);
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
      for (let y = 0; y <= max + step; y += step) {
        points.push(Math.min(y, max));
      }
    } else {
      for (let y = max; y >= -step; y -= step) {
        points.push(Math.max(0, y));
      }
    }

    for (const y of points) {
      setTop(scroller, y);
      await sleep(520);
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

      for (let round = 0; round < 5; round++) {
        for (const s of scrollers) {
          await pass(s, false);
          await pass(s, true);
        }

        scanVisible();

        const count = Object.keys(state.q).length;
        notify('Lượt quét ' + (round + 1));

        if (count === lastCount) unchangedRounds++;
        else unchangedRounds = 0;

        lastCount = count;
        if (unchangedRounds >= 2) break;
      }

      originals.forEach(x => setTop(x.s, x.top));

      await sleep(250);
      scanVisible();

      const questions = Object.values(state.q)
        .sort((a, b) => {
          if (a.sectionIndex !== b.sectionIndex) {
            return a.sectionIndex - b.sectionIndex;
          }
          return a.n - b.n;
        });

      const styles = [
        ...document.querySelectorAll('link[rel="stylesheet"]')
      ]
        .map(link => absoluteUrl(link.href))
        .filter(Boolean);

      nativeBridge.onResult(JSON.stringify({
        title: document.title || 'Đề Azota',
        url: location.href,
        total: totals(),
        missing: missingNumbers(),
        styles,
        questions
      }));

    } catch (e) {
      try {
        nativeBridge.onError(String(e && e.message ? e.message : e));
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
      try { scanVisible(); } catch (_) {}
    }, 180);
  };

  new MutationObserver(scheduleScan)
    .observe(document.documentElement, { childList: true, subtree: true });

  addEventListener('scroll', scheduleScan, { passive: true, capture: true });

  state.timer = setInterval(scanVisible, 1400);

  window.AZX_APP = {
    version: 5,
    state,
    scanVisible,
    startScan
  };

  scanVisible();
})();
