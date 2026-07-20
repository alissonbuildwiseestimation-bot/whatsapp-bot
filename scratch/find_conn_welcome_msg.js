const fs = require('fs');
const path = require('path');

const txt = fs.readFileSync(path.join(__dirname, '..', 'queen.js'), 'utf8');

// Find connectToWA function in queen.js
const connIdx = txt.indexOf('async function connectToWA()');
if (connIdx !== -1) {
    const fnBody = txt.slice(connIdx, connIdx + 5000);
    console.log(fnBody);
}
