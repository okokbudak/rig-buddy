// The update check (pc/agent/update.mjs): version comparison, and the real GitHub answer for this repository.
import assert from 'node:assert/strict';

const { isNewer, updateInfo, setupAsset } = await import('../pc/agent/update.mjs');

// the installer offered to RigBuddy.exe: only this repository's, only with GitHub's SHA-256
const H = 'ab'.repeat(32);
const ok = { name: 'RigBuddy-Setup.exe', browser_download_url: 'https://github.com/okokbudak/rig-buddy/releases/download/v0.7.0/RigBuddy-Setup.exe', digest: `sha256:${H.toUpperCase()}`, size: 97590988 };
assert.deepEqual(setupAsset([{ name: 'RigBuddy.apk' }, ok]), { url: ok.browser_download_url, sha256: H, size: 97590988 });
assert.equal(setupAsset([{ ...ok, digest: undefined }]), null, 'no SHA-256 from GitHub: nothing to check the download against');
assert.equal(setupAsset([{ ...ok, digest: 'md5:abc' }]), null);
assert.equal(setupAsset([{ ...ok, browser_download_url: 'https://evil.example/RigBuddy-Setup.exe' }]), null, 'another host');
assert.equal(setupAsset([{ ...ok, browser_download_url: 'https://github.com/someone/else/releases/download/v1/RigBuddy-Setup.exe' }]), null, 'another repository');
assert.equal(setupAsset([{ ...ok, name: 'Other.exe' }]), null);
assert.equal(setupAsset(undefined), null);
assert.equal(setupAsset([{ ...ok, size: 'big' }]).size, null);

assert.equal(isNewer('0.6.3', '0.6.2'), true);
assert.equal(isNewer('v0.6.3', '0.6.2.0'), true, 'a leading v and a fourth part');
assert.equal(isNewer('0.6.2', '0.6.2.0'), false, 'same version');
assert.equal(isNewer('0.10.0', '0.9.9'), true, 'numbers, not text');
assert.equal(isNewer('1.0.0', '0.99.99'), true);
assert.equal(isNewer('0.6.1', '0.6.2'), false, 'older');
assert.equal(isNewer('', '0.6.2'), false);
assert.equal(isNewer('0.6.x', '0.6.2'), false, 'unreadable is never "newer"');
assert.equal(isNewer(null, null), false);

process.env.RIGBUDDY_UPDATE_CHECK = '0';
assert.deepEqual(await updateInfo(), { latest: null, current: null, newer: false, disabled: true }, 'switched off: no request at all');
delete process.env.RIGBUDDY_UPDATE_CHECK;

process.env.RIGBUDDY_VERSION = '0.0.1';
const live = await updateInfo();
if (live.latest) {
  assert.match(live.latest, /^\d+(\.\d+)*$/);
  assert.ok(live.url.startsWith('https://github.com/okokbudak/rig-buddy/'));
  assert.equal(live.newer, true, 'an old version has a newer one');
  console.log(`GitHub says: ${live.latest} (${live.url}); installer: ${live.setup ? `${live.setup.url} sha256 ${live.setup.sha256.slice(0, 12)}… ${live.setup.size} B` : 'none offered'}`);
} else {
  console.log('GitHub not reachable from here: live part skipped');
}
console.log('update: all tests passed');
