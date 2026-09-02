# RedNote Keyboard Friendly (小红书键盘增强)

Keyboard shortcuts for **rednote.com / xiaohongshu.com note detail pages** — arrow keys for the image carousel, `E` for a full-screen lightbox with zoom/pan, one-key like/collect/comment, `/` for search, `?` for help. Auto-dismisses nag modals.

Does nothing on the home feed, search, or profile pages — shortcuts are gated to note-detail URLs (`/explore/<id>`, `/discovery/item/<id>`, `/note/<id>`), so browsing the feed with your hands on the keyboard won't accidentally like anything.

> *Unofficial userscript. Not affiliated with Xiaohongshu / RedNote.*

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/) (or Violentmonkey).
2. Open the raw script URL and confirm the install prompt:

   <https://github.com/lsj5031/rednote-keyboard/raw/main/rednote-keyboard.user.js>

3. Open any note on xiaohongshu.com or rednote.com and press `?` to see the in-page help.

## Shortcuts

Only active on note detail pages; typing in an input is always left alone.

| Key | Action |
|---|---|
| `←` / `→` or `A` / `D` | Previous / next image |
| `E` | Enlarge image in a modal lightbox |
| `1` – `9` | Jump to the Nth image |
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
| `1` – `9` | Jump to the Nth image |
| `Ctrl`/`⌘` + wheel or `+` / `−` | Zoom (up to 8×) |
| `0` or ⤾ button | Reset zoom |
| Drag | Pan while zoomed (works from anywhere, including the image itself) |
| `Esc` / `E` / `q` / ✕ / click background | Close |

Held-down keys don't repeat (except arrows anywhere, and `h j k l` while the lightbox is open), IME composition is never intercepted, and modifier combos pass through to the browser.

Inside the lightbox, the mouse wheel flips to the previous/next image (scroll up = previous, scroll down = next) — hold `Ctrl` / `⌘` while scrolling to zoom instead.

## Verified against the live site

The DOM hooks and behavior were audited and exercised on a real xiaohongshu.com note page (Swiper loop mode, Chinese UI):

- All selectors present: `.swiper`, `.like-wrapper`, `.collect-wrapper`, `.chat-wrapper`, `#content-textarea`, `input.search-input`, `.follow-button`
- Slide count correct in loop mode (9 real slides detected from 11 raw Swiper slides)
- Repeat/IME guards: held `L` fires 0 clicks; single `L` fires exactly 1
- Lightbox: opens, zooms to 200%, pans by dragging **on the image**, survives the end-of-drag click, closes with `Esc`
- `⌘Enter` sends only from the comment box — never from the search box
- Bilingual button matching: `Send`/`发送`, `Got it`/`知道了`/`我知道了`

## Changelog

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
