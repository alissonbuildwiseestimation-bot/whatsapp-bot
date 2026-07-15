const axios = require('axios');
const cheerio = require('cheerio');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://nexdrive.fit/'
};

async function testAll() {
    const urls = [
        { ep: 'Episode 1', url: 'https://vcloud.zip/auy9uw4zrywha5n' },
        { ep: 'Episode 2', url: 'https://vcloud.zip/t5hbst5xxb2qbqn' },
        { ep: 'Episode 3', url: 'https://vcloud.zip/xgslcgjppflzffi' },
        { ep: 'Episode 4', url: 'https://vcloud.zip/vljimgfizlbs7cf' },
        { ep: 'Episode 5', url: 'https://vcloud.zip/op2h0p01ehpi05o' },
        { ep: 'Episode 6', url: 'https://vcloud.zip/ob17-htinom3jms' }
    ];

    for (const item of urls) {
        console.log(`\n========================================`);
        console.log(`Testing ${item.ep}: ${item.url}`);
        try {
            const res = await axios.get(item.url, { headers: HEADERS });
            const $ = cheerio.load(res.data);
            const scriptContent = $('script').text() || '';
            const atobRegex = /atob\(\s*atob\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g;
            let match = atobRegex.exec(scriptContent);
            if (match && match[1]) {
                const step1 = Buffer.from(match[1], 'base64').toString('utf8');
                const decodedLink = Buffer.from(step1, 'base64').toString('utf8');
                
                const res2 = await axios.get(decodedLink, { headers: HEADERS });
                const $2 = cheerio.load(res2.data);
                const hubLinkEl = $2('a:contains("10Gbps")');
                if (hubLinkEl.length > 0) {
                    const hubUrl = hubLinkEl.attr('href');
                    console.log(`Fresh HubCloud URL: ${hubUrl}`);
                    
                    // Request the hub url
                    try {
                        const hRes = await axios.get(hubUrl, { headers: HEADERS });
                        console.log(`HubCloud Request Status: ${hRes.status}, data length: ${hRes.data.length}`);
                    } catch(err) {
                        console.log(`HubCloud Request Failed: ${err.message}`);
                        if (err.response) {
                            console.log(`Response Body: ${String(err.response.data).trim().substring(0, 150)}`);
                        }
                    }
                } else {
                    console.log('No 10Gbps link on this page.');
                }
            } else {
                console.log('No double atob match found.');
            }
        } catch(e) {
            console.error(`Failed: ${e.message}`);
        }
    }
}

testAll();
