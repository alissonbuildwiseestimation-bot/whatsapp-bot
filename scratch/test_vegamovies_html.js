const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

async function inspectHtml() {
    const url = 'https://vegamovies.mom/?s=deadpool';
    try {
        const response = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        
        console.log('--- Searching for headings and parent hierarchy ---');
        // Let's find headings containing "Deadpool" and print their parent tags and classes
        $('h1, h2, h3, h4').each((i, el) => {
            const text = $(el).text();
            if (text.toLowerCase().includes('deadpool')) {
                console.log(`\nFound heading text: "${text.trim()}"`);
                console.log(`Tag name: ${el.name}`);
                console.log(`Parent tag name: ${el.parent.name}, class: ${$(el.parent).attr('class') || 'none'}`);
                
                // Let's print the parent's outer HTML structure (simplified)
                const outerHtml = $.html($(el).parent().parent().slice(0, 1));
                console.log(`Grandparent structure (first 500 chars):`);
                console.log(outerHtml.substring(0, 800));
            }
        });
    } catch (e) {
        console.error('Inspection failed:', e.message);
    }
}

inspectHtml();
