const { cmd } = require('../Utils/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fileType = require('file-type');
const { fetchTmdbMetadata, scrapePostPage, resolveLandingLink, resolveVcloudLink } = require('../Utils/movie_scraper');

// =========================================================================
//  SETTINGS PERSISTENCE — saves to session/download_settings.json
// =========================================================================
const SETTINGS_PATH = path.join(__dirname, '..', '..', 'session', 'download_settings.json');

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
        }
    } catch (err) {
        console.error('[DanieDownload] Failed to load settings:', err.message);
    }
    return { mode: 'private', groupJid: '', groupName: '' };
}

function saveSettings(settings) {
    try {
        const dir = path.dirname(SETTINGS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
        console.log('[DanieDownload] Settings saved:', settings);
    } catch (err) {
        console.error('[DanieDownload] Failed to save settings:', err.message);
    }
}

// =========================================================================
//  IN-MEMORY STATE for multi-step .config flow
// =========================================================================
const pendingConfig = {};

function isOwner(senderJid) {
    const ownerNum = (process.env.BOT_NUMBER || '').trim();
    const sudoNums = (process.env.SUDO || '').split(',').map(n => n.trim()).filter(Boolean);
    const allOwners = [ownerNum, ...sudoNums];
    const senderNum = senderJid.replace(/@.*/, '');
    return allOwners.includes(senderNum);
}

// Parse download command item (supports "=", space separation, or no name)
function parseDownloadItem(item) {
    let customFilename = null;
    let url = item.trim();

    if (item.includes('=')) {
        const parts = item.split('=').map(p => p.trim());
        if (parts.length >= 2) {
            customFilename = parts[0];
            url = parts.slice(1).join('=').trim();
        }
    } else {
        const lastSpaceIdx = item.lastIndexOf(' ');
        if (lastSpaceIdx !== -1) {
            const lastWord = item.substring(lastSpaceIdx + 1).trim();
            if (lastWord.startsWith('http://') || lastWord.startsWith('https://')) {
                customFilename = item.substring(0, lastSpaceIdx).trim();
                url = lastWord;
            }
        }
    }
    return { customFilename, url };
}

// =========================================================================
//  .config — Interactive owner-only configuration wizard
// =========================================================================
cmd({
    pattern: 'config',
    react: '⚙️',
    desc: 'Configure where downloaded files are sent (private or group).',
    category: 'download',
    use: '.config',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q, reply }) => {
    try {
        const senderJid = m.sender || mek.sender || from;
        if (!isOwner(senderJid)) {
            return reply('❌ Only the bot owner can use this command.');
        }

        const current = loadSettings();
        const modeLabel = current.mode === 'group'
            ? `📤 *Group* → ${current.groupName || current.groupJid}`
            : '📥 *Private Chat*';

        if (q && q.trim()) {
            return handleConfigReply(conn, mek, m, senderJid, q.trim(), reply);
        }

        pendingConfig[senderJid] = { step: 'mode', groups: [] };

        await reply(
            `⚙️ *DanieWatch Download Config*\n\n` +
            `Current setting: ${modeLabel}\n\n` +
            `Where should downloaded files be sent?\n\n` +
            `*Reply with:*\n` +
            `  \`1\` — 📥 Private Chat (sent to you)\n` +
            `  \`2\` — 📤 A WhatsApp Group\n\n` +
            `_Send \`.config 1\` or \`.config 2\` to choose._`
        );
    } catch (error) {
        console.error('[DanieDownload] Config error:', error);
        reply(`❌ Config error: ${error.message}`);
    }
});

