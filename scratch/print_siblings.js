const axios = require('axios');
const cheerio = require('cheerio');

async function printSiblings() {
    const url = 'https://vegamovies.navy/download-obsession-2026-hindi-dubbed-org-dd5-1-480p-720p-1080p-2160p-4k-amazon-prime/';
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        const content = $('main.page-body, .page-body, .entry-content, #main-content, div.content-kuss, div.content-area');
        content.find('a[href*="nexdrive.fit"]').each((i, el) => {
            console.log(`\n--- Button ${i + 1} SIBLINGS ---`);
            const parent = $(el).parent();
            console.log(`Parent tag: ${parent[0].name}, html: ${parent.html().substring(0, 150)}`);
            
            // Let's get the siblings around parent
            parent.prevAll().slice(0, 4).each((j, sib) => {
                console.log(`  Prev ${j+1}: <${sib.name}> -> "${$(sib).text().trim()}"`);
            });
        });
    } catch(e) {
        console.error(e);
    }
}
printSiblings();
