const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function testParse() {
    const url = 'https://vegamovies.mom/?s=deadpool';
    try {
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        
        const results = [];
        $('a.ml-mask').each((i, el) => {
            const link = $(el).attr('href');
            const title = $(el).find('h2').text().trim();
            const img = $(el).find('img').attr('data-original') || $(el).find('img').attr('src');
            if (link && title) {
                results.push({
                    title,
                    link,
                    img
                });
            }
        });

        console.log(`Parsed ${results.length} results:`);
        console.log(JSON.stringify(results.slice(0, 5), null, 2));
    } catch (e) {
        console.error('Parse failed:', e.message);
    }
}

testParse();
