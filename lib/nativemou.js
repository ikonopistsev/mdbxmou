const nativePath = '../build/Release/mdbxmou';
/** @type {import("./types").MDBX_Native} */
const nativeModule = require(nativePath);
// Экспортируем объединенный модуль
module.exports = nativeModule;
