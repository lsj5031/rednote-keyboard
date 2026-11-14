// Behavioral viewport tests against the actual userscript. No dependencies.
// This simulates GM, not a real manager's background-tab behavior.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../rednote-keyboard.user.js', import.meta.url), 'utf8');
let passes = 0;
function test(name, run) {
  run();
  console.log(`PASS ${name}`);
  passes++;
}

function fixture(script = source) {
  const timers = new Map(), intervals = [], observers = [], events = {}, opened = [];
  let next = 1, cards = [], cover = null;
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.style = {};
      this.children = [];
      this.isConnected = true;
      this.attrs = {};
    }
    appendChild(el) { el.parentElement = this; this.children.push(el); return el; }
    replaceChildren() { this.children = []; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    contains(el) { return el === this || this.children.some((c) => c.contains(el)); }
    querySelector() { return this.anchor || null; }
    getBoundingClientRect() { return this.rect; }
    getClientRects() { return [this.rect]; }
    addEventListener() {}
    remove() {}
  }
  const body = new Element('body');
  const scrolls = [];
  const scrollingElement = { scrollBy: (options) => scrolls.push(options) };
  const location = { pathname: '/', origin: 'https://www.rednote.com', href: 'https://www.rednote.com/' };
  const document = {
    body, scrollingElement, activeElement: body, hidden: false,
    createElement: (tag) => new Element(tag),
    getElementById: (id) => body.children.find((e) => e.id === id),
    querySelector: () => null,
    querySelectorAll: (sel) => sel === 'section.note-item' ? cards : [],
    addEventListener: (type, fn) => { (events[type] ||= []).push(fn); },
    elementFromPoint(x, y) {
      if (x < 0 || y < 0 || x >= 1000 || y >= 800) return null;
      if (cover?.(x, y)) return body;
      return cards.find((c) => c.isConnected && !c.hidden &&
        x >= c.rect.left && x < c.rect.right && y >= c.rect.top && y < c.rect.bottom) || body;
    },
  };
  const context = {
    document, location, URL, console,
    window: { innerWidth: 1000, innerHeight: 800,
      matchMedia: () => ({ matches: false }),
      addEventListener: document.addEventListener },
    getComputedStyle: (el) => ({
      display: el.hidden ? 'none' : 'block', opacity: el.opacity ?? '1', visibility: 'visible',
    }),
    MutationObserver: class {
      constructor(fn) { this.fn = fn; observers.push(this); }
      observe(_, options) { this.options = options; }
    },
    ResizeObserver: class {
      constructor(fn) { this.fn = fn; }
      observe() {}
      unobserve() {}
    },
    setTimeout: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn) => { intervals.push(fn); },
    GM_openInTab: (url, options) => opened.push({ url, options }),
  };
  vm.runInNewContext(script, context);
  const f = {
    context, document, opened, events, observers, scrolls,
    add(id, x, y, w = 150, h = 200, href = `/discovery/item/${id}?xsec_token=signed%2Bvalue&source=feed`) {
      const c = new Element('section');
      c.rect = { left: x, top: y, right: x + w, bottom: y + h };
      c.anchor = c.appendChild(new Element('a'));
      c.anchor.attrs.href = href;
      body.appendChild(c);
      cards.push(c);
      return c;
    },
    settle(rounds = 2) {
      for (let i = 0; i < rounds; i++) {
        const jobs = [...timers.values()]; timers.clear(); jobs.forEach((fn) => fn());
      }
    },
    event(type) { for (const fn of events[type] || []) fn({}); },
    mutate(target = body) {
      for (const o of observers) o.fn([{ type: 'attributes', target, addedNodes: [], removedNodes: [] }]);
    },
    tick() { intervals.forEach((fn) => fn()); },
    route(path) { location.pathname = path; location.href = location.origin + path; },
    badges() { return document.getElementById('rnk-feed-keys')?.children || []; },
    refresh() { f.event('scroll'); f.settle(); },
    cover(fn) { cover = fn; },
    press(key, options = {}) {
      const e = { key, target: body, prevented: false, stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; }, ...options };
      for (const fn of events.keydown) fn(e);
      return e;
    },
    remove(c) { c.isConnected = false; cards = cards.filter((v) => v !== c); },
  };
  return f;
}

