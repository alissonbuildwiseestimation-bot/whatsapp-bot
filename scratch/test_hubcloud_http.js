const axios = require('axios');

const url = 'https://gpdl2.hubcloud.cx/?id=9b5be8fbcda3176610277b7283f3994d66cd1d9ef48ae458e8288727c426df4cd2e3dbc70962702f6e0371f2aa5473d334c9bde83c505e6eefa593ae17b2eea1ed5629b1789245402bd92105c7cf0a38946b08d5281d26477efbb78ecd1970c49e85f3afbba53c803597a41d72f7e8c1::81649519bea7c99801aa2cca596885cd';

async function test() {
    console.log('--- TEST 1: WITHOUT REFERER ---');
    try {
        const res1 = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        console.log(`Test 1 status: ${res1.status}, length: ${res1.data.length} bytes`);
    } catch(e) {
        console.error('Test 1 failed:', e.message);
    }

    console.log('\n--- TEST 2: WITH REFERER vcloud.zip ---');
    try {
        const res2 = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://vcloud.zip/'
            }
        });
        console.log(`Test 2 status: ${res2.status}, length: ${res2.data.length} bytes`);
    } catch(e) {
        console.error('Test 2 failed:', e.message);
    }
}

test();
