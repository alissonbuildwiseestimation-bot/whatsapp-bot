const axios = require('axios');

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://vegamovies.navy/'
};

async function testNavyApi() {
    const url = 'https://vegamovies.navy/search.php?q=deadpool&page=1';
    console.log(`Querying API: ${url}`);
    try {
        const response = await axios.get(url, { headers: HEADERS });
        console.log(`Status: ${response.status}`);
        console.log('JSON Output (first 3 items):');
        if (response.data && response.data.hits) {
            console.log(`Found: ${response.data.found} items`);
            console.log(JSON.stringify(response.data.hits.slice(0, 3), null, 2));
        } else {
            console.log('Unexpected response:', response.data);
        }
    } catch(e) {
        console.error('API Query failed:', e.message);
        if (e.response) {
            console.log('Response body:', e.response.data);
        }
    }
}

testNavyApi();
