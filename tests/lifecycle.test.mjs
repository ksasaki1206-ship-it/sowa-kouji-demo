import assert from 'node:assert/strict';
import {
  changeSchedule, postponeSchedule, cancelCase, restoreCancelledCase, archiveCase, unarchiveCase,
  isOperationalCase, isPastCase
} from '../assets/js/lifecycle.js';
import { findDuplicateCases, findScheduleConflicts, getCaseAlerts, matchesPastCase } from '../assets/js/workflow.js';

const photos = { survey:[], before:[], during:[], after:[] };
const item = {
  id:'case-1', propertyId:'property-1', roomId:'room-1', property:'物件', room:'101号室', status:'現調調整中',
  lifecycleStatus:'active', isArchived:false, surveyAt:'', surveyDurationMinutes:60,
  surveyStaff:'西山さん', surveyStaffId:'staff-1', workAt:'', workDurationMinutes:180,
  workStaff:'未定', workStaffId:'', scheduleHistory:[], photos
};

let result = changeSchedule(item, 'survey', { at:'2026-09-10T10:00', durationMinutes:60, changedBy:'西山さん', changedAt:'2026-09-01T09:00:00.000Z' });
assert.equal(result.ok, true);
assert.equal(result.entry.action, 'scheduled');
assert.equal(item.surveyAt, '2026-09-10T10:00');

result = changeSchedule(item, 'survey', { at:'2026-09-12T13:00', durationMinutes:90, changedBy:'西山さん' });
assert.equal(result.ok, false);
assert.equal(item.surveyAt, '2026-09-10T10:00');

result = changeSchedule(item, 'survey', { at:'2026-09-12T13:00', durationMinutes:90, reasonCategory:'resident', reason:'入居者都合', changedBy:'西山さん', changedAt:'2026-09-08T09:00:00.000Z' });
assert.equal(result.ok, true);
assert.equal(result.entry.action, 'rescheduled');
assert.equal(result.entry.oldAt, '2026-09-10T10:00');
assert.equal(result.entry.newAt, '2026-09-12T13:00');
assert.equal(result.entry.oldDurationMinutes, 60);
assert.equal(item.scheduleHistory.length, 2);

result = postponeSchedule(item, 'survey', { reasonCategory:'resident', reason:'再確認待ち', changedBy:'高橋さん', changedAt:'2026-09-09T09:00:00.000Z' });
assert.equal(result.ok, true);
assert.equal(item.surveyAt, '');
assert.equal(result.entry.oldAt, '2026-09-12T13:00');
assert.equal(result.entry.action, 'postponed');

result = changeSchedule(item, 'survey', { at:'2026-09-15T14:00', durationMinutes:90, reasonCategory:'resident', reason:'再調整完了', changedBy:'高橋さん', changedAt:'2026-09-10T09:00:00.000Z' });
assert.equal(result.ok, true);
assert.equal(result.entry.action, 'rescheduled');
assert.equal(item.surveyAt, '2026-09-15T14:00');
assert.equal(item.scheduleHistory.length, 4);

const cancelled = { ...item, id:'cancelled', scheduleHistory:[...item.scheduleHistory] };
result = cancelCase(cancelled, { reasonCategory:'customer', reason:'依頼取下げ', changedBy:'事務所', changedAt:'2026-09-11T09:00:00.000Z' });
assert.equal(result.ok, true);
assert.equal(cancelled.lifecycleStatus, 'cancelled');
assert.equal(isOperationalCase(cancelled), false);
assert.equal(getCaseAlerts({ cases:[cancelled], auditLogs:[], responses:[] }, cancelled).length, 0);
assert.equal(findDuplicateCases({ cases:[cancelled] }, { ...item, id:'new-case' }).length, 0);
assert.equal(findScheduleConflicts({ cases:[cancelled] }, { ...item, id:'new-case', surveyAt:'2026-09-15T14:30' }).length, 0);
assert.equal(matchesPastCase(cancelled, 'cancelled'), true);
assert.equal(restoreCancelledCase(cancelled).ok, true);
assert.equal(cancelled.lifecycleStatus, 'active');

const completed = { ...item, id:'completed', status:'完了', isArchived:false };
assert.equal(archiveCase(completed, { changedBy:'事務所' }).ok, true);
assert.equal(completed.isArchived, true);
assert.equal(isOperationalCase(completed), false);
assert.equal(isPastCase(completed), true);
assert.equal(matchesPastCase(completed, 'archived'), true);
assert.equal(unarchiveCase(completed).ok, true);
assert.equal(completed.isArchived, false);

const cancelledArchive = { ...item, id:'cancel-archive', lifecycleStatus:'cancelled', isArchived:false };
assert.equal(archiveCase(cancelledArchive, { changedBy:'事務所' }).ok, true);
const active = { ...item, id:'active', status:'受注', lifecycleStatus:'active', isArchived:false };
assert.equal(archiveCase(active, { changedBy:'事務所' }).ok, false);
assert.equal(active.isArchived, false);

const archivedConflict = { ...item, id:'archived', isArchived:true, surveyAt:'2026-09-15T14:00' };
assert.equal(findScheduleConflicts({ cases:[archivedConflict] }, { ...item, id:'new-case-2', surveyAt:'2026-09-15T14:30' }).length, 0);

console.log('lifecycle tests: ok');
