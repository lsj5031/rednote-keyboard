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
const fakeSwiper = {
  slides: [
    { getAttribute: () => '0', querySelector: () => null },
    { getAttribute: () => '1', querySelector: () => null },
    { getAttribute: () => '2', querySelector: () => null },
  ],
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
globalThis.MutationObserver = class {
  observe() {}
};
globalThis.setInterval = () => 0;

// ---- load the real script ------------------------------------------------
const src = readFileSync(new URL('../rednote-keyboard.user.js', import.meta.url), 'utf8');
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

press('e');
check('E opens the lightbox', !!mediaEl());

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

const fails = results.filter(([s]) => s === 'FAIL');
for (const [s, name] of results) console.log(`${s}  ${name}`);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
