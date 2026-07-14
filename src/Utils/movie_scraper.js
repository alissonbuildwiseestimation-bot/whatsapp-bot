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
                // Find first movie or tv result
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

        // Map genre IDs to names (simplified mapping, or fetch dynamically)
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

        // Parse season and episode from title/url if available
        let season = null;
        let episode = null;
        const sMatch = rawTitle.match(/season\s*(\d+)/i) || rawTitle.match(/\bs(\d+)\b/i);
        const eMatch = rawTitle.match(/episode\s*(\d+)/i) || rawTitle.match(/\be(\d+)\b/i);
        if (sMatch) season = parseInt(sMatch[1], 10);
        if (eMatch) episode = parseInt(eMatch[1], 10);

        // 3. Find download links grouped by resolution
        const links = [];
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            const linkText = $(el).text().trim();

            // Ignore external and non-download links
            if (!href || href.startsWith('#') || href.includes('imdb.com') || href.includes('youtube.com') || href.includes('telegram') || href.includes('facebook') || href.includes('twitter')) {
                return;
            }

            // Find nearest resolution label (parent element or text)
            let parentText = '';
            let current = $(el);
            for (let i = 0; i < 3; i++) {
                parentText += ' ' + current.parent().text();
                current = current.parent();
            }

            // Also check preceding headings
            let precedingHeading = '';
            let prev = $(el).closest('p, div').prev();
            while (prev.length && !/^h[1-6]$/i.test(prev[0].name)) {
                prev = prev.prev();
            }
            if (prev.length) {
                precedingHeading = prev.text();
            }

            const combinedText = `${linkText} ${parentText} ${precedingHeading}`.toLowerCase();
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

        // 4. Select the best link: Prefer 720p, fall back to 480p, then 1080p, then others
        let chosenLink = links.find(l => l.resolution === '720p');
        if (!chosenLink) chosenLink = links.find(l => l.resolution === '480p');
        if (!chosenLink) chosenLink = links.find(l => l.resolution === '1080p');
        if (!chosenLink) chosenLink = links[0]; // fallback to first link found

        if (!chosenLink) {
            throw new Error('No download links found on the page.');
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

        // Fetch page HTML
        const res = await axios.get(currentUrl, {
            headers: HEADERS,
            timeout: 15000,
            maxRedirects: 5,
            validateStatus: () => true
        });

        const $ = cheerio.load(res.data);

        // Search for V-Cloud, HubCloud, GDFlix, or KMHD links in page anchors
        let resolvedUrl = null;
        $('a[href]').each((_, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('vcloud') || href.includes('hubcloud') || href.includes('gdflix') || href.includes('katdrive') || href.includes('kmhd') || href.includes('vgmlink'))) {
                resolvedUrl = href;
                return false; // break
            }
        });

        if (resolvedUrl) {
            console.log('[MovieScraper] Found intermediate link on landing page:', resolvedUrl);
            return resolvedUrl;
        }

        // If no explicit download cloud link found, check if it redirected to a cloud domain
        const finalUrl = res.request.res.responseUrl || currentUrl;
        if (finalUrl.includes('vcloud') || finalUrl.includes('hubcloud') || finalUrl.includes('gdflix') || finalUrl.includes('kmhd')) {
            return finalUrl;
        }

        return currentUrl;
    } catch (err) {
        console.error('[MovieScraper] Landing link resolution failed:', err.message);
        return url;
    }
}

/**
 * Extract direct download links from V-Cloud / HubCloud pages
 */
async function resolveVcloudLink(url) {
    try {
        console.log('[MovieScraper] Resolving V-Cloud/HubCloud link:', url);
        const res = await axios.get(url, { headers: HEADERS, timeout: 15000 });
        const $ = cheerio.load(res.data);

        // 1. Look for inline JavaScript double base64 atob encoding: atob(atob('...'))
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

        // Fallback: var url = '...'
        if (!decodedLink) {
            const varUrlRegex = /var\s+url\s*=\s*['"]([^'"]+)['"]/i;
            const matchVar = varUrlRegex.exec(scriptContent);
            if (matchVar && matchVar[1]) {
                decodedLink = matchVar[1];
                console.log('[MovieScraper] Decoded var url link:', decodedLink);
            }
        }

        // 2. If it's a video player page (e.g. /video/id), get the download button
        if (!decodedLink && url.includes('/video/')) {
            const videoDl = $('div.vd > center > a').attr('href');
            if (videoDl) {
                decodedLink = videoDl;
            }
        }

        if (decodedLink) {
            // Reconstruct full URL if relative
            if (!decodedLink.startsWith('http')) {
                const parsed = new URL(url);
                decodedLink = `${parsed.protocol}//${parsed.host}${decodedLink.startsWith('/') ? '' : '/'}${decodedLink}`;
            }

            // Fetch the decoded download landing page
            console.log('[MovieScraper] Fetching final download landing page:', decodedLink);
            const dlRes = await axios.get(decodedLink, { headers: HEADERS, timeout: 15000 });
            const dl$ = cheerio.load(dlRes.data);

            // Locate final download links
            const finalLinks = [];
            dl$('h2 a.btn, div.card-body a.btn, a.btn').each((_, el) => {
                const href = dl$(el).attr('href');
                const text = dl$(el).text().trim();
                if (href) {
                    finalLinks.push({ text, href });
                }
            });

            // Prioritize Pixeldrain, Mega, FSL Server, Download File
            let best = finalLinks.find(l => l.text.toLowerCase().includes('pixeldrain'));
            if (!best) best = finalLinks.find(l => l.text.toLowerCase().includes('download file'));
            if (!best) best = finalLinks.find(l => l.text.toLowerCase().includes('fsl server') || l.text.toLowerCase().includes('fslv2'));
            if (!best) best = finalLinks.find(l => l.text.toLowerCase().includes('mega server'));
            if (!best) best = finalLinks[0]; // fallback

            if (best) {
                let directUrl = best.href;
                // If it's Pixeldrain, format for API download
                if (directUrl.includes('pixeldrain.com/u/')) {
                    const id = directUrl.split('/u/')[1].split('?')[0];
                    directUrl = `https://pixeldrain.com/api/file/${id}?download`;
                }
                console.log('[MovieScraper] Resolved final direct URL:', directUrl);
                return directUrl;
            }
        }

        // Fallback: If no scripting/decoding succeeded, check if the V-Cloud page itself has direct links
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
