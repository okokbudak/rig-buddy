// The update check (pc/agent/update.mjs): version comparison, and the real GitHub answer for this repository.
import assert from 'node:assert/strict';

const { isNewer, updateInfo, setupAsset, apkFile } = await import('../pc/agent/update.mjs');

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
  // the APK for the apps: fetched once by the PC, checked against GitHub's SHA-256
  if (live.apk) {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-apk-'));
    const fake = async () => new Response(new Uint8Array([1, 2, 3]));
    await assert.rejects(apkFile(dir, fake), /checksum/, 'a download that does not match is refused');
    assert.ok(!fs.existsSync(path.join(dir, 'update', `RigBuddy-${live.latest}.apk`)), '... and not kept');
    const a = await apkFile(dir);
    assert.equal(a.version, live.latest);
    assert.equal(a.sha256, live.apk.sha256);
    assert.equal(fs.statSync(a.file).size, live.apk.size);
    fs.writeFileSync(path.join(dir, 'update', 'RigBuddy-0.0.1.apk'), 'old');
    const again = await apkFile(dir, () => { throw new Error('must not download again'); });
    assert.equal(again.file, a.file, 'a good copy is reused');
    console.log(`APK: ${path.basename(a.file)} ${a.size} B, checksum ok`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
} else {
  console.log('GitHub not reachable from here: live part skipped');
}
console.log('update: all tests passed');