test('visual order, full signed URL and background API; no label movement after opening', () => {
  const f = fixture();
  f.add('right', 220, 10); f.add('left', 10, 10); f.add('below', 10, 250);
  f.refresh();
  assert.equal(f.badges().map((b) => b.textContent).join(''), 'abc');
  const before = [...f.badges()];
  const e = f.press('a');
  assert.equal(f.opened[0].url, 'https://www.rednote.com/discovery/item/left?xsec_token=signed%2Bvalue&source=feed');
  assert.equal(JSON.stringify(f.opened[0].options), '{"active":false}');
  assert.ok(e.prevented && e.stopped);
  assert.equal(f.badges()[0].style.background, '#237647');
  assert.deepEqual(f.badges(), before);
  // Our own badge mutation must not clear/reassign keys.
  f.mutate(f.badges()[0]);
  assert.equal(f.badges().length, 3);
});

test('Space pages the feed viewport from focused actions, reverse, holds and guards', () => {
  const f = fixture();
  const button = { nodeType: 1, tagName: 'BUTTON', getAttribute: () => null };
  f.document.activeElement = button;
  assert.ok(f.press(' ', { target: button }).prevented);
  for (let i = 0; i < 10; i++) assert.ok(f.press(' ', { target: button, repeat: true }).prevented);
  assert.equal(JSON.stringify(f.scrolls), '[{"top":800,"behavior":"smooth"}]');
  assert.ok(f.press(' ', { shiftKey: true }).prevented);
  assert.equal(f.scrolls.at(-1).top, -800);
  f.context.window.matchMedia = () => ({ matches: true });
  f.press(' ');
  assert.equal(f.scrolls.at(-1).behavior, 'instant');
  f.document.activeElement = f.document.body;
  const editor = { nodeType: 1, tagName: 'SPAN', isContentEditable: true };
  for (const opts of [
    { target: editor }, { composedPath: () => [editor] },
    { target: { nodeType: 1, tagName: 'INPUT' } },
    { ctrlKey: true }, { metaKey: true }, { altKey: true },
    { isComposing: true }, { keyCode: 229 }, { defaultPrevented: true },
  ]) assert.equal(f.press(' ', opts).prevented, false);
  f.route('/search_result');
  assert.equal(f.press(' ').prevented, false);
  assert.equal(f.scrolls.length, 3);
  assert.equal(f.opened.length, 0);
});

