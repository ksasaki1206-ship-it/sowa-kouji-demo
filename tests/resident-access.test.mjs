import assert from 'node:assert/strict';
import { generateResidentAccessToken, residentAccessStatus } from '../assets/js/resident-access.js';
import { buildResidentUrl } from '../assets/js/routing.js';

let next = 0;
const fakeCrypto = { getRandomValues(bytes) { bytes.forEach((_, index) => { bytes[index] = next++ & 255; }); return bytes; } };
const token = generateResidentAccessToken(fakeCrypto);
assert.equal(token.length >= 32, true);
assert.match(token, /^[0-9A-Za-z_-]+$/);
assert.throws(() => generateResidentAccessToken(null), /安全な入居者用URL/);
assert.equal(residentAccessStatus(null).status, 'unavailable');
assert.equal(residentAccessStatus({ residentAccessEnabled:false }).status, 'disabled');
assert.equal(residentAccessStatus({ residentAccessEnabled:true, lifecycleStatus:'cancelled' }).status, 'closed');
assert.equal(residentAccessStatus({ residentAccessEnabled:true, status:'完了' }).status, 'closed');
assert.equal(residentAccessStatus({ residentAccessEnabled:true, isArchived:true }).status, 'closed');
assert.equal(residentAccessStatus({ residentAccessEnabled:true, lifecycleStatus:'active', status:'問い合わせ', isArchived:false }).status, 'open');
assert.equal(buildResidentUrl('https://example.test/app/', token), `https://example.test/app/?resident=${token}`);

console.log('resident access tests: ok');
