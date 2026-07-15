const axios = require('axios');
const cheerio = require('cheerio');

async function inspectMomPost() {
    const url = 'https://vegamovies.mom/deadpool-2016-hindi-dubbed-Watch-online-full-movie/';
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        console.log(`Page title: ${$('title').text().trim()}`);
        
        const links = [];
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            const text = $(el).text().trim();
            const parentClass = $(el).parent().attr('class') || '';
            const parentId = $(el).parent().attr('id') || '';
            
            if (href && !href.includes('javascript:') && !href.startsWith('#') && !href.includes('facebook') && !href.includes('twitter') && !href.includes('pinterest')) {
                links.push({ text, href, parentClass, parentId });
            }
        });

        console.log(`Found ${links.length} interesting links.`);
        
        // Let's filter links that contain "watch", "play", "download", "server", "stream" or "embed"
        const filtered = links.filter(l => {
            const t = l.text.toLowerCase();
            const h = l.href.toLowerCase();
            return t.includes('download') || t.includes('server') || t.includes('watch') || t.includes('play') || t.includes('stream') || t.includes('embed') || t.includes('click') || h.includes('download') || h.includes('play') || h.includes('stream') || h.includes('embed') || h.includes('video') || h.includes('server') || h.includes('link') || h.includes('drive');
        });

        console.log('Filtered links (first 50):');
        console.log(filtered.slice(0, 50));

    } catch (e) {
        console.error(e);
    }
}

inspectMomPost();
