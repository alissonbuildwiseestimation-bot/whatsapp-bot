const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');

const agent = new https.Agent({  
  rejectUnauthorized: false
});

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function testDad() {
    const url = 'https://vegamovies.dad/?s=deadpool';
    try {
        const response = await axios.get(url, { 
            headers: HEADERS,
            httpsAgent: agent,
            timeout: 10000 
        });
        const $ = cheerio.load(response.data);
        
        console.log(`Dad page status: ${response.status}`);
        console.log(`Dad page size: ${response.data.length} bytes`);
        
        const results = [];
        // Let's look for standard WordPress search result items (often in articles)
        $('article').each((i, el) => {
            const title = $(el).find('h2, h3, .entry-title a').first().text().trim();
            const link = $(el).find('a').first().attr('href');
            const img = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || $(el).find('img').first().attr('data-lazy-src');
            if (title && link) {
                results.push({ title, link, img });
            }
        });

        console.log(`Found ${results.length} results:`);
        results.slice(0, 5).forEach((r, idx) => {
            console.log(`  ${idx + 1}. Title: ${r.title}\n     Link: ${r.link}\n     Img: ${r.img}`);
        });

        if (results.length === 0) {
            // Let's print out some HTML snippets or a[href] to see if it's styled differently
            const hrefs = [];
            $('a[href]').each((i, el) => {
                hrefs.push({ text: $(el).text().trim(), href: $(el).attr('href') });
            });
            console.log('Sample links:', hrefs.slice(0, 30));
        }

    } catch(e) {
        console.error('Dad test failed:', e.message);
    }
}

testDad();
