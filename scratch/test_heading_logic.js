const axios = require('axios');
const cheerio = require('cheerio');

async function testHeadingLogic() {
    const url = 'https://vegamovies.navy/download-obsession-2026-hindi-dubbed-org-dd5-1-480p-720p-1080p-2160p-4k-amazon-prime/';
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        $('a[href*="nexdrive.fit"]').each((i, el) => {
            let precedingHeading = '';
            let prev = $(el).parent();
            while (prev.length && prev[0].name !== 'p' && prev[0].name !== 'div' && prev[0].name !== 'body') {
                prev = prev.parent();
            }
            if (prev.length && prev[0].name !== 'body') {
                let sib = prev.prev();
                while (sib.length) {
                    const tagName = sib[0].name.toLowerCase();
                    const text = sib.text().trim();
                    if (/^h[1-6]$/.test(tagName) || (tagName === 'p' && text && text !== 'Download Now' && !text.toLowerCase().includes('click here') && !text.toLowerCase().includes('download'))) {
                        if (text && !text.includes('Quality') && !text.includes('Audio')) {
                            precedingHeading = text;
                            break;
                        }
                    }
                    sib = sib.prev();
                }
            }
            console.log(`Button ${i + 1} Href: ${$(el).attr('href')} -> Heading: "${precedingHeading}"`);
        });
    } catch(e) {
        console.error(e);
    }
}

testHeadingLogic();
