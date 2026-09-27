// Regression harness: loads the real userscript against a minimal DOM stub
// and drives its keydown handler directly. Run: node tests/keymap-harness.mjs
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const results = [];
const check = (name, cond) => {
  results.push([cond ? 'PASS' : 'FAIL', name]);
};

// ---- DOM stubs ----------------------------------------------------------
const created = []; // every createElement result, in order
const byId = new Map();
const likeButton = {
  clicked: 0,
  style: {},
  getClientRects: () => [{}],
  click() {
    this.clicked++;
  },
};
const selectors = {
  '.interact-container .like-wrapper': likeButton,
};
let slideSrcset =
  'https://example.test/slide-480.jpg 480w, https://example.test/slide-1440.jpg 1440w, https://example.test/slide-750.jpg 750w';
const fakeSlideImg = {
  currentSrc: 'https://example.test/slide-750.jpg', // the browser's pick for the small slide
  src: 'https://example.test/slide-750.jpg',
  widthAttr: '800',
  heightAttr: '1000',
  getAttribute(name) {
    if (name === 'srcset') return slideSrcset;
    if (name === 'width') return this.widthAttr;
    if (name === 'height') return this.heightAttr;
    return null;
  },
  complete: true,
};
const fakeSwiper = {
  slides: ['0', '1', '2'].map((idx) => ({
    getAttribute: () => idx,
    querySelector: (sel) => (sel === 'img' ? fakeSlideImg : null),
  })),
  el: { querySelector: () => null },
  activeIndex: 0,
  realIndex: 0,
  slidePrevCalls: 0,
  slideNextCalls: 0,
  slideTos: [],
  slidePrev() {
    this.slidePrevCalls++;
    this.realIndex = Math.max(0, this.realIndex - 1);
  },
  slideNext() {
    this.slideNextCalls++;
    this.realIndex = Math.min(2, this.realIndex + 1);
  },
  slideToLoop(n) {
    this.slideTos.push(n);
    this.realIndex = n;
  },
  slideTo(n) {
    this.slideTos.push(n);
    this.realIndex = n;
  },
};
function makeEl(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    style: {},
    textContent: '',
    children: [],
    offsetWidth: tag === 'img' ? 800 : 1000,
    offsetHeight: 800,
    listeners: {},
    addEventListener(t, f) {
      (this.listeners[t] ||= []).push(f);
    },
    setAttribute() {},
    removeAttribute(k) {
      delete this[k];
    },
    append(...kids) {
      this.children.push(...kids);
    },
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    remove() {},
    querySelector: () => null,
    getClientRects: () => [{}],
    focus() {},
    blur() {},
  };
  if (tag === 'input') el.value = '';
  created.push(el);
  return el;
}

let keydownHandler = null;
globalThis.document = {
  body: makeEl('body'),
  activeElement: { tagName: 'BODY', blur() {} },
  addEventListener(type, fn) {
    if (type === 'keydown') keydownHandler = fn;
  },
  createElement: makeEl,
  getElementById: (id) => byId.get(id) || null,
  querySelector(sel) {
    if (sel === '.swiper.note-slider, .swiper')
      return Object.assign(makeEl('div'), { swiper: fakeSwiper });
    if (selectors[sel]) return selectors[sel];
    return null;
  },
  querySelectorAll(sel) {
    const one = this.querySelector(sel);
    return one ? [one] : [];
  },
};
// toast() registers its element under an id — keep the map populated
const origAppendChild = globalThis.document.body.appendChild;
globalThis.document.body.appendChild = function (c) {
  if (c.id) byId.set(c.id, c);
  return origAppendChild.call(this, c);
};
globalThis.window = { addEventListener() {} };
globalThis.location = { pathname: '/discovery/item/testid' };
let mutationHandler = null;
globalThis.MutationObserver = class {
  constructor(fn) {
    mutationHandler = fn;
  }
  observe() {}
};
globalThis.setInterval = () => 0;

// ---- load the real script ------------------------------------------------
const src = readFileSync(new URL('../rednote-keyboard.user.js', import.meta.url), 'utf8');
const rawScriptUrl =
  'https://raw.githubusercontent.com/lsj5031/rednote-keyboard/main/rednote-keyboard.user.js';
check('metadata has an explicit update URL', src.includes(`// @updateURL    ${rawScriptUrl}`));
check('metadata has an explicit download URL', src.includes(`// @downloadURL  ${rawScriptUrl}`));
vm.runInThisContext(src, { filename: 'rednote-keyboard.user.js' });

