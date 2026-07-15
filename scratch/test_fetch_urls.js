const axios = require('axios');

const url1 = "https://pub-f4ba9fb2017042968ec12c06f4b42344.r2.dev/f89dcad128acf340960ba71c64b4b3da?token=1784097413124";
const url2 = "https://556138dca7367763ed46eecaa4284eca.r2.cloudflarestorage.com/hub2/Little.House.on.the.Prairie.S01.480p.WEB-DL.HIN-ENG.x264.ESub-Vegamovies.hot.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=26b6cf8a0399b5880643f585c8c3dbe5%2F20260715%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260715T063653Z&X-Amz-Expires=10800&X-Amz-SignedHeaders=host&response-content-disposition=Little.House.on.the.Prairie.S01.480p.WEB-DL.HIN-ENG.x264.ESub-Vegamovies.hot.zip&X-Amz-Signature=2dc81e04f52a7ffc280158437a4b81a6861e62406ccd4dd58dc5a30d6cd81195";

async function testFetch(url) {
    try {
        console.log(`\nFetching: ${url.substring(0, 100)}...`);
        const parsedUrl = new URL(url);
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': parsedUrl.origin + '/',
                'Origin': parsedUrl.origin
            },
            timeout: 10000 // 10s for testing
        });
        console.log('Status:', response.status);
        console.log('Headers:', response.headers);
    } catch (err) {
        console.error('Fetch failed:', err.message);
        if (err.response) {
            console.error('Response Status:', err.response.status);
            console.error('Response Data:', err.response.data);
        }
    }
}

async function run() {
    await testFetch(url1);
    await testFetch(url2);
}

run();
