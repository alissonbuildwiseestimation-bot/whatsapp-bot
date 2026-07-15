const scraper = require('../src/Utils/movie_scraper');

async function testVcloud() {
    const url = 'https://vcloud.zip/0hnnys1eo-uxn-j';
    console.log(`Resolving VCloud Link: ${url}`);
    try {
        const directUrl = await scraper.resolveVcloudLink(url);
        console.log('Resolved direct URL:', directUrl);
    } catch(e) {
        console.error('Failed to resolve VCloud link:', e.message);
    }
}

testVcloud();