const press = (key, opts = {}) =>
  keydownHandler({
    key,
    repeat: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    isComposing: false,
    keyCode: 0,
    preventDefault() {},
    stopPropagation() {},
    ...opts,
  });
const zoomLabel = () =>
  [...created].reverse().find((el) => /^\d+%$/.test(el.textContent || ''));
const mediaEl = () =>
  [...created].reverse().find((el) => el.tagName === 'IMG' && el.style.transform);

// ---- scenario ------------------------------------------------------------
check('script installs a keydown handler', typeof keydownHandler === 'function');

await new Promise((r) => setTimeout(r, 10));
check('note opens in the lightbox by default', !!mediaEl());
check(
  'lightbox picks the largest srcset variant over the slide pick',
  mediaEl().src === 'https://example.test/slide-1440.jpg'
);
check(
  'lightbox reserves the source aspect box (width/height attrs)',
  mediaEl().width === 800 && mediaEl().height === 1000
);

const imgsBeforeManualReopen = created.filter((el) => el.tagName === 'IMG').length;
press('q');
press('e');
check(
  'E reopens a manually closed lightbox',
  created.filter((el) => el.tagName === 'IMG').length === imgsBeforeManualReopen + 1
);

const prevBefore = fakeSwiper.slidePrevCalls;
press('h');
check('h goes to previous image', fakeSwiper.slidePrevCalls === prevBefore + 1);

const nextBefore = fakeSwiper.slideNextCalls;
press('l');
check('l goes to next image', fakeSwiper.slideNextCalls === nextBefore + 1);
check('l inside lightbox does NOT click like', likeButton.clicked === 0);

press('g');
const tosAfterSingleG = fakeSwiper.slideTos.length;
check('single g waits (no jump yet)', fakeSwiper.slideTos.length === tosAfterSingleG);
press('g');
check('gg jumps to first image', fakeSwiper.slideTos.at(-1) === 0);

press('G');
check('G jumps to last image', fakeSwiper.slideTos.at(-1) === 2);

press('2');
check('digit jumps to Nth image inside lightbox', fakeSwiper.slideTos.at(-1) === 1);
press('9');
check('digit beyond slide count is ignored', fakeSwiper.slideTos.at(-1) === 1);

press('+');
press('+');
check('zoom reaches 200% via +', zoomLabel()?.textContent === '200%');

