const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://nexdrive.fit/'
};

async function inspectVcloud() {
    const url = 'https://vcloud.zip/auy9uw4zrywha5n';
    console.log(`Fetching vcloud: ${url}`);
    try {
        const res = await axios.get(url, { headers: HEADERS });
        const $ = cheerio.load(res.data);
        
        console.log(`Page title: "${$('title').text().trim()}"`);
        
        const scriptContent = $('script').text() || '';
        const varUrlRegex = /var\s+url\s*=\s*['"]([^'"]+)['"]/i;
        const matchVar = varUrlRegex.exec(scriptContent);
        if (matchVar) {
            console.log(`Found var url in script: "${matchVar[1]}"`);
            
            const nextUrl = matchVar[1].startsWith('http') ? matchVar[1] : `https://vcloud.zip${matchVar[1]}`;
            console.log(`Fetching next page: ${nextUrl}`);
            const res2 = await axios.get(nextUrl, { headers: HEADERS });
            const $2 = cheerio.load(res2.data);
            
            console.log('\nAll anchors on next page:');
            $2('a').each((i, el) => {
                console.log(`Anchor ${i + 1}: Text: "${$2(el).text().trim()}", Href: "${$2(el).attr('href')}"`);
            });
        } else {
            console.log('No var url found in script.');
            console.log('\nAll anchors on first page:');
            $('a').each((i, el) => {
                console.log(`Anchor ${i + 1}: Text: "${$(el).text().trim()}", Href: "${$(el).attr('href')}"`);
            });
        }
    } catch (e) {
        console.error('Failed:', e.message);
    }
}

inspectVcloud();
