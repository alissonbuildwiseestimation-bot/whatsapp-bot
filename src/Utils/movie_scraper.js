const axios = require('axios');
const cheerio = require('cheerio');

const TMDB_API_KEY = process.env.TMDB_API_KEY || 'fc6d85b3839330e3458701b975195487';

// Common User-Agent to bypass simple blocks
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
};

/**
 * Clean up title by removing tags and year
 */
function cleanTitle(title) {
    if (!title) return '';
    return title
        .replace(/^download\s+/i, '')
        .replace(/\s*\(\s*season\s+.*?\)/gi, '')
        .replace(/\s*\(\s*\d{4}\s*\)/g, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\b(480p|720p|1080p|2160p|dual|multi|hindi|english|dubbed|subbed|esub|org)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fetch movie/series metadata from TMDB using IMDb ID or search query
 */
async function fetchTmdbMetadata(query, mediaType = 'movie', imdbId = null) {
    try {
        let details = null;

        // 1. If IMDb ID is available, look it up directly
        if (imdbId && /^tt\d+$/.test(imdbId)) {
            const url = `https://api.themoviedb.org/3/find/${imdbId}?external_source=imdb_id&api_key=${TMDB_API_KEY}`;
            const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
            if (res.data) {
                const results = res.data.movie_results || [];
                const tvResults = res.data.tv_results || [];
                if (results.length > 0) {
                    details = { ...results[0], media_type: 'movie' };
                } else if (tvResults.length > 0) {
                    details = { ...tvResults[0], media_type: 'tv' };
                }
            }
        }

        // 2. Fallback to keyword search
        if (!details && query) {
            const cleanQuery = cleanTitle(query);
            const url = `https://api.themoviedb.org/3/search/multi?query=${encodeURIComponent(cleanQuery)}&api_key=${TMDB_API_KEY}`;
            const res = await axios.get(url, { headers: HEADERS, timeout: 10000 });
            if (res.data && res.data.results && res.data.results.length > 0) {
                details = res.data.results.find(r => r.media_type === 'movie' || r.media_type === 'tv');
            }
        }

        if (!details) return null;

        const isTv = details.media_type === 'tv';
        const tmdbId = details.id;
        const title = details.title || details.name || '';
        const overview = details.overview || '';
        const posterUrl = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : null;
        const releaseDate = details.release_date || details.first_air_date || '';
        const year = releaseDate ? releaseDate.split('-')[0] : 'N/A';
        const genres = details.genre_ids ? details.genre_ids.map(id => getGenreName(id)).filter(Boolean).join(', ') : 'Unknown';

        return {
            tmdbId,
            title,
            year,
            overview,
            genres,
            posterUrl,
            type: details.media_type,
            releaseDate
        };
    } catch (err) {
        console.error('[MovieScraper] TMDB fetch failed:', err.message);
        return null;
    }
}

function getGenreName(id) {
    const genreMap = {
        28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
        99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
        27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
        10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western', 10759: 'Action & Adventure',
        10762: 'Kids', 10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap',
        10767: 'Talk', 10768: 'War & Politics'
    };
    return genreMap[id] || null;
}

/**
 * Scrape a post page on Vegamovies, Rogmovies, or HDHub4u
 */
async function scrapePostPage(url) {
    try {
        const response = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(response.data);

        // 1. Find IMDb URL/ID
        let imdbId = null;
        const imdbLink = $('a[href*="imdb.com/title/tt"]').attr('href');
        if (imdbLink) {
            const match = imdbLink.match(/tt\d+/);
            if (match) imdbId = match[0];
        }

        // 2. Parse title and metadata
        const rawTitle = $('title').text() || $('h1').text() || '';
        const cleanName = cleanTitle(rawTitle);

        let season = null;
        let episode = null;
        const sMatch = rawTitle.match(/season\s*(\d+)/i) || rawTitle.match(/\bs(\d+)\b/i);
        const eMatch = rawTitle.match(/episode\s*(\d+)/i) || rawTitle.match(/\be(\d+)\b/i);
        if (sMatch) season = parseInt(sMatch[1], 10);
        if (eMatch) episode = parseInt(eMatch[1], 10);

        // 3. Find download links grouped by resolution inside the page content body
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

            // Exclude internal domain links unless it's a direct landing/download link
            try {
                const parsedUrl = new URL(url);
                if (href.includes(parsedUrl.hostname) && !lowerHref.includes('/download') && !lowerHref.includes('nexdrive') && !lowerHref.includes('fastdl')) {
                    return;
                }
            } catch (e) {}

            // Must contain download keywords or wrap a button element
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

            links.push({ text: linkText, href, resolution });
        });

        // Prioritize: 720p first, then 480p, then 1080p, then any link
        let chosenLink = links.find(l => l.resolution === '720p');
        if (!chosenLink) chosenLink = links.find(l => l.resolution === '480p');
        if (!chosenLink) chosenLink = links.find(l => l.resolution === '1080p');
        if (!chosenLink) chosenLink = links[0];

        if (!chosenLink) {
            throw new Error('No download links found in post body.');
        }

        return {
            title: cleanName,
            imdbId,
            season,
            episode,
            chosenUrl: chosenLink.href,
            resolution: chosenLink.resolution
        };
    } catch (err) {
        console.error('[MovieScraper] Post page scrape failed:', err.message);
        throw err;
    }
}

