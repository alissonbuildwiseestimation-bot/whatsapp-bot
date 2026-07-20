const fs = require('fs');
const path = require('path');

const txt = fs.readFileSync(path.join(__dirname, '..', 'queen.js'), 'utf8');

const matches = [...txt.matchAll(/cSQMJ/g)];
console.log('Matches count:', matches.length);

matches.forEach(m => {
    const idx = m.index;
    console.log(txt.slice(Math.max(0, idx - 100), Math.min(txt.length, idx + 100)));
    console.log('====================================');
});
