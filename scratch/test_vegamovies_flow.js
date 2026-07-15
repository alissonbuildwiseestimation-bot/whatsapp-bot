const scraper = require('../src/Utils/movie_scraper');

async function verifyFlow() {
    console.log('--- VERIFYING VEGAMOVIES SCRAPER FUNCTIONS ---');
    try {
        console.log('1. Testing scrapeAllPostLinks on Vikings series...');
        const url = 'https://vegamovies.navy/download-see-you-at-work-tomorrow-season-1-hindi-dubbed-series-480p-720p-1080p-web-dl/';
        const links = await scraper.scrapeAllPostLinks(url);
        console.log(`Parsed ${links.length} total links.`);
        
        const validLinks = links.filter(l => {
            const lowerHref = l.href.toLowerCase();
            return lowerHref.includes('nexdrive') || 
                   lowerHref.includes('vgmlink') || 
                   lowerHref.includes('gdflix') || 
                   lowerHref.includes('fastdl') || 
                   lowerHref.includes('filebee') || 
                   lowerHref.includes('hubcloud') || 
                   lowerHref.includes('vcloud') || 
                   lowerHref.includes('katdrive') || 
                   lowerHref.includes('kmhd') || 
                   lowerHref.includes('fastdl.zip');
        });
        // Force the target link to be the exact V-Cloud pack page for testing
        const targetLink = { text: 'Season 1 [E08 Added] {Hindi-Korean} 480p WEB-DL x264 [250MB/E]', href: 'https://nexdrive.fit/genxfm784776492707/' };
        
        if (targetLink) {
            console.log(`\n2. Testing extractDirectDownloadLinks on selected link: ${targetLink.heading || targetLink.text}`);
            const hosts = await scraper.extractDirectDownloadLinks(targetLink.href);
            console.log(`Parsed ${hosts.length} direct host download links:`);
            hosts.forEach((h, idx) => {
                console.log(`  Host ${idx + 1}: ${h.text} [Episode: "${h.episode || 'N/A'}"] -> ${h.href}`);
            });
            
            // Filter options to only FSL, FSLv2, GDrive (G-Direct, Fastdl, Filepress), 10gbps
            const filteredOptions = hosts.filter(host => {
                const parentLower = (host.parentHost || '').toLowerCase();
                const textLower = host.text.toLowerCase();
                
                const isDirectLink = host.text === 'Direct Link';
                const targetName = isDirectLink ? parentLower : textLower;
                
                // Matches FSL/V-Cloud
                const matchesFsl = targetName.includes('fsl') || targetName.includes('vcloud') || targetName.includes('v-cloud');
                // Matches GDrive (fastdl, filepress, g-direct, filebee, etc.)
                const matchesGdrive = targetName.includes('gdrive') || targetName.includes('g-drive') || targetName.includes('drive.google') || targetName.includes('fastdl') || targetName.includes('filepress') || targetName.includes('filebee') || targetName.includes('g-direct');
                // Matches 10gbps
                const matches10gbps = targetName.includes('10gbps');
                
                return matchesFsl || matchesGdrive || matches10gbps;
            });
            
            console.log(`\nFiltered down to ${filteredOptions.length} supported host options:`);
            filteredOptions.forEach((h, idx) => {
                console.log(`  Filtered Host ${idx + 1}: ${h.text} [Episode: "${h.episode || 'N/A'}"]`);
            });
        }
        console.log('\n--- VERIFICATION COMPLETED ---');
    } catch(e) {
        console.error('Verification failed:', e.message);
        process.exit(1);
    }
}

verifyFlow();