/**
 * Follow shorteners or redirects to get the VCloud/HubCloud link
 */
async function resolveLandingLink(url) {
    try {
        let currentUrl = url;
        console.log('[MovieScraper] Resolving landing link:', currentUrl);

        const res = await axios.get(currentUrl, {
            headers: HEADERS,
            timeout: 15000,
            maxRedirects: 5,
            validateStatus: () => true
        });

        const $ = cheerio.load(res.data);

        // Keywords for final hosts (exclude landing domains like nexdrive/vgmlink/gdflix if we are already on them)
        const currentDomain = new URL(currentUrl).hostname.toLowerCase();
        const keywords = ['vcloud', 'hubcloud', 'gdflix', 'katdrive', 'kmhd', 'vgmlink', 'fastdl', 'filebee', 'nexdrive']
            .filter(kw => !currentDomain.includes(kw));
        
        let resolvedUrl = null;
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (href && keywords.some(kw => href.toLowerCase().includes(kw))) {
                if (!href.includes('/category/') && !href.includes('/tag/') && !href.includes('?s=')) {
                    resolvedUrl = href;
                    return false;
                }
            }
        });

        if (resolvedUrl) {
            console.log('[MovieScraper] Found intermediate link on landing page:', resolvedUrl);
            return resolvedUrl;
        }

        const finalUrl = res.request.res.responseUrl || currentUrl;
        if (keywords.some(kw => finalUrl.toLowerCase().includes(kw))) {
            return finalUrl;
        }

        return currentUrl;
    } catch (err) {
        console.error('[MovieScraper] Landing link resolution failed:', err.message);
        return url;
    }
}

/**
 * Extract direct download links from V-Cloud / HubCloud / Fastdl / Filebee pages
 */
