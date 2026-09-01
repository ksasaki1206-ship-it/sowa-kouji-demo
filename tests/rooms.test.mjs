import assert from 'node:assert/strict';
import { normalizeRoomNumber } from '../assets/js/data.js';
import { groupCasesByRoom, selectableRooms } from '../assets/js/workflow.js';

for (const value of ['101', '101号室', '１０１号室', '101 号室', '1 0 1号室']) {
  assert.equal(normalizeRoomNumber(value), '101');
}
assert.equal(normalizeRoomNumber('Ａ-１０１号室'), 'Ａ-101');
assert.equal(normalizeRoomNumber('店舗A'), '店舗A');

const rooms = [
  { id:'r1', propertyId:'p1', active:true },
  { id:'r2', propertyId:'p1', active:false },
  { id:'r3', propertyId:'p2', active:true }
];
assert.deepEqual(selectableRooms(rooms, 'p1').map(item => item.id), ['r1']);
assert.deepEqual(selectableRooms(rooms, 'p1', 'r2').map(item => item.id), ['r1','r2']);

const groups = groupCasesByRoom([
  { id:'c1', propertyId:'p1', roomId:'', room:'101号室' },
  { id:'c2', propertyId:'p1', roomId:'', room:'１０１ 号室' },
  { id:'c3', propertyId:'p2', roomId:'', room:'101号室' },
  { id:'c4', propertyId:'p1', roomId:'r2', room:'102号室' },
  { id:'c5', propertyId:'p1', roomId:'r2', room:'旧102表記' }
]);
assert.equal(groups.length, 3);
assert.deepEqual(groups.find(group => group.cases.some(item => item.id === 'c1')).cases.map(item => item.id), ['c1','c2']);
assert.deepEqual(groups.find(group => group.roomId === 'r2').cases.map(item => item.id), ['c4','c5']);

console.log('room master tests: ok');
