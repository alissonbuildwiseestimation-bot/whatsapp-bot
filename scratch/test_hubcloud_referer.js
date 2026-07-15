const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};

async function testReferer() {
    const startUrl = 'https://vcloud.zip/auy9uw4zrywha5n';
    console.log(`Fetching landing page: ${startUrl}`);
    try {
        const res = await axios.get(startUrl, { headers: { ...HEADERS, 'Referer': 'https://nexdrive.fit/' } });
        const $ = cheerio.load(res.data);
        
        const scriptContent = $('script').text() || '';
        const atobRegex = /atob\(\s*atob\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g;
        let match = atobRegex.exec(scriptContent);
        if (match && match[1]) {
            const step1 = Buffer.from(match[1], 'base64').toString('utf8');
            const decodedLink = Buffer.from(step1, 'base64').toString('utf8');
            console.log(`Decoded link: "${decodedLink}"`);
            
            // Fetch decoded page to get HubCloud URL
            const res2 = await axios.get(decodedLink, { headers: { ...HEADERS, 'Referer': startUrl } });
            const $2 = cheerio.load(res2.data);
            
            const hubLinkEl = $2('a:contains("10Gbps")');
            if (hubLinkEl.length > 0) {
                const hubUrl = hubLinkEl.attr('href');
                console.log(`HubCloud URL: ${hubUrl}`);
                
                console.log('\n--- ATTEMPT 1: REFERER = decodedLink ---');
                try {
                    const r1 = await axios.get(hubUrl, {
                        headers: {
                            ...HEADERS,
                            'Referer': decodedLink
                        }
                    });
                    console.log(`Success! Status: ${r1.status}, data length: ${r1.data.length}`);
                } catch(err) {
                    console.log('Failed:', err.message);
                    if (err.response) {
                        console.log(`Response Body: ${String(err.response.data).trim().substring(0, 150)}`);
                    }
                }

                console.log('\n--- ATTEMPT 2: REFERER = startUrl (https://vcloud.zip/auy9uw4zrywha5n) ---');
                try {
                    const r2 = await axios.get(hubUrl, {
                        headers: {
                            ...HEADERS,
                            'Referer': startUrl
                        }
                    });
                    console.log(`Success! Status: ${r2.status}, data length: ${r2.data.length}`);
                } catch(err) {
                    console.log('Failed:', err.message);
                    if (err.response) {
                        console.log(`Response Body: ${String(err.response.data).trim().substring(0, 150)}`);
                    }
                }

                console.log('\n--- ATTEMPT 3: REFERER = https://vcloud.zip/ ---');
                try {
                    const r3 = await axios.get(hubUrl, {
                        headers: {
                            ...HEADERS,
                            'Referer': 'https://vcloud.zip/'
                        }
                    });
                    console.log(`Success! Status: ${r3.status}, data length: ${r3.data.length}`);
                } catch(err) {
                    console.log('Failed:', err.message);
                    if (err.response) {
                        console.log(`Response Body: ${String(err.response.data).trim().substring(0, 150)}`);
                    }
                }
            }
        }
    } catch(e) {
        console.error('Failed:', e.message);
    }
}

testReferer();
