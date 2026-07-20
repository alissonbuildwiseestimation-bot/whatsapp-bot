const fs = require('fs');
const path = require('path');

const queenPath = path.join(__dirname, '..', 'queen.js');
const txt = fs.readFileSync(queenPath, 'utf8');

const fnCode = txt.slice(txt.indexOf('function _0x128c()'));
const startIdx = fnCode.indexOf('[');
const endIdx = fnCode.indexOf('];_0x128c') + 1;
const arrRaw = fnCode.slice(startIdx, endIdx);

fs.writeFileSync(path.join(__dirname, 'arr.js'), 'module.exports = ' + arrRaw + ';', 'utf8');
const arr = require('./arr.js');

console.log('Total elements in _0x128c array:', arr.length);

arr.forEach((item, idx) => {
    if (typeof item === 'string') {
        if (/anju|xpro|rashmika|proverce|queen|system|online|welcome|connection|developed|expert|professional|status/i.test(item)) {
            console.log(`Index ${idx}:`, JSON.stringify(item));
        }
    }
});
