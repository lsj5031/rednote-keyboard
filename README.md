# RedNote Keyboard Friendly (小红书键盘增强)

Keyboard shortcuts for **rednote.com / xiaohongshu.com**. Visible home-feed cards automatically show single-key badges for opening notes in background tabs. On note detail pages, each note opens in a full-screen lightbox by default, with image navigation, responsive text scrolling, one-key like/collect/comment, `/` for search, and `?` for help. Auto-dismisses note-page nag modals.

Home keys only navigate, never like, comment, or follow. Note actions remain gated to detail URLs (`/explore/<id>`, `/discovery/item/<id>`, `/note/<id>`). Search and profile pages have no shortcuts or badges.

> *Unofficial userscript. Not affiliated with Xiaohongshu / RedNote.*

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open the raw script URL and confirm the install prompt:

   <https://raw.githubusercontent.com/lsj5031/rednote-keyboard/main/rednote-keyboard.user.js>

3. Open any note on xiaohongshu.com or rednote.com and press `?` to see the in-page help.

Version 0.5.0 requests `GM_openInTab` (background tabs) and `unsafeWindow` (read the page's Swiper instance and full-quality image state). Accept the userscript manager's permission/update prompt if shown. These are userscript-manager APIs, not site permissions. There is no `window.open` fallback if the tab API is unavailable.

## Shortcuts

### Home feed

On `/` (including rednote.com) and `/explore`, visible note cards automatically receive lowercase letter/digit badges in visual reading order. Press a displayed key **once** to immediately open its complete note URL, including signed query parameters, in a **new background tab**, keeping the feed in place. No activation mode, Enter, or key sequences. A brief green badge indicates an open without moving the other labels.

Keys belong to the viewport, not the notes. Scrolling, resizing, layout changes and recycled cards invalidate stale assignments; badges return after the layout settles. Cards need an exposed badge-sized area, so offscreen, hidden or covered cards are skipped. Badges do not affect layout or intercept mouse clicks. `j`/`k`, arrows, `/`, `?` and other navigation keys remain untouched. There are 34 available single-character keys; later cards remain unlabelled when these run out.

Typing, IME composition, modifier combinations (including Shift) and held/repeated keys are never used to open feed tabs.

### Note detail

The following shortcuts only apply on note detail pages; typing in an input is always left alone.

| Key | Action |
|---|---|
| `←` / `→` or `A` / `D` | Previous / next image |
| `↓` / `↑` or `J` / `K` | Scroll the note text and comments down / up in wide or stacked layouts (hold to repeat) |
| `E` | Toggle the full-screen lightbox |
| `L` | Like / unlike |
| `S` | Collect (favorite) / un-collect |
| `C` | Focus the comment box |
| `Ctrl` / `⌘` + `Enter` | Send comment |
| `F` | Follow / unfollow the author |
| `/` | Focus search |
| `Esc` | Close overlay / blur focused input |
| `?` | Toggle the help overlay |

### Inside the lightbox (`E`)

| Key / input | Action |
|---|---|
| `←` / `→`, `a` / `d`, or `h` / `l` | Switch images (hold to repeat) |
| Mouse wheel | Previous / next image |
| `j` / `k` | Pan down / up while zoomed |
| `gg` / `Shift+G` | First image / last image |
| `Ctrl`/`⌘` + wheel or `+` / `−` | Zoom (up to 8×) |
| `0` or ⤾ button | Reset zoom |
| Drag | Pan while zoomed (works from anywhere, including the image itself) |
| `Esc` / `E` / `q` / ✕ / click background | Close |

Held-down keys don't repeat except carousel arrows, note scrolling keys, and `h j k l` while the lightbox is open. IME composition is never intercepted, and modifier combos pass through to the browser.

Inside the lightbox, the mouse wheel flips to the previous/next image (scroll up = previous, scroll down = next) — hold `Ctrl` / `⌘` while scrolling to zoom instead.

## Validation

Run the dependency-free checks from the repository root:

```sh
node --check rednote-keyboard.user.js
node tests/keymap-harness.mjs
node tests/feed-harness.mjs
git diff --check
```

The existing note harness covers responsive scrolling and lightbox/image regressions. It now models a sandbox DOM without `.swiper`, exposing the instance only through `unsafeWindow.document`. The feed harness exercises the real handler with a simulated DOM and `GM_openInTab`, including stale assignments, visibility, typing guards, exhaustion, SPA transitions and busy mutations.

For a real-DOM smoke fixture, run `python3 -m http.server 8765 --bind 127.0.0.1` and open `http://127.0.0.1:8765/tests/feed-fixture.html`. The fixture reports its checks on screen. **It simulates GM and does not prove real extension background tabs or sandbox access.** Live managed-Chromium checks verified visible badges, correct URL and background-option dispatch through a simulated GM API, keyboard guards, immediate scroll invalidation and settled reassignment. Before/after scrolling screenshots were inspected. Actual Tampermonkey/Violentmonkey background-tab opening and sandbox access were not exercised; the real-DOM fixture also remains unverified in this environment. The note harness covers the page-world bridge, but real-manager Swiper navigation, auto-lightbox and full-quality image state remain verification limits for this release.

### Earlier live note-page verification

Before the 0.5.0 grant change, the DOM hooks and behavior were audited and exercised on a real xiaohongshu.com note page (Swiper loop mode, Chinese UI):

- All selectors present: `.swiper`, `.like-wrapper`, `.collect-wrapper`, `.chat-wrapper`, `#content-textarea`, `input.search-input`, `.follow-button`
- Slide count correct in loop mode (9 real slides detected from 11 raw Swiper slides)
- Repeat/IME guards: held `L` fires 0 clicks; single `L` fires exactly 1
- Lightbox: opens, zooms to 200%, pans by dragging **on the image**, survives the end-of-drag click, closes with `Esc`
- `⌘Enter` sends only from the comment box — never from the search box
- Bilingual button matching: `Send`/`发送`, `Got it`/`知道了`/`我知道了`

## Changelog

### 0.5.0

- Added: automatic visible home-feed single-letter/digit badges. One press opens the correct signed note link in a new background tab through `GM_openInTab(url, {active:false})`.
- Added: viewport reassignment after settling, keypress identity/URL/geometry/exposure checks, repeat/typing/IME/modifier protection, and a brief opened indicator. No author links or site write actions on the feed.
- Changed: manager grants now include `GM_openInTab` and `unsafeWindow`; note Swiper and image state are read through the supported page-world bridge. Existing note-detail shortcuts and responsive scrolling remain unchanged.
- Added: dependency-free behavioral feed tests and a runnable real-DOM smoke fixture. Actual userscript-manager background-tab and sandbox behavior require live release verification.

### 0.4.14

- Fixed: `↓` / `↑` and `J` / `K` now scroll the note body and comments in narrow, stacked layouts as well as wide layouts. The scrollable container is resolved on each keypress, so resizing works without reloading.

### 0.4.13

- Removed: number-key shortcuts for jumping to images on the note page and in the lightbox.
- Fixed: Ctrl/⌘/Alt keyboard combinations now pass through while the lightbox is open, preserving browser shortcuts such as Ctrl/⌘+1–9.

### 0.4.12

- Added: `↓` / `↑` or `J` / `K` scroll the right-hand note text and comments by 120 pixels per keypress, with hold-to-repeat support. Close the default lightbox with `Esc`, `E`, or `q` to read and scroll the note. The image carousel and page stay in place. Typing, modifier combos, and the help overlay are left alone; `j` / `k` still pan while the lightbox is open.

### 0.4.11

- Fixed: the auto-opened lightbox can no longer end up on an **invisible first image** — this was reproducible on the live site with the previously published version: when Swiper existed but the active slide's `<img>` wasn't rendered yet, the lightbox rendered an *empty* `<img>`, whose empty `src` resolves to the **page URL** — a 0×0 broken image that never recovers until you scroll next and back. The lightbox now waits (with the spinner) for a real URL for as long as it takes; the old wait also gave up after ~2 s and rendered the empty `<img>` anyway, which is the same bug on a slow connection.
- Fixed: the first image now uses the note's **full-quality `urlDefault`** (from the page's own `__INITIAL_STATE__`, `http://` upgraded to `https://`) while the slide still carries its blur-up **preview** (`…!nd_prv_…`). The site renders the preview into the first slide first and swaps in the sharp `…!nd_dft_…` copy a moment later, so the lightbox used to snapshot the blurry one. If the CDN rejects a stale state URL, it falls back to the slide's own copy once.
- Improved: when the slide thumb has no intrinsic size yet, the reserved aspect box falls back to the note state's declared width/height, and the spinner no longer forces layout on every 100 ms re-check while waiting.

