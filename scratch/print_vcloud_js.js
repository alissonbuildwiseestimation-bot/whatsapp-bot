const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://nexdrive.fit/'
};

async function test() {
    const startUrl = 'https://vcloud.zip/auy9uw4zrywha5n';
    try {
        const res = await axios.get(startUrl, { headers: HEADERS });
        const $ = cheerio.load(res.data);
        
        const scriptContent = $('script').text() || '';
        const atobRegex = /atob\(\s*atob\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g;
        let match = atobRegex.exec(scriptContent);
        if (match && match[1]) {
            const step1 = Buffer.from(match[1], 'base64').toString('utf8');
            const decodedLink = Buffer.from(step1, 'base64').toString('utf8');
            console.log(`[Test] Decoded link: "${decodedLink}"`);
            
            const res2 = await axios.get(decodedLink, { headers: HEADERS });
            const $2 = cheerio.load(res2.data);
            
            console.log('\n--- ALL INLINE SCRIPTS ---');
            $2('script').each((i, el) => {
                const content = $2(el).text().trim();
                if (content && (content.includes('function') || content.includes('changeLinkinBrave'))) {
                    console.log(`Script ${i + 1}:\n${content}\n`);
                }
            });
        }
    } catch(e) {
        console.error('Failed:', e.message);
    }
}

test();
