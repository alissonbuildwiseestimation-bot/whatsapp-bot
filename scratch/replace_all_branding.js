const fs = require('fs');
const path = require('path');

const queenPath = path.join(__dirname, '..', 'queen.js');
let queenTxt = fs.readFileSync(queenPath, 'utf8');

const fnIdx = queenTxt.indexOf('function _0x128c()');
if (fnIdx === -1) {
    console.error('function _0x128c() not found!');
    process.exit(1);
}

const startIdx = queenTxt.indexOf('[', fnIdx);
const endIdx = queenTxt.indexOf('];_0x128c', fnIdx) + 1;

const arrRaw = queenTxt.slice(startIdx, endIdx);
const arr = eval(arrRaw);

console.log('Original arr length:', arr.length);

arr.forEach((item, idx) => {
    if (typeof item === 'string') {
        let orig = item;
        item = item.replace(/anju-xpro-/g, 'anju-xpro-')
                   .replace(/Anju XPRO/g, 'DanieWatch')
                   .replace(/Queen_/g, 'DanieWatch_')
                   .replace(/Xpro MD/g, 'DanieWatch')
                   .replace(/XPROVERCE MD/gi, 'DanieWatch')
                   .replace(/XPROVERCE/gi, 'DanieWatch')
                   .replace(/𝗫PRO𝚅𝙴𝚁𝙲𝙴/gi, 'DanieWatch')
                   .replace(/𝗫Ｐ𝗥Ｏ𝗩/gi, 'DanieWatch')
                   .replace(/PRO𝚅𝙴𝚁𝙲𝙴/gi, 'DanieWatch')
                   .replace(/𝚀𝚄𝙴𝙴𝙽/g, 'DanieWatch')
                   .replace(/𝙰𝙽𝙹𝚄/g, 'Bot')
                   .replace(/𝗑ᴾᴿᴼ/g, '')
                   .replace(/𝙹𝚄\s*𝗑ᴾᴿᴼ/g, '')
                   .replace(/𝗤𝗨𝗘𝗘𝗡-𝗔𝗡𝗝𝗨/g, 'DanieWatch')
                   .replace(/〽️ᗪ/g, '')
                   .replace(/〽️ᴅ/g, '')
                   .replace(/〽ᗪ/g, '')
                   .replace(/Rashmika/gi, 'Daniyal Aadil')
                   .replace(/RASHMIKA/g, 'DANIYAL AADIL')
                   .replace(/Mr\. Rashmika/gi, 'Daniyal Aadil')
                   .replace(/𝙼𝚁 𝚁𝙰𝚂𝙷𝙼𝙸𝙺/g, 'Daniyal Aadil')
                   .replace(/Expert Professional/gi, 'DanieWatch Downloader')
                   .replace(/Professio/gi, 'DanieWatch')
                   .replace(/query anju/gi, 'daniewatch')
                   .replace(/queen anju/gi, 'DanieWatch')
                   .replace(/𝚚𝚞𝚎𝚎𝚗 𝗮𝗻𝗷𝘂/gi, 'DanieWatch')
                   .replace(/q2kmc\/rash/gi, 'aadil/daniewatch');
        
        if (orig !== item) {
            console.log(`Updated Index ${idx}: ${JSON.stringify(orig)} -> ${JSON.stringify(item)}`);
            arr[idx] = item;
        }
    }
});

const newArrStr = JSON.stringify(arr);
queenTxt = queenTxt.slice(0, startIdx) + newArrStr + queenTxt.slice(endIdx);

// Also do global regex replacements on any remaining raw unescaped or hex escaped strings in queen.js
queenTxt = queenTxt.replace(/© 𝚀𝚄𝙴𝙴𝙽 𝙰𝙽𝙹𝚄 𝗑ᴾᴿᴼ/gi, '© DanieWatch')
                   .replace(/𝗫PRO𝚅𝙴𝚁𝙲𝙴  〽ᗪ/gi, 'DanieWatch Bot')
                   .replace(/XPROVERCE MD/gi, 'DanieWatch Bot')
                   .replace(/Janith Rashmika/gi, 'Daniyal Aadil')
                   .replace(/Mrrashmika/gi, 'Daniyal Aadil')
                   .replace(/Mr\. Rashmika/gi, 'Daniyal Aadil')
                   .replace(/XPROVERCE/gi, 'DanieWatch');

fs.writeFileSync(queenPath, queenTxt, 'utf8');
console.log('Successfully rebranded all string array elements in queen.js!');
