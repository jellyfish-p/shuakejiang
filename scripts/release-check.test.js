const assert = require('assert/strict');
const { checkReleaseVersion } = require('./release-check');

const header = version => `// ==UserScript==\n// @name Test\n// @version ${version}\n// ==/UserScript==`;
const base = () => ({ packageVersion: '2.2.0', header: header('2.2.0'), userscript: header('2.2.0') + '\n(function () {})();' });
let count = 0;
function test(name, run) { run(); count++; console.log('✅ ' + name); }

test('main CI checks consistent versions without requiring a tag', () => {
  assert.equal(checkReleaseVersion(base()), '2.2.0');
});

test('matching vX.Y.Z tag passes the release gate', () => {
  assert.equal(checkReleaseVersion({ ...base(), tag: 'v2.2.0' }), '2.2.0');
});

test('multi-digit and zero components are valid stable versions', () => {
  const version = '10.0.123';
  assert.equal(checkReleaseVersion({ packageVersion: version, header: header(version), userscript: header(version), tag: 'v' + version }), version);
});

for (const tag of ['v2.2.1', 'v1.0.0']) {
  test('different version tag is rejected: ' + tag, () => {
    assert.throws(() => checkReleaseVersion({ ...base(), tag }), /不一致/);
  });
}

for (const tag of ['2.2.0', 'v2.2', 'v02.2.0', 'v2.2.0-rc.1', 'v2.2.0+build.1', 'v2.2.0;echo unsafe', 'v2.2.0\n', 'v*']) {
  test('invalid or unsupported tag is rejected: ' + JSON.stringify(tag), () => {
    assert.throws(() => checkReleaseVersion({ ...base(), tag }), /仅支持/);
  });
}

for (const packageVersion of [undefined, 220, '02.2.0', '2.2.0-rc.1', '2.2.0\n']) {
  test('invalid package version is rejected: ' + JSON.stringify(packageVersion), () => {
    assert.throws(() => checkReleaseVersion({ ...base(), packageVersion }), /package.json/);
  });
}

for (const field of ['header', 'userscript']) {
  test(field + ' version mismatch is rejected', () => {
    assert.throws(() => checkReleaseVersion({ ...base(), [field]: header('2.1.4') }), /不一致/);
  });
  test(field + ' missing metadata is rejected', () => {
    assert.throws(() => checkReleaseVersion({ ...base(), [field]: '// @version 2.2.0' }), /元数据/);
  });
  test(field + ' duplicate version fields are rejected', () => {
    assert.throws(() => checkReleaseVersion({ ...base(), [field]: header('2.2.0').replace('// @name Test', '// @version 2.2.0') }), /只能/);
  });
}

test('only the leading userscript metadata is checked, not embedded vendor versions', () => {
  assert.equal(checkReleaseVersion({ ...base(), userscript: header('2.2.0') + '\n' + header('1.0') }), '2.2.0');
});

test('a metadata-like block after executable code cannot substitute for the public header', () => {
  assert.throws(() => checkReleaseVersion({ ...base(), userscript: 'console.log(1);\n' + header('2.2.0') }), /元数据/);
});

test('CRLF and a leading BOM do not change the declared version', () => {
  assert.equal(checkReleaseVersion({ ...base(), userscript: '\uFEFF' + header('2.2.0').replaceAll('\n', '\r\n'), tag: 'v2.2.0' }), '2.2.0');
});

test('a version-looking string outside the public metadata cannot fill a missing field', () => {
  assert.throws(() => checkReleaseVersion({ ...base(), userscript: header('2.2.0').replace('// @version 2.2.0\n', '') + '\n' + header('2.2.0') }), /只能/);
});

console.log(`Release version checks passed (${count} cases).`);
