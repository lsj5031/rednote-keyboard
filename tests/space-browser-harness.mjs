// Optional real-Chromium fixture checks. No downloads or live site requests.
// Set PLAYWRIGHT_CORE_PATH and CHROMIUM_PATH to existing local installations.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

assert.ok(process.env.PLAYWRIGHT_CORE_PATH && process.env.CHROMIUM_PATH,
  'Set PLAYWRIGHT_CORE_PATH and CHROMIUM_PATH to existing local installations');
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_CORE_PATH).href);
const { chromium } = playwright.default || playwright;
const source = await readFile(process.argv[2] || new URL('../rednote-keyboard.user.js', import.meta.url), 'utf8');
const evidence = process.env.EVIDENCE_DIR || '/tmp/rednote-space-evidence';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true });
const context = await browser.newContext({ viewport: { width: 1000, height: 800 } });
await context.route('**/*', (route) => route.request().isNavigationRequest()
  ? route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }) : route.abort());
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
const measurements = [];
let shot = 0;
const screenshot = (name) => page.screenshot({
  path: path.join(evidence, `${String(++shot).padStart(2, '0')}-${name}.png`),
});
const position = () => page.evaluate(() => ({
  top: window.target.scrollTop, background: document.scrollingElement.scrollTop,
  clicks: window.clicks,
}));
async function fixture(kind, preventSpace = false) {
  await page.goto(`http://rednote.test/${kind === 'feed' ? '' : 'explore/fixture'}`);
  await page.setContent(`<!doctype html><style>
    * { box-sizing: border-box } body { margin: 0; height: 6500px; font: 22px sans-serif;
      background: repeating-linear-gradient(#e4eefa 0 199px,#aec8eb 200px 399px) }
    button,input { position: fixed; top: 12px; z-index: 2 } button { left: 20px } input { left: 250px }
    .note-container { position: fixed; top: 90px; right: 40px; width: 500px }
    .note-scroller { height: 450px; overflow-y: auto; background: white }
    .content { height: 5000px; background: repeating-linear-gradient(#fff 0 149px,#d6ead4 150px 299px) }
    @media(max-width:700px) {
      .note-container { width: 380px; height: 530px; overflow-y: auto }
      .note-scroller { height: auto; overflow: visible }
    }
    dialog { position:fixed; top:150px } video { position:fixed; bottom:10px; width:200px }
    </style>
    <button id="action" onclick="window.clicks++">Fixture action</button>
    <input aria-label="Editor">
    ${kind === 'feed' ? '<main>Feed fixture, numbered page bands</main>' :
      '<div class="note-container" role="dialog"><div class="note-scroller"><div class="content">Note text and comments fixture</div></div></div>'}`);
  await page.evaluate((kind) => {
    window.clicks = 0;
    window.target = kind === 'feed' ? document.scrollingElement : document.querySelector('.note-scroller');
  }, kind);
  if (preventSpace) await page.evaluate(() => document.addEventListener('keydown', (event) => {
    if (event.key === ' ') event.preventDefault();
  }, { capture: true }));
  await page.addScriptTag({ content: source });
}
async function paging(name, height) {
  const clicks = (await position()).clicks + 1;
  await page.locator('#action').click();
  assert.equal((await position()).clicks, clicks);
  await screenshot(`${name}-before`);
  await page.evaluate(() => {
    window.samples = [];
    window.sampling = true;
    const sample = (time) => {
      window.samples.push({ time, top: window.target.scrollTop });
      if (window.sampling) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.down('Space');
  await page.waitForTimeout(80);
  await screenshot(`${name}-during`);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.down('Space'); // Chromium emits repeat:true while held.
    await page.waitForTimeout(60);
  }
  const beforeRelease = await position();
  assert.equal(beforeRelease.top, height, `${name}: settles while Space remains held`);
  await page.keyboard.up('Space');
  await page.waitForTimeout(700);
  const final = await position();
  const samples = await page.evaluate(() => { window.sampling = false; return window.samples; });
  measurements.push({ name, height, final, actionClickDelta: final.clicks - clicks + 1, samples });
  assert.equal(final.top, height, `${name}: exactly one visible page`);
  assert.equal(final.clicks, clicks, `${name}: no second action activation on keyup`);
  assert.ok(samples.some(({ top }) => top > 0 && top < height), `${name}: intermediate smooth positions`);
  if (name === 'note-wide' || name === 'note-stacked')
    assert.equal(final.background, 0, `${name}: background does not move`);
  await screenshot(`${name}-after`);
  await page.keyboard.press('Shift+Space');
  await page.waitForFunction(() => window.target.scrollTop === 0);
  await screenshot(`${name}-reverse`);
  await page.locator('input').focus();
  await page.locator('input').fill('');
  await page.keyboard.type('a b');
  assert.equal(await page.locator('input').inputValue(), 'a b');
  assert.equal((await position()).top, 0, `${name}: input Space remains typing`);
}
try {
  await fixture('feed');
  await paging('feed', 800);
  await fixture('note');
  await paging('note-wide', 450);
  await page.setViewportSize({ width: 640, height: 800 });
  await page.evaluate(() => { window.target = document.querySelector('.note-container'); });
  await paging('note-stacked', 530);
  // Same loaded script, resized back to a document-owned note layout.
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.addStyleTag({ content: '.note-container{position:static;width:500px}.note-scroller{height:auto;overflow:visible}' });
  await page.evaluate(() => { window.target = document.scrollingElement; });
  await paging('note-document', 800);

  await fixture('note');
  await page.locator('#action').click();
  await page.keyboard.press('?');
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  assert.equal((await position()).top, 0);
  assert.equal((await position()).background, 0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<button onclick="window.dialogClicks=(window.dialogClicks||0)+1">Dialog action</button>';
    document.body.append(dialog);
    dialog.show(); // Nonmodal dialog leaves the background focusable.
  });
  await page.locator('#action').focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(500);
  assert.deepEqual(await position(), { top: 0, background: 0, clicks: 1 });
  await page.locator('dialog button').focus();
  await page.keyboard.press('Space');
  assert.equal(await page.evaluate(() => window.dialogClicks), 1);
  await page.evaluate(() => document.querySelector('dialog').remove());
  // Media controls, contenteditable descendants and already-cancelled events.
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend',
      '<video controls tabindex="0"></video><div contenteditable="true" style="position:fixed;top:60px"><span id="edit">text</span></div>');
  });
  await page.locator('video').focus();
  await page.keyboard.press('Space');
  await page.locator('#edit').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' x');
  assert.match(await page.locator('[contenteditable]').innerText(), / x/);
  assert.equal((await position()).top, 0);
  assert.equal((await position()).background, 0);

  await fixture('feed', true);
  await page.locator('#action').click();
  await page.keyboard.press('Space');
  assert.deepEqual(await position(), { top: 0, background: 0, clicks: 1 });

  await fixture('feed');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#action').click();
  await page.keyboard.press('Space');
  const reduced = await position();
  assert.equal(reduced.top, 800);
  assert.equal(reduced.clicks, 1);
  measurements.push({ name: 'reduced-motion', final: reduced });
  console.log('PASS Chromium fixtures: feed, wide/stacked/document note, hold, focused action, reverse, typing, overlays, media, reduced motion');
} finally {
  await writeFile(path.join(evidence, 'measurements.json'), JSON.stringify(measurements, null, 2));
  await context.tracing.stop({ path: path.join(evidence, 'trace.zip') });
  await browser.close();
}
