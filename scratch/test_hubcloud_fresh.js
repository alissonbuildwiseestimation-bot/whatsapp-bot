const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://nexdrive.fit/'
};

async function testFresh() {
    const startUrl = 'https://vcloud.zip/auy9uw4zrywha5n';
    console.log(`[Test] Fetching fresh landing page: ${startUrl}`);
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
            
            // Fetch decoded page to get fresh 10gbps URL
            const res2 = await axios.get(decodedLink, { headers: HEADERS });
            const $2 = cheerio.load(res2.data);
            
            const hubLinkEl = $2('a:contains("10Gbps")');
            if (hubLinkEl.length === 0) {
                console.log('No 10Gbps link found on decoded page.');
                return;
            }
            
            const hubUrl = hubLinkEl.attr('href');
            console.log(`[Test] Fresh HubCloud URL: "${hubUrl}"`);
            
            const cleanHubUrl = hubUrl.split('::')[0];
            console.log(`[Test] Cleaned HubCloud URL: "${cleanHubUrl}"`);
            
            console.log('\n--- ATTEMPT 1: NO REFERER ---');
            try {
                const r1 = await axios.get(hubUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                console.log(`Success! Status: ${r1.status}, data length: ${r1.data.length}`);
            } catch(err) {
                console.log('Failed:', err.message);
                if (err.response) {
                    console.log('Response Status:', err.response.status);
                    console.log('Response Headers:', err.response.headers);
                    console.log('Response Body:', String(err.response.data).substring(0, 500));
                }
            }
            
            console.log('\n--- ATTEMPT 2: CLEANED URL (NO REFERER) ---');
            try {
                const r2 = await axios.get(cleanHubUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                });
                console.log(`Success! Status: ${r2.status}, data length: ${r2.data.length}`);
            } catch(err) {
                console.log('Failed:', err.message);
            }

            console.log('\n--- ATTEMPT 3: CLEANED URL + REFERER = decodedLink ---');
            try {
                const r3 = await axios.get(cleanHubUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': decodedLink
                    }
                });
                console.log(`Success! Status: ${r3.status}, data length: ${r3.data.length}`);
            } catch(err) {
                console.log('Failed:', err.message);
            }

            console.log('\n--- ATTEMPT 4: CLEANED URL + REFERER = https://vcloud.zip/ ---');
            try {
                const r4 = await axios.get(cleanHubUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://vcloud.zip/'
                    }
                });
                console.log(`Success! Status: ${r4.status}, data length: ${r4.data.length}`);
            } catch(err) {
                console.log('Failed:', err.message);
            }
        }
    } catch(e) {
        console.error('Test failed:', e.message);
    }
}

testFresh();
