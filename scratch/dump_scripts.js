const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function dumpScripts() {
    const url = 'https://vegamovies.navy/?s=deadpool';
    try {
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        
        console.log('--- Printing all Script Tags ---');
        $('script').each((i, el) => {
            const src = $(el).attr('src');
            const text = $(el).text().trim();
            if (src) {
                console.log(`Script src: ${src}`);
            } else {
                console.log(`Inline Script (${text.length} chars):`);
                console.log(text.substring(0, 1000));
            }
        });
    } catch(e) {
        console.error(e);
    }
}

dumpScripts();
