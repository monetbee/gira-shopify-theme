import { openSync, writeSync, closeSync } from 'node:fs';
import { runLocalInspection } from '../src/shopify/local-inspect.js';
import { readVisibleLine } from '../src/shopify/terminal-input.js';

let fd;
const input = process.stdin;
const wasRaw = input.isRaw;
const reasons = [];
const write = text => { if (fd !== undefined) writeSync(fd, text); };
function readLine(timeoutMs) {
  return readVisibleLine(input, write, timeoutMs, process.stdout.columns || 80);
}
const terminal = {
  open() {
    fd = openSync(process.platform === 'win32' ? '\\\\.\\CONOUT$' : '/dev/tty', 'w');
    input.setRawMode(true);
    write('\u001b[?1049h\u001b[2J\u001b[H');
  },
  async confirm() {
    write('Local administrator inspection. Disable terminal recording.\r\nType VIEW and Enter to permit API access and temporary identity display.\r\nInput is visible. Do not paste credentials. Ctrl-C cancels.\r\n');
    return readLine(60_000);
  },
  async view(text) {
    write('\u001b[2J\u001b[H' + text.replaceAll('\n', '\r\n') + '\r\nEnter: continue validation. Ctrl-C: cancel. Timeout: 60 seconds.\r\n');
    try { await readLine(60_000); } finally { write('\u001b[2J\u001b[H'); }
  },
  async result(success, detail) {
    if (fd === undefined) return;
    write(success ? 'Identity verification passed.\r\n' : 'Verification failed or inspection cancelled. Exit code 1.\r\n');
    if (detail) write(`Reason: ${detail.code}\r\nAPI attempted: ${detail.apiStarted}\r\nIdentity view completed: ${detail.identityDisplayed}\r\n`);
    write('Enter to close.\r\n');
    try { await readLine(10_000); } catch { /* Close on timeout/cancel. */ }
  },
  close() {
    try {
      if (fd !== undefined) {
        try { write('\u001b[2J\u001b[H\u001b[?1049l'); } finally { closeSync(fd); fd = undefined; }
      }
    } finally {
      if (input.isTTY) input.setRawMode(Boolean(wasRaw));
      input.pause();
    }
  },
};

try {
  process.exitCode = await runLocalInspection({ args: process.argv.slice(2), env: process.env,
    interactive: Boolean(input.isTTY && process.stdout.isTTY && process.stderr.isTTY), terminal,
    report: code => reasons.push(code) });
} catch { reasons.push('LOCAL_INSPECTION_FAILED'); process.exitCode = 1; }
if (process.exitCode === 1) {
  // Only fixed local failure codes; no response data or exception text.
  process.stderr.write(`Local inspection stopped: ${reasons.join(', ') || 'LOCAL_INSPECTION_FAILED'}. Exit code: 1.\n`);
  if (reasons.includes('INTERACTIVE_TERMINAL_REQUIRED')) {
    process.stderr.write(`TTY: stdin=${Boolean(input.isTTY)} stdout=${Boolean(process.stdout.isTTY)} stderr=${Boolean(process.stderr.isTTY)}\n`);
  }
}
