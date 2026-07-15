const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://nexdrive.fit/'
};

async function search() {
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
            
            const res2 = await axios.get(decodedLink, { headers: HEADERS });
            const $2 = cheerio.load(res2.data);
            
            // Search all inline scripts
            console.log('Searching inline scripts...');
            $2('script').each((i, el) => {
                const text = $2(el).text();
                if (text.includes('changeLinkinBrave')) {
                    console.log(`Found changeLinkinBrave in inline script ${i + 1}`);
                }
            });

            // Search external scripts
            const extScripts = [];
            $2('script[src]').each((_, el) => {
                const src = $2(el).attr('src');
                if (src && !src.includes('google') && !src.includes('jquery') && !src.includes('bootstrap') && !src.includes('popper')) {
                    extScripts.push(src.startsWith('http') || src.startsWith('//') ? src : `https://vcloud.zip${src}`);
                }
            });

            for (let src of extScripts) {
                if (src.startsWith('//')) src = 'https:' + src;
                console.log(`Fetching external script: ${src}`);
                try {
                    const sRes = await axios.get(src, { headers: HEADERS });
                    if (sRes.data.includes('changeLinkinBrave')) {
                        console.log(`FOUND changeLinkinBrave in external script: ${src}`);
                        // Print the definition
                        const idx = sRes.data.indexOf('changeLinkinBrave');
                        console.log(sRes.data.substring(Math.max(0, idx - 100), Math.min(sRes.data.length, idx + 1000)));
                    }
                } catch(e) {
                    console.error(`Failed to fetch ${src}:`, e.message);
                }
            }
        }
    } catch(e) {
        console.error(e);
    }
}

search();
