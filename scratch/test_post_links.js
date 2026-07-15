const axios = require('axios');
const cheerio = require('cheerio');
const scraper = require('../src/Utils/movie_scraper');

async function testPostLinks() {
    const url = 'https://vegamovies.navy/download-see-you-at-work-tomorrow-season-1-hindi-dubbed-series-480p-720p-1080p-web-dl/';
    console.log(`Scraping post page: ${url}`);
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        const links = [];
        const contentSelector = 'main.page-body, .page-body, .entry-content, #main-content';
        
        $(contentSelector).find('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            const linkText = $(el).text().trim();

            if (!href || href.trim() === '/' || href.startsWith('#') || href.includes('imdb.com') || href.includes('youtube.com') || href.includes('telegram') || href.includes('facebook') || href.includes('twitter')) {
                return;
            }

            const lowerHref = href.toLowerCase();
            if (lowerHref.includes('/category/') || lowerHref.includes('/tag/') || lowerHref.includes('/genre/') || lowerHref.includes('?s=') || lowerHref.includes('/author/')) {
                return;
            }

            const hasButton = $(el).find('button, .dwd-button, .btn').length > 0 || $(el).hasClass('btn') || $(el).hasClass('dwd-button');
            const hasDwdKeyword = linkText.toLowerCase().includes('download') || 
                                 linkText.toLowerCase().includes('click here') || 
                                 linkText.toLowerCase().includes('v-cloud') || 
                                 linkText.toLowerCase().includes('g-direct') ||
                                 lowerHref.includes('nexdrive') || 
                                 lowerHref.includes('vgmlink') || 
                                 lowerHref.includes('gdflix') || 
                                 lowerHref.includes('fastdl') || 
                                 lowerHref.includes('filebee');

            if (!hasButton && !hasDwdKeyword) {
                return;
            }

            let precedingHeading = '';
            let prev = $(el).closest('p, div').prev();
            while (prev.length && !/^h[1-6]$/i.test(prev[0].name)) {
                prev = prev.prev();
            }
            if (prev.length) {
                precedingHeading = prev.text();
            }

            const combinedText = `${linkText} ${precedingHeading}`.toLowerCase();
            let resolution = 'Unknown';
            if (combinedText.includes('2160p') || combinedText.includes('4k')) {
                resolution = '2160p';
            } else if (combinedText.includes('1080p')) {
                resolution = '1080p';
            } else if (combinedText.includes('720p')) {
                resolution = '720p';
            } else if (combinedText.includes('480p')) {
                resolution = '480p';
            }

            links.push({ text: linkText, href, resolution, precedingHeading: precedingHeading.trim() });
        });

        console.log(`Found ${links.length} total links:`);
        links.forEach((l, i) => {
            console.log(`[${i + 1}] Resolution: ${l.resolution}`);
            console.log(`    Heading: ${l.precedingHeading}`);
            console.log(`    Text: ${l.text}`);
            console.log(`    Url: ${l.href}`);
        });

    } catch (e) {
        console.error('Test failed:', e.message);
    }
}

testPostLinks();
