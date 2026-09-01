import assert from 'node:assert/strict';
import { getCaseAlerts, matchesCasePreset } from '../assets/js/workflow.js';

const photos = { survey:[], before:[], during:[], after:[] };
const base = { status:'現調調整中', surveyAt:'', surveyStaff:'未定', workAt:'', workStaff:'未定', photos };
const state = { auditLogs:[], responses:[], cases:[] };

const surveyMissing = { ...base, id:'survey-missing', surveyAt:'2026-09-02T10:00' };
const workMissing = { ...base, id:'work-missing', surveyAt:'2026-09-02T10:00', surveyStaff:'西山さん', workAt:'2026-09-03T09:00' };
const datesMissing = { ...base, id:'dates-missing' };
state.cases.push(surveyMissing, workMissing, datesMissing);

const surveyAlerts = getCaseAlerts(state, surveyMissing);
assert.equal(surveyAlerts.some(alert => alert.code === 'survey-staff-undecided' && alert.priority === 'high'), true);
assert.equal(surveyAlerts.some(alert => alert.code === 'survey-undecided'), false);

const workAlerts = getCaseAlerts(state, workMissing);
assert.equal(workAlerts.some(alert => alert.code === 'work-staff-undecided' && alert.priority === 'high'), true);
assert.equal(workAlerts.some(alert => alert.code === 'survey-staff-undecided'), false);

const missingDateAlerts = getCaseAlerts(state, datesMissing);
assert.equal(missingDateAlerts.some(alert => alert.code === 'survey-undecided'), true);
assert.equal(missingDateAlerts.some(alert => alert.code === 'survey-staff-undecided'), false);
assert.equal(missingDateAlerts.some(alert => alert.code === 'work-staff-undecided'), false);

assert.equal(matchesCasePreset(state, surveyMissing, 'survey-staff-undecided'), true);
assert.equal(matchesCasePreset(state, workMissing, 'work-staff-undecided'), true);
assert.equal(matchesCasePreset(state, surveyMissing, 'staff-undecided'), true);
assert.equal(matchesCasePreset(state, workMissing, 'staff-undecided'), true);
assert.equal(matchesCasePreset(state, datesMissing, 'staff-undecided'), false);

console.log('workflow UI tests: ok');
