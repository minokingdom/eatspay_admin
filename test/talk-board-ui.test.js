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
    assert.match(js, /#btn-home-talk-write-floating.+navigate\('talk-write'\)/s, `${prefix}home write button must open talk write`);
    assert.ok(js.includes("'이츠톡': { parent: '#screen-talk .screen-content', before: '.talk-screen-panel' }"), `${prefix}talk banner insertion must target a direct screen-content child`);
    assert.match(js, /before\s*&&\s*before\.parentNode\s*===\s*parent/, `${prefix}banner insertion should guard against non-child insertion anchors`);
    assert.match(js, /home-talk-row-card/, `${prefix}home talk rows must use the polished row card`);
    assert.match(js, /class="talk-cafe-stat"/, `${prefix}talk cards must expose compact stats`);
    assert.match(js, /class="talk-detail-chat-card"/, `${prefix}talk detail needs inline 1:1 chat entry`);
    assert.match(js, /btn-talk-start-chat/, `${prefix}detail chat entry must keep the existing chat action id`);
    assert.match(js, /talk-detail-chat-copy/, `${prefix}detail chat button must keep rich icon and text markup`);
    assert.doesNotMatch(js, /chatButton\.textContent\s*=\s*'1:1 채팅'/, `${prefix}chat setup must not flatten the designed chat button`);
    assert.match(css, /\.talk-screen-panel\b/, `${prefix}talk screen panel styles are required`);
    assert.match(css, /\.talk-write-floating\.home-talk-write-floating\b/, `${prefix}home floating button styles are required`);
    assert.match(css, /\.talk-write-floating strong/, `${prefix}floating write label needs hover-expand styling`);
    assert.match(css, /\.talk-detail-chat-card\b/, `${prefix}detail chat card styles are required`);
    assert.doesNotMatch(js, /class="talk-cafe-dot"/, `${prefix}old dot-only talk card marker should be gone`);
    assert.doesNotMatch(html, /id="btn-talk-chats"/, `${prefix}talk list header must not show a separate chat-list button`);
  }
});

test('bottom navigation icon hit area resolves to its parent button', () => {
  const css = read('css/style.css');
  const js = read('js/app.js');

  assert.match(css, /\.bottom-nav \.nav-item > \*[\s\S]*?pointer-events: none !important;/, 'nav children should not steal icon clicks from the button');
  assert.match(css, /\.bottom-nav \.nav-item::after[\s\S]*?pointer-events: none;/, 'decorative nav overlay must not intercept clicks');
  assert.match(js, /const navItem = event\.target\.closest\('\.bottom-nav \.nav-item'\)/, 'nav clicks are delegated from the button');
  assert.match(js, /document\.addEventListener\('pointerup'[\s\S]*navigateBottomNavItem/, 'nav should also handle pointerup for webview icon taps');
});