### 0.4.10

- Fixed: the lightbox now loads the **largest `srcset` / `data-srcset` variant** the slide declares instead of `currentSrc` — `currentSrc` is the candidate the browser picked for the small carousel slot (via `srcset` + `sizes`), not for a full-screen view at up to 8× zoom, which made images (notably the first, auto-opened one) look soft.
- Added: the lightbox reserves the image's **aspect-ratio box** while it loads (from the source slide's `naturalWidth`/`naturalHeight` or its `width`/`height` attributes; `MEDIA_CSS` keeps `height:auto` so the max-width/max-height clamps preserve the ratio). The hints are dropped on load so intrinsic sizing always wins — the image no longer pops into place.
- Changed: the spinner now **fades in/out** (150 ms opacity transition, removed from layout 200 ms after hiding) instead of blinking — images that load from cache within a couple of frames never become visibly opaque.

### 0.4.9

- Added: a small centered spinner shows in the lightbox whenever there's no image on screen yet — while waiting for the slide's image URL (auto-open vs. the page's lazy loader) and while the `<img>` / `<video>` loads — instead of a black void. It hides as soon as the media fires `load` (or `loadeddata` for video), and never spins for media that has already been replaced.

### 0.4.8

- Fixed: the auto-opened lightbox no longer shows a blank first image. `syncLightbox` used to render the active slide the moment Swiper existed — but the slide's `<img>` often had no usable URL yet (lazy loader hadn't run: no `src`, real URL only in `data-src`, or a transparent `data:` placeholder), so an empty `<img>` was rendered until you scrolled next and back. Sources are now resolved (`currentSrc` → `data-src` → `src`, unusable ones skipped) and, when none resolves yet, the lightbox re-checks every 100 ms (up to ~2 s) instead of rendering blank.

