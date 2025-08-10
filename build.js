var spawnSync = require('child_process').spawnSync;

function exec(cmd) {
    const { status } = spawnSync(cmd, {
        shell: true,
        stdio: 'inherit',
    });
    process.exit(status);
}

exec("npx cmake-js rebuild --config Release --CDMDBX_TXN_CHECKOWNER=OFF --CDMDBX_BUILD_CXX=OFF --CDMDBX_ENABLE_TESTS=OFF --CDMDBX_BUILD_SHARED_LIBRARY=OFF --CDMDBX_BUILD_TOOLS=OFF --CDMDBX_INSTALL_STATIC=ON");
