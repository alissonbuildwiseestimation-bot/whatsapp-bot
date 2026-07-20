const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { cmd } = require('../Utils/command');
const ETfO = require('../../customization');

const apiBase = "https://v0-api-server-with-cookies.vercel.app/api";

function gpWO(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64');
}

function cmQO(str) {
    return JSON.parse(Buffer.from(str, 'base64').toString('utf8'));
}

function YiKO(title) {
    return title.replace(/[<>:"/\\|?*]/g, '_').replace(/\s+/g, '_');
}

async function UfEO(detailPath) {
    const res = await axios.get(`${apiBase}/info?detailPath=${detailPath}`);
    if (!res.data || !res.data.success) {
        throw new Error("Info API failed");
    }
    return res.data.info;
}

async function UDCL(detailPath, season = 0, episode = 0) {
    const res = await axios.get(`${apiBase}/streams?detailPath=${detailPath}&season=${season}&episode=${episode}`);
    if (!res.data || !res.data.success) {
        throw new Error("Stream API failed");
    }
    return res.data;
}

// Downloads stream to temporary local file, uploads to WhatsApp, and cleans up
async function oTgM(conn, targets, streamUrl, filename, size, detailPath, thumbnail, title, config, getThumbnailBuffer, mek, reply, season, episode) {
    const tempFilePath = path.join(__dirname, 'tmp_' + Date.now() + '_' + filename);
    try {
        const response = await axios({
            method: "GET",
            url: streamUrl,
            responseType: "stream",
            timeout: 600000,
            headers: {
                "User-Agent": "Mozilla/5.0",
                "Referer": `https://movie-box.co/movies/${detailPath}`,
                "Origin": "https://movie-box.co",
                "Accept": "*/*"
            }
        });

        const writer = fs.createWriteStream(tempFilePath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });

        let caption = ETfO.MVDL_MOVIE_CAPTION(title, season, episode, size, config);
        const thumbBuffer = await getThumbnailBuffer(thumbnail || ETfO.IMG);

        const primaryTarget = targets[0];
        const docMsg = {
            document: { url: tempFilePath },
            mimetype: response.headers["content-type"] || "video/mp4",
            fileName: filename,
            caption: caption,
            jpegThumbnail: thumbBuffer
        };

        let sentMsg = null;
        try {
            sentMsg = await conn.sendMessage(primaryTarget, docMsg, { quoted: mek });
        } catch (err) {
            console.error("Send fail to " + primaryTarget + ":", err.message);
        }

        if (sentMsg && targets.length > 1) {
            for (let i = 1; i < targets.length; i++) {
                try {
                    console.log("Forwarding to target " + (i + 1) + "/" + targets.length + ": " + targets[i]);
                    if (typeof conn.forwardMessage === 'function') {
                        await conn.forwardMessage(targets[i], sentMsg, { forceForward: true });
                    } else if (conn.sendMessage) {
                        await conn.sendMessage(targets[i], { forward: sentMsg });
                    }
                } catch (err) {
                    console.error("Forward fail to " + targets[i] + ":", err.message);
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (fs.existsSync(tempFilePath)) {
            try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
        }
        return true;
    } catch (err) {
        if (fs.existsSync(tempFilePath)) {
            try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
        }
        throw err;
    }
}

// Send interactive button lists helper
async function kIMJ(conn, from, image, caption, footer, buttons, mek, config) {
    const messagePayload = {
        image: { url: image },
        caption: caption,
        footer: footer,
        buttons: buttons,
        headerType: 4
    };
    // Send using conn.nonbuttonMessage or conn.sendMessage depending on context
    if (typeof conn.nonbuttonMessage === 'function') {
        return conn.nonbuttonMessage(from, messagePayload);
    } else {
        return conn.sendMessage(from, messagePayload);
    }
}

// ======================== COMMAND HANDLERS ========================

// 1. mvdl search command
cmd({
    pattern: "mvdl",
    react: "🎬",
    category: "download",
    desc: "Search movies & TV series on Movie-Box",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, prefix, config, pushname }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_SEARCH_PROMPT);
        }
        const res = await axios.get(`${apiBase}/search?q=${encodeURIComponent(q)}&page=1&perPage=10`);
        if (!res.data || !res.data.success || !res.data.results || !res.data.results.length) {
            return reply(ETfO.MVDL_NO_RESULTS);
        }

        const buttons = res.data.results.map(item => ({
            buttonId: `${prefix}mvdlinfo ${gpWO({ action: "info", detailPath: item.detailPath, type: item.type })}`,
            buttonText: { displayText: `${item.title} (${item.type.toUpperCase()})` },
            type: 1
        }));

        await kIMJ(conn, from, ETfO.IMG, ETfO.MVDL_SEARCH_RESULTS(q), config.FOOTER, buttons, mek, config);
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_SEARCH_FAILED);
    }
});

