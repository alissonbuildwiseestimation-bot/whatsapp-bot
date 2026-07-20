const fs = require('fs');
const path = require('path');

const youtubeCode = fs.readFileSync(path.join(__dirname, '../src/commands/youtube.js'), 'utf8');

const iifeMatch = youtubeCode.match(/let vVWdb;!function\(\)\{[\s\S]*?\}\(\);/);
if (iifeMatch) {
    const evalCode = `var vVWdb; !function(){ ${iifeMatch[0].replace('let vVWdb;', '')} }(); global.vVWdb = vVWdb;`;
    eval(evalCode);
    
    const results = {};
    for (let i = 0; i < 200; i++) {
        for (let method of ['nB7ab', 'L5Bbb', 'jyzbb', 'bqWbb', 'L78bb', 'jsY9', 'DPQ9', 'bklab']) {
            try {
                const str = global.vVWdb[method](i);
                if (str && typeof str === 'string') {
                    results[`${method}(${i})`] = str;
                }
            } catch (e) {}
        }
    }
    console.log('Decoded strings:', JSON.stringify(results, null, 2));
}
