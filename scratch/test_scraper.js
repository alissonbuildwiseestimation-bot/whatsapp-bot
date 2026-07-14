const scraper = require('../src/Utils/movie_scraper');

async function test() {
    console.log('Testing TMDB metadata resolver...');
    const meta = await scraper.fetchTmdbMetadata('The Boys', 'tv');
    console.log('TMDB Result:', meta);

    console.log('Testing clean title...');
    console.log('Cleaned:', scraper.cleanTitle('Download The Boys Season 1 Hindi Dual Audio [720p]'));
}

test();
