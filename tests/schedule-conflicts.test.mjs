import assert from 'node:assert/strict';
import { findScheduleConflicts, workerOwnsCase } from '../assets/js/workflow.js';

const base = { property:'テスト物件', room:'101号室', surveyStaff:'未定', surveyStaffId:'', surveyAt:'', surveyDurationMinutes:60, workStaff:'未定', workStaffId:'', workAt:'', workDurationMinutes:180 };
const survey = { ...base, id:'survey', surveyStaff:'西山さん', surveyStaffId:'staff-nishiyama', surveyAt:'2026-09-02T10:00' };
const work = { ...base, id:'work', room:'102号室', workStaff:'西山さん', workStaffId:'staff-nishiyama', workAt:'2026-09-02T13:00' };
const state = { cases:[survey, work] };

const surveySurvey = { ...base, id:'new-1', surveyStaff:'西山さん', surveyStaffId:'staff-nishiyama', surveyAt:'2026-09-02T10:30' };
assert.equal(findScheduleConflicts(state, surveySurvey).length, 1);
assert.equal(findScheduleConflicts(state, surveySurvey)[0].conflicting.type, 'survey');

const surveyWork = { ...base, id:'new-2', workStaff:'西山さん', workStaffId:'staff-nishiyama', workAt:'2026-09-02T10:30', workDurationMinutes:30 };
assert.equal(findScheduleConflicts(state, surveyWork)[0].conflicting.type, 'survey');

const workWork = { ...base, id:'new-3', workStaff:'西山さん', workStaffId:'staff-nishiyama', workAt:'2026-09-02T15:00', workDurationMinutes:60 };
assert.equal(findScheduleConflicts(state, workWork)[0].conflicting.type, 'work');

const boundary = { ...base, id:'new-4', surveyStaff:'西山さん', surveyStaffId:'staff-nishiyama', surveyAt:'2026-09-02T11:00' };
assert.equal(findScheduleConflicts(state, boundary).length, 0);

const otherStaff = { ...base, id:'new-5', surveyStaff:'高橋さん', surveyStaffId:'staff-takahashi', surveyAt:'2026-09-02T10:30' };
assert.equal(findScheduleConflicts(state, otherStaff).length, 0);

const sameCaseCrossType = { ...base, id:'new-6', surveyStaff:'高橋さん', surveyStaffId:'staff-takahashi', surveyAt:'2026-09-02T10:00', workStaff:'高橋さん', workStaffId:'staff-takahashi', workAt:'2026-09-02T10:30', workDurationMinutes:60 };
assert.equal(findScheduleConflicts({ cases:[] }, sameCaseCrossType).length, 1);

const linkedStaff = [{ id:'staff-worker-a', name:'職人A', loginUserId:'worker-a' }];
assert.equal(workerOwnsCase({ ...base, workStaff:'旧表示名', workStaffId:'staff-worker-a' }, '職人A', 'worker-a', linkedStaff), true);
assert.equal(workerOwnsCase({ ...base, workStaff:'職人A' }, '職人A', 'worker-a', []), true);

console.log('schedule conflict tests: ok');
