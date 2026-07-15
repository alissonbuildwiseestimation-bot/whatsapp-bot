const axios = require('axios');

async function testFastdl() {
    const url = 'https://fastdl.zip/embed.php?download=GInVmupPKndZcD9mPLlfxBSdG';
    const referers = [
        'https://nexdrive.fit/',
        'https://vegamovies.navy/',
        'https://vegamovies.mom/',
        'https://fastdl.zip/'
    ];

    for (const ref of referers) {
        console.log(`\nTesting with Referer: ${ref}`);
        try {
            const res = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': ref,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5'
                }
            });
            console.log(`Status: ${res.status}`);
            console.log(`Size: ${res.data.length} bytes`);
            if (res.data.includes('UnAvailable')) {
                console.log('Result: File is Deleted or UnAvailable');
            } else {
                console.log('Result: SUCCESS! Let\'s see a snippet of HTML:');
                console.log(res.data.substring(0, 1000));
            }
        } catch(e) {
            console.log(`Failed: ${e.message}`);
        }
    }
}

testReferers();