### 0.4.7

- Fixed: wheel navigation in the lightbox is now smooth with an external mouse on macOS. A single notch there arrives as several small pixel `wheel` events (plus zero-delta gesture events when the pointer veers sideways mid-scroll), and the old handler flipped one image **per event** — a zero-delta event even flipped to the *next* image, so scrolling up fought against going to the previous image. Wheel deltas now accumulate to one notched detent (~100px) before exactly one image change, matching how `Ctrl`/`⌘`+wheel zoom already worked.

### 0.4.6

- Fixed: added explicit Tampermonkey/Violentmonkey update and download URLs so future versions update reliably regardless of redirects from the installation link.

### 0.4.5

- Changed: each note now opens in the full-screen lightbox by default. Closing it keeps it closed for that note; navigating to another note opens the lightbox again.

### 0.4.4

- Changed: inside the lightbox, the mouse wheel now navigates to the previous/next image instead of zooming — the same action as the on-page carousel. Hold `Ctrl` / `⌘` while scrolling to zoom; zoom deltas accumulate so a notched wheel detent (or a whole trackpad flick) steps 20% once, instead of 20% per event.

### 0.4.3

- Added: vim-style keys inside the lightbox — `h`/`l` switch images (hold-to-repeat), `j`/`k` pan down/up while zoomed, `gg` jumps to the first image, `Shift+G` to the last, and `q` closes. Digits `1`–`9` now jump to the Nth image inside the lightbox too (previously unused there).
- Note: while the lightbox is open, `l` means "next image", not like — matching how `a`/`d` already behave in there. Held `hjkl` repeat like the arrows, but only with the lightbox open; held `L` on the note page still never machine-guns likes.
- Added: `tests/keymap-harness.mjs`, a Node harness that loads the real userscript against a DOM stub and drives its actual keydown handler through every chord and regression guard (18 checks).

### 0.4.2

- Fixed: `/` now focuses the search box you can actually see. The header renders two stacked copies of `input.search-input` at identical coordinates and the DOM-first one is a transparent ghost (`opacity: 0.00001`) — the bare `querySelector` focused that invisible copy, so the caret never appeared and the shortcut looked dead. The hook now skips transparent/hidden copies.

### 0.4.1

- Fixed: `L` now likes the note itself, not a comment — comments carry their own `.like-wrapper` buttons which can sit earlier in the DOM than the note's action bar, and the bare `querySelector` grabbed whichever came first. The like hook is now scoped to the engage bar's container (with a comment-excluding fallback); verified against a live page with 3 `.like-wrapper` elements.

### 0.4.0

- Fixed: pan-by-drag now works when zoomed (previously only the bare background started a drag, which made panning impossible once the image covered the viewport), and a pan-drag no longer closes the lightbox via its trailing click.
- Fixed: holding a key no longer machine-guns toggles (like/unlike, lightbox open/close).
- Fixed: the page's own video now pauses while the lightbox is open (no double audio) and resumes on close; lightbox playback falls back to muted if autoplay with sound is blocked.
- Fixed: IME composition (pinyin input) is never intercepted — `Esc` no longer discards a draft mid-composition and `⌘Enter` can't send half-composed text.
- Fixed: `Send`/`Got it` buttons are matched bilingually so send-comment and nag dismissal work on the Chinese UI.
- Fixed: `⌘/Ctrl+Enter` only triggers from the comment box, not any focused input.
- Fixed: Swiper slide counting works across loop-mode implementations (cloned and non-cloned); current slide resolves via `.swiper-slide-active`.
- Changed: handled keys call `stopPropagation()` so the site's own handlers can't double-fire.
- Changed: visibility checks use client rects instead of `offsetParent` (which reports `null` for fixed-position elements).
- Added: throttled mutation observer, `@noframes`, MIT license, dialog roles and aria-labels.

### 0.3.0

- Initial version: carousel keys, lightbox, like/collect/comment/follow, search focus, help overlay, nag auto-dismiss.

## License

[MIT](LICENSE)
