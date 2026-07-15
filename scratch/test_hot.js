const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function testHot() {
    const url = 'https://vegamovies.hot/?s=deadpool';
    try {
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        
        console.log(`Hot page status: ${response.status}`);
        console.log(`Hot page size: ${response.data.length} bytes`);
        
        const results = [];
        // Let's find links inside search results. Typically they are articles or custom grids.
        // Let's list all links in the page content first to understand selectors.
        const hrefs = [];
        $('a[href]').each((i, el) => {
            hrefs.push({ text: $(el).text().trim(), href: $(el).attr('href'), class: $(el).attr('class') });
        });
        console.log('Total links found:', hrefs.length);
        console.log('Sample links (first 50):');
        console.log(hrefs.slice(0, 50));
        
        console.log('Looking for post links (href contains download or /download-):');
        const postLinks = hrefs.filter(h => h.href && h.href.includes('/download-'));
        console.log(postLinks.slice(0, 10));

    } catch(e) {
        console.error('Hot test failed:', e.message);
    }
}

testHot();
