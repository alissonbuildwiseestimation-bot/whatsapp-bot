const fs = require('fs');
const path = require('path');

const youtubeCode = fs.readFileSync(path.join(__dirname, '../src/commands/youtube.js'), 'utf8');

const iifeMatch = youtubeCode.match(/let vVWdb;!function\(\)\{[\s\S]*?\}\(\);/);
if (iifeMatch) {
    const evalCode = `var vVWdb; !function(){ ${iifeMatch[0].replace('let vVWdb;', '')} }(); global.vVWdb = vVWdb;`;
    eval(evalCode);
    
    console.log('L78bb(20):', global.vVWdb.L78bb(20));
    console.log('jsY9(21):', global.vVWdb.jsY9(21));
    console.log('DPQ9(22):', global.vVWdb.DPQ9(22));
    for (let i = 0; i < 60; i++) {
        console.log(`[${i}]:`, global.vVWdb.L78bb(i));
    }
}
