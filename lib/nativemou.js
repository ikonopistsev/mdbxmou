const os = require('os');

const nativePath = '../build/Release/mdbxmou';
const nativeModule = require(nativePath);
// Экспортируем объединенный модуль
module.exports = nativeModule;
