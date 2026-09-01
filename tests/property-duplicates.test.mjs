import assert from 'node:assert/strict';
import { findDuplicateCases } from '../assets/js/workflow.js';

const base = { propertyId:'property-001', property:'○○マンション', roomId:'room-001', room:'101号室', status:'現調調整中' };
const state = { cases:[
  { ...base, id:'open-101' },
  { ...base, id:'done-101', status:'完了' },
  { ...base, id:'open-102', roomId:'room-002', room:'102号室' },
  { ...base, id:'other-property', propertyId:'property-002' },
  { ...base, id:'cancelled-101', lifecycleStatus:'cancelled' },
  { ...base, id:'archived-101', isArchived:true }
] };

assert.deepEqual(findDuplicateCases(state, { ...base, id:'new-case' }).map(item => item.id), ['open-101']);
assert.equal(findDuplicateCases(state, { ...base, id:'new-case', roomId:'room-002', room:'１０２ 号室' }).length, 1);
assert.equal(findDuplicateCases(state, { ...base, id:'new-case', roomId:'room-different', room:'101号室' }).length, 0);
assert.equal(findDuplicateCases({ cases:[{ ...base, id:'legacy-open', roomId:'', room:'１０１ 号室' }] }, { ...base, id:'new-case', roomId:'', room:'101' }).length, 1);
assert.equal(findDuplicateCases({ cases:[state.cases[1]] }, { ...base, id:'new-case' }).length, 0);
assert.equal(findDuplicateCases(state, { ...base, id:'new-case', propertyId:'property-003' }).length, 0);
assert.equal(findDuplicateCases(state, { ...base, id:'open-101' }).length, 0);
assert.equal(findDuplicateCases(state, { ...base, id:'new-case', roomId:'', room:'' }).length, 0);

console.log('property duplicate tests: ok');
