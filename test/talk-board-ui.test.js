const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('talk board UI is polished on root and app mirror', () => {
  for (const prefix of ['', 'www/']) {
    const html = read(`${prefix}index.html`);
    const js = read(`${prefix}js/app.js`);
    const css = read(`${prefix}css/style.css`);

    assert.match(html, /id="btn-home-talk-write-floating"/, `${prefix}home needs a floating write entry`);
    assert.match(html, /class="talk-screen-panel"/, `${prefix}talk list needs the updated panel wrapper`);
    assert.doesNotMatch(html, /id="talk-price-input"/, `${prefix}talk write should not show a price input`);
    assert.doesNotMatch(html, />가격<\/label>/, `${prefix}talk write should not show a price label`);
    assert.match(js, /#btn-home-talk-write-floating.+navigate\('talk-write'\)/s, `${prefix}home write button must open talk write`);
    assert.match(js, /formData\.append\('price',\s*'0'\)/, `${prefix}talk write should submit a zero price internally`);
    assert.doesNotMatch(js, /talk-price-input/, `${prefix}talk write should not read or reset a removed price input`);
    assert.ok(js.includes("'이츠톡': { parent: '#screen-talk .screen-content', before: '.talk-screen-panel' }"), `${prefix}talk banner insertion must target a direct screen-content child`);
    assert.match(js, /before\s*&&\s*before\.parentNode\s*===\s*parent/, `${prefix}banner insertion should guard against non-child insertion anchors`);
    assert.match(js, /home-talk-row-card/, `${prefix}home talk rows must use the polished row card`);
    assert.match(js, /class="talk-cafe-stat"/, `${prefix}talk cards must expose compact stats`);
    assert.match(js, /class="talk-detail-chat-chip"/, `${prefix}talk detail needs a compact 1:1 chat chip`);
    assert.match(js, /btn-talk-start-chat/, `${prefix}detail chat entry must keep the existing chat action id`);
    assert.doesNotMatch(js, /talk-detail-chat-copy/, `${prefix}detail chat should stay as a compact chip, not a large copy block`);
    assert.doesNotMatch(js, /class="talk-detail-chat-card"/, `${prefix}talk detail must not use the large chat card`);
    assert.match(css, /\.talk-screen-panel\b/, `${prefix}talk screen panel styles are required`);
    assert.match(css, /\.talk-write-floating\.home-talk-write-floating\b/, `${prefix}home floating button styles are required`);
    assert.match(css, /\.talk-write-floating strong/, `${prefix}floating write label needs hover-expand styling`);
    assert.match(css, /\.talk-write-floating\s*\{[\s\S]*?width:\s*54px;[\s\S]*?height:\s*54px;/, `${prefix}floating write button must be circular before hover`);
    assert.match(css, /\.talk-write-floating:hover,[\s\S]*?\.talk-write-floating\.is-expanded\s*\{[\s\S]*?width:\s*106px;/, `${prefix}floating write button should expand only on hover/focus`);
    assert.match(css, /\.talk-write-floating:hover,[\s\S]*?background:\s*#02a94d;/, `${prefix}floating write button should darken on hover/focus`);
    assert.doesNotMatch(css, /\.phone-frame \.talk-write-floating\s*\{[\s\S]*?width:\s*106px;/, `${prefix}app frame should not force the write button open`);
    assert.match(css, /@media \(max-width:\s*390px\)[\s\S]*?\.talk-write-floating\s*\{[\s\S]*?width:\s*52px;[\s\S]*?height:\s*52px;/, `${prefix}mobile floating write button must stay circular before hover`);
    assert.match(css, /\.talk-detail-chat-chip\b/, `${prefix}detail chat chip styles are required`);
    assert.match(css, /\.bottom-nav \.nav-item\.nav-hover,[\s\S]*?color:\s*#03c75a !important;/, `${prefix}nav hover class should force green over the icon`);
    assert.doesNotMatch(css, /\.talk-detail-chat-card\b/, `${prefix}large detail chat card styles should be removed`);
    assert.doesNotMatch(js, /class="talk-cafe-dot"/, `${prefix}old dot-only talk card marker should be gone`);
    assert.doesNotMatch(html, /id="btn-talk-chats"/, `${prefix}talk list header must not show a separate chat-list button`);
  }
});

test('bottom navigation icon hit area resolves to its parent button', () => {
  const css = read('css/style.css');
  const js = read('js/app.js');
  const sw = read('sw.js');

  assert.match(css, /\.bottom-nav \.nav-item > \*[\s\S]*?pointer-events: auto !important;/, 'nav children should keep hover while clicks bubble to the parent button');
  assert.match(css, /\.bottom-nav-icon\s*\{[\s\S]*?pointer-events: auto !important;/, 'nav icons should keep pointer hover on the parent button');
  assert.match(css, /\.nav-label\s*\{[\s\S]*?pointer-events: auto;/, 'nav labels should keep pointer hover on the parent button');
  assert.match(css, /\.bottom-nav \.nav-item::after[\s\S]*?pointer-events: none;/, 'decorative nav overlay must not intercept clicks');
  assert.match(js, /function getBottomNavItemByPoint/, 'nav hover/click should resolve one button by the nav hit area');
  assert.match(js, /function getBottomNavItemFromEvent/, 'nav clicks should fall back to the direct event target');
  assert.match(js, /\['pointerup',\s*'touchend',\s*'mouseup',\s*'click'\]\.forEach/, 'nav should handle pointer, touch, mouse, and click activation through one delegate');
  assert.match(js, /handleBottomNavActivation[\s\S]*navigateBottomNavItem/, 'nav activations should share one handler');
  assert.doesNotMatch(js, /button\.addEventListener\('touchend'/, 'nav buttons should not carry duplicate per-button touch handlers');
  assert.match(js, /serviceWorkerVersion\s*=\s*'20260628_nav_icon_hover_force_fix'/, 'app should register a new service worker version for nav/write changes');
  assert.match(sw, /eatspay-pwa-v70-nav-icon-hover-force-fix/, 'service worker cache name should change when nav/write behavior changes');
});
