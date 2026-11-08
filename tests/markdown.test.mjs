import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../public/markdown.js';

test('exchange replies render bold labels and nested numbered/bulleted lists', () => {
  const html = renderMarkdown('1. **LOT-1002 — Portlandsement M-400**\n   * **Hudud:** Navoiy\n   * **Narxi:** 695 000 UZS / tonna\n\n2. **LOT-1001**\n   * **Hudud:** Toshkent');
  assert.match(html, /<ol>/);
  assert.match(html, /<ul>/);
  assert.match(html, /<strong>Hudud:<\/strong> Navoiy/);
  assert.match(html, /<strong>LOT-1002 — Portlandsement M-400<\/strong>/);
  assert.doesNotMatch(html, /\*\*/);
});

test('headings, emphasis, quotes, links, tables and code render correctly', () => {
  const html = renderMarkdown('## Takliflar\n\n*Demo* va ~~eski~~\n\n> Narxlar sun’iy.\n\n[UZEX](https://uzex.uz/)\n\n| Lot | Narx |\n| --- | --- |\n| M-400 | 720000 |\n\n`lot_id`\n\n```json\n{"demo":true}\n```');
  for (const tag of ['h2', 'em', 's', 'blockquote', 'table', 'code', 'pre']) assert.ok(html.includes(`<${tag}`), tag);
  assert.match(html, /class="markdown-table"/);
  assert.match(html, /href="https:\/\/uzex.uz\/" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /language-json/);
});

test('model text cannot inject HTML, executable links or remote images', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n[bad](data:text/html;base64,PHNjcmlwdD4=)\n\n![demo](https://tracker.example/pixel.png)');
  assert.doesNotMatch(html, /<script|<img|href="(?:javascript|data):/i);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /src="https:\/\/tracker/);
  const code = renderMarkdown('```html\n<img onerror=alert(1)>\n```');
  assert.match(code, /&lt;img/);
  assert.doesNotMatch(code, /<img/);
});
