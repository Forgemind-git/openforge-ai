// The assistant must never be able to send, email, book or delete on its own.
// Every write goes through a prepare_* tool that only stores a draft.
const test = require('node:test');
const assert = require('node:assert');
process.env.DATA_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'of-test-'));
const { TOOLS } = require('../src/assistant/tools');
const live = require('../src/assistant/live');

const READ = new Set(['get_overview', 'list_tasks', 'list_events', 'search_mail', 'read_mail', 'list_chats', 'read_chat', 'open_view']);

test('every tool is a read or a prepare_* draft', () => {
  for (const t of TOOLS) {
    assert.ok(READ.has(t.name) || t.name.startsWith('prepare_'), `unexpected tool ${t.name}`);
    if (t.name.startsWith('prepare_')) assert.equal(t.drafts, true, `${t.name} must be marked as a draft tool`);
  }
});

test('no tool name suggests acting directly', () => {
  for (const t of TOOLS) assert.doesNotMatch(t.name, /^(send|delete|create|book|post|update|complete)_/);
});

test('tools source never imports the senders', () => {
  const src = require('fs').readFileSync(require.resolve('../src/assistant/tools'), 'utf8');
  for (const fn of ['sendMail', 'sendToChat', 'waSend', 'tgSend', 'createEvent', 'createTask', 'updateTask', 'deleteTask']) {
    assert.doesNotMatch(src, new RegExp(`\\.${fn}\\(`), `tools.js must not call ${fn}`);
  }
});

test('Gemini declarations convert schemas and drop empty parameter objects', () => {
  const d = live.declarations();
  assert.equal(d.length, TOOLS.length);
  assert.equal(d.find(x => x.name === 'get_overview').parameters, undefined);
  assert.equal(d.find(x => x.name === 'read_chat').parameters.type, 'OBJECT');
});

test('phone numbers are masked', () => {
  const { maskPhone } = require('../src/assistant/tools');
  assert.equal(maskPhone('919876543210'), '+91 98••••10');
  assert.doesNotMatch(maskPhone('919876543210'), /765432/);
});
