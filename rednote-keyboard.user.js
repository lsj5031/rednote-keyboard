// ==UserScript==
// @name         RedNote Keyboard Friendly (小红书键盘增强)
// @namespace    https://github.com/local/rednote-keyboard
// @version      0.3.0
// @description  Keyboard shortcuts for rednote.com / xiaohongshu.com NOTE DETAIL pages only: arrow keys for the image carousel, E to enlarge in a modal, L/S/C for like/collect/comment, / for search, ? for help. Auto-dismisses nag modals. Does nothing on the home feed / search / profile pages.
// @author       you
// @match        https://www.rednote.com/*
// @match        https://www.xiaohongshu.com/*
// @match        https://rednote.com/*
// @match        https://xiaohongshu.com/*
// @run-at       document-idle
// @grant        none
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
  const likeEl = () => document.querySelector('.like-wrapper');
  const collectEl = () => document.querySelector('.collect-wrapper');
  const chatEl = () => document.querySelector('.chat-wrapper');
  const commentBox = () => document.querySelector('#content-textarea');
  const followBtn = () =>
    Array.from(document.querySelectorAll('button.follow-button')).find(
      (b) => b.offsetParent !== null
    );
  const searchInput = () => document.querySelector('input.search-input');
  const sendBtn = () =>
    Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Send' && b.offsetParent !== null
    );

  const slideCount = () => {
    const sw = swiper();
    return sw ? sw.slides.length - (sw.loopedSlides || 0) * 2 : 0;
  };
  const currentSlideEl = () => {
    const sw = swiper();
    if (!sw) return null;
    return sw.slides[sw.realIndex] || document.querySelector('.swiper-slide-active');
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
  let lbDragStart = { x: 0, y: 0, px: 0, py: 0 };

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

  function openLightbox() {
    if (!swiper()) return;
    if (lb) return closeLightbox();

    const ov = document.createElement('div');
    ov.style.cssText =
      'position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.93);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
    ov.addEventListener('pointerdown', (e) => {
      if (e.target === ov && lbZoom > 1) {
        lbDragging = true;
        lbDragStart = { x: e.clientX, y: e.clientY, px: lbPan.x, py: lbPan.y };
        ov.style.cursor = 'grabbing';
      }
    });
    ov.addEventListener('click', (e) => {
      if (e.target === ov) closeLightbox();
    });
    ov.addEventListener('wheel', (e) => {
      e.preventDefault();
      lbZoomBy(e.deltaY < 0 ? 0.2 : -0.2);
    }, { passive: false });

    const view = document.createElement('div');
    view.style.cssText = 'width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden';

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText =
      'position:fixed;top:16px;right:20px;z-index:2;width:40px;height:40px;border-radius:50%;border:1px solid #555;' +
      'background:rgba(30,30,30,.8);color:#fff;font-size:16px;cursor:pointer';
    closeBtn.addEventListener('click', () => closeLightbox());

    const prevBtn = document.createElement('button');
    prevBtn.textContent = '‹';
    const nextBtn = document.createElement('button');
    nextBtn.textContent = '›';
    for (const [b, dir] of [[prevBtn, -1], [nextBtn, 1]]) {
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
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    }
    zoomBar.append(zoomOut, zoomLabel, zoomIn, zoomReset);

    const hint = document.createElement('div');
    hint.textContent = '← → 切换 · 滚轮/＋− 缩放 · 拖动平移 · Esc/E 关闭';
    hint.style.cssText =
      'position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:2;color:#999;font-size:12px';

    ov.append(view, closeBtn, prevBtn, nextBtn, counter, zoomBar, hint);
    document.body.appendChild(ov);

    lb = { ov, view, media: null, counter, zoomLabel };
    syncLightbox();
  }

  function syncLightbox() {
    if (!lb) return;
    const slide = currentSlideEl();
    const video = slide ? slide.querySelector('video') : null;
    if (lb.media) lb.media.remove();

    if (video) {
      const v = document.createElement('video');
      v.src = video.currentSrc || video.src || '';
      v.controls = true;
      v.autoplay = true;
      v.style.cssText = MEDIA_CSS.replace('object-fit:contain', '');
      lb.view.appendChild(v);
      lb.media = v;
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
    lb = null;
  }

  // drag-to-pan (window-level so it keeps tracking outside the overlay)
  window.addEventListener('pointermove', (e) => {
    if (!lbDragging || !lb) return;
    lbPan.x = lbDragStart.px + (e.clientX - lbDragStart.x);
    lbPan.y = lbDragStart.py + (e.clientY - lbDragStart.y);
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
    ['← / →  or  A / D', '切换图片'],
    ['滚轮 / + / −', '缩放（最多 8 倍）'],
    ['0 或 ⤾', '重置缩放'],
    ['拖动', '平移（放大后）'],
    ['Esc / E / ✕', '关闭放大视图'],
  ];
  let helpVisible = false;
  function toggleHelp() {
    let box = document.getElementById('rnk-help');
    if (!box) {
      box = document.createElement('div');
      box.id = 'rnk-help';
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
  function dismissAlerts() {
    if (!isNoteDetail()) return; // only touch the page on note detail
    const gotIt = Array.from(document.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === 'Got it' && b.offsetParent !== null
    );
    if (gotIt) gotIt.click();
  }
  new MutationObserver(() => dismissAlerts()).observe(document.body, {
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

      // Lightbox takes priority when open
      if (lb) {
        switch (e.key) {
          case 'Escape':
          case 'e':
          case 'E':
            e.preventDefault();
            closeLightbox();
            break;
          case 'ArrowLeft':
          case 'a':
          case 'A':
            e.preventDefault();
            moveSlide(-1);
            syncLightbox();
            break;
          case 'ArrowRight':
          case 'd':
          case 'D':
            e.preventDefault();
            moveSlide(1);
            syncLightbox();
            break;
          case '+':
          case '=':
            e.preventDefault();
            lbZoomBy(0.5);
            break;
          case '-':
          case '_':
            e.preventDefault();
            lbZoomBy(-0.5);
            break;
          case '0':
            e.preventDefault();
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
          if (box && (document.activeElement === box || isEditable(e.target))) {
            e.preventDefault();
            if (!click(sendBtn(), '已发送 💬')) toast('请先点击评论区');
          }
        }
        return;
      }

      const editing = isEditable(e.target);

      // Escape always works, even while typing
      if (e.key === 'Escape') {
        if (helpVisible) return toggleHelp();
        const box = commentBox();
        if (box && document.activeElement === box) {
          box.blur();
          return;
        }
        const close = Array.from(document.querySelectorAll('button.close-icon')).find(
          (b) => b.offsetParent !== null
        );
        if (click(close)) return;
        dismissAlerts();
        return;
      }

      if (editing) return; // typing in comment box / search: hands off

      switch (e.key) {
        case 'ArrowLeft':
        case 'a':
        case 'A':
          e.preventDefault();
          moveSlide(-1);
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          e.preventDefault();
          moveSlide(1);
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          openLightbox();
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          click(likeEl(), '❤️ 已点赞 / 取消');
          break;
        case 's':
        case 'S':
          e.preventDefault();
          click(collectEl(), '⭐ 已收藏 / 取消');
          break;
        case 'c':
        case 'C':
          e.preventDefault();
          if (!commentBox()) click(chatEl());
          else {
            commentBox().focus();
            commentBox().scrollIntoView({ block: 'center', behavior: 'smooth' });
            toast('💬 输入评论…');
          }
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          click(followBtn(), '👤 关注 / 取消');
          break;
        case '/':
          e.preventDefault();
          if (searchInput()) {
            searchInput().focus();
            toast('🔍 搜索');
          }
          break;
        case '?':
          e.preventDefault();
          toggleHelp();
          break;
        default:
          if (/^[1-9]$/.test(e.key)) {
            const total = slideCount();
            if (total >= +e.key) {
              e.preventDefault();
              gotoSlide(+e.key);
            }
          }
      }
    },
    true // capture: intercept before the page's own handlers
  );
})();
