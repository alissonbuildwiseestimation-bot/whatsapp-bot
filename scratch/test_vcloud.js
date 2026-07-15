const axios = require('axios');
const cheerio = require('cheerio');
const { extractSubOptions } = require('../src/Utils/movie_scraper');

async function test() {
    const url = 'https://vcloud.zip/auy9uw4zrywha5n';
    try {
        console.log('Resolving sub-options for:', url);
        const options = await extractSubOptions(url);
        console.log('--- EXTRACTED OPTIONS ---');
        console.log(JSON.stringify(options, null, 2));
    } catch (err) {
        console.error('Error:', err.message);
    }
}

test();
