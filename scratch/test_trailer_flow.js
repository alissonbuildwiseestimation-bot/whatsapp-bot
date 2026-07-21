const { fetchTmdbById } = require('../src/Utils/movie_scraper');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const defaultHeaders = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
    "Referer": "https://frame.y2meta-uk.com/",
    "Origin": "https://frame.y2meta-uk.com",
    "Accept": "*/*"
};

function remuxToFaststartMp4(inputBuffer) {
    if (!inputBuffer || inputBuffer.length === 0) return inputBuffer;
    const tmpInput = path.join(os.tmpdir(), `yt_in_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.mp4`);
    const tmpOutput = path.join(os.tmpdir(), `yt_out_${Date.now()}_${Math.random().toString(36).substr(2, 5)}.mp4`);
    try {
        fs.writeFileSync(tmpInput, inputBuffer);
        execSync(`ffmpeg -y -i "${tmpInput}" -c copy -movflags +faststart "${tmpOutput}"`, { stdio: 'ignore' });
        const outputBuffer = fs.readFileSync(tmpOutput);
        console.log(`[Remux] Faststart remux succeeded (${inputBuffer.length} -> ${outputBuffer.length} bytes)`);
        return outputBuffer;
    } catch (e) {
        console.error('[Remux] Faststart remux failed, returning original buffer:', e.message);
        return inputBuffer;
    } finally {
        try { if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput); } catch (_) {}
        try { if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput); } catch (_) {}
    }
}

async function downloadTrailer(ytUrl) {
    try {
        console.log('[Trailer] Requesting key...');
        const keyRes = await fetch("https://cnv.cx/v2/sanity/key", { headers: defaultHeaders });
        if (!keyRes.ok) throw new Error("Key fetch failed");
        const { key } = await keyRes.json();

        console.log('[Trailer] Converting...');
        const params = new URLSearchParams({
            link: ytUrl,
            format: "mp4",
            audioBitrate: "128",
            videoQuality: "360",
            filenameStyle: "pretty",
            vCodec: "h264"
        });

        const convRes = await fetch("https://cnv.cx/v2/converter", {
            method: "POST",
            headers: {
                ...defaultHeaders,
                "Content-Type": "application/x-www-form-urlencoded",
                key: key
            },
            body: params
        });

        if (!convRes.ok) throw new Error("Conversion failed");
        const json = await convRes.json();
        if (!json.url) throw new Error("No download URL found");

        console.log('[Trailer] Downloading stream...');
        const fileRes = await fetch(json.url, { headers: defaultHeaders });
        if (!fileRes.ok) throw new Error("File download failed");
        const arrayBuf = await fileRes.arrayBuffer();
        let buffer = Buffer.from(arrayBuf);

        console.log('[Trailer] Remuxing to faststart MP4...');
        buffer = remuxToFaststartMp4(buffer);
        return buffer;
    } catch(e) {
        console.error('[Trailer] Download error:', e.message);
        return null;
    }
}

async function testTrailerIntegration() {
    console.log('Fetching TMDB metadata for Fight Club (movie 550)...');
    const tmdb = await fetchTmdbById(550, 'movie');
    console.log('TMDB data:', { title: tmdb.title, year: tmdb.year, trailerUrl: tmdb.trailerUrl });

    if (tmdb.trailerUrl) {
        console.log(`Downloading trailer for ${tmdb.title} from ${tmdb.trailerUrl}...`);
        const buf = await downloadTrailer(tmdb.trailerUrl);
        if (buf && buf.length > 0) {
            console.log(`Trailer downloaded successfully! Size: ${buf.length} bytes.`);
        } else {
            console.log('Trailer download returned null. Skipping trailer and moving on!');
        }
    } else {
        console.log('No trailer URL found on TMDB. Skipping trailer and moving on!');
    }
}

testTrailerIntegration();
