const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function testNavy() {
    const url = 'https://vegamovies.navy/?s=deadpool';
    try {
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        
        console.log(`Navy page status: ${response.status}`);
        console.log(`Navy page size: ${response.data.length} bytes`);
        
        console.log('Search Results page structure:');
        console.log('All links inside content:');
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
        console.error('Navy test failed:', e.message);
    }
}

testNavy();
