const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

const domains = [
    'https://vegamovies.pages.dev',
    'https://vegamovies.navy',
    'https://vegamovies.hot',
    'https://vegamovies.mom',
    'https://vegamovies.dad',
    'https://vegamovies.yt',
    'https://vegamovies.club',
    'https://vegamovies.vip'
];

async function testDomains() {
    for (const domain of domains) {
        console.log(`\nTesting search on domain: ${domain}...`);
        try {
            const searchUrl = `${domain}/?s=deadpool`;
            const response = await axios.get(searchUrl, { headers: HEADERS, timeout: 8000 });
            console.log(`Status: ${response.status}`);
            
            const $ = cheerio.load(response.data);
            const results = [];
            
            $('article, .post-item, .blog-post, .post').each((i, el) => {
                const title = $(el).find('h2, h3, .entry-title a, .post-title a').first().text().trim();
                const link = $(el).find('a').first().attr('href');
                const img = $(el).find('img').first().attr('src');
                if (title && link) {
                    results.push({ title, link, img });
                }
            });

            if (results.length > 0) {
                console.log(`SUCCESS! Found ${results.length} results on ${domain}:`);
                results.slice(0, 3).forEach((r, idx) => {
                    console.log(`  ${idx + 1}. Title: ${r.title}\n     Link: ${r.link}\n     Img: ${r.img}`);
                });
                break; // Stop if we find a working domain
            } else {
                console.log(`No results parsed on ${domain}. HTML size: ${response.data.length} bytes.`);
                // Let's print some markup to see if we can locate posts
                console.log('Heading text:', $('h1, h2').map((_, el) => $(el).text()).get().slice(0, 5));
            }
        } catch (err) {
            console.log(`Failed on ${domain}: ${err.message}`);
        }
    }
}

testDomains();
