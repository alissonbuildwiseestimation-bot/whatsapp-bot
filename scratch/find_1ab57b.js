const fs = require('fs');
const path = require('path');

const txt = fs.readFileSync(path.join(__dirname, '..', 'queen.js'), 'utf8');

const matches = [...txt.matchAll(/0x1ab57b/g)];
console.log('0x1ab57b matches count:', matches.length);

matches.forEach(m => {
    const idx = m.index;
    console.log(txt.slice(Math.max(0, idx - 150), Math.min(txt.length, idx + 150)));
    console.log('====================================');
});
