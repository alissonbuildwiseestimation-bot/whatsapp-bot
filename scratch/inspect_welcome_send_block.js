const fs = require('fs');
const path = require('path');

const txt = fs.readFileSync(path.join(__dirname, '..', 'queen.js'), 'utf8');

const matches = [...txt.matchAll(/0x348/g)];
const idx = matches[0].index;

console.log(txt.slice(Math.max(0, idx - 1000), Math.min(txt.length, idx + 1000)));
