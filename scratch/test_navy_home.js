const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function testNavyHome() {
    const url = 'https://vegamovies.navy';
    try {
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        
        console.log(`Navy home status: ${response.status}`);
        console.log(`Navy home size: ${response.data.length} bytes`);
        
        const hrefs = [];
        $('a[href]').each((i, el) => {
            hrefs.push({ text: $(el).text().trim(), href: $(el).attr('href'), class: $(el).attr('class') });
        });
        console.log('Total links found on home:', hrefs.length);
        console.log('Sample links (first 50):');
        console.log(hrefs.slice(0, 50));

    } catch(e) {
        console.error('Navy home failed:', e.message);
    }
}

testNavyHome();