press('j');
check('j pans down while zoomed', /translate\(.*px,\s*80px/.test(mediaEl().style.transform));
press('k');
press('k');
check('k pans up past start point', /translate\(.*px,\s*-80px/.test(mediaEl().style.transform));

const imgsBeforeClose = created.filter((el) => el.tagName === 'IMG').length;
press('q');
check(
  'q closes the lightbox (next E reopens, not closes)',
  (() => {
    press('e');
    return (
      created.filter((el) => el.tagName === 'IMG').length === imgsBeforeClose + 1
    );
  })()
);

press('q'); // close again — the check above left the lightbox reopened

const likeBefore = likeButton.clicked;
press('l');
check('after close, l clicks like again', likeButton.clicked === likeBefore + 1);

const likeHeld = likeButton.clicked;
press('l', { repeat: true });
check('held l on note page does NOT machine-gun likes', likeButton.clicked === likeHeld);

const nextHeld = fakeSwiper.slideNextCalls;
press('ArrowRight', { repeat: true });
check('held arrow still repeats (carousel)', fakeSwiper.slideNextCalls === nextHeld + 1);

// gg timeout: stale g must not combine
press('e');
press('g');
await new Promise((r) => setTimeout(r, 550));
const tosBeforeStale = fakeSwiper.slideTos.length;
press('g');
check(
  'second g after 500ms starts a NEW chord (no accidental jump)',
  fakeSwiper.slideTos.length === tosBeforeStale
);

// ---- mouse wheel inside the lightbox -------------------------------------
// The overlay is the most recently created element carrying a 'wheel' listener.
const ov = [...created].reverse().find((el) => el.listeners && el.listeners.wheel);
const wheel = (opts) =>
  ov.listeners.wheel.forEach((f) => f({ preventDefault() {}, ...opts }));

const nextBeforeWheel = fakeSwiper.slideNextCalls;
wheel({ deltaY: 100 });
check('wheel down goes to next image', fakeSwiper.slideNextCalls === nextBeforeWheel + 1);

const prevBeforeWheel = fakeSwiper.slidePrevCalls;
wheel({ deltaY: -100 });
check('wheel up goes to previous image', fakeSwiper.slidePrevCalls === prevBeforeWheel + 1);

// macOS mouse noise: one notch arrives as several tiny pixel events, and
// zero-delta gesture events appear mid-scroll (e.g. when the pointer veers
// sideways). The old handler flipped to the NEXT image on deltaY === 0, so a
// smooth scroll-up could not land on the previous image. Deltas must
// accumulate to one ~100px detent before exactly one slide change fires.
const nextBeforeNoise = fakeSwiper.slideNextCalls;
const prevBeforeNoise = fakeSwiper.slidePrevCalls;
wheel({ deltaY: 0 });
wheel({ deltaY: -4 });
wheel({ deltaY: 0 });
wheel({ deltaY: -4 });
check('zero-delta wheel events never flip to the next image', fakeSwiper.slideNextCalls === nextBeforeNoise);
check('tiny up-scroll flurry does not skip images early', fakeSwiper.slidePrevCalls === prevBeforeNoise);
wheel({ deltaY: -92 }); // -100 total = one detent
check(
  'accumulated up-scroll detent moves exactly one image back',
  fakeSwiper.slidePrevCalls === prevBeforeNoise + 1 &&
    fakeSwiper.slideNextCalls === nextBeforeNoise
);

// Ctrl+wheel zooms instead of navigating: deltas accumulate until one notched
// detent (~100px) worth has scrolled, then a single 0.2 zoom step fires.
// Convention: scroll up (deltaY < 0) = zoom in, scroll down = zoom out.
wheel({ deltaY: -3, ctrlKey: true });
check('one small ctrl+wheel flurry event does not zoom yet', zoomLabel()?.textContent === '100%');
wheel({ deltaY: -99, ctrlKey: true });
check('ctrl+wheel accumulation zooms one step (120%)', zoomLabel()?.textContent === '120%');
wheel({ deltaY: 102, ctrlKey: true });
check('ctrl+wheel down zooms out one step (100%)', zoomLabel()?.textContent === '100%');
for (let i = 0; i < 40; i++) wheel({ deltaY: -3, ctrlKey: true }); // 120px total
check('40 tiny trackpad deltas yield exactly ONE zoom step (120%)', zoomLabel()?.textContent === '120%');
wheel({ deltaY: 3, deltaMode: 1, ctrlKey: true }); // line-mode wheel: 3 lines = 120px
check('line-mode ctrl+wheel notch converts to one step (100%)', zoomLabel()?.textContent === '100%');

// Spinner: it must cover both wait states — while the slide's URL resolves
// and while the rendered <img> loads — and hide as soon as the image is up.
const spinnerEl = () =>
  [...created].reverse().find((el) => /rnk-spin/.test(el.style.cssText || ''));
const fire = (el, type) => (el && el.listeners && el.listeners[type]
  ? el.listeners[type]
  : []
).forEach((f) => f());

check('spinner fades via an opacity transition', /transition:opacity/.test(spinnerEl().style.cssText));
fire(mediaEl(), 'load'); // the currently displayed image finishes loading
check('spinner fades out once the visible image has loaded', spinnerEl().style.opacity === '0');

// Auto-open can beat the page's lazy loader: the active slide's <img> may
// have no usable URL yet (no src, only data-src, or a data: placeholder).
// The lightbox must WAIT for a real source instead of rendering a blank <img>
// — the "initial image isn't visible until I scroll away and back" bug.
const resolvedSrc = fakeSlideImg.currentSrc;
const resolvedSrcset = slideSrcset;
fakeSlideImg.currentSrc = '';
fakeSlideImg.src = '';
slideSrcset = '';
const imgsBeforeLazy = created.filter((el) => el.tagName === 'IMG').length;
press('ArrowRight'); // resync while the slide image is unresolved
check(
  'unresolved slide image renders no blank <img>',
  created.filter((el) => el.tagName === 'IMG').length === imgsBeforeLazy
);
check(
  'spinner shows while the slide image resolves',
  spinnerEl().style.display === 'block' && spinnerEl().style.opacity === '1'
);
// The wait used to give up after ~2s and render the empty <img> anyway —
// an empty src resolves to the PAGE URL, i.e. a 0×0 broken image: exactly
// the blank-first-image bug, just on a slow connection. It must wait as
// long as it takes (the lightbox is the only thing that can re-trigger it).
await new Promise((r) => setTimeout(r, 2600)); // blows past the old 2s budget
check(
  'still no blank <img> after the old 2s retry budget runs out',
  created.filter((el) => el.tagName === 'IMG').length === imgsBeforeLazy
);
check(
  'spinner survives the long wait',
  spinnerEl().style.display === 'block' && spinnerEl().style.opacity === '1'
);
fakeSlideImg.currentSrc = resolvedSrc;
fakeSlideImg.src = resolvedSrc;
slideSrcset = resolvedSrcset;
fakeSlideImg.naturalWidth = 1080;
fakeSlideImg.naturalHeight = 1440;
await new Promise((r) => setTimeout(r, 150)); // retry fires at ~100ms
check(
  'lightbox renders the image once the slide resolves',
  created.filter((el) => el.tagName === 'IMG').length === imgsBeforeLazy + 1
);
check(
  'reserved box prefers the slide image natural size',
  mediaEl().width === 1080 && mediaEl().height === 1440
);
check(
  'new image keeps the spinner up while it loads',
  spinnerEl().style.display === 'block' && spinnerEl().style.opacity === '1'
);
fire(mediaEl(), 'load');
check('spinner fades out after the new image fires load', spinnerEl().style.opacity === '0');
check(
  'aspect hints are dropped once the intrinsic size is known',
  !mediaEl().width && !mediaEl().height
);

// At auto-open the first slide often still carries the blur-up PREVIEW
// (…!nd_prv_…) — the site swaps in the sharp …!nd_dft_… copy a moment later.
// The lightbox must take the note state's full-quality URL instead of
// snapshotting the preview (verified live on xiaohongshu.com).
const PRV_SRC = 'https://example.test/notes!nd_prv_wlteh.jpg';
const DFT_SRC = 'https://example.test/notes!nd_dft_wlteh.jpg';
fakeSlideImg.currentSrc = PRV_SRC;
fakeSlideImg.src = PRV_SRC;
slideSrcset = '';
globalThis.window.__INITIAL_STATE__ = {
  note: {
    noteDetailMap: {
      testid: {
        note: {
          imageList: [
            { urlDefault: 'http://example.test/notes!nd_dft_wlteh.jpg', width: 1080, height: 1440 },
          ],
        },
      },
    },
  },
};
// An unloaded slide thumb has no intrinsic size — the state dims reserve the box
fakeSlideImg.naturalWidth = 0;
fakeSlideImg.naturalHeight = 0;
fakeSlideImg.widthAttr = null;
fakeSlideImg.heightAttr = null;
press('ArrowRight');
check(
  'note-state full-quality URL wins over the slide blur-up preview',
  mediaEl().src === DFT_SRC
);
check(
  'state URL is upgraded to https (http is blocked as mixed content)',
  !/^http:/.test(mediaEl().src)
);
check(
  'aspect box falls back to note-state dims while the slide thumb is unloaded',
  mediaEl().width === 1080 && mediaEl().height === 1440
);
// A stale signed state URL must not strand the lightbox: hop to the slide's copy
fire(mediaEl(), 'error');
check('a rejected state URL falls back to the slide image', mediaEl().src === PRV_SRC);
delete globalThis.window.__INITIAL_STATE__;
fakeSlideImg.currentSrc = resolvedSrc;
fakeSlideImg.src = resolvedSrc;
slideSrcset = resolvedSrcset;
fakeSlideImg.naturalWidth = 1080;
fakeSlideImg.naturalHeight = 1440;
fakeSlideImg.widthAttr = '800';
fakeSlideImg.heightAttr = '1000';

// A manual close remains closed on the same note, but the next SPA note route
// gets its own default lightbox after the outgoing carousel has been replaced.
press('q');
const imgsBeforeMutation = created.filter((el) => el.tagName === 'IMG').length;
mutationHandler();
await new Promise((r) => setTimeout(r, 10));
check(
  'DOM changes do not reopen a manually closed lightbox',
  created.filter((el) => el.tagName === 'IMG').length === imgsBeforeMutation
);

location.pathname = '/explore/next-note';
mutationHandler();
await new Promise((r) => setTimeout(r, 300));
check(
  'the next note opens in the lightbox by default',
  created.filter((el) => el.tagName === 'IMG').length === imgsBeforeMutation + 1
);

const fails = results.filter(([s]) => s === 'FAIL');
for (const [s, name] of results) console.log(`${s}  ${name}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
