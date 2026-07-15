const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function inspectNexdrive() {
    const url = 'https://nexdrive.fit/genxfm784776493508/';
    try {
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        
        console.log(`Nexdrive page status: ${response.status}`);
        console.log(`Nexdrive page size: ${response.data.length} bytes`);
        
        console.log('All links on Nexdrive landing page:');
        $('a[href]').each((i, el) => {
            console.log(`Text: "${$(el).text().trim()}", Href: "${$(el).attr('href')}"`);
        });

        console.log('All buttons/forms on Nexdrive landing page:');
        $('form').each((i, el) => {
            console.log(`Form action: "${$(el).attr('action')}"`);
            console.log('Inputs:', $(el).find('input').map((_, inp) => `${$(inp).attr('name')}=${$(inp).attr('value')}`).get());
        });

        // Let's print out scripts if there are any
        $('script').each((i, el) => {
            const src = $(el).attr('src');
            const text = $(el).text().trim();
            if (!src && text) {
                console.log(`Script (${text.length} chars):`, text.substring(0, 1000));
            }
        });

    } catch(e) {
        console.error(e);
    }
}

inspectNexdrive();
