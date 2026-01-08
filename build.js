
var spawnSync = require('child_process').spawnSync;
var fs = require('fs');
var path = require('path');

function exec(cmd) {
    const { status } = spawnSync(cmd, {
        shell: true,
        stdio: 'inherit',
    });
    if (status !== 0) {
        process.exit(status);
    }
}

// Create VERSION.json for libmdbx (needed for npm packages, which don't ship git metadata).
// In a git checkout/submodule we must NOT create it, since libmdbx rejects multiple version sources.
const versionFile = 'deps/libmdbx/VERSION.json';
const libmdbxGitMarker = 'deps/libmdbx/.git';
if (!fs.existsSync(libmdbxGitMarker) && !fs.existsSync(versionFile)) {
    console.log('Creating VERSION.json for libmdbx...');
    const versionJson = {
        "git_describe": "v0.13.7",
        "git_timestamp": "2025-07-30T12:00:00Z",
        "git_tree": "npm-package",
        "git_commit": "npm-package",
        "semver": "0.13.7"
    };
    fs.writeFileSync(versionFile, JSON.stringify(versionJson, null, 2));
    console.log('VERSION.json created successfully!');
}

// Workaround for npm package: npm does not ship git metadata, while libmdbx
// may rely on it to determine version info during CMake configure.
// Apply this patch only when git metadata is missing.
const cmakeFile = 'deps/libmdbx/CMakeLists.txt';
if (!fs.existsSync(libmdbxGitMarker) && fs.existsSync(cmakeFile)) {
    const cmakeText = fs.readFileSync(cmakeFile, 'utf8');
    const from = 'if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/.git"';
    const to = 'if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/.git"';
    if (cmakeText.includes(from)) {
        const patched = cmakeText.replace(from, to);
        if (patched !== cmakeText) {
            fs.writeFileSync(cmakeFile, patched);
            console.log('Patched libmdbx CMakeLists.txt for npm package (no .git).');
        }
    }
}

exec("npx cmake-js rebuild --config Release --CDMDBX_TXN_CHECKOWNER=OFF --CDMDBX_BUILD_CXX=ON --CDMDBX_ENABLE_TESTS=OFF --CDMDBX_BUILD_SHARED_LIBRARY=OFF --CDMDBX_BUILD_TOOLS=OFF --CDMDBX_INSTALL_STATIC=ON");
