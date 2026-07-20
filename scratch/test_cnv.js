const axios = require('axios');

const gVWoc = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    'Referer': 'https://frame.y2meta-uk.com/',
    'Origin': 'https://frame.y2meta-uk.com',
    'Accept': '*/*'
};

async function downloadYtVideo(ytUrl, quality = '720', format = 'mp4') {
    try {
        console.log('Fetching key from cnv.cx...');
        const keyRes = await axios.get('https://cnv.cx/v2/sanity/key', { headers: gVWoc, timeout: 10000 });
        if (!keyRes.data || !keyRes.data.key) throw new Error('Key fetch failed');
        const apiKey = keyRes.data.key;
        console.log('Got key:', apiKey);

        const params = new URLSearchParams({
            link: ytUrl,
            format: format,
            audioBitrate: '128',
            videoQuality: quality,
            filenameStyle: 'pretty',
            vCodec: 'h264'
        });

        console.log('Sending convert request...');
        const convRes = await axios.post('https://cnv.cx/v2/converter', params.toString(), {
            headers: {
                ...gVWoc,
                'Content-Type': 'application/x-www-form-urlencoded',
                'key': apiKey
            },
            timeout: 15000
        });

        console.log('Converter response:', convRes.data);
        if (convRes.data && convRes.data.url) {
            console.log('✅ Direct Video URL:', convRes.data.url);
            return convRes.data.url;
        } else {
            console.log('❌ No URL in response');
        }
    } catch (e) {
        console.error('cnv.cx error:', e.response?.data || e.message);
    }
}

downloadYtVideo('https://www.youtube.com/watch?v=dfeUzm6KF4g');