// 2. mvdlinfo command
cmd({
    pattern: "mvdlinfo",
    react: "🔍",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, prefix, config, getThumbnailBuffer }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_INVALID_REQUEST);
        }
        const payload = cmQO(q);
        const movie = await UfEO(payload.detailPath);
        const isMovie = payload.type === "movie";
        const poster = movie.images?.poster || ETfO.IMG;

        const genres = movie.genre?.split(",")?.slice(0, 3)?.join(" • ") || "Unknown";
        const duration = movie.duration ? `${Math.floor(movie.duration / 3600)}h ${Math.floor((movie.duration % 3600) / 60)}m` : "N/A";
        const rating = movie.imdbRating ? `⭐ ${movie.imdbRating}/10` : "No Rating";
        const dubs = movie.dubs?.slice(0, 3)?.map(d => d.languageName || d.langName || d.language).join(", ") || "Original";
        const castList = movie.cast?.slice(0, 3)?.map(c => c.name).join(", ") || "Unknown";

        let caption = ETfO.MVDL_MOVIE_INFO(movie, isMovie, genres, duration, rating, dubs, castList);
        const buttons = [];

        if (isMovie) {
            // Fetch fresh streams dynamically to avoid expiration
            const streamInfo = await UDCL(payload.detailPath, 0, 0);
            for (const stream of streamInfo.streams) {
                buttons.push({
                    buttonId: `${prefix}mvdlget ${gpWO({
                        action: "download",
                        detailPath: payload.detailPath,
                        quality: stream.quality,
                        streamUrl: stream.streamUrl,
                        size: stream.sizeBytes || stream.size,
                        thumbnail: poster,
                        title: movie.title,
                        season: 0,
                        episode: 0
                    })}`,
                    buttonText: { displayText: `📥 ${stream.quality} (${stream.size})` },
                    type: 1
                });
            }
            // Add subtitles button if subtitles exist
            if (streamInfo.subtitles && streamInfo.subtitles.length) {
                buttons.push({
                    buttonId: `${prefix}mvdlsub ${gpWO({ action: "subtitle_select", detailPath: payload.detailPath, season: 0, episode: 0 })}`,
                    buttonText: { displayText: "📝 Subtitles" },
                    type: 1
                });
            }
            caption += ETfO.MVDL_CHOOSE_QUALITY;
        } else {
            // TV series: show seasons
            const seasons = movie.seasons || [];
            if (!seasons.length) {
                return reply(ETfO.MVDL_NO_SEASONS);
            }
            seasons.forEach(season => {
                buttons.push({
                    buttonId: `${prefix}mvdlseason ${gpWO({ action: "season", detailPath: payload.detailPath, seasonNumber: season.season, maxEpisode: season.maxEpisode })}`,
                    buttonText: { displayText: `Season ${season.season} (${season.maxEpisode} Episodes)` },
                    type: 1
                });
            });
            caption += ETfO.MVDL_CHOOSE_SEASON;
        }

        await kIMJ(conn, from, poster, caption, config.FOOTER, buttons, mek, config);
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_INFO_FAILED);
    }
});

// 3. mvdlseason command
cmd({
    pattern: "mvdlseason",
    react: "📺",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, prefix, config }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_INVALID_REQUEST);
        }
        const payload = cmQO(q);
        const movie = await UfEO(payload.detailPath);
        const poster = movie.images?.poster || ETfO.IMG;

        const buttons = [];
        for (let ep = 1; ep <= payload.maxEpisode; ep++) {
            buttons.push({
                buttonId: `${prefix}mvdlshowep ${gpWO({ action: "episode_select", detailPath: payload.detailPath, seasonNumber: payload.seasonNumber, episodeNumber: ep })}`,
                buttonText: { displayText: `Episode ${ep}` },
                type: 1
            });
        }

        const caption = ETfO.MVDL_SEASON_CAPTION(movie, payload.seasonNumber, payload.maxEpisode);
        await kIMJ(conn, from, poster, caption, config.FOOTER, buttons, mek, config);
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_SEASON_FAILED);
    }
});

// 4. mvdlshowep command
cmd({
    pattern: "mvdlshowep",
    react: "📺",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, prefix, config }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_INVALID_REQUEST);
        }
        const payload = cmQO(q);
        const streamInfo = await UDCL(payload.detailPath, payload.seasonNumber, payload.episodeNumber);
        const movie = await UfEO(payload.detailPath);
        const poster = movie.images?.poster || ETfO.IMG;

        const buttons = streamInfo.streams.map(stream => ({
            buttonId: `${prefix}mvdlget ${gpWO({
                action: "download",
                detailPath: payload.detailPath,
                quality: stream.quality,
                streamUrl: stream.streamUrl,
                size: stream.sizeBytes || stream.size,
                thumbnail: poster,
                title: movie.title,
                season: payload.seasonNumber,
                episode: payload.episodeNumber
            })}`,
            buttonText: { displayText: `📥 ${stream.quality} (${stream.size})` },
            type: 1
        }));

        if (streamInfo.subtitles && streamInfo.subtitles.length) {
            buttons.push({
                buttonId: `${prefix}mvdlsub ${gpWO({ action: "subtitle_select", detailPath: payload.detailPath, season: payload.seasonNumber, episode: payload.episodeNumber })}`,
                buttonText: { displayText: "📝 Subtitles" },
                type: 1
            });
        }

        const caption = ETfO.MVDL_EPISODE_CAPTION(movie, payload.seasonNumber, payload.episodeNumber);
        await kIMJ(conn, from, poster, caption, config.FOOTER, buttons, mek, config);
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_EPISODE_FAILED);
    }
});