test('typing, shadow editing, all modifiers, IME, repeats and reserved keys pass through', () => {
  const f = fixture(); f.add('one', 10, 10); f.refresh();
  const input = { nodeType: 1, tagName: 'INPUT', getAttribute: () => null };
  const editable = { nodeType: 1, tagName: 'SPAN', isContentEditable: true, getAttribute: () => null };
  for (const opts of [
    { target: input }, { target: editable }, { composedPath: () => [editable] },
    { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
    { isComposing: true }, { keyCode: 229 }, { repeat: true }, { defaultPrevented: true },
  ]) assert.equal(f.press('a', opts).prevented, false);
  f.document.activeElement = input;
  assert.equal(f.press('a').prevented, false);
  f.document.activeElement = f.document.body;
  for (const key of ['j', 'k', '/', '?', 'ArrowDown', 'Enter', 'A', 'aa']) {
    assert.equal(f.press(key).prevented, false);
  }
  assert.equal(f.opened.length, 0);
});

test('stale geometry, href, anchor identity, removal, visibility and occlusion never open', () => {
  for (const change of [
    (f, c) => { c.rect.top += 1; },
    (f, c) => { c.anchor.attrs.href = '/note/recycled'; },
    (f, c) => { c.anchor = { ...c.anchor }; },
    (f, c) => f.remove(c),
    (f, c) => { c.hidden = true; },
    (f) => f.cover(() => true),
  ]) {
    const f = fixture(); const c = f.add('one', 10, 10); f.refresh();
    change(f, c);
    assert.equal(f.press('a').prevented, false);
    assert.equal(f.opened.length, 0);
    assert.equal(f.badges().length, 0);
  }
  // Even an unselected card moving invalidates the whole viewport assignment.
  const f = fixture(); f.add('one', 10, 10); const c = f.add('two', 220, 10); f.refresh();
  c.rect.left += 1;
  f.press('a');
  assert.equal(f.opened.length, 0);
});

test('scroll/resize/mutation clear immediately; unstable geometry waits for settlement', () => {
  const f = fixture(); const c = f.add('one', 10, 10); f.refresh();
  for (const type of ['scroll', 'resize']) {
    f.event(type); assert.equal(f.badges().length, 0);
    assert.equal(f.press('a').prevented, false);
    f.settle(); assert.equal(f.badges().length, 1);
  }
  c.anchor.attrs.href = '/note/new';
  f.mutate(c); assert.equal(f.badges().length, 0);
  f.settle(1);
  c.rect.top += 10; f.settle(1); assert.equal(f.badges().length, 0);
  f.settle(); assert.equal(f.badges().length, 1);
});

test('busy unrelated mutations neither starve pending hints nor shuffle settled labels', () => {
  const f = fixture(); f.add('one', 10, 10);
  for (let i = 0; i < 100; i++) f.mutate();
  f.settle();
  assert.equal(f.badges().length, 1);
  const badge = f.badges()[0];
  for (let i = 0; i < 100; i++) f.mutate();
  assert.equal(f.badges()[0], badge);
  f.settle();
  assert.equal(f.badges()[0], badge);
});

test('partial viewport cards need a whole exposed badge; headers and overlays hit-tested', () => {
  const f = fixture();
  f.add('offscreen', 10, -210);
  f.add('sliver', 220, -180); // only 20px visible
  f.add('partial', 430, -100); // enough visible below header
  const hidden = f.add('hidden', 10, 250); hidden.hidden = true;
  const transparent = f.add('transparent', 220, 250); transparent.opacity = '0';
  f.add('covered', 430, 250);
  f.cover((x, y) => y < 60 || (x >= 430 && y >= 250));
  f.refresh();
  assert.equal(f.badges().length, 1);
  assert.ok(parseFloat(f.badges()[0].style.cssText.match(/top:([\d.]+)/)[1]) >= 60);
  f.press('a'); assert.ok(f.opened[0].url.includes('/partial?'));
});

test('key exhaustion uses single characters only, excludes author and foreign links', () => {
  const f = fixture();
  for (let i = 0; i < 40; i++) f.add(String(i), (i % 8) * 100, Math.floor(i / 8) * 100, 80, 80);
  f.add('author', 810, 10, 80, 80, '/user/profile/id');
  f.add('foreign', 810, 110, 80, 80, 'https://other.test/note/id');
  f.refresh();
  const keys = f.badges().map((b) => b.textContent);
  assert.equal(keys.length, 34);
  assert.equal(new Set(keys).size, 34);
  assert.ok(keys.every((k) => /^[a-z0-9]$/.test(k) && !'jk'.includes(k)));
  f.press('9'); assert.ok(f.opened[0].url.includes('/33?'));
});

test('SPA, back, async rendering, hidden documents and non-home routes', () => {
  const f = fixture(); f.add('one', 10, 10); f.refresh();
  for (const path of ['/search_result', '/user/profile/x', '/explore/id', '/discovery/item/id', '/note/id']) {
    f.route(path);
    f.press('a');
    assert.equal(f.opened.length, 0);
    f.tick(); assert.equal(f.badges().length, 0);
  }
  f.route('/explore'); f.event('popstate'); f.settle();
  assert.equal(f.badges().length, 1);
  f.route('/'); f.tick(); f.settle();
  assert.equal(f.badges().length, 1);
  f.document.hidden = true; f.event('visibilitychange');
  assert.equal(f.badges().length, 0);
  f.document.hidden = false; f.event('visibilitychange'); f.settle();
  f.add('async', 220, 10); f.mutate(); f.settle();
  assert.equal(f.badges().length, 2);
});

test('missing/failing manager API does not consume keys or fall back to window.open', () => {
  const f = fixture(); f.add('one', 10, 10); f.refresh();
  f.context.GM_openInTab = undefined;
  assert.equal(f.press('a').prevented, false);
  f.context.GM_openInTab = () => { throw Error('denied'); };
  assert.equal(f.press('a').prevented, false);
});

// Sensitivity checks: the same behavioral assertions must reject broken guards.
test('regression assertions reject deliberately disabled stale/keyboard guards', () => {
  const noStale = source.replace(
    'feedRoute !== location.href || !sameFeed(feedSnapshot, feedCards())',
    'false'
  );
  const f = fixture(noStale); const c = f.add('one', 10, 10); f.refresh();
  c.rect.top += 1; f.press('a');
  assert.equal(f.opened.length, 1, 'mutated stale guard must expose the bug');
  for (const guard of ['e.repeat', 'e.isComposing', 'e.keyCode === 229', 'e.ctrlKey',
    'e.metaKey', 'e.altKey', 'e.shiftKey', 'isEditable(e.target)']) {
    const broken = source.replace(guard + ' ||', 'false ||');
    assert.notEqual(broken, source);
    const g = fixture(broken); g.add('one', 10, 10); g.refresh();
    const opts = guard === 'isEditable(e.target)'
      ? { target: { nodeType: 1, tagName: 'INPUT' } }
      : guard === 'e.keyCode === 229' ? { keyCode: 229 }
      : { [guard.slice(2)]: true };
    g.press('a', opts);
    assert.equal(g.opened.length, 1, `mutated ${guard} must expose the bug`);
  }
});

test('visibility, exhaustion, SPA and background-option assertions reject broken variants', () => {
  const occluded = fixture(source.replace('return hit && card.contains(hit);', 'return true;'));
  occluded.add('covered', 10, 10); occluded.cover(() => true); occluded.refresh();
  assert.throws(() => assert.equal(occluded.badges().length, 0));

  const tiny = fixture(source.replaceAll('28', '8').replaceAll('27', '7')
    .replaceAll('14, 14', '4, 4').replaceAll('32', '12'));
  tiny.add('sliver', 10, -180); tiny.refresh();
  assert.throws(() => assert.equal(tiny.badges().length, 0));

  const exhausted = fixture(source.replace('after.slice(0, FEED_KEYS.length)', 'after'));
  for (let i = 0; i < 40; i++) exhausted.add(String(i), (i % 8) * 100, Math.floor(i / 8) * 100, 80, 80);
  exhausted.refresh();
  assert.throws(() => assert.equal(exhausted.badges().length, 34));

  const spa = fixture(source.replace(
    "const isHome = () => /^\\/(?:explore\\/?)?$/.test(location.pathname);",
    'const isHome = () => true;'
  ));
  spa.add('one', 10, 10); spa.refresh(); spa.route('/search_result'); spa.tick(); spa.settle();
  assert.throws(() => assert.equal(spa.badges().length, 0));

  const active = fixture(source.replace('{ active: false }', '{ active: true }'));
  active.add('one', 10, 10); active.refresh(); active.press('a');
  assert.throws(() => assert.equal(active.opened[0].options.active, false));
});
console.log(`${passes} feed scenarios passed (GM simulated, not extension-tested).`);
