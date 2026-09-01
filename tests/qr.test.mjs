import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createQrSvg } from '../assets/js/qr.js';

const url = 'https://example.test/sowa-kouji-demo/?resident=nNAU_zVuA5LTQtEX8vMOm-QaI2nNKBWX';
const svg = createQrSvg(url);
assert.match(svg, /^<svg/);
assert.match(svg, /viewBox=/);
assert.match(svg, /<path/);
assert.match(svg, /入居者回答フォームのQRコード/);

const helperSource = fs.readFileSync(new URL('../assets/js/qr.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../assets/js/app.js', import.meta.url), 'utf8');
assert.doesNotMatch(helperSource, /https?:\/\//);
assert.doesNotMatch(helperSource + appSource, /fetch\s*\(|XMLHttpRequest|import\s*\(\s*['"]https?:/);

console.log('qr tests: ok');
