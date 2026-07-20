const axios = require('axios');

async function testApis() {
    const ytUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    
    const apis = [
        {
            name: 'vreden',
            fn: async () => {
                const res = await axios.get(`https://api.vreden.web.id/api/ytmp4?url=${encodeURIComponent(ytUrl)}`, { timeout: 10000 });
                return res.data?.result?.download?.url || res.data?.result?.url;
            }
        },
        {
            name: 'siputzx',
            fn: async () => {
                const res = await axios.get(`https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(ytUrl)}`, { timeout: 10000 });
                return res.data?.data?.dl || res.data?.data?.url;
            }
        },
        {
            name: 'agatz',
            fn: async () => {
                const res = await axios.get(`https://api.agatz.xyz/api/ytmp4?url=${encodeURIComponent(ytUrl)}`, { timeout: 10000 });
                return res.data?.data?.url || res.data?.data?.dl;
            }
        },
        {
            name: 'dreaded',
            fn: async () => {
                const res = await axios.get(`https://api.dreaded.site/api/ytdl/video?url=${encodeURIComponent(ytUrl)}`, { timeout: 10000 });
                return res.data?.result?.downloadUrl || res.data?.result?.url;
            }
        },
        {
            name: 'coyd',
            fn: async () => {
                const res = await axios.get(`https://api.ytdl.co.uk/download?url=${encodeURIComponent(ytUrl)}`, { timeout: 10000 });
                return res.data;
            }
        },
        {
            name: 'cobalt-public',
            fn: async () => {
                const res = await axios.post('https://cobalt-api.kwiatekmomenty.pl/', {
                    url: ytUrl,
                    videoQuality: '720'
                }, {
                    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                    timeout: 10000
                });
                return res.data?.url;
            }
        }
    ];

    for (const api of apis) {
        try {
            console.log(`Testing ${api.name}...`);
            const url = await api.fn();
            if (url) {
                console.log(`✅ ${api.name} SUCCESS:`, url.substring(0, 100));
            } else {
                console.log(`❌ ${api.name} returned empty.`);
            }
        } catch (e) {
            console.log(`❌ ${api.name} FAILED:`, e.message);
        }
    }
}

testApis();
