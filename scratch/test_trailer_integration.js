const { fetchTmdbById, downloadYoutubeVideoUrl } = require('../src/Utils/movie_scraper');

async function testIntegration() {
    console.log('--- Testing Movie TMDB 550 (Fight Club) ---');
    const tmdbMovie = await fetchTmdbById(550, 'movie');
    console.log('TMDB Movie Title:', tmdbMovie?.title);
    console.log('TMDB Movie Trailer URL:', tmdbMovie?.trailerUrl);

    if (tmdbMovie?.trailerUrl) {
        console.log('Resolving direct video download link...');
        const videoUrl = await downloadYoutubeVideoUrl(tmdbMovie.trailerUrl);
        console.log('Direct video URL resolved:', videoUrl ? 'YES' : 'NO');
    }

    console.log('\n--- Testing TV TMDB 1399 (Game of Thrones) ---');
    const tmdbTv = await fetchTmdbById(1399, 'tv');
    console.log('TMDB TV Title:', tmdbTv?.title);
    console.log('TMDB TV Trailer URL:', tmdbTv?.trailerUrl);

    if (tmdbTv?.trailerUrl) {
        console.log('Resolving direct video download link...');
        const videoUrl = await downloadYoutubeVideoUrl(tmdbTv.trailerUrl);
        console.log('Direct video URL resolved:', videoUrl ? 'YES' : 'NO');
    }
}

testIntegration();
