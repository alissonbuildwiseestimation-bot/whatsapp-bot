const axios = require('axios');
const cheerio = require('cheerio');

async function checkHeadings() {
    const url = 'https://vegamovies.navy/download-obsession-2026-hindi-dubbed-org-dd5-1-480p-720p-1080p-2160p-4k-amazon-prime/';
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        $('a[href*="nexdrive.fit"]').each((i, el) => {
            console.log(`\n--- Button ${i + 1} ---`);
            console.log(`Href: ${$(el).attr('href')}`);
            console.log(`Text: "${$(el).text().trim()}"`);
            
            // Let's print the parent paragraph text
            const parent = $(el).parent();
            console.log(`Parent tag: ${parent[0].name}, text: "${parent.text().replace(/\s+/g, ' ').trim()}"`);
            
            // Let's print preceding elements
            let prev = parent.prev();
            let count = 0;
            while (prev.length && count < 3) {
                console.log(`  Prev ${count + 1} tag: ${prev[0].name}, text: "${prev.text().replace(/\s+/g, ' ').trim()}"`);
                prev = prev.prev();
                count++;
            }
        });
    } catch(e) {
        console.error(e);
    }
}

checkHeadings();
