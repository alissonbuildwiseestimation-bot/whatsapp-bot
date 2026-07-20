const fs = require('fs');
const path = require('path');

const queenTxt = fs.readFileSync(path.join(__dirname, '..', 'queen.js'), 'utf8');

// Inspect string array in _0x128c
const fnCode = queenTxt.slice(queenTxt.indexOf('function _0x128c()'));
const arrStr = fnCode.slice(fnCode.indexOf('['), fnCode.indexOf('];_0x128c') + 1);
eval('const arr = ' + arrStr + '; global.arr = arr;');

console.log('=== STRING ARRAY MATCHES ===');
global.arr.forEach((s, idx) => {
    if (typeof s === 'string' && /system online|connection success|xpro|rashmika|anju|developed|proverce|queen/i.test(s)) {
        console.log(`_0x128c[${idx}]:`, JSON.stringify(s));
    }
});

// Search raw string literals in queen.js
console.log('\n=== RAW MATCHES IN QUEEN.JS ===');
const matches = [...queenTxt.matchAll(/['"`]([^'"`]{5,300})['"`]/g)].map(m => m[1]);
matches.forEach(s => {
    if (/system online|connection success|xpro|rashmika|anju|developed|proverce|queen/i.test(s)) {
        console.log('Raw:', JSON.stringify(s));
    }
});
