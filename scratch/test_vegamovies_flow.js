const scraper = require('../src/Utils/movie_scraper');

function isLandingUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('vcloud') || 
           lower.includes('hubcloud') || 
           lower.includes('gdflix') || 
           lower.includes('fastdl') || 
           lower.includes('filebee') || 
           lower.includes('latent.click');
}

async function verifyFlow() {
    console.log('--- VERIFYING VEGAMOVIES AUTOMATED FALLBACK & EPISODE FLOW ---');
    try {
        console.log('1. Scraping post page: See You at Work Tomorrow...');
        const postUrl = 'https://vegamovies.navy/download-see-you-at-work-tomorrow-season-1-hindi-dubbed-series-480p-720p-1080p-web-dl/';
        const allLinks = await scraper.scrapeAllPostLinks(postUrl);
        
        // Filter out unrelated links (keep only V-Cloud redirect/landing pages)
        const validLinks = allLinks.filter(l => {
            const lowerHref = l.href.toLowerCase();
            const lowerText = l.text.toLowerCase();
            const lowerHeading = (l.heading || '').toLowerCase();
            
            const isVcloud = lowerHref.includes('vcloud') || 
                             lowerText.includes('v-cloud') || 
                             lowerText.includes('vcloud') || 
                             lowerHeading.includes('v-cloud') || 
                             lowerHeading.includes('vcloud');
                             
            return isVcloud && (
                   lowerHref.includes('nexdrive') || 
                   lowerHref.includes('vgmlink') || 
                   lowerHref.includes('gdflix') || 
                   lowerHref.includes('fastdl') || 
                   lowerHref.includes('filebee') || 
                   lowerHref.includes('hubcloud') || 
                   lowerHref.includes('vcloud') || 
                   lowerHref.includes('katdrive') || 
                   lowerHref.includes('kmhd') || 
                   lowerHref.includes('fastdl.zip')
            );
        });

        console.log(`Parsed ${allLinks.length} total links, filtered down to ${validLinks.length} V-Cloud links:`);
        validLinks.forEach((l, i) => {
            const cleanText = l.text.replace(/⚡\s*/g, '').trim();
            const label = l.heading 
                ? `${l.heading} — *${cleanText}* (${l.resolution})` 
                : `${cleanText} (${l.resolution})`;
            console.log(`  Option ${i + 1}: ${label}`);
        });

        // Let's choose the 480p V-Cloud Pack option
        const selectedLink = validLinks.find(l => l.text.includes('V-Cloud') && l.resolution === '480p') || validLinks[0];
        console.log(`\nSelected resolution: ${selectedLink.heading} (${selectedLink.resolution})`);

        // Resolve direct host links
        console.log(`\n2. Extracting direct hosts from: ${selectedLink.href}`);
        const directHosts = await scraper.extractDirectDownloadLinks(selectedLink.href);
        console.log(`Found ${directHosts.length} direct hosts.`);

        // Group hosts by episode
        const episodesMap = new Map();
        directHosts.forEach(h => {
            const epLabel = h.episode;
            if (epLabel) {
                if (!episodesMap.has(epLabel)) {
                    episodesMap.set(epLabel, []);
                }
                episodesMap.get(epLabel).push(h);
            }
        });

        if (episodesMap.size > 0) {
            console.log(`\n3. Grouped into ${episodesMap.size} Episodes:`);
            const sortedEpisodes = Array.from(episodesMap.keys()).sort((a, b) => {
                return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
            });
            sortedEpisodes.forEach((ep, idx) => {
                console.log(`  Episode ${idx + 1}: *${ep}*`);
            });

            // Simulate selecting Episode 1
            const selectedEpisode = sortedEpisodes[0];
            console.log(`\nSimulated selection: ${selectedEpisode}`);
            
            const episodeHosts = episodesMap.get(selectedEpisode);
            const chosenHost = episodeHosts[0];
            console.log(`Chosen Host Landing link: ${chosenHost.href}`);

            // Simulate Fallback candidates lookup
            let candidates = [];
            if (isLandingUrl(chosenHost.href)) {
                console.log(`\n4. Simulating sub-options extraction for: ${chosenHost.href}`);
                const subOpts = await scraper.extractSubOptions(chosenHost.href);
                
                const opt10gbps = subOpts.find(opt => opt.text.toLowerCase().includes('10gbps'));
                const optFslv2 = subOpts.find(opt => opt.text.toLowerCase().includes('fslv2'));
                const optFsl = subOpts.find(opt => opt.text.toLowerCase().includes('fsl') && !opt.text.toLowerCase().includes('fslv2'));
                
                if (opt10gbps) candidates.push({ name: '10Gbps Server', href: opt10gbps.href });
                if (optFslv2) candidates.push({ name: 'FSLv2 Server', href: optFslv2.href });
                if (optFsl) candidates.push({ name: 'FSL Server', href: optFsl.href });
            }

            if (candidates.length === 0) {
                candidates.push({ name: 'Direct Link', href: chosenHost.href });
            }

            console.log(`\nFallback candidates resolved:`);
            candidates.forEach((cand, idx) => {
                console.log(`  Candidate ${idx + 1} (${cand.name}): ${cand.href}`);
            });

            console.log(`\nFallback system will attempt downloading these in order:`);
            candidates.forEach((cand, idx) => {
                console.log(`  Attempt ${idx + 1}: ${cand.name}`);
            });
        } else {
            console.log('\n3. Single movie/file flow. Directly trigger fallback system.');
        }

        console.log('\n--- VERIFICATION COMPLETED ---');
    } catch(e) {
        console.error('Verification failed:', e.message);
        process.exit(1);
    }
}

verifyFlow();