// 5. mvdlget command (downloads & uploads file, dynamically refreshing the download link)
cmd({
    pattern: "mvdlget",
    react: "⬇️",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, config, getThumbnailBuffer }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_INVALID_REQUEST);
        }
        const payload = cmQO(q);
        const { detailPath, quality, streamUrl, size, thumbnail, title, season, episode } = payload;
        
        // Fetch fresh stream links dynamically to prevent cloudflare / CDN signature expiration!
        let finalStreamUrl = streamUrl;
        try {
            const freshInfo = await UDCL(detailPath, season || 0, episode || 0);
            const freshStream = freshInfo.streams.find(s => s.quality.includes(quality) || quality.includes(s.quality));
            if (freshStream) {
                finalStreamUrl = freshStream.streamUrl;
                console.log("Successfully refreshed expired stream URL!");
            }
        } catch (err) {
            console.error("Failed to refresh stream link, using fallback payload link:", err.message);
        }

        const poster = thumbnail || ETfO.IMG;

        // Send Movie Card message
        await conn.sendMessage(from, {
            image: { url: poster },
            caption: ETfO.MVDL_MOVIE_CARD(payload, quality, size, season, episode)
        }, { quoted: mek });

        const ext = "mp4";
        const cleanTitle = YiKO(title);
        const filename = `${cleanTitle}_${season ? `S${season}E${episode}_` : ""}${quality}p.${ext}`;
        
        const targets = config.MOVIE_JID && config.MOVIE_JID.length ? config.MOVIE_JID : [from];
        
        await oTgM(conn, targets, finalStreamUrl, filename, size, detailPath, poster, title, config, getThumbnailBuffer, mek, reply, season, episode);
        await reply(ETfO.MVDL_DOWNLOAD_SUCCESS);
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_DOWNLOAD_FAILED);
    }
});

// 6. mvdlsub command
cmd({
    pattern: "mvdlsub",
    react: "📝",
    category: "download",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, config }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_SUB_INVALID);
        }
        const payload = cmQO(q);
        
        if (payload.action === "subtitle_select") {
            const streamInfo = await UDCL(payload.detailPath, payload.season || 0, payload.episode || 0);
            const subtitles = streamInfo.subtitles || [];
            if (!subtitles.length) {
                return reply(ETfO.MVDL_SUB_NO_AVAILABLE);
            }
            const buttons = subtitles.map(sub => ({
                buttonId: `${prefix}mvdlsub ${gpWO({ action: "subtitle_download", url: sub.url, langName: sub.languageName || sub.lang || sub.language })}`,
                buttonText: { displayText: `📝 ${sub.languageName || sub.language}` },
                type: 1
            }));

            await kIMJ(conn, from, ETfO.IMG, ETfO.MVDL_SUB_LANGUAGES, config.FOOTER, buttons, mek, config);
            return;
        }

        if (payload.action === "subtitle_download") {
            const response = await axios({
                method: "GET",
                url: payload.url,
                responseType: "arraybuffer",
                timeout: 30000
            });
            const buffer = Buffer.from(response.data);
            await conn.sendMessage(from, {
                document: buffer,
                mimetype: "application/x-subrip",
                fileName: `${payload.langName}.srt`,
                caption: ETfO.MVDL_SUB_CAPTION(payload.langName),
                jpegThumbnail: await getThumbnailBuffer(ETfO.IMG)
            }, { quoted: mek });
        }
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_SUB_FAILED);
    }
});

// 7. mv command
cmd({
    pattern: "mv",
    react: "🔍",
    category: "download",
    desc: "Search movies & TV series on Movie-Box",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, prefix, config }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_SEARCH_PROMPT);
        }
        const buttons = [
            { buttonId: `${prefix}mvdl ${q}`, buttonText: { displayText: "SEARCH MOVIE-BOX" }, type: 1 }
        ];
        await kIMJ(conn, from, ETfO.IMG, ETfO.MVDL_SEARCH_RESULTS(q), config.FOOTER, buttons, mek, config);
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_SEARCH_FAILED);
    }
});

// 8. movie search alias command
cmd({
    pattern: "movie",
    react: "🔍",
    category: "download",
    desc: "Search movies & TV series on Movie-Box",
    filename: __filename
}, async (conn, mek, m, { from, q, reply, prefix, config }) => {
    try {
        if (!q) {
            return reply(ETfO.MVDL_SEARCH_PROMPT);
        }
        const buttons = [
            { buttonId: `${prefix}mvdl ${q}`, buttonText: { displayText: "SEARCH MOVIE-BOX" }, type: 1 }
        ];
        await kIMJ(conn, from, ETfO.IMG, ETfO.MVDL_SEARCH_RESULTS(q), config.FOOTER, buttons, mek, config);
    } catch (err) {
        console.error(err);
        reply(ETfO.MVDL_SEARCH_FAILED);
    }
});