async function resolveVcloudLink(url) {
    try {
        console.log('[MovieScraper] Resolving V-Cloud/HubCloud link:', url);

        // 1. Handle Filebee links directly
        if (url.includes('filebee.xyz')) {
            const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
            const $ = cheerio.load(res.data);
            const dlLink = $('a[href*="cdn-cgi/content"], a[href*="filepress"]').attr('href');
            if (dlLink) {
                console.log('[MovieScraper] Resolved direct Filebee link:', dlLink);
                return dlLink;
            }
        }

        // 2. Handle Fastdl direct link redirection
        if (url.includes('fastdl.zip')) {
            const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
            const scriptContent = res.data;
            const reurlRegex = /reurl\s*=\s*['"]([^'"]+)['"]/i;
            const match = reurlRegex.exec(scriptContent);
            if (match && match[1]) {
                const reurl = match[1];
                try {
                    const parsedUrl = new URL(reurl);
                    const linkParam = parsedUrl.searchParams.get('link');
                    if (linkParam) {
                        console.log('[MovieScraper] Resolved direct Google User Content link from Fastdl:', linkParam);
                        return linkParam;
                    }
                } catch (e) {}
                console.log('[MovieScraper] Resolved Fastdl target:', reurl);
                return reurl;
            }
        }

        const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(res.data);

        // 3. Look for inline JavaScript double base64 atob encoding or var url = '...'
        const scriptContent = $('script').text() || '';
        let decodedLink = null;

        const atobRegex = /atob\(\s*atob\(\s*['"]([^'"]+)['"]\s*\)\s*\)/g;
        let match = atobRegex.exec(scriptContent);
        if (match && match[1]) {
            try {
                const step1 = Buffer.from(match[1], 'base64').toString('utf8');
                decodedLink = Buffer.from(step1, 'base64').toString('utf8');
                console.log('[MovieScraper] Decoded double-atob link:', decodedLink);
            } catch (e) {
                console.error('[MovieScraper] Failed decoding double atob:', e.message);
            }
        }

        if (!decodedLink) {
            const varUrlRegex = /var\s+url\s*=\s*['"]([^'"]+)['"]/i;
            const matchVar = varUrlRegex.exec(scriptContent);
            if (matchVar && matchVar[1]) {
                decodedLink = matchVar[1];
                console.log('[MovieScraper] Decoded var url link:', decodedLink);
            }
        }

        if (!decodedLink && url.includes('/video/')) {
            const videoDl = $('div.vd > center > a').attr('href');
            if (videoDl) {
                decodedLink = videoDl;
            }
        }

        if (decodedLink) {
            if (!decodedLink.startsWith('http')) {
                const parsed = new URL(url);
                decodedLink = `${parsed.protocol}//${parsed.host}${decodedLink.startsWith('/') ? '' : '/'}${decodedLink}`;
            }

            console.log('[MovieScraper] Fetching final download landing page:', decodedLink);
            const dlRes = await axios.get(decodedLink, { headers: HEADERS, timeout: 15000 });
            const dl$ = cheerio.load(dlRes.data);

            const finalLinks = [];
            dl$('h2 a.btn, div.card-body a.btn, a.btn, a[href]').each((_, el) => {
                const href = dl$(el).attr('href');
                const text = dl$(el).text().trim();
                if (href && (href.startsWith('http') || href.startsWith('/'))) {
                    finalLinks.push({ text, href });
                }
            });

            // Prioritize raw R2 Direct Cloud Storage links, then 10Gbps Server, then Pixeldrain, then Mega
            let best = finalLinks.find(l => l.text.toLowerCase().includes('fslv2') || l.text.toLowerCase().includes('fsl server'));
            if (!best) best = finalLinks.find(l => l.text.toLowerCase().includes('10gbps') || l.text.toLowerCase().includes('10gbps server'));
            if (!best) best = finalLinks.find(l => l.text.toLowerCase().includes('pixeldrain') || l.text.toLowerCase().includes('pixelserver'));
            if (!best) best = finalLinks.find(l => l.text.toLowerCase().includes('mega server'));
            if (!best) best = finalLinks.find(l => l.text.toLowerCase().includes('download file'));
            if (!best) best = finalLinks[0];

            if (best) {
                let directUrl = best.href;
                if (!directUrl.startsWith('http')) {
                    const parsed = new URL(decodedLink);
                    directUrl = `${parsed.protocol}//${parsed.host}${directUrl.startsWith('/') ? '' : '/'}${directUrl}`;
                }
                if (directUrl.includes('pixeldrain.com/u/')) {
                    const id = directUrl.split('/u/')[1].split('?')[0];
                    directUrl = `https://pixeldrain.com/api/file/${id}?download`;
                }
                console.log('[MovieScraper] Resolved final direct URL:', directUrl);
                return directUrl;
            }
        }

        const directBtn = $('a:contains("Download File")').attr('href') || $('a:contains("FSL Server")').attr('href');
        if (directBtn) {
            return directBtn;
        }

        return url;
    } catch (err) {
        console.error('[MovieScraper] V-Cloud resolution failed:', err.message);
        return url;
    }
}

module.exports = {
    fetchTmdbMetadata,
    scrapePostPage,
    resolveLandingLink,
    resolveVcloudLink,
    cleanTitle
};