async function handleConfigReply(conn, mek, m, senderJid, text, reply) {
    const state = pendingConfig[senderJid];
    const step = state ? state.step : 'mode';

    if (step === 'mode') {
        if (text === '1') {
            const settings = { mode: 'private', groupJid: '', groupName: '' };
            saveSettings(settings);
            delete pendingConfig[senderJid];
            return reply('✅ Download mode set to *Private Chat*.\n\nAll files from `.download` will be sent directly to you.');
        }

        if (text === '2') {
            await reply('🔍 Fetching your groups...');
            try {
                const groupsObj = await conn.groupFetchAllParticipating();
                const groups = Object.values(groupsObj).map(g => ({
                    jid: g.id,
                    subject: g.subject || 'Unknown Group'
                }));

                if (groups.length === 0) {
                    delete pendingConfig[senderJid];
                    return reply('❌ No groups found. Make sure the bot is added to at least one group.');
                }

                pendingConfig[senderJid] = { step: 'group', groups };

                let list = '📋 *Your Groups:*\n\n';
                groups.forEach((g, i) => {
                    list += `  \`${i + 1}\` — ${g.subject}\n`;
                });
                list += `\n_Reply with the group number, e.g. \`.config 3\`_`;

                return reply(list);
            } catch (err) {
                delete pendingConfig[senderJid];
                return reply(`❌ Failed to fetch groups: ${err.message}`);
            }
        }
        return reply('❌ Invalid option. Reply with `1` (Private) or `2` (Group).');
    }

    if (step === 'group') {
        const num = parseInt(text, 10);
        const groups = state.groups || [];

        if (isNaN(num) || num < 1 || num > groups.length) {
            return reply(`❌ Invalid selection. Reply with a number from 1 to ${groups.length}.`);
        }

        const chosen = groups[num - 1];
        const settings = { mode: 'group', groupJid: chosen.jid, groupName: chosen.subject };
        saveSettings(settings);
        delete pendingConfig[senderJid];
        return reply(`✅ Download mode set to *Group*.\n\n📤 Files will be sent to: *${chosen.subject}*\n🆔 \`${chosen.jid}\``);
    }
}

// =========================================================================
//  .setgroup — Quick shortcut to pick a group destination
// =========================================================================
cmd({
    pattern: 'setgroup',
    react: '📋',
    desc: 'Quick-set the target group for downloads.',
    category: 'download',
    use: '.setgroup list  OR  .setgroup <number>',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q, reply }) => {
    try {
        const senderJid = m.sender || mek.sender || from;
        if (!isOwner(senderJid)) {
            return reply('❌ Only the bot owner can use this command.');
        }

        const arg = (q || '').trim().toLowerCase();

        let groupsObj;
        try {
            groupsObj = await conn.groupFetchAllParticipating();
        } catch (err) {
            return reply(`❌ Failed to fetch groups: ${err.message}`);
        }

        const groups = Object.values(groupsObj).map(g => ({
            jid: g.id,
            subject: g.subject || 'Unknown Group'
        }));

        if (groups.length === 0) {
            return reply('❌ No groups found.');
        }

        if (!arg || arg === 'list') {
            pendingConfig[senderJid] = { step: 'group', groups };

            let list = '📋 *Your Groups:*\n\n';
            groups.forEach((g, i) => {
                list += `  \`${i + 1}\` — ${g.subject}\n`;
            });
            list += `\n_Reply with \`.setgroup <number>\` to select._`;
            return reply(list);
        }

        const num = parseInt(arg, 10);
        if (isNaN(num) || num < 1 || num > groups.length) {
            return reply(`❌ Invalid selection. Use a number from 1 to ${groups.length}.\nUse \`.setgroup list\` to see all groups.`);
        }

        const chosen = groups[num - 1];
        const settings = { mode: 'group', groupJid: chosen.jid, groupName: chosen.subject };
        saveSettings(settings);
        return reply(`✅ Download target set to group: *${chosen.subject}*\n🆔 \`${chosen.jid}\``);

    } catch (error) {
        console.error('[DanieDownload] Setgroup error:', error);
        reply(`❌ Error: ${error.message}`);
    }
});

