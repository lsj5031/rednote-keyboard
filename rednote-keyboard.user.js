// ==UserScript==
// @name         RedNote Keyboard Friendly (小红书键盘增强)
// @namespace    https://github.com/lsj5031/rednote-keyboard
// @version      0.5.1
// @description  Automatic visible home-feed keys open notes in background tabs. Note-detail lightbox, image navigation, responsive text scrolling and keyboard actions.
// @author       lsj5031
// @homepageURL  https://github.com/lsj5031/rednote-keyboard
// @updateURL    https://raw.githubusercontent.com/lsj5031/rednote-keyboard/main/rednote-keyboard.user.js
// @downloadURL  https://raw.githubusercontent.com/lsj5031/rednote-keyboard/main/rednote-keyboard.user.js
// @match        https://www.rednote.com/*
// @match        https://www.xiaohongshu.com/*
// @match        https://rednote.com/*
// @match        https://xiaohongshu.com/*
// @run-at       document-idle
// @grant        GM_openInTab
// @grant        unsafeWindow
// @license      MIT
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Page gating — keep note actions separate from home navigation
   * (verified: the home feed has .like-wrapper cards but no .swiper,
   * so without this gate L would like the first feed card)
   * ------------------------------------------------------------------ */
  const NOTE_DETAIL_RE = /^\/(discovery\/item|explore|note)\/[^/]+\/?$/;
  const isNoteDetail = () => NOTE_DETAIL_RE.test(location.pathname);
  const isHome = () => /^\/(?:explore\/?)?$/.test(location.pathname);
  // Supported manager bridge: DOM expandos and state belong to the page world,
  // not the granted userscript's isolated window. Never inject page scripts.
  const pageWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  /* ------------------------------------------------------------------ *
   * DOM hooks (verified against the note-detail page DOM, Aug 2026)
   * ------------------------------------------------------------------ */
  const swiperEl = () => document.querySelector('.swiper.note-slider, .swiper');
  const swiper = () => {
    const el = pageWindow.document
      ? pageWindow.document.querySelector('.swiper.note-slider, .swiper')
      : swiperEl();
    return el && el.swiper ? el.swiper : null;
  };
  // Comments carry their own .like-wrapper under each .comment-item, and they
  // can appear EARLIER in the DOM than the note's engage bar — a bare
  // querySelector liked a comment instead of the note. Scope to the engage
  // bar's container first, then fall back to the first like button that isn't
  // inside a comment.
  const likeEl = () => {
    const scoped = document.querySelector('.interact-container .like-wrapper');
    if (scoped) return scoped;
    return (
      Array.from(document.querySelectorAll('.like-wrapper')).find(
        (el) => !el.closest('[id^="comment-"], .comment-item, .comment-inner-container')
      ) || null
    );
  };
  const collectEl = () => document.querySelector('.collect-wrapper');
  const chatEl = () => document.querySelector('.chat-wrapper');
  const commentBox = () => document.querySelector('#content-textarea');
  // offsetParent is null for position:fixed elements, so check client rects
  const visible = (el) => !!el && el.getClientRects().length > 0;
  // Narrow layouts expand the text panel and scroll an ancestor instead.
  // Resolve on each keypress so resizing works without reloading the note.
  const noteScrollTarget = () => {
    for (const panel of document.querySelectorAll('.note-container .note-scroller')) {
      if (!visible(panel)) continue;
      for (let el = panel; el; el = el.parentElement) {
        if (
          el.clientHeight > 0 &&
          el.scrollHeight > el.clientHeight &&
          (/^(auto|scroll|overlay)$/.test(getComputedStyle(el).overflowY) ||
            el === document.scrollingElement)
        ) return el;
      }
    }
    return null;
  };
  const btnText = (b) => (b.textContent || '').trim();
  const followBtn = () =>
    Array.from(document.querySelectorAll('button.follow-button')).find(visible);
  // The header renders two stacked copies of the search box at the same
  // coordinates; the DOM-first one is a transparent ghost (opacity 1e-05),
  // so querySelector-first focused an invisible input and `/` looked dead.
  const searchInput = () => {
    const inputs = document.querySelectorAll('input.search-input');
    for (const el of inputs) {
      const cs = getComputedStyle(el);
      if (
        cs.display !== 'none' &&
        cs.visibility !== 'hidden' &&
        parseFloat(cs.opacity) > 0.5
      )
        return el;
    }
    return inputs[0] || null;
  };
  const sendBtn = () =>
    Array.from(document.querySelectorAll('button')).find(
      (b) => (btnText(b) === 'Send' || btnText(b) === '发送') && visible(b)
    );

  const slideCount = () => {
    const sw = swiper();
    if (!sw || !sw.slides.length) return 0;
    // Legacy Swiper clones ~loopedSlides copies at each end in loop mode;
    // Swiper >=9 doesn't clone at all. Dedupe by slide index to cover both.
    const idx = sw.slides.map((s) => s.getAttribute('data-swiper-slide-index'));
    return idx.some((v) => v !== null) ? new Set(idx).size : sw.slides.length;
  };
  const currentSlideEl = () => {
    const sw = swiper();
    if (!sw) return null;
    // .swiper-slide-active is clone-correct in every Swiper version
    return (
      sw.el.querySelector('.swiper-slide-active') || sw.slides[sw.activeIndex] || null
    );
  };

  const isEditable = (t) => {
    const el = t && t.nodeType === 1 ? t : null;
    if (!el) return false;
    return (
      el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true'
    );
  };

  /* ------------------------------------------------------------------ *
   * Home feed: disposable viewport assignments, never permanent note keys.
   * Badges live in one fixed, pointer-transparent layer, outside the feed.
   * ------------------------------------------------------------------ */
  const FEED_KEYS = 'abcdefghilmnopqrstuvwxyz0123456789'; // reserve j/k
  let feedLayer = null;
  let feedEntries = [];
  let feedSnapshot = null;
  let feedTimer = null;
  let feedRoute = location.href;
  const feedObserved = new Set();
  const feedResize = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => invalidateFeed()) : null;

  function feedCards() {
    if (!isHome() || document.hidden) return [];
    const result = [];
    for (const card of document.querySelectorAll('section.note-item')) {
      const r = card.getBoundingClientRect();
      const left = Math.max(0, r.left), top = Math.max(0, r.top);
      const right = Math.min(window.innerWidth, r.right);
      const bottom = Math.min(window.innerHeight, r.bottom);
      if (right - left < 28 || bottom - top < 28) continue;
      const anchor = card.querySelector('a.cover[href], a.title[href]');
      if (!anchor || !card.isConnected) continue;
      let url;
      try {
        url = new URL(anchor.getAttribute('href'), location.href);
      } catch (_) { continue; }
      if (url.origin !== location.origin || !NOTE_DETAIL_RE.test(url.pathname)) continue;
      let hidden = false;
      for (let el = card; el; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' ||
            cs.visibility === 'collapse' || Number(cs.opacity) < 0.1) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      // Find a fully exposed 28px patch, including under a fixed header or
      // in a clipped card. Hit testing also rejects overlays and CSS clipping.
      let patch = null;
      for (const y of [top + 4, (top + bottom - 28) / 2, bottom - 32]) {
        for (const x of [left + 4, (left + right - 28) / 2, right - 32]) {
          if (x < left || y < top || x + 28 > right || y + 28 > bottom) continue;
          if ([[1, 1], [27, 1], [1, 27], [27, 27], [14, 14]].every(([dx, dy]) => {
            const hit = document.elementFromPoint(x + dx, y + dy);
            return hit && card.contains(hit);
          })) {
            patch = [x, y];
            break;
          }
        }
        if (patch) break;
      }
      if (patch) result.push({
        card, anchor, url: url.href, rect: [r.left, r.top, r.right, r.bottom],
        patch,
      });
    }
    return result.sort((a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0]);
  }

  function sameFeed(a, b) {
    return a && b && a.length === b.length && a.every((v, i) => {
      const w = b[i];
      return v.card === w.card && v.anchor === w.anchor && v.url === w.url &&
        v.rect.every((n, j) => n === w.rect[j]) &&
        v.patch.every((n, j) => n === w.patch[j]);
    });
  }

  function clearFeed() {
    feedSnapshot = null;
    feedEntries = [];
    if (feedLayer) feedLayer.replaceChildren();
  }

  function invalidateFeed() {
    clearFeed();
    clearTimeout(feedTimer);
    for (const card of feedObserved) {
      if (!isHome() || !card.isConnected) {
        feedResize?.unobserve(card);
        feedObserved.delete(card);
      }
    }
    if (!isHome() || document.hidden) return;
    feedTimer = setTimeout(() => {
      const before = feedCards();
      feedTimer = setTimeout(() => {
        const after = feedCards();
        if (!sameFeed(before, after)) {
          invalidateFeed();
          return;
        }
        if (!isHome() || document.hidden) return;
        if (!feedLayer) {
          feedLayer = document.createElement('div');
          feedLayer.id = 'rnk-feed-keys';
          feedLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
          document.body.appendChild(feedLayer);
        }
        feedSnapshot = after;
        feedEntries = after.slice(0, FEED_KEYS.length).map((entry, i) => {
          const badge = document.createElement('span');
          badge.textContent = FEED_KEYS[i];
          badge.style.cssText = `position:absolute;left:${entry.patch[0]}px;top:${entry.patch[1]}px;` +
            'box-sizing:border-box;width:28px;height:28px;text-align:center;line-height:26px;' +
            'background:#202020;color:white;border:1px solid white;border-radius:5px;' +
            'font:bold 16px/26px monospace;pointer-events:none;box-shadow:0 1px 4px #0008';
          feedLayer.appendChild(badge);
          return { ...entry, key: FEED_KEYS[i], badge };
        });
        after.forEach(({ card }) => {
          if (!feedObserved.has(card)) {
            feedObserved.add(card);
            feedResize?.observe(card);
          }
        });
        feedTimer = null;
      }, 80);
    }, 160);
  }

  function feedKeydown(e) {
    if (!isHome() || e.defaultPrevented || e.repeat || e.isComposing || e.keyCode === 229 ||
        e.ctrlKey || e.metaKey || e.altKey || e.shiftKey ||
        isEditable(e.target) || isEditable(document.activeElement) ||
        (e.composedPath && e.composedPath().some(isEditable))) return;
    if (feedRoute !== location.href || !sameFeed(feedSnapshot, feedCards())) {
      invalidateFeed();
      return;
    }
    const entry = feedEntries.find(({ key }) => key === e.key);
    if (!entry || typeof GM_openInTab !== 'function') return;
    // No click(), focus tricks, or fallback window.open: the manager owns
    // background-tab semantics and the full signed URL is passed unchanged.
    try {
      GM_openInTab(entry.url, { active: false });
    } catch (_) { return; }
    e.preventDefault();
    e.stopPropagation();
    entry.badge.style.background = '#237647';
    setTimeout(() => { entry.badge.style.background = '#202020'; }, 450);
  }

  function ownFeedMutation(record) {
    return feedLayer && (feedLayer.contains(record.target) ||
      (record.type === 'childList' &&
       [...record.addedNodes, ...record.removedNodes].length > 0 &&
       [...record.addedNodes, ...record.removedNodes].every((n) => n === feedLayer)));
  }
  new MutationObserver((records) => {
    if (records.every(ownFeedMutation)) return;
    // Busy counters, video UI, and unrelated text updates must not starve
    // hints. Mutation batches only invalidate an existing mapping if its
    // identity/geometry/exposure changed. Pending settlement is not restarted.
    if (feedSnapshot && sameFeed(feedSnapshot, feedCards())) return;
    if (!feedSnapshot && feedTimer !== null) return;
    invalidateFeed();
  }).observe(document.body, {
    childList: true, subtree: true, attributes: true, characterData: true,
  });
  window.addEventListener('scroll', invalidateFeed, true);
  window.addEventListener('resize', invalidateFeed);
  window.addEventListener('popstate', invalidateFeed);
  window.addEventListener('hashchange', invalidateFeed);
  document.addEventListener('visibilitychange', invalidateFeed);
  // pushState emits no event; also catch CSS-only layout/occlusion changes.
  // Keypress independently revalidates the entire mapping, even between polls.
  setInterval(() => {
    const changedRoute = feedRoute !== location.href;
    feedRoute = location.href;
    if (changedRoute || (feedSnapshot && !sameFeed(feedSnapshot, feedCards()))) invalidateFeed();
  }, 250);
  invalidateFeed();

  /* ------------------------------------------------------------------ *
   * Feedback helpers
   * ------------------------------------------------------------------ */
  let toastTimer = null;
  function toast(msg) {
    let el = document.getElementById('rnk-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rnk-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      el.style.cssText =
        'position:fixed;right:24px;bottom:24px;z-index:2147483647;background:rgba(20,20,20,.92);' +
        'color:#fff;padding:10px 16px;border-radius:8px;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.35);opacity:0;transition:opacity .18s;pointer-events:none';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.style.opacity = '0'), 1200);
  }

  function flash(el) {
    if (!el) return;
    const prev = el.style.transition;
    el.style.transition = 'transform .12s';
    el.style.transform = 'scale(1.25)';
    setTimeout(() => {
      el.style.transform = '';
      el.style.transition = prev;
    }, 120);
  }

  function click(el, msg) {
    if (!el) return false;
    el.click();
    flash(el);
    if (msg) toast(msg);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * Carousel
   * ------------------------------------------------------------------ */
  function moveSlide(dir) {
    const sw = swiper();
    if (!sw) return;
    if (dir > 0) sw.slideNext();
    else sw.slidePrev();
    toast(`${sw.realIndex + 1}/${slideCount()}`);
  }
  function gotoSlide(n) {
    const sw = swiper();
    if (!sw) return;
    sw.slideToLoop ? sw.slideToLoop(n - 1) : sw.slideTo(n - 1);
    toast(`${n}/${slideCount()}`);
  }

  /* ------------------------------------------------------------------ *
   * Enlarge modal (lightbox) — press E
   * ------------------------------------------------------------------ */
  let lb = null; // lightbox state
  let lbZoom = 1;
  let lbPan = { x: 0, y: 0 };
  let lbDragging = false;
  let lbDragMoved = false; // suppress the click a pan-drag ends with
  let lbDragStart = { x: 0, y: 0, px: 0, py: 0 };
  let lbPendingG = 0; // timestamp of a waiting "g" (for the gg chord)
  let lbSyncTimer = null; // retry timer while the slide's image URL isn't ready

  const MEDIA_CSS =
    'max-width:94vw;max-height:92vh;height:auto;object-fit:contain;transition:transform .15s ease;' +
    'user-select:none;-webkit-user-drag:none';

  // The slide's own src already serves full resolution (verified 1080px wide);
  // stripping the CDN transform suffix returns 403, so reuse it as-is.

  // Largest declared variant wins: currentSrc is the candidate the browser
  // picked for the SLIDE's small slot (srcset + sizes), not for a full-screen
  // lightbox at up to 94vw / 8x zoom — reusing it made images load soft.
  function bestSrcset(img) {
    let best = '';
    let bestW = 0;
    for (const attr of ['srcset', 'data-srcset']) {
      const ss = img.getAttribute(attr);
      if (!ss) continue;
      for (const cand of ss.split(',')) {
        const m = cand.trim().match(/(\S+)\s+(\d+)w/);
        if (m && +m[2] > bestW) {
          bestW = +m[2];
          best = m[1];
        }
      }
    }
    return best;
  }

  function mediaUrl(img) {
    if (!img) return '';
    // A slide's <img> can still be a lazy-load shell when the lightbox opens:
    // no src yet (the real URL sits in data-src) or a transparent data:
    // placeholder. Rendering either one shows an EMPTY lightbox until you
    // scrolled next and back — so skip unusable sources.
    return (
      [bestSrcset(img), img.currentSrc, img.getAttribute('data-src'), img.src].find(
        (u) => u && !u.startsWith('data:')
      ) || ''
    );
  }

  // The blur-up preview marker in a CDN variant name (…!nd_prv_… vs the full
  // …!nd_dft_… copy).
  const PREVIEW_URL_RE = /[!_-]prv[!_-]/;

  // Full-quality image i of the note on screen, straight from the page's own
  // note state. The slide's <img> is often still the blur-up PREVIEW when the
  // lightbox auto-opens — the site swaps in the sharp default a moment later —
  // and a snapshot of the preview is why the FIRST image looked soft until you
  // scrolled away and back. The state URL is http://, which an https page
  // blocks as mixed content, so normalize it. The map keeps every note visited
  // this session, hence the lookup must match the note in the URL.
  function stateImage(i) {
    try {
      const root = pageWindow.__INITIAL_STATE__;
      const map = root && root.note && root.note.noteDetailMap;
      const m = location.pathname.match(/\/(?:explore|discovery\/item|note)\/([^/?#]+)/);
      const id = m && m[1];
      const k =
        map && id && (map[id] ? id : Object.keys(map).find((x) => x.indexOf(id) !== -1));
      const holder = k && map[k];
      const note = holder && (holder.note || holder);
      const im = note && note.imageList && note.imageList[i];
      if (!im || !im.urlDefault) return null;
      return {
        url: im.urlDefault.replace(/^http:\/\//, 'https://'),
        width: +im.width || 0,
        height: +im.height || 0,
      };
    } catch (e) {
      return null;
    }
  }

  // Clone-correct index of a slide: data-swiper-slide-index wins (valid on
  // looped clones in every Swiper version), else the instance's real index.
  function activeImageIndex(slide) {
    const attr = slide && slide.getAttribute('data-swiper-slide-index');
    if (attr) return +attr;
    const sw = swiper();
    if (!sw) return 0;
    return sw.realIndex != null ? sw.realIndex : sw.activeIndex || 0;
  }

  function applyTransform() {
    if (!lb || !lb.media) return; // media can be absent while a slide resolves
    lb.media.style.transform = `translate(${lbPan.x}px, ${lbPan.y}px) scale(${lbZoom})`;
    lb.zoomLabel.textContent = `${Math.round(lbZoom * 100)}%`;
    lb.counter.textContent = `${swiper() ? swiper().realIndex + 1 : 1}/${slideCount()}`;
  }

  // Spinner: on whenever the lightbox has no ready media — while the slide's
  // URL resolves and while the <img>/<video> loads. Passing `media` ignores
  // stale load events from media that has already been replaced.
  // It FADES (150ms) instead of blinking: an image that loads from cache
  // within a couple of frames never gets visibly opaque.
  let lbSpinToken = 0;
  function lbSpinner(show, media) {
    if (!lb || !lb.spinner) return;
    if (media && lb.media !== media) return;
    const el = lb.spinner;
    if (show) {
      // Already fully up: skip the forced layout (the URL-wait re-checks
      // every 100ms for as long as it takes).
      if (el.style.display === 'block' && el.style.opacity === '1') return;
      lbSpinToken++; // cancels a pending fade-out's display:none
      el.style.display = 'block';
      void el.offsetHeight; // flush layout so opacity animates from 0
      el.style.opacity = '1';
      return;
    }
    el.style.opacity = '0';
    const token = ++lbSpinToken;
    setTimeout(() => {
      if (token === lbSpinToken && lb && lb.spinner === el && el.style.opacity === '0')
        el.style.display = 'none';
    }, 200);
  }

  function clampPan() {
    if (!lb || !lb.media || lbZoom <= 1) {
      lbPan = { x: 0, y: 0 };
      return;
    }
    const vw = lb.view.offsetWidth;
    const vh = lb.view.offsetHeight;
    const iw = lb.media.offsetWidth || vw;
    const ih = lb.media.offsetHeight || vh;
    const maxX = Math.max(0, (iw * lbZoom - vw) / 2);
    const maxY = Math.max(0, (ih * lbZoom - vh) / 2);
    lbPan.x = Math.max(-maxX, Math.min(maxX, lbPan.x));
    lbPan.y = Math.max(-maxY, Math.min(maxY, lbPan.y));
  }

  function lbZoomBy(delta) {
    lbZoom = Math.max(1, Math.min(8, Math.round((lbZoom + delta) * 10) / 10));
    if (lbZoom <= 1) lbPan = { x: 0, y: 0 };
    clampPan();
    applyTransform();
  }

  // Wheel = prev/next image; hold Ctrl/⌘ to zoom instead. One step per wheel
  // EVENT would machine-gun: a trackpad flick fires dozens of small deltas,
  // and on macOS one mouse-notch arrives as several small pixel events plus
  // zero-delta gesture events (fired when the pointer veers sideways mid-
  // scroll — they used to flip to the NEXT image, so scrolling up fought
  // against going to the previous one). Accumulate deltas and emit one step
  // per notched detent's worth (~100px; line-mode wheels count as a detent
  // per event), like Ctrl/⌘+wheel zoom already did.
  let lbWheelAcc = 0;
  function lbWheel(e) {
    e.preventDefault();
    lbWheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    while (Math.abs(lbWheelAcc) >= 100) {
      const dir = lbWheelAcc > 0 ? 1 : -1;
      if (e.ctrlKey || e.metaKey) lbZoomBy(-dir * 0.2); // scroll down = zoom out
      else {
        moveSlide(dir);
        syncLightbox();
      }
      lbWheelAcc -= dir * 100;
    }
  }

  function openLightbox() {
    if (!swiper()) return;
    if (lb) return closeLightbox();

    // Pause the page's own players so audio doesn't double up; resume on close.
    const pausedVideos = Array.from(document.querySelectorAll('.swiper video')).filter(
      (v) => !v.paused
    );
    pausedVideos.forEach((v) => v.pause());

    const ov = document.createElement('div');
    ov.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.93);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    ov.setAttribute('role', 'dialog');
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('aria-label', '图片放大视图');
    // Pan works from anywhere (image included) — when zoomed in, the image
    // covers the viewport, so requiring e.target === ov made panning impossible.
    ov.addEventListener('pointerdown', (e) => {
      if (lbZoom <= 1 || e.target.closest('button')) return;
      lbDragging = true;
      lbDragMoved = false;
      lbDragStart = { x: e.clientX, y: e.clientY, px: lbPan.x, py: lbPan.y };
      ov.style.cursor = 'grabbing';
    });
    ov.addEventListener('click', (e) => {
      if (e.target !== ov) return; // buttons/media handle their own clicks
      if (lbDragMoved) {
        lbDragMoved = false; // a pan-drag ending on the background isn't a close-click
        return;
      }
      closeLightbox();
    });
    ov.addEventListener('wheel', lbWheel, { passive: false });

    const view = document.createElement('div');
    view.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'position:fixed;top:16px;right:20px;z-index:2;width:40px;height:40px;border-radius:50%;border:1px solid #555;' +
      'background:rgba(30,30,30,.8);color:#fff;font-size:16px;cursor:pointer';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.addEventListener('click', () => closeLightbox());

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '‹';
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '›';
    for (const [b, dir] of [[prevBtn, -1], [nextBtn, 1]]) {
      b.setAttribute('aria-label', dir < 0 ? '上一张' : '下一张');
      b.style.cssText =
        'position:fixed;top:50%;transform:translateY(-50%);z-index:2;width:48px;height:72px;border:none;' +
        'background:rgba(30,30,30,.6);color:#fff;font-size:34px;cursor:pointer;border-radius:8px';
      b.style[dir < 0 ? 'left' : 'right'] = '12px';
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        moveSlide(dir);
        syncLightbox();
      });
    }

    const counter = document.createElement('div');
    counter.style.cssText =
      'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2;color:#fff;' +
      'background:rgba(0,0,0,.55);padding:5px 14px;border-radius:20px;font-size:13px';

    const zoomLabel = document.createElement('span');
    zoomLabel.style.cssText = 'display:inline-block;min-width:52px;text-align:center;color:#fff';
    const zoomIn = document.createElement('button');
    zoomIn.textContent = '+';
    const zoomOut = document.createElement('button');
    zoomOut.textContent = '−';
    const zoomReset = document.createElement('button');
    zoomReset.textContent = '⤾';
    const zoomBar = document.createElement('div');
    zoomBar.style.cssText =
      'position:fixed;bottom:18px;right:20px;z-index:2;display:flex;gap:8px;align-items:center;' +
      'background:rgba(30,30,30,.8);padding:6px 10px;border-radius:20px';
    const zoomBtnCss =
      'width:28px;height:28px;border-radius:50%;border:none;background:#444;color:#fff;font-size:15px;cursor:pointer';
    for (const [b, fn] of [
      [zoomOut, () => lbZoomBy(-0.5)],
      [zoomIn, () => lbZoomBy(0.5)],
      [zoomReset, () => { lbZoom = 1; lbPan = { x: 0, y: 0 }; applyTransform(); }],
    ]) {
      b.style.cssText = zoomBtnCss;
      b.setAttribute('aria-label', b === zoomIn ? '放大' : b === zoomOut ? '缩小' : '重置缩放');
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    }
    zoomBar.append(zoomOut, zoomLabel, zoomIn, zoomReset);

    const hint = document.createElement('div');
    hint.textContent = '← → / h l 切换 · 滚轮切换图片 · Ctrl+滚轮缩放 · j k 平移 · gg/G 首末图 · q/Esc 关闭';
    hint.style.cssText =
      'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:2;color:#999;font-size:12px';

    // One injected keyframes rule for the spinner (id-guarded like the toast).
    if (!document.getElementById('rnk-spin')) {
      const st = document.createElement('style');
      st.id = 'rnk-spin';
      st.textContent = '@keyframes rnk-spin{to{transform:rotate(360deg)}}';
      document.body.appendChild(st);
    }
    const spinner = document.createElement('div');
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.cssText =
      'display:none;opacity:0;transition:opacity .15s ease;position:absolute;left:50%;top:50%;' +
      'margin:-16px 0 0 -16px;box-sizing:border-box;' +
      'width:32px;height:32px;border:3px solid rgba(255,255,255,.2);border-top-color:rgba(255,255,255,.85);' +
      'border-radius:50%;animation:rnk-spin .8s linear infinite;z-index:1';

    ov.append(view, spinner, closeBtn, prevBtn, nextBtn, counter, zoomBar, hint);
    document.body.appendChild(ov);

    lb = { ov, view, media: null, counter, zoomLabel, pausedVideos, spinner };
    syncLightbox();
  }

  function syncLightbox() {
    if (!lb) return;
    const slide = currentSlideEl();
    const video = slide ? slide.querySelector('video') : null;
    const srcImg = slide ? slide.querySelector('img') : null;
    if (lb.media) {
      if (lb.media.tagName === 'VIDEO') lb.media.pause();
      lb.media.remove();
      lb.media = null;
    }

    // While the slide's copy is still the blur-up preview, show the full-
    // quality URL from the note state instead (verified live: the first
    // slide carries …!nd_prv_… at open and upgrades to …!nd_dft_… after).
    const slideUrl = mediaUrl(srcImg);
    const st = stateImage(activeImageIndex(slide));
    const resolved = st && st.url && slideUrl && PREVIEW_URL_RE.test(slideUrl) ? st.url : slideUrl;
    const usedState = resolved !== slideUrl;

    // The auto-open can beat the page's own rendering: swiper exists but the
    // active slide's <img> may not be in the DOM yet, or may only carry an
    // empty/data: placeholder. Rendering that empty <img> was the "blank
    // first image" bug — an EMPTY src resolves to the page URL, giving a
    // 0×0 broken image that never recovers until you scroll next and back.
    // Spin and re-check every 100ms for as long as the lightbox is open.
    if (!video && !resolved) {
      lbSpinner(true);
      clearTimeout(lbSyncTimer);
      lbSyncTimer = setTimeout(syncLightbox, 100);
      return;
    }
    clearTimeout(lbSyncTimer); // a pending re-check must not re-render later

    if (video) {
      const v = document.createElement('video');
      v.src = video.currentSrc || video.src || '';
      v.controls = true;
      v.playsInline = true;
      v.style.cssText = MEDIA_CSS.replace('object-fit:contain', '');
      v.addEventListener('loadeddata', () => lbSpinner(false, v));
      lb.view.appendChild(v);
      lb.media = v;
      lbSpinner(v.readyState < 2);
      // Opening via a keypress counts as user activation, so unmuted playback
      // is usually allowed; fall back to muted if the browser still blocks it.
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
    } else {
      const img = document.createElement('img');
      img.style.cssText = MEDIA_CSS;
      // Reserve the source's aspect-ratio box while the image loads so it
      // doesn't pop into place: width/height attributes give an unloaded <img>
      // its ratio (MEDIA_CSS keeps height:auto, so the max-* clamps preserve
      // it). Dropped again once loaded — intrinsic size always wins (the
      // slide's thumb dims could pin us wrong when the URL came from data-src).
      const w =
        (srcImg && (srcImg.naturalWidth || +srcImg.getAttribute('width'))) ||
        (st && st.width) || 0;
      const h =
        (srcImg && (srcImg.naturalHeight || +srcImg.getAttribute('height'))) ||
        (st && st.height) || 0;
      if (w && h) {
        img.width = w;
        img.height = h;
      }
      img.addEventListener('load', () => {
        img.removeAttribute('width');
        img.removeAttribute('height');
        lbSpinner(false, img);
      });
      let triedSlideCopy = false;
      img.addEventListener('error', () => {
        // Signed CDN URLs can go stale in a long-lived tab — hop to the
        // slide's own copy once before giving up.
        if (!triedSlideCopy && usedState) {
          const alt = mediaUrl(srcImg);
          if (alt && alt !== resolved) {
            triedSlideCopy = true;
            img.src = alt;
            return;
          }
        }
        lbSpinner(false, img);
      });
      img.src = resolved;
      lb.view.appendChild(img);
      lb.media = img;
      lbSpinner(!img.complete);
    }
    lbZoom = 1;
    lbPan = { x: 0, y: 0 };
    applyTransform();
  }

  function closeLightbox() {
    if (!lb) return;
    clearTimeout(lbSyncTimer);
    lb.ov.remove();
    (lb.pausedVideos || []).forEach((v) => v.play().catch(() => {}));
    lb = null;
  }

  let autoOpenedNotePath = null;
  let pendingNotePath = null;
  let autoOpenTimer = null;

  function syncDefaultLightbox() {
    const notePath = isNoteDetail() ? location.pathname : null;

    if (!notePath) {
      clearTimeout(autoOpenTimer);
      autoOpenTimer = null;
      pendingNotePath = null;
      autoOpenedNotePath = null;
      closeLightbox();
      return;
    }
    if (notePath === autoOpenedNotePath || notePath === pendingNotePath) return;

    clearTimeout(autoOpenTimer);
    closeLightbox();
    pendingNotePath = notePath;

    const tryOpen = () => {
      if (!isNoteDetail() || location.pathname !== pendingNotePath) {
        pendingNotePath = null;
        syncDefaultLightbox();
        return;
      }
      if (!swiper()) {
        autoOpenTimer = setTimeout(tryOpen, 100);
        return;
      }

      autoOpenedNotePath = pendingNotePath;
      pendingNotePath = null;
      autoOpenTimer = null;
      if (!lb) openLightbox();
    };

    // Let a client-side route change replace the previous note's carousel.
    autoOpenTimer = setTimeout(tryOpen, autoOpenedNotePath === null ? 0 : 250);
  }

  // drag-to-pan (window-level so it keeps tracking outside the overlay)
  window.addEventListener('pointermove', (e) => {
    if (!lbDragging || !lb) return;
    const dx = e.clientX - lbDragStart.x;
    const dy = e.clientY - lbDragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) lbDragMoved = true;
    lbPan.x = lbDragStart.px + dx;
    lbPan.y = lbDragStart.py + dy;
    clampPan();
    applyTransform();
  });
  window.addEventListener('pointerup', () => {
    lbDragging = false;
    if (lb) lb.ov.style.cursor = 'default';
  });

  /* ------------------------------------------------------------------ *
   * Help overlay
   * ------------------------------------------------------------------ */
  const SHORTCUTS = [
    ['Space / Shift + Space', '向下 / 向上平滑翻页（首页和正文）'],
    ['← / →  or  A / D', '上一张 / 下一张图片'],
    ['↓ / ↑  or  J / K', '向下 / 向上滚动正文和评论（可长按）'],
    ['E', '放大图片（模态全屏查看）'],
    ['L', '点赞 / 取消点赞'],
    ['S', '收藏'],
    ['C', '聚焦评论输入框'],
    ['Ctrl / ⌘ + Enter', '发送评论'],
    ['F', '关注 / 取消关注作者'],
    ['/', '聚焦搜索框'],
    ['Esc', '关闭弹窗 / 取消输入聚焦'],
    ['?', '显示 / 隐藏本帮助'],
  ];
  const LIGHTBOX_SHORTCUTS = [
    ['← / →  or  h / l', '切换图片'],
    ['j / k', '放大后上下平移'],
    ['gg / G', '跳到第一张 / 最后一张'],
    ['滚轮', '上一张 / 下一张'],
    ['Ctrl + 滚轮 / + / −', '缩放（最多 8 倍）'],
    ['0 或 ⤾', '重置缩放'],
    ['拖动', '平移（放大后）'],
    ['Esc / E / q / ✕', '关闭放大视图'],
  ];
  let helpVisible = false;
  function toggleHelp() {
    let box = document.getElementById('rnk-help');
    if (!box) {
      box = document.createElement('div');
      box.id = 'rnk-help';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-label', '键盘快捷键帮助');
      box.style.cssText =
        'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;' +
        'background:#1e1e1e;color:#eee;border:1px solid #444;border-radius:12px;padding:20px 24px;' +
        'font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;' +
        'box-shadow:0 12px 40px rgba(0,0,0,.5);min-width:340px;max-height:85vh;overflow:auto';
      const rows = (list) =>
        list
          .map(
            ([k, d]) =>
              `<tr><td style="padding:3px 16px 3px 0;white-space:nowrap"><kbd style="background:#333;border:1px solid #555;border-bottom-width:2px;border-radius:4px;padding:1px 6px;font:12px monospace">${k}</kbd></td><td style="padding:3px 0;color:#bbb">${d}</td></tr>`
          )
          .join('');
      box.innerHTML =
        '<div style="font-size:15px;font-weight:600;margin-bottom:12px">⌨️ 小红书键盘快捷键</div>' +
        '<div style="margin-bottom:12px">首页：可见卡片自动显示单键，按一次在后台新标签页打开；滚动后重新分配。</div>' +
        '<table style="border-collapse:collapse">' + rows(SHORTCUTS) + '</table>' +
        '<div style="font-size:13px;font-weight:600;margin:14px 0 6px;color:#ddd">🖼️ 放大视图内</div>' +
        '<table style="border-collapse:collapse">' + rows(LIGHTBOX_SHORTCUTS) + '</table>' +
        '<div style="margin-top:10px;color:#888;font-size:12px">Esc 或 ? 关闭 · 仅笔记详情页生效</div>';
      document.body.appendChild(box);
    }
    helpVisible = !helpVisible;
    box.style.display = helpVisible ? 'block' : 'none';
  }

  /* ------------------------------------------------------------------ *
   * Auto-dismiss nag modals (ad-blocker reminder etc.)
   * ------------------------------------------------------------------ */
  const GOT_IT_LABELS = ['Got it', '知道了', '我知道了'];
  function dismissAlerts() {
    if (!isNoteDetail()) return; // only touch the page on note detail
    const gotIt = Array.from(document.querySelectorAll('button')).find(
      (b) => GOT_IT_LABELS.includes(btnText(b)) && visible(b)
    );
    if (gotIt) gotIt.click();
  }
  // The observer fires on every mutation and scanning all buttons adds up on
  // a busy page — run at most twice a second.
  let lastDismiss = 0;
  function dismissAlertsThrottled() {
    const now = Date.now();
    if (now - lastDismiss < 500) return;
    lastDismiss = now;
    dismissAlerts();
  }
  function onPageMutation() {
    dismissAlertsThrottled();
    syncDefaultLightbox();
  }
  new MutationObserver(onPageMutation).observe(document.body, {
    childList: true,
    subtree: true,
  });
  setInterval(dismissAlerts, 5000);
  dismissAlerts();
  syncDefaultLightbox();

  /* ------------------------------------------------------------------ *
   * Keyboard handling
   * ------------------------------------------------------------------ */
  document.addEventListener(
    'keydown',
    (e) => {
      // Own Space even on focused action buttons, including repeats: otherwise
      // the browser may activate the button on keyup instead of paging.
      if (e.key === ' ' && (isHome() || isNoteDetail())) {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229 ||
            e.ctrlKey || e.metaKey || e.altKey) return;
        const path = e.composedPath ? e.composedPath() : [e.target];
        const controls = [...path, document.activeElement];
        if (controls.some((el) => isEditable(el) || el?.closest?.(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), ' +
          '[role="textbox"], video, audio, [role="slider"]'
        ))) return;

        // A note may itself be presented as a dialog. Only unrelated dialogs
        // block its text panel; never page the background behind an overlay.
        const panels = isNoteDetail()
          ? Array.from(document.querySelectorAll('.note-container .note-scroller')) : [];
        const dialogs = Array.from(document.querySelectorAll(
          'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"]'
        )).filter((el) => visible(el) && getComputedStyle(el).visibility !== 'hidden' &&
          !panels.some((panel) => el.contains(panel)));
        if (lb || helpVisible || dialogs.length) {
          // Keep native actions within unrelated dialogs, but not native
          // page scrolling when focus is left on the underlying page.
          if (!lb && !helpVisible && dialogs.some((dialog) =>
            controls.some((el) => el?.closest?.('button') &&
              dialog.contains(el)))) return;
          e.preventDefault();
          e.stopPropagation();
          return;
        }

        const target = isHome() ? document.scrollingElement : noteScrollTarget();
        e.preventDefault();
        e.stopPropagation();
        if (target && !e.repeat) {
          const height = target === document.scrollingElement
            ? window.innerHeight : target.clientHeight;
          target.scrollBy({
            top: (e.shiftKey ? -1 : 1) * height,
            behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? 'instant' : 'smooth',
          });
        }
        return;
      }
      if (isHome()) {
        feedKeydown(e);
        return;
      }
      if (!isNoteDetail()) return; // keybindings are note-detail-only

      // IME composition (pinyin etc.): never intercept while composing
      if (e.isComposing || e.keyCode === 229) return;

      // Holding a key must not machine-gun toggles (like/unlike, lightbox…).
      // Carousel and note scrolling keys repeat; h/l repeat only in the
      // lightbox (held L must never spam like/unlike on the note page).
      if (
        e.repeat &&
        !(
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          ['ArrowDown', 'ArrowUp', 'j', 'J', 'k', 'K'].includes(e.key) ||
          (lb && ['h', 'l'].includes(e.key))
        )
      )
        return;

      const handled = () => {
        e.preventDefault();
        e.stopPropagation(); // keep the page's own handlers from double-firing
      };

      // Lightbox takes priority when open
      if (lb) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        switch (e.key) {
          case 'Escape':
          case 'e':
          case 'E':
          case 'q':
            handled();
            lbPendingG = 0;
            closeLightbox();
            break;
          case 'ArrowLeft':
          case 'a':
          case 'A':
            handled();
            moveSlide(-1);
            syncLightbox();
            break;
          case 'ArrowRight':
          case 'd':
          case 'D':
            handled();
            moveSlide(1);
            syncLightbox();
            break;
          case 'h':
            handled();
            lbPendingG = 0;
            moveSlide(-1);
            syncLightbox();
            break;
          case 'l':
            handled();
            lbPendingG = 0;
            moveSlide(1);
            syncLightbox();
            break;
          case 'j':
          case 'k': {
            handled();
            lbPendingG = 0;
            if (lbZoom > 1) {
              const step = (lb.view.offsetHeight || 600) * 0.1;
              lbPan.y += e.key === 'j' ? step : -step;
              clampPan();
              applyTransform();
            }
            break;
          }
          case 'g': {
            handled();
            const now = performance.now();
            if (now - lbPendingG < 500) {
              lbPendingG = 0;
              gotoSlide(1); // gg → first image
              syncLightbox();
            } else {
              lbPendingG = now; // wait for the second g
            }
            break;
          }
          case 'G': {
            handled();
            lbPendingG = 0;
            const total = slideCount();
            if (total) gotoSlide(total);
            syncLightbox();
            break;
          }
          case '+':
          case '=':
            handled();
            lbZoomBy(0.5);
            break;
          case '-':
          case '_':
            handled();
            lbZoomBy(-0.5);
            break;
          case '0':
            handled();
            lbZoom = 1;
            lbPan = { x: 0, y: 0 };
            applyTransform();
            break;
        }
        return;
      }

      // Never hijack modifier combos (except Ctrl/Cmd+Enter to send)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key === 'Enter') {
          const box = commentBox();
          // only when the comment box itself has focus — not any editable
          if (box && document.activeElement === box) {
            handled();
            if (!click(sendBtn(), '已发送 💬')) toast('请先点击评论区');
          }
        }
        return;
      }

      const editing = isEditable(e.target);

      // Escape always works, even while typing
      if (e.key === 'Escape') {
        if (helpVisible) {
          handled();
          toggleHelp();
          return;
        }
        if (editing) {
          // blur the input (comment box, search…) without touching page buttons
          handled();
          e.target.blur();
          return;
        }
        const close = Array.from(document.querySelectorAll('button.close-icon')).find(
          visible
        );
        if (click(close)) {
          handled();
          return;
        }
        dismissAlerts();
        return;
      }

      if (editing) return; // typing in comment box / search: hands off

      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          handled();
          moveSlide(-1);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          handled();
          moveSlide(1);
          break;
        case 'ArrowDown':
        case 'ArrowUp':
        case 'j':
        case 'J':
        case 'k':
        case 'K': {
          if (helpVisible) break;
          const panel = noteScrollTarget();
          if (!panel) break;
          handled();
          const down = ['ArrowDown', 'j', 'J'].includes(e.key);
          panel.scrollBy({ top: down ? 120 : -120, behavior: 'instant' });
          break;
        }
        case 'e':
        case 'E':
          handled();
          openLightbox();
          break;
        case 'l':
        case 'L':
          handled();
          click(likeEl(), '❤️ 已点赞 / 取消');
          break;
        case 's':
        case 'S':
          handled();
          click(collectEl(), '⭐ 已收藏 / 取消');
          break;
        case 'c':
        case 'C': {
          handled();
          const box = commentBox();
          if (!box) {
            click(chatEl());
          } else {
            box.focus();
            box.scrollIntoView({ block: 'center', behavior: 'smooth' });
            toast('💬 输入评论…');
          }
          break;
        }
        case 'f':
        case 'F':
          handled();
          click(followBtn(), '👤 关注 / 取消');
          break;
        case '/':
          handled();
          if (searchInput()) {
            searchInput().focus();
            toast('🔍 搜索');
          }
          break;
        case '?':
          handled();
          toggleHelp();
          break;
      }
    },
    true // capture: intercept before the page's own handlers
  );
})();
