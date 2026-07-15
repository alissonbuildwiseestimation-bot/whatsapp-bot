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

async function run() {
    const url = 'https://nexdrive.fit/genxfm784776492707/';
    console.log(`[Test] 1. Extracting direct hosts from landing page: ${url}`);
    try {
        const directHosts = await scraper.extractDirectDownloadLinks(url);
        console.log(`[Test] Found ${directHosts.length} direct hosts.`);
        
        // Filter landing hosts
        const landingHosts = directHosts.filter(h => isLandingUrl(h.href));
        console.log(`[Test] Found ${landingHosts.length} landing hosts:`);
        landingHosts.forEach(h => console.log(`  - ${h.text} [${h.episode}] -> ${h.href}`));
        
        // Fetch sub-options concurrently
        console.log('\n[Test] 2. Extracting sub-options concurrently...');
        const subOptsResults = await Promise.all(landingHosts.map(async (host) => {
            try {
                const subOpts = await scraper.extractSubOptions(host.href);
                return subOpts.map(opt => ({
                    parentHost: host.text,
                    text: opt.text,
                    href: opt.href,
                    episode: host.episode
                }));
            } catch (err) {
                console.error(`Failed for host ${host.text}:`, err.message);
                return [];
            }
        }));
        
        const mergedOptions = subOptsResults.flat();
        console.log(`[Test] Merged ${mergedOptions.length} sub-options:`);
        
        // Filter mergedOptions to only include FSL, FSLv2, GDrive, and 10gbps
        const filteredOptions = mergedOptions.filter(host => {
            const parentLower = host.parentHost.toLowerCase();
            const textLower = host.text.toLowerCase();
            
            const isDirectLink = host.text === 'Direct Link';
            const targetName = isDirectLink ? parentLower : textLower;
            
            const matchesFsl = targetName.includes('fsl') || targetName.includes('vcloud') || targetName.includes('v-cloud');
            const matchesGdrive = targetName.includes('gdrive') || targetName.includes('g-drive') || targetName.includes('drive.google') || targetName.includes('fastdl') || targetName.includes('filepress') || targetName.includes('filebee') || targetName.includes('g-direct');
            const matches10gbps = targetName.includes('10gbps');
            
            return matchesFsl || matchesGdrive || matches10gbps;
        });
        
        console.log(`\n[Test] 3. Filtered down to ${filteredOptions.length} supported options:`);
        filteredOptions.forEach((host, idx) => {
            const epPrefix = host.episode ? `*${host.episode}* — ` : '';
            console.log(`  Option ${idx + 1}: ${epPrefix}${host.parentHost} (${host.text}) -> ${host.href}`);
        });
        
    } catch(e) {
        console.error('[Test] Extraction failed:', e.message);
    }
}

run();
