const axios = require('axios');
const cheerio = require('cheerio');

async function testContainer() {
    const url = 'https://vegamovies.mom/deadpool-2016-hindi-dubbed-Watch-online-full-movie/';
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        console.log('Main div classes/ids:');
        $('div').each((i, el) => {
            const id = $(el).attr('id');
            const cls = $(el).attr('class');
            if (id || cls) {
                if (cls && (cls.includes('content') || cls.includes('body') || cls.includes('post') || cls.includes('entry'))) {
                    console.log(`Div - id: ${id || 'none'}, class: ${cls}`);
                }
            }
        });

        // Let's print out all a[href] inside the page to see if there are any download links
        const hrefs = [];
        $('a[href]').each((i, el) => {
            hrefs.push({ text: $(el).text().trim(), href: $(el).attr('href') });
        });
        console.log(`Found ${hrefs.length} total hrefs.`);
        console.log('Sample hrefs (first 30):');
        console.log(hrefs.slice(0, 30));

        console.log('Sample download hrefs:');
        console.log(hrefs.filter(h => h.href.includes('download') || h.href.includes('vgmlink') || h.href.includes('gdflix') || h.href.includes('nexdrive')));
    } catch(e) {
        console.error(e);
    }
}

testContainer();
