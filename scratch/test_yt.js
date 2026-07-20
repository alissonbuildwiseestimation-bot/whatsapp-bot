const path = require('path');

async function test() {
    try {
        const ruhend = require(path.join(__dirname, '../node_modules/ruhend-scraper'));
        console.log('ruhend keys:', Object.keys(ruhend));
        const res = await ruhend.ytmp4('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        console.log('ruhend ytmp4:', res);
    } catch (e) {
        console.error('ruhend err:', e.message);
    }

    try {
        const dylux = require(path.join(__dirname, '../node_modules/api-dylux'));
        console.log('dylux keys:', Object.keys(dylux));
        const res2 = await dylux.ytmp4('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        console.log('dylux ytmp4:', res2);
    } catch (e) {
        console.error('dylux err:', e.message);
    }
}

test();
