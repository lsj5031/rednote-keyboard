// ==UserScript==
// @name         RedNote Keyboard Friendly (小红书键盘增强)
// @namespace    https://github.com/lsj5031/rednote-keyboard
// @version      0.4.4
// @description  Keyboard shortcuts for rednote.com / xiaohongshu.com NOTE DETAIL pages only: arrow keys for the image carousel, E to enlarge in a modal, L/S/C for like/collect/comment, / for search, ? for help. Auto-dismisses nag modals. Does nothing on the home feed / search / profile pages.
// @author       lsj5031
// @homepageURL  https://github.com/lsj5031/rednote-keyboard
// @match        https://www.rednote.com/*
// @match        https://www.xiaohongshu.com/*
// @match        https://rednote.com/*
// @match        https://xiaohongshu.com/*
// @run-at       document-idle
// @grant        none
// @license      MIT
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Page gating — shortcuts only apply on note detail pages
   * (verified: the home feed has .like-wrapper cards but no .swiper,
   * so without this gate L would like the first feed card)
   * ------------------------------------------------------------------ */
  const NOTE_DETAIL_RE = /\/(discovery\/item|explore|note)\//;
  const isNoteDetail = () => NOTE_DETAIL_RE.test(location.pathname);

  /* ------------------------------------------------------------------ *
   * DOM hooks (verified against the note-detail page DOM, Aug 2026)
   * ------------------------------------------------------------------ */
  const swiperEl = () => document.querySelector('.swiper.note-slider, .swiper');
  const swiper = () => {
    const el = swiperEl();
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

  const MEDIA_CSS =
    'max-width:94vw;max-height:92vh;object-fit:contain;transition:transform .15s ease;' +
    'user-select:none;-webkit-user-drag:none';

  function mediaUrl(img) {
    // The slide's own src already serves full resolution (verified 1080px wide);
    // stripping the CDN transform suffix returns 403, so reuse it as-is.
    if (!img) return '';
    return img.currentSrc || img.src || '';
  }

  function applyTransform() {
    if (!lb) return;
    lb.media.style.transform = `translate(${lbPan.x}px, ${lbPan.y}px) scale(${lbZoom})`;
    lb.zoomLabel.textContent = `${Math.round(lbZoom * 100)}%`;
    lb.counter.textContent = `${swiper() ? swiper().realIndex + 1 : 1}/${slideCount()}`;
  }

  function clampPan() {
    if (!lb || lbZoom <= 1) {
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

  // Wheel = prev/next image; hold Ctrl/⌘ to zoom instead. Zooming one 0.2
  // step per wheel EVENT would machine-gun on trackpads (a single flick
  // fires dozens of small deltas), so accumulate deltas and emit one step
  // per notched detent's worth (~100px; line-mode wheels count as a detent
  // per event).
  let lbWheelAcc = 0;
  function lbWheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      lbWheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      while (Math.abs(lbWheelAcc) >= 100) {
        lbZoomBy(lbWheelAcc > 0 ? -0.2 : 0.2); // scroll down = zoom out
        lbWheelAcc -= lbWheelAcc > 0 ? 100 : -100;
      }
    } else {
      moveSlide(e.deltaY < 0 ? -1 : 1);
      syncLightbox();
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

    ov.append(view, closeBtn, prevBtn, nextBtn, counter, zoomBar, hint);
    document.body.appendChild(ov);

    lb = { ov, view, media: null, counter, zoomLabel, pausedVideos };
    syncLightbox();
  }

  function syncLightbox() {
    if (!lb) return;
    const slide = currentSlideEl();
    const video = slide ? slide.querySelector('video') : null;
    if (lb.media) {
      if (lb.media.tagName === 'VIDEO') lb.media.pause();
      lb.media.remove();
    }

    if (video) {
      const v = document.createElement('video');
      v.src = video.currentSrc || video.src || '';
      v.controls = true;
      v.playsInline = true;
      v.style.cssText = MEDIA_CSS.replace('object-fit:contain', '');
      lb.view.appendChild(v);
      lb.media = v;
      // Opening via a keypress counts as user activation, so unmuted playback
      // is usually allowed; fall back to muted if the browser still blocks it.
      v.play().catch(() => {
        v.muted = true;
        v.play().catch(() => {});
      });
    } else {
      const img = document.createElement('img');
      img.style.cssText = MEDIA_CSS;
      img.src = mediaUrl(slide ? slide.querySelector('img') : null);
      lb.view.appendChild(img);
      lb.media = img;
    }
    lbZoom = 1;
    lbPan = { x: 0, y: 0 };
    applyTransform();
  }

  function closeLightbox() {
    if (!lb) return;
    lb.ov.remove();
    (lb.pausedVideos || []).forEach((v) => v.play().catch(() => {}));
    lb = null;
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
    ['← / →  or  A / D', '上一张 / 下一张图片'],
    ['E', '放大图片（模态全屏查看）'],
    ['1 – 9', '跳到第 N 张图片'],
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
    ['1 – 9', '跳到第 N 张图片'],
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
  new MutationObserver(dismissAlertsThrottled).observe(document.body, {
    childList: true,
    subtree: true,
  });
  setInterval(dismissAlerts, 5000);
  dismissAlerts();

  /* ------------------------------------------------------------------ *
   * Keyboard handling
   * ------------------------------------------------------------------ */
  document.addEventListener(
    'keydown',
    (e) => {
      if (!isNoteDetail()) return; // keybindings are note-detail-only

      // IME composition (pinyin etc.): never intercept while composing
      if (e.isComposing || e.keyCode === 229) return;

      // Holding a key must not machine-gun toggles (like/unlike, lightbox…).
      // Arrows stay repeatable for flipping through images; with the lightbox
      // open, hjkl are movement keys too — but ONLY there (held L must still
      // never spam like/unlike on the note page).
      if (
        e.repeat &&
        !(
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          (lb && ['h', 'l', 'j', 'k'].includes(e.key))
        )
      )
        return;

      const handled = () => {
        e.preventDefault();
        e.stopPropagation(); // keep the page's own handlers from double-firing
      };

      // Lightbox takes priority when open
      if (lb) {
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
          default:
            // digits jump to the Nth image (same as on the page behind)
            if (/^[1-9]$/.test(e.key)) {
              const total = slideCount();
              if (total >= +e.key) {
                handled();
                lbPendingG = 0;
                gotoSlide(+e.key);
                syncLightbox();
              }
            }
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
        default:
          if (/^[1-9]$/.test(e.key)) {
            const total = slideCount();
            if (total >= +e.key) {
              handled();
              gotoSlide(+e.key);
            }
          }
      }
    },
    true // capture: intercept before the page's own handlers
  );
})();
