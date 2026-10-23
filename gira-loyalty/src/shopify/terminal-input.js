// Small visible ASCII editor for consent; no input is copied to normal logs.
const pendingLf = new WeakSet();
export function readVisibleLine(input, write, timeoutMs) {
  return new Promise((resolve, reject) => {
    let value = '';
    let settled = false;
    const finish = (cancelled) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.off('data', onData);
      input.off('end', cancel);
      input.off('error', cancel);
      input.pause();
      cancelled ? reject(new Error('INTERACTION_CANCELLED')) : resolve(value);
    };
    const cancel = () => finish(true);
    const onData = chunk => {
      for (const char of chunk.toString('utf8')) {
        if (pendingLf.has(input)) {
          pendingLf.delete(input);
          if (char === '\n') continue;
        }
        if (char === '\u0003' || char === '\u0004' || char === '\u001b') return finish(true);
        if (char === '\r' || char === '\n') {
          if (char === '\r') pendingLf.add(input);
          write('\r\n'); return finish(false);
        }
        if (char === '\b' || char === '\u007f') {
          if (value.length) { value = value.slice(0, -1); write('\b \b'); }
        } else if (/^[\x20-\x7e]$/.test(char) && value.length < 64) {
          value += char;
          write(char);
        }
      }
    };
    const timer = setTimeout(cancel, timeoutMs);
    input.on('data', onData);
    input.once('end', cancel);
    input.once('error', cancel);
    write('> ');
    input.resume();
  });
}
