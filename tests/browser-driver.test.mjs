// The browser driver: config/browser.json driver, overridden by --driver (and JOBBA_BROWSER_DRIVER
// in tests), and channel verification per driver.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRIVERS, browserDriver, channelVerified } from '../scripts/lib/browser.mjs';

test('the flag beats the environment, which beats the config; the default is the template', () => {
  assert.deepEqual(DRIVERS, ['chrome', 'cloakbrowser']);
  assert.equal(browserDriver({ cfg: { driver: 'chrome' } }), 'chrome');
  assert.equal(browserDriver({ cfg: { driver: 'chrome' }, env: { JOBBA_BROWSER_DRIVER: 'cloakbrowser' } }), 'cloakbrowser');
  assert.equal(browserDriver({ flags: { driver: 'chrome' }, cfg: { driver: 'cloakbrowser' }, env: { JOBBA_BROWSER_DRIVER: 'cloakbrowser' } }), 'chrome');
  assert.equal(browserDriver({ cfg: {} }), 'cloakbrowser');
  assert.throws(() => browserDriver({ flags: { driver: 'firefox' } }), /driver must be chrome or cloakbrowser/);
  assert.throws(() => browserDriver({ cfg: { driver: true } }), /driver must be chrome or cloakbrowser/);
});

test('a channel is verified per driver: verified for cloakbrowser, verified_chrome for chrome', () => {
  const cfg = { verified: { easy: true, greenhouse: false }, verified_chrome: { easy: false, greenhouse: true } };
  assert.equal(channelVerified(cfg, 'easy', 'cloakbrowser'), true);
  assert.equal(channelVerified(cfg, 'easy', 'chrome'), false);
  assert.equal(channelVerified(cfg, 'greenhouse', 'chrome'), true);
  assert.equal(channelVerified(cfg, 'lever', 'chrome'), false);
  assert.equal(channelVerified({}, 'easy', 'cloakbrowser'), false);
  assert.equal(channelVerified({ verified_chrome: { easy: 'yes' } }, 'easy', 'chrome'), false, 'only true counts');
});
