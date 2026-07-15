const scraper = require('../src/Utils/movie_scraper');

async function verifyFlow() {
    console.log('--- VERIFYING VEGAMOVIES SCRAPER FUNCTIONS ---');
    try {
        console.log('1. Testing scrapeAllPostLinks...');
        const url = 'https://vegamovies.navy/download-obsession-2026-hindi-dubbed-org-dd5-1-480p-720p-1080p-2160p-4k-amazon-prime/';
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
        console.log(`Filtered down to ${validLinks.length} valid redirect links:`);
        validLinks.forEach((vl, idx) => {
            console.log(`  Link ${idx + 1}: ${vl.heading || vl.text} (${vl.resolution}) -> ${vl.href}`);
        });

        if (validLinks.length > 0) {
            console.log('\n2. Testing extractDirectDownloadLinks on the first link...');
            const firstLink = validLinks[0];
            const hosts = await scraper.extractDirectDownloadLinks(firstLink.href);
            console.log(`Parsed ${hosts.length} direct host download links:`);
            hosts.forEach((h, idx) => {
                console.log(`  Host ${idx + 1}: ${h.text} -> ${h.href}`);
            });
        }
        console.log('\n--- VERIFICATION COMPLETED ---');
    } catch(e) {
        console.error('Verification failed:', e.message);
        process.exit(1);
    }
}

verifyFlow();
