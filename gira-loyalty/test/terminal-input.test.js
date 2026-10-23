import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { readVisibleLine } from '../src/shopify/terminal-input.js';

function terminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.setRawMode = () => {};
  const output = [];
  return { input, output, read: (ms = 1000) => readVisibleLine(input, text => output.push(text), ms) };
}
test('visible terminal input accepts VIEW with CR, LF, CRLF and Windows backspace', async () => {
  for (const ending of ['\r', '\n', '\r\n']) {
    for (const correction of ['VIEW', 'VIEQ\bW', 'VIEQ\u007fW']) {
      const t = terminal();
      const pending = t.read();
      for (const char of correction + ending) t.input.write(char);
      assert.equal(await pending, 'VIEW');
      assert.ok(t.output.join('').includes('V'));
      assert.equal(t.input.listenerCount('keypress'), 0);
      t.input.destroy();
    }
  }
});
test('terminal input cancels on Ctrl-C, EOF or timeout', async () => {
  for (const mode of ['ctrl-c', 'eof', 'timeout']) {
    const t = terminal();
    const pending = t.read(20);
    if (mode === 'ctrl-c') t.input.write('\u0003');
    if (mode === 'eof') t.input.end();
    await assert.rejects(pending, { message: 'INTERACTION_CANCELLED' });
    assert.equal(t.input.listenerCount('keypress'), 0);
    t.input.destroy();
  }
});

test('a split CRLF from consent does not dismiss the next screen', async () => {
  const t = terminal();
  const consent = t.read();
  t.input.write('VIEW\r');
  assert.equal(await consent, 'VIEW');
  let finished = false;
  const next = t.read().then(value => { finished = true; return value; });
  t.input.write('\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  t.input.write('\r');
  assert.equal(await next, '');
  t.input.destroy();
});

