const axios = require('axios');
const cheerio = require('cheerio');

async function dumpMomText() {
    const url = 'https://vegamovies.mom/deadpool-2016-hindi-dubbed-Watch-online-full-movie/';
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        console.log('--- Dumping all page text inside div.mvi-content ---');
        console.log($('.mvi-content').text().replace(/\s+/g, ' ').trim().substring(0, 1500));
        
        console.log('\n--- Dumping all links inside div.mvi-content ---');
        $('.mvi-content a[href]').each((i, el) => {
            console.log(`Text: "${$(el).text().trim()}", Href: "${$(el).attr('href')}"`);
        });

    } catch (e) {
        console.error(e);
    }
}

dumpMomText();