// =========================================================================
//  .download — Enhanced: supports multiple files, movie scraping, TMDB info
// =========================================================================
cmd({
    pattern: 'download',
    react: '📥',
    desc: 'Downloads files. Supports multiple files separated by commas, Vegamovies/Rogmovies/HDHub4u auto-scraping, and TMDB integration.',
    category: 'download',
    use: '.download <link>  OR  .download name = <link>  OR  .download name1 = link1, name2 link2',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q, reply }) => {
    console.log("=== DOWNLOAD COMMAND TRIGGERED ===");
    console.log("q:", q);
    try {
        if (!q) {
            return reply(
                '❌ Please provide a download link!\n\n' +
                '*Usage:*\n' +
                '`.download https://example.com/file.zip`\n' +
                '`.download myname.zip = https://example.com/file.zip`\n' +
                '`.download file1 = link1, file2 link2`\n' +
                '`.download https://vegamovies.dad/some-movie/`'
            );
        }

        // Split by comma to support multiple files in a single command
        const items = q.split(',').map(item => item.trim()).filter(Boolean);
        await reply(`⏳ Found *${items.length}* download item(s) to process.`);

        const settings = loadSettings();
        const isGroupMode = settings.mode === 'group' && settings.groupJid;
        const destJid = isGroupMode ? settings.groupJid : from;
        const destLabel = isGroupMode ? `📤 Group: *${settings.groupName}*` : '📥 *Private Chat*';

        for (let i = 0; i < items.length; i++) {
            let { customFilename, url } = parseDownloadItem(items[i]);
            let targetFilename = customFilename;

            if (items.length > 1) {
                await reply(`⏳ Processing file *${i + 1}/${items.length}*...\n📍 Target: ${targetFilename || 'Auto-detect'}`);
            }

            // 1. Movie Page Autodetect & Scrape for Vegamovies, Rogmovies, or HDHub4u
            const isMoviePage = ['vegamovies', 'rogmovies', 'hdhub4u'].some(domain => url.toLowerCase().includes(domain));
            if (isMoviePage) {
                try {
                    await reply(`🔍 Processing movie/series page link...\n🔗 ${url}`);
                    
                    // Scrape the detail page
                    const scraped = await scrapePostPage(url);
                    console.log('[DanieDownload] Scraped details:', scraped);
                    
                    // Fetch TMDB metadata
                    const tmdb = await fetchTmdbMetadata(scraped.title, scraped.season ? 'tv' : 'movie', scraped.imdbId);
                    
                    const titleText = tmdb ? tmdb.title : scraped.title;
                    const yearText = tmdb ? tmdb.year : scraped.year || 'N/A';
                    const genresText = tmdb ? tmdb.genres : 'Unknown';
                    const overviewText = tmdb ? tmdb.overview : '— No summary available —';
                    
                    // Format message details caption
                    let detailsMessage = `🎬 *『 𝑫𝑨𝑵𝑰𝑬𝑾𝑨𝑻𝑪𝑯 𝑪𝑰𝑵𝑬𝑴𝑨 』* 🍿\n`;
                    detailsMessage += `───────────────────\n`;
                    detailsMessage += `📝 *Title:* ${titleText}\n`;
                    detailsMessage += `📅 *Year:* ${yearText}\n`;
                    if (scraped.season !== null) {
                        detailsMessage += `📺 *Season:* ${scraped.season} | *Episode:* ${scraped.episode || 'All/Pack'}\n`;
                    }
                    detailsMessage += `🎭 *Genres:* ${genresText}\n\n`;
                    detailsMessage += `📝 *Summary:* \n${overviewText}\n`;
                    detailsMessage += `───────────────────`;
                    
                    // Send TMDB poster and movie details first to the configured chat destination
                    const posterUrl = tmdb && tmdb.posterUrl ? tmdb.posterUrl : null;
                    if (posterUrl) {
                        await conn.sendMessage(destJid, {
                            image: { url: posterUrl },
                            caption: detailsMessage
                        });
                    } else {
                        await conn.sendMessage(destJid, {
                            text: detailsMessage
                        });
                    }
                    
                    // Follow landing redirects to find V-Cloud/HubCloud
                    const landingUrl = await resolveLandingLink(scraped.chosenUrl);
                    let directUrl = landingUrl;
                    
                    if (landingUrl.includes('vcloud') || landingUrl.includes('hubcloud') || landingUrl.includes('gdflix')) {
                        directUrl = await resolveVcloudLink(landingUrl);
                    }
                    
                    let ext = 'mp4';
                    try {
                        const urlPath = new URL(directUrl).pathname;
                        const urlFile = urlPath.substring(urlPath.lastIndexOf('/') + 1);
                        if (urlFile.includes('.')) ext = urlFile.split('.').pop();
                    } catch (e) {}
                    
                    let displayFilename = `${titleText} (${yearText})`;
                    if (scraped.season !== null) {
                        displayFilename += ` S${String(scraped.season).padStart(2, '0')}`;
                        if (scraped.episode !== null) {
                            displayFilename += `E${String(scraped.episode).padStart(2, '0')}`;
                        }
                    }
                    displayFilename += ` [${scraped.resolution}].${ext}`;
                    
                    // Redirect downloader to resolved direct link
                    url = directUrl;
                    targetFilename = displayFilename;
                    
                } catch (err) {
                    await reply(`❌ Movie scraper failed: ${err.message}\nUsing original link as fallback.`);
                }
            }

            // Basic URL validation
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                await reply(`❌ Invalid link format for item ${i + 1}! Skipping.`);
                continue;
            }

            // Determine temporary/target filename
            let tempFilename = targetFilename || ('file_' + Date.now());
            if (!targetFilename) {
                try {
                    const urlPath = new URL(url).pathname;
                    const urlFile = urlPath.substring(urlPath.lastIndexOf('/') + 1);
                    if (urlFile && urlFile.includes('.')) {
                        tempFilename = decodeURIComponent(urlFile);
                    }
                } catch (err) {}
            }

            const tempFilePath = path.join(__dirname, 'tmp_' + Date.now() + '_' + tempFilename);

            // Fetch file with axios as a stream
            const parsedUrl = new URL(url);
            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': '*/*',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Referer': parsedUrl.origin + '/',
                    'Origin': parsedUrl.origin
                },
                timeout: 600000 // 10 minutes timeout
            });

            // Write stream to file
            const writer = fs.createWriteStream(tempFilePath);
            response.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            if (!fs.existsSync(tempFilePath)) {
                throw new Error('Downloaded file does not exist on disk.');
            }

            const stats = fs.statSync(tempFilePath);
            const sizeInBytes = stats.size;
            const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

            if (sizeInBytes > 2000 * 1024 * 1024) {
                fs.unlinkSync(tempFilePath);
                await reply(`❌ File ${tempFilename} is too large (${sizeInMB} MB). Max upload limit is 2 GB.`);
                continue;
            }

            // Detect mime type
            let mime = response.headers['content-type'] || 'application/octet-stream';
            try {
                const fileBuffer = fs.readFileSync(tempFilePath, { start: 0, end: 4100 });
                const detectedType = await fileType.fromBuffer(fileBuffer);
                if (detectedType) {
                    mime = detectedType.mime;
                }
            } catch (err) {}

            await reply(`📤 Uploading file: *${tempFilename}* (${sizeInMB} MB)\n📍 To: ${destLabel}`);

            // Send the file to destination
            await conn.sendMessage(destJid, {
                document: { url: tempFilePath },
                mimetype: mime,
                fileName: tempFilename
            }, isGroupMode ? {} : { quoted: mek });

            if (isGroupMode && destJid !== from) {
                await reply(`✅ *${tempFilename}* (${sizeInMB} MB) successfully sent to the group!`);
            }

            // Delete temporary file
            fs.unlinkSync(tempFilePath);
        }

        await reply('✅ Processed all download items.');

    } catch (error) {
        console.error('Download command error:', error);
        reply(`❌ Failed to download/upload file: ${error.message}`);
    }
});

// =========================================================================
//  .groupid — unchanged from original
// =========================================================================
cmd({
    pattern: 'groupid',
    react: '🆔',
    desc: 'Get the ID of the current group/chat.',
    category: 'download',
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        await reply(`*Current Chat ID:* \`${from}\``);
    } catch (error) {
        console.error(error);
        reply(`❌ Failed to get JID: ${error.message}`);
    }
});

// =========================================================================
//  .status — Show current download destination configuration
// =========================================================================
cmd({
    pattern: 'dlstatus',
    alias: ['downloadstatus', 'dlconfig'],
    react: '📊',
    desc: 'Show current download destination configuration.',
    category: 'download',
    use: '.dlstatus',
    filename: __filename
}, async (conn, mek, m, { from, reply }) => {
    try {
        const settings = loadSettings();
        const modeEmoji = settings.mode === 'group' ? '📤' : '📥';
        const modeLabel = settings.mode === 'group'
            ? `Group → *${settings.groupName || 'Unknown'}*\n🆔 \`${settings.groupJid}\``
            : 'Private Chat (sent to you)';

        await reply(
            `📊 *Download Config Status*\n\n` +
            `${modeEmoji} Mode: *${settings.mode}*\n` +
            `📍 Destination: ${modeLabel}\n\n` +
            `_Use \`.config\` to change._`
        );
    } catch (error) {
        reply(`❌ Error: ${error.message}`);
    }
});
