var spawnSync = require('child_process').spawnSync;
var fs = require('fs');

function exec(cmd) {
    const { status } = spawnSync(cmd, {
        shell: true,
        stdio: 'inherit',
    });
    if (status !== 0) {
        process.exit(status);
    }
}

// Create VERSION.json for libmdbx (needed for npm package)
const versionFile = 'deps/libmdbx/VERSION.json';
if (!fs.existsSync(versionFile)) {
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

exec("npx cmake-js rebuild --config Release --CDMDBX_TXN_CHECKOWNER=OFF --CDMDBX_BUILD_CXX=ON --CDMDBX_ENABLE_TESTS=OFF --CDMDBX_BUILD_SHARED_LIBRARY=OFF --CDMDBX_BUILD_TOOLS=OFF --CDMDBX_INSTALL_STATIC=ON");
