const axios = require('axios');
const TMDB_API_KEY = 'fc6d85b3839330e3458701b975195487';

async function testTmdbVideos() {
    console.log('Testing TMDB Movie (550)...');
    const movieRes = await axios.get(`https://api.themoviedb.org/3/movie/550/videos?api_key=${TMDB_API_KEY}`);
    console.log('Movie videos:', movieRes.data.results.map(v => ({ name: v.name, key: v.key, site: v.site, type: v.type, official: v.official })));

    console.log('\nTesting TMDB TV (1399)...');
    const tvRes = await axios.get(`https://api.themoviedb.org/3/tv/1399/videos?api_key=${TMDB_API_KEY}`);
    console.log('TV videos:', tvRes.data.results.map(v => ({ name: v.name, key: v.key, site: v.site, type: v.type, official: v.official })));
}

testTmdbVideos();
