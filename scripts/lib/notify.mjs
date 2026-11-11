// Desktop notification from a script (the apply runner waiting for a bot check, for example).
// macOS: osascript; Linux: notify-send; anything else, or preferences.notify.desktop "off": a line
// on stderr. Never throws, never blocks: a missing notifier is not an error.

import { execFile } from 'node:child_process';
import { platform } from 'node:os';

const quote = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

export function notifyCommand(title, message, os = platform()) {
  if (os === 'darwin') return ['osascript', ['-e', `display notification "${quote(message)}" with title "${quote(title)}" sound name "Glass"`]];
  if (os === 'linux') return ['notify-send', ['--app-name=jobba-hunt', String(title), String(message)]];
  return null;
}

export function notify(title, message, { mode = 'auto', run = execFile } = {}) {
  const cmd = mode === 'off' ? null : notifyCommand(title, message);
  if (!cmd) {
    process.stderr.write(`[notify] ${title}: ${message}\n`);
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    run(cmd[0], cmd[1], { timeout: 5000 }, (err) => {
      if (err) process.stderr.write(`[notify] ${title}: ${message}\n`);
      resolve(!err);
    });
  });
}
