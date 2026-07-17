const { cmd } = require('../Utils/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fileType = require('file-type');
const { fetchTmdbMetadata, fetchTmdbById, scrapePostPage, resolveLandingLink, resolveVcloudLink, resolveFinalUrl, scrapeAllPostLinks, extractDirectDownloadLinks, extractSubOptions } = require('../Utils/movie_scraper');

// Global handlers to prevent background network disconnect errors from crashing the Node process
process.on('unhandledRejection', (reason, promise) => {
    console.error('[DanieWatch] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[DanieWatch] Uncaught Exception thrown:', err);
});

function cleanFileName(filename) {
    if (!filename) return '';
    // Strip extensions like .mp4, .mkv, .avi, .webm, etc.
    return filename.replace(/\.(mp4|mkv|avi|webm|mov|3gp|srt)$/i, '').trim();
}

function cleanJunkWords(text) {
    const junkRegexes = [
        /\bdual\s+audio\b/gi,
        /\bhindi-korean\b/gi,
        /\bhindi\b/gi,
        /\benglish\b/gi,
        /\bkorean\b/gi,
        /\bmulti\s+audio\b/gi,
        /\bweb-dl\b/gi,
        /\bwebrip\b/gi,
        /\bbluray\b/gi,
        /\bhdtv\b/gi,
        /\bhdr\b/gi,
        /\bx264\b/gi,
        /\bx265\b/gi,
        /\bhevc\b/gi,
        /\b10bit\b/gi,
        /\besub\b/gi,
        /\bsub\b/gi,
        /\bsubtitle[s]?\b/gi,
        /\bseries\b/gi,
        /\bmovie[s]?\b/gi,
        /\bfull\s+movie\b/gi,
        /\borg\b/gi,
        /\boriginal\b/gi,
        /\bdirect\s+link[s]?\b/gi,
        /\blink[s]?\b/gi,
        /\b480p\b/gi,
        /\b720p\b/gi,
        /\b1080p\b/gi,
        /\b2160p\b/gi,
        /\b4k\b/gi
    ];

    let result = text;
    for (const regex of junkRegexes) {
        result = result.replace(regex, '');
    }
    result = result.replace(/[\[\]\(\)\{\}\-\:]/g, ' ');
    return result;
}

function generateCustomFileName(state, primaryHost) {
    let postTitle = state.title || '';
    const resolution = state.selectedResolution || '';
    let episode = primaryHost ? primaryHost.episode : '';

    // Sanitize episode — reject disclaimers that got misidentified as episode labels
    if (episode && /download\s+manager|instant\s+download|note\s*:/i.test(episode)) {
        console.log(`[DanieFileName] Rejecting junk episode label: "${episode}"`);
        episode = '';
    }

    console.log(`[DanieFileName] Input: title="${postTitle}", resolution="${resolution}", episode="${episode}"`);

    // Remove "Download" from start
    postTitle = postTitle.replace(/^download\s+/i, '').trim();

    // Remove common disclaimer/note prefixes
    postTitle = postTitle.replace(/note\s*[:\-–]\s*use\s+download\s+manager.*?instant\s+download[!.\s]*/gi, '').trim();

    // Determine if it is a TV show
    const hasEpisode = !!episode;
    const isTvShow = hasEpisode || /season\s*\d+|series/i.test(postTitle);

    let cleanTitle = '';

    if (isTvShow) {
        // Keep everything up to and including "Season N" or "Season N - M" (with optional parentheses)
        const seasonMatch = postTitle.match(/^(.*?\(?\s*season\s*\d+(?:\s*[-–]\s*\d+)?\s*\)?)/i);
        if (seasonMatch) {
            cleanTitle = seasonMatch[1].trim();
        } else {
            // No season found — use full title
            cleanTitle = postTitle;
        }
    } else {
        // Keep everything up to and including the year (with optional parentheses)
        const yearMatch = postTitle.match(/^(.*?\(?\s*\b(19|20)\d{2}\b\s*\)?)/i);
        if (yearMatch) {
            cleanTitle = yearMatch[1].trim();
        } else {
            // No year found — use full title
            cleanTitle = postTitle;
        }
    }

    // Remove invalid filename characters
    cleanTitle = cleanTitle.replace(/[:*?"<>|\\\/]/g, '').trim();
    cleanTitle = cleanTitle.replace(/\s+/g, ' ').trim();

    // Build final name: [Episode] Title Resolution
    const parts = [];
    if (episode) {
        parts.push(episode.trim());
    }
    parts.push(cleanTitle);
    if (resolution) {
        parts.push(resolution.trim());
    }

    const result = parts.join(' ');
    console.log(`[DanieFileName] Output: "${result}"`);
    return result;
}

const { execSync } = require('child_process');

function extractArchive(archivePath, targetDir) {
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    const ext = path.extname(archivePath).toLowerCase();
    
    if (ext === '.zip') {
        try {
            console.log('[DanieDownload] Extracting ZIP via adm-zip...');
            const AdmZip = require('adm-zip');
            const zip = new AdmZip(archivePath);
            zip.extractAllTo(targetDir, true);
            return true;
        } catch (err) {
            console.error('[DanieDownload] adm-zip failed, falling back to system tar:', err.message);
        }
    }
    
    // Fallback to system tar for other formats or if adm-zip fails
    try {
        console.log(`[DanieDownload] Extracting ${ext} archive via system tar...`);
        execSync(`tar -xf "${archivePath}" -C "${targetDir}"`, { stdio: 'ignore' });
        return true;
    } catch (err) {
        console.error(`[DanieDownload] System tar extraction failed:`, err.message);
        throw new Error(`Failed to extract archive (${ext}): ${err.message}`);
    }
}

function getAllFiles(dirPath, arrayOfFiles) {
    const files = fs.readdirSync(dirPath);
    arrayOfFiles = arrayOfFiles || [];

    files.forEach((file) => {
        const filePath = path.join(dirPath, file);
        if (fs.statSync(filePath).isDirectory()) {
            arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
        } else {
            arrayOfFiles.push(filePath);
        }
    });

    return arrayOfFiles;
}

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
    return { mode: 'private', groupJid: '', groupName: '', privateJid: '', privateName: '' };
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

async function downloadFileWithResume(url, tempFilePath, customHeaders = {}, abortSignal = null) {
    const parsedUrl = new URL(url);
    const defaultHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': parsedUrl.origin + '/',
        'Origin': parsedUrl.origin
    };
    const headers = { ...defaultHeaders, ...customHeaders };

    let downloadedBytes = 0;
    let attempts = 0;
    const maxAttempts = 3;

    if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
    }

    while (attempts < maxAttempts) {
        attempts++;
        let writer = null;
        try {
            const requestHeaders = { ...headers };
            if (downloadedBytes > 0) {
                requestHeaders['Range'] = `bytes=${downloadedBytes}-`;
                writer = fs.createWriteStream(tempFilePath, { flags: 'a' });
                console.log(`[DanieDownload] Attempt ${attempts}: Resuming download from byte ${downloadedBytes}`);
            } else {
                writer = fs.createWriteStream(tempFilePath);
                console.log(`[DanieDownload] Attempt ${attempts}: Starting download`);
            }

            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'stream',
                headers: requestHeaders,
                timeout: 300000 // 5 minutes timeout per connection attempt
            });

            const status = response.status;
            if (downloadedBytes > 0 && status !== 206) {
                console.log(`[DanieDownload] Server returned status ${status} instead of 206. Restarting download.`);
                writer.end();
                fs.unlinkSync(tempFilePath);
                writer = fs.createWriteStream(tempFilePath);
                downloadedBytes = 0;
            }

            response.data.pipe(writer);

            let streamError = null;
            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', (err) => {
                    streamError = err;
                    reject(err);
                });
                response.data.on('error', (err) => {
                    streamError = err;
                    reject(err);
                });
                response.data.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                });
                if (abortSignal) {
                    abortSignal.addEventListener('abort', () => {
                        reject(new Error('Aborted'));
                    });
                }
            });

            if (!streamError) {
                console.log(`[DanieDownload] Download completed. Total bytes: ${downloadedBytes}`);
                // Reject suspiciously small files (likely HTML error pages, not video/audio)
                if (downloadedBytes < 5000) {
                    if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    throw new Error(`Downloaded file too small (${downloadedBytes} bytes) - likely an error page`);
                }
                return response.headers; // success!
            }
        } catch (err) {
            if (err.message === 'Aborted') {
                if (writer) writer.destroy();
                throw err;
            }
            console.error(`[DanieDownload] Attempt ${attempts} failed:`, err.message);
            if (writer) writer.destroy();

            if (attempts >= maxAttempts) {
                throw new Error(`Download failed after ${maxAttempts} attempts. Error: ${err.message}`);
            }
            
            // Wait 2 seconds before retry
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

// =========================================================================
//  IN-MEMORY STATE & DIRECT COMMAND HANDLER
//  Bypasses the obfuscated framework's command dispatch entirely.
//  All DanieWatch commands are handled here via raw messages.upsert.
// =========================================================================
function cleanJid(jid) {
    if (!jid) return '';
    const parts = jid.split('@');
    const user = parts[0].split(':')[0];
    let server = parts[1] || 's.whatsapp.net';
    if (server === 'c.us' || server === 's.whatsapp.net') {
        server = 's.whatsapp.net';
    }
    return `${user}@${server}`;
}

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

function getQuotedMessageId(mek) {
    const msg = mek.message;
    if (!msg) return null;
    const contextInfo = msg.extendedTextMessage?.contextInfo || 
                        msg.imageMessage?.contextInfo || 
                        msg.videoMessage?.contextInfo || 
                        msg.documentMessage?.contextInfo;
    return contextInfo?.stanzaId || null;
}

const pendingConfig = {};
const pendingSearch = {};
const VEGAMOVIES_DOMAIN = 'https://vegamovies.navy';
const ROGMOVIES_DOMAIN = 'https://rogmovies.rest';

// Our command prefix
const PREFIX = '.';

// Map of our command names to handler functions (populated after they're defined)
const DANIE_COMMANDS = {};
const ACTIVE_CHATS_PATH = path.join(__dirname, '..', '..', 'session', 'active_chats.json');

function loadActiveChats() {
    try {
        if (fs.existsSync(ACTIVE_CHATS_PATH)) {
            return JSON.parse(fs.readFileSync(ACTIVE_CHATS_PATH, 'utf-8'));
        }
    } catch (e) {
        console.error('[DanieWatch] Failed to load active_chats.json:', e.message);
    }
    return {};
}

function saveActiveChat(jid, name, notify) {
    if (!jid || typeof jid !== 'string') return;
    if (jid.endsWith('@g.us') || jid.includes('broadcast')) return;
    const clean = cleanJid(jid);
    if (!clean || clean.endsWith('@g.us') || clean.includes('broadcast')) return;

    const chatsMap = loadActiveChats();
    const existing = chatsMap[clean] || {};

    const cleanPhone = clean.split('@')[0];
    let newName = existing.name;
    let newNotify = existing.notify;

    if (name && typeof name === 'string' && name.trim() && name.trim() !== cleanPhone) {
        newName = name.trim();
    }
    if (notify && typeof notify === 'string' && notify.trim() && notify.trim() !== cleanPhone) {
        newNotify = notify.trim();
    }

    chatsMap[clean] = {
        id: clean,
        name: newName || undefined,
        notify: newNotify || undefined,
        lastUpdated: Date.now()
    };

    try {
        const dir = path.dirname(ACTIVE_CHATS_PATH);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(ACTIVE_CHATS_PATH, JSON.stringify(chatsMap, null, 2), 'utf-8');
    } catch (e) {
        console.error('[DanieWatch] Failed to save active_chats.json:', e.message);
    }
}

function getAllPrivateChats(conn, cleanSender) {
    const rawChats = [];

    // 1. From saved active_chats.json (captured from live WhatsApp events)
    const saved = loadActiveChats();
    Object.values(saved).forEach(c => rawChats.push(c));

    if (conn) {
        // 2. From conn.contacts
        if (conn.contacts) {
            try {
                const connContacts = conn.contacts instanceof Map ? Array.from(conn.contacts.values()) : Object.values(conn.contacts);
                connContacts.forEach(c => rawChats.push(c));
            } catch (e) {}
        }

        // 3. From conn.chats
        if (conn.chats) {
            try {
                const connChats = conn.chats instanceof Map ? Array.from(conn.chats.values()) : Object.values(conn.chats);
                connChats.forEach(c => rawChats.push(c));
            } catch (e) {}
        }

        // 4. From conn.store
        if (conn.store) {
            if (conn.store.contacts) {
                try {
                    const storeContacts = typeof conn.store.contacts.all === 'function'
                        ? conn.store.contacts.all()
                        : (conn.store.contacts instanceof Map ? Array.from(conn.store.contacts.values()) : Object.values(conn.store.contacts));
                    storeContacts.forEach(c => rawChats.push(c));
                } catch (e) {}
            }
            if (conn.store.chats) {
                try {
                    const storeChats = typeof conn.store.chats.all === 'function'
                        ? conn.store.chats.all()
                        : (conn.store.chats instanceof Map ? Array.from(conn.store.chats.values()) : Object.values(conn.store.chats));
                    storeChats.forEach(c => rawChats.push(c));
                } catch (e) {}
            }
        }
    }

    // Deduplicate and filter out groups / broadcasts
    const seen = new Set();
    let result = [];

    for (const c of rawChats) {
        if (!c || !c.id) continue;
        const clean = cleanJid(c.id);
        if (!clean || clean.endsWith('@g.us') || clean.includes('broadcast')) continue;

        const phone = clean.split('@')[0];
        const contactName = c.name || c.verifiedName;
        const notifyName = c.notify || c.pushName;

        if (seen.has(clean)) {
            const existingObj = result.find(r => r.id === clean);
            if (existingObj) {
                if (contactName && contactName !== phone) existingObj.name = contactName;
                if (notifyName && notifyName !== phone && !existingObj.name) existingObj.name = notifyName;
            }
            continue;
        }
        seen.add(clean);

        const displayName = (contactName && contactName !== phone) ? contactName : ((notifyName && notifyName !== phone) ? notifyName : phone);
        result.push({
            id: clean,
            name: displayName
        });
    }

    // Always include oneself first
    const selfChat = { id: cleanSender, name: 'You (Private Chat)' };
    const otherChats = result.filter(c => c.id !== cleanSender);

    return [selfChat, ...otherChats];
}

function initUpsertListener(conn) {
    if (conn.danieDownloadUpsertRegistered) return;
    conn.danieDownloadUpsertRegistered = true;

    // Listen to WhatsApp sync events to capture active chats & contacts
    try {
        if (conn.ev) {
            conn.ev.on('contacts.upsert', (contacts) => {
                const arr = Array.isArray(contacts) ? contacts : [contacts];
                for (const c of arr) if (c && c.id) saveActiveChat(c.id, c.name || c.verifiedName, c.notify);
            });
            conn.ev.on('contacts.update', (updates) => {
                const arr = Array.isArray(updates) ? updates : [updates];
                for (const c of arr) if (c && c.id) saveActiveChat(c.id, c.name || c.verifiedName, c.notify);
            });
            conn.ev.on('chats.upsert', (chats) => {
                const arr = Array.isArray(chats) ? chats : [chats];
                for (const c of arr) if (c && c.id) saveActiveChat(c.id, c.name || c.subject, c.notify);
            });
            conn.ev.on('messaging-history.set', (history) => {
                if (history && history.contacts && Array.isArray(history.contacts)) {
                    for (const c of history.contacts) if (c && c.id) saveActiveChat(c.id, c.name || c.verifiedName, c.notify);
                }
                if (history && history.chats && Array.isArray(history.chats)) {
                    for (const c of history.chats) if (c && c.id) saveActiveChat(c.id, c.name || c.subject, c.notify);
                }
                if (history && history.messages && Array.isArray(history.messages)) {
                    for (const m of history.messages) if (m && m.key && m.key.remoteJid) saveActiveChat(m.key.remoteJid, null, m.pushName);
                }
            });
        }
    } catch (e) {}

    conn.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            if (chatUpdate.type !== 'notify') return;
            const mek = chatUpdate.messages[0];
            if (!mek || !mek.message) return;

            const from = mek.key.remoteJid;
            let senderJid = mek.key.participant || mek.key.remoteJid;
            if (mek.key.fromMe && conn.user && conn.user.id) {
                senderJid = conn.user.id;
            }
            const cleanSender = cleanJid(senderJid);

            // Record incoming/outgoing chat JIDs
            if (from) saveActiveChat(from, null, mek.pushName);
            if (senderJid) saveActiveChat(senderJid, null, mek.pushName);

            const body = mek.message.conversation ||
                         mek.message.extendedTextMessage?.text ||
                         mek.message.buttonsResponseMessage?.selectedButtonId ||
                         mek.message.listResponseMessage?.singleSelectReply?.selectedRowId ||
                         '';
            const trimmedText = body.trim();
            if (!trimmedText) return;

            console.log(`[DanieWatch] Raw message received: from="${from}" sender="${senderJid}" cleanSender="${cleanSender}" fromMe=${mek.key.fromMe} text="${trimmedText}"`);
            console.log(`[DanieWatch] Current pendingConfig keys:`, Object.keys(pendingConfig));

            const reply = async (textMsg) => {
                return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
            };

            // ---- Clear pending states and abort active download if a new command starts ----
            if (trimmedText.startsWith(PREFIX)) {
                console.log(`[DanieWatch] Command starting with prefix detected: "${trimmedText}". Clearing pending states for ${cleanSender}`);
                if (pendingSearch[cleanSender] && pendingSearch[cleanSender].activeDownload) {
                    try {
                        console.log('[DanieWatch] Aborting active download due to new command execution.');
                        pendingSearch[cleanSender].activeDownload.controller.abort();
                        if (pendingSearch[cleanSender].activeDownload.ref && pendingSearch[cleanSender].activeDownload.ref.filePath) {
                            const fp = pendingSearch[cleanSender].activeDownload.ref.filePath;
                            if (fs.existsSync(fp)) fs.unlinkSync(fp);
                        }
                    } catch (e) {}
                }
                delete pendingConfig[cleanSender];
                delete pendingSearch[cleanSender];

                // Parse custom command and arguments
                const cmdPart = trimmedText.slice(PREFIX.length).trim();
                const spaceIdx = cmdPart.indexOf(' ');
                const cmdName = spaceIdx !== -1 ? cmdPart.substring(0, spaceIdx).trim().toLowerCase() : cmdPart.toLowerCase();
                const cmdArgs = spaceIdx !== -1 ? cmdPart.substring(spaceIdx + 1).trim() : '';

                if (DANIE_COMMANDS[cmdName]) {
                    console.log(`[DanieWatch] Executing custom command from upsert listener: "${cmdName}" with args: "${cmdArgs}"`);
                    
                    // Clear the message text to prevent the main bot framework from executing it again
                    if (mek.message.conversation) mek.message.conversation = '';
                    if (mek.message.extendedTextMessage?.text) mek.message.extendedTextMessage.text = '';

                    try {
                        await DANIE_COMMANDS[cmdName](conn, mek, from, senderJid, cmdArgs, reply);
                    } catch (cmdErr) {
                        console.error(`[DanieWatch] Error executing custom command "${cmdName}":`, cmdErr);
                        try {
                            await reply(`❌ Command execution failed: ${cmdErr.message}`);
                        } catch (_) {}
                    }
                }
                return;
            }

            // ---- Check if it's a plain-number reply for pending config ----
            if (pendingConfig[cleanSender]) {
                const quotedId = getQuotedMessageId(mek);
                const isValidNumber = /^\d+$/.test(trimmedText);
                const isMatch = (quotedId && quotedId === pendingConfig[cleanSender].messageId) || 
                                (!quotedId && isValidNumber);
                if (isMatch) {
                    console.log(`[DanieWatch] Directing reply "${trimmedText}" to handleConfigReply for ${cleanSender}.`);
                    await handleConfigReply(conn, mek, null, senderJid, trimmedText, reply);
                    return;
                }
            }

            // ---- Check if it's a plain-number reply for pending search/resolution ----
            if (pendingSearch[cleanSender]) {
                const quotedId = getQuotedMessageId(mek);
                const isValidNumber = /^\d+$/.test(trimmedText);
                const isMatch = (quotedId && quotedId === pendingSearch[cleanSender].messageId) || 
                                (!quotedId && isValidNumber);
                if (isMatch) {
                    console.log(`[DanieWatch] Directing reply "${trimmedText}" to handleSearchReply for ${cleanSender}.`);
                    await handleSearchReply(conn, mek, senderJid, trimmedText, reply);
                    return;
                }
            }
        } catch (err) {
            console.error('[DanieDownload] Error in messages.upsert handler:', err);
        }
    });
}

function isOwner(senderJid) {
    const ownerNum = (process.env.BOT_NUMBER || '').trim();
    const sudoNums = (process.env.SUDO || '').split(',').map(n => n.trim()).filter(Boolean);
    const allOwners = [ownerNum, ...sudoNums];
    const senderNum = cleanJid(senderJid).split('@')[0];
    return allOwners.includes(senderNum);
}

// Parse download command item (supports "=", space separation, or no name)
function parseDownloadItem(item) {
    let customFilename = null;
    let url = item.trim();

    const firstEqIdx = item.indexOf('=');
    if (firstEqIdx !== -1) {
        const leftPart = item.substring(0, firstEqIdx).trim();
        const rightPart = item.substring(firstEqIdx + 1).trim();
        
        // If the left part does NOT start with a URL protocol, it is the custom filename
        if (!leftPart.startsWith('http://') && !leftPart.startsWith('https://')) {
            customFilename = leftPart;
            url = rightPart;
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
}, async (conn, mek, m, { from, quoted, q }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
    try {
        const senderJid = m.sender || mek.sender || from;
        if (!isOwner(senderJid)) {
            return reply('❌ Only the bot owner can use this command.');
        }

        initUpsertListener(conn);

        const current = loadSettings();
        let modeLabel = '📥 *Private Chat*';
        if (current.mode === 'group') {
            modeLabel = `📤 *Group* → ${current.groupName || current.groupJid}`;
        } else if (current.mode === 'private' && current.privateJid) {
            modeLabel = `📥 *Private Chat* → ${current.privateName || current.privateJid}`;
        }

        if (q && q.trim()) {
            return handleConfigReply(conn, mek, m, senderJid, q.trim(), reply);
        }

        const cleanSender = cleanJid(senderJid);
        pendingConfig[cleanSender] = { step: 'mode', groups: [], chats: [], messageId: null };

        const sent = await reply(
            `⚙️ *DanieWatch Download Config*\n\n` +
            `Current setting: ${modeLabel}\n\n` +
            `Where should downloaded files be sent?\n\n` +
            `*Reply with:*\n` +
            `  \`1\` — 📥 Private Chats\n` +
            `  \`2\` — 📤 WhatsApp Groups\n\n` +
            `_Reply with just the number to select._`
        );
        if (sent && sent.key) {
            pendingConfig[cleanSender].messageId = sent.key.id;
        }
    } catch (error) {
        console.error('[DanieDownload] Config error:', error);
        reply(`❌ Config error: ${error.message}`);
    }
});

async function handleConfigReply(conn, mek, m, senderJid, text, reply) {
    const cleanSender = cleanJid(senderJid);
    const state = pendingConfig[cleanSender];
    const step = state ? state.step : 'mode';

    if (step === 'mode') {
        if (text === '1') {
            await reply('🔍 Fetching private chats...');
            try {
                const privateChats = getAllPrivateChats(conn, cleanSender);

                pendingConfig[cleanSender] = { step: 'private_chat', chats: privateChats, messageId: null };

                let list = '📋 *Select a Private Chat:*\n\n';
                privateChats.forEach((c, i) => {
                    const phone = c.id.split('@')[0];
                    if (c.id === cleanSender) {
                        list += `  \`${i + 1}\` — 👤 You (Private Chat)\n`;
                    } else if (c.name && c.name !== phone) {
                        list += `  \`${i + 1}\` — 👤 ${c.name} (+${phone})\n`;
                    } else {
                        list += `  \`${i + 1}\` — 👤 +${phone}\n`;
                    }
                });
                list += `\n_Reply with just the number to choose._`;

                const sent = await reply(list);
                if (sent && sent.key) {
                    pendingConfig[cleanSender].messageId = sent.key.id;
                }
                return sent;
            } catch (err) {
                delete pendingConfig[cleanSender];
                return reply(`❌ Failed to fetch private chats: ${err.message}`);
            }
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
                    delete pendingConfig[cleanSender];
                    return reply('❌ No groups found. Make sure the bot is added to at least one group.');
                }

                pendingConfig[cleanSender] = { step: 'group', groups, messageId: null };

                let list = '📋 *Select a WhatsApp Group:*\n\n';
                groups.forEach((g, i) => {
                    list += `  \`${i + 1}\` — ${g.subject}\n`;
                });
                list += `\n_Reply with just the number to choose._`;

                const sent = await reply(list);
                if (sent && sent.key) {
                    pendingConfig[cleanSender].messageId = sent.key.id;
                }
                return sent;
            } catch (err) {
                delete pendingConfig[cleanSender];
                return reply(`❌ Failed to fetch groups: ${err.message}`);
            }
        }
        return reply('❌ Invalid option. Reply with `1` (Private Chats) or `2` (WhatsApp Groups).');
    }

    if (step === 'private_chat') {
        const num = parseInt(text, 10);
        const chats = state.chats || [];

        if (isNaN(num) || num < 1 || num > chats.length) {
            return reply(`❌ Invalid selection. Reply with a number from 1 to ${chats.length}.`);
        }

        const chosen = chats[num - 1];
        const chosenName = chosen.name || chosen.id.split('@')[0];
        const settings = { mode: 'private', privateJid: chosen.id, privateName: chosenName, groupJid: '', groupName: '' };
        saveSettings(settings);
        delete pendingConfig[cleanSender];
        return reply(`✅ Download destination set to Private Chat:\n👤 Name: *${chosenName}*\n🆔 \`${chosen.id}\``);
    }

    if (step === 'group') {
        const num = parseInt(text, 10);
        const groups = state.groups || [];

        if (isNaN(num) || num < 1 || num > groups.length) {
            return reply(`❌ Invalid selection. Reply with a number from 1 to ${groups.length}.`);
        }

        const chosen = groups[num - 1];
        const settings = { mode: 'group', groupJid: chosen.jid, groupName: chosen.subject, privateJid: '', privateName: '' };
        saveSettings(settings);
        delete pendingConfig[cleanSender];
        return reply(`✅ Download destination set to Group:\n📤 Name: *${chosen.subject}*\n🆔 \`${chosen.jid}\``);
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
}, async (conn, mek, m, { from, quoted, q }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
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

        const cleanSender = cleanJid(senderJid);

        if (!arg || arg === 'list') {
            pendingConfig[cleanSender] = { step: 'group', groups };

            let list = '📋 *Your Groups:*\n\n';
            groups.forEach((g, i) => {
                list += `  \`${i + 1}\` — ${g.subject}\n`;
            });
            list += `\n_Reply with just the number to select._`;
            return reply(list);
        }

        const num = parseInt(arg, 10);
        if (isNaN(num) || num < 1 || num > groups.length) {
            return reply(`❌ Invalid selection. Use a number from 1 to ${groups.length}.\nUse \`.setgroup list\` to see all groups.`);
        }

        const chosen = groups[num - 1];
        const settings = { mode: 'group', groupJid: chosen.jid, groupName: chosen.subject, privateJid: '', privateName: '' };
        saveSettings(settings);
        delete pendingConfig[cleanSender];
        return reply(`✅ Download target set to group: *${chosen.subject}*\n🆔 \`${chosen.jid}\``);

    } catch (error) {
        console.error('[DanieDownload] Setgroup error:', error);
        reply(`❌ Error: ${error.message}`);
    }
});

function parseQueryToItems(q) {
    if (!q) return [];
    
    // Find all HTTP/HTTPS URLs with their indices
    const urlRegex = /https?:\/\/[^\s,]+/gi;
    const matches = [];
    let match;
    while ((match = urlRegex.exec(q)) !== null) {
        matches.push({
            url: match[0],
            index: match.index,
            length: match[0].length
        });
    }

    if (matches.length === 0) {
        // No URLs found, fallback to original comma split
        return q.split(',').map(item => item.trim()).filter(Boolean);
    }

    const splitPoints = [0];
    for (let i = 0; i < matches.length - 1; i++) {
        const endOfCurrentUrl = matches[i].index + matches[i].length;
        const startOfNextUrl = matches[i+1].index;
        const midText = q.substring(endOfCurrentUrl, startOfNextUrl);
        
        const lastCommaIdx = midText.lastIndexOf(',');
        if (lastCommaIdx !== -1) {
            splitPoints.push(endOfCurrentUrl + lastCommaIdx);
        } else {
            const lastSpaceIdx = midText.lastIndexOf(' ');
            if (lastSpaceIdx !== -1) {
                splitPoints.push(endOfCurrentUrl + lastSpaceIdx);
            } else {
                splitPoints.push(endOfCurrentUrl);
            }
        }
    }
    splitPoints.push(q.length);

    const items = [];
    for (let i = 0; i < splitPoints.length - 1; i++) {
        let itemText = q.substring(splitPoints[i], splitPoints[i+1]).trim();
        itemText = itemText.replace(/^[\s,]+|[\s,]+$/g, '').trim();
        if (itemText) {
            items.push(itemText);
        }
    }
    
    return items;
}

// =========================================================================
//  .download — Enhanced: supports multiple files, movie scraping, TMDB info
// =========================================================================
async function downloadCommandHandler(conn, mek, from, senderJid, q, reply, abortSignal = null, activeDownloadRef = null, preferredServer = null, silentErrors = false) {
    console.log("=== DOWNLOAD COMMAND TRIGGERED ===");
    console.log("q:", q);
    try {
        if (!q) {
            return reply(
                '❌ Please provide a download link!\n\n' +
                '*Usage:*\n' +
                '`.d https://example.com/file.zip`\n' +
                '`.d myname.zip = https://example.com/file.zip`\n' +
                '`.d file1 = link1, file2 link2`\n' +
                '`.d https://vegamovies.dad/some-movie/`'
            );
        }

        const items = parseQueryToItems(q);

        const settings = loadSettings();
        const isGroupMode = settings.mode === 'group' && settings.groupJid;
        const destJid = isGroupMode ? settings.groupJid : (settings.privateJid || senderJid);
        const destLabel = isGroupMode ? `📤 Group: *${settings.groupName}*` : `📥 Private Chat: *${settings.privateName || 'You'}*`;

        for (let i = 0; i < items.length; i++) {
            let { customFilename, url } = parseDownloadItem(items[i]);
            let targetFilename = customFilename;

            if (items.length > 1) {
                await reply(`⏳ Processing file *${i + 1}/${items.length}*...\n📍 Target: ${targetFilename || 'Auto-detect'}`);
            }

            // Direct download bypass (no movie scraping/resolution)

            // Basic URL validation
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                await reply(`❌ Invalid link format for item ${i + 1}! Skipping.\nParsed URL: \`${url}\``);
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

            // If the URL points to a redirector/landing page, resolve it first
            if (isLandingUrl(url)) {
                try {
                    const resolved = await resolveVcloudLink(url, preferredServer);
                    if (resolved && resolved !== url) {
                        url = resolved;
                        console.log('[DanieDownload] Resolved redirect URL:', url);
                    }
                } catch (e) {
                    console.error('[DanieDownload] Failed to resolve redirect link:', e.message);
                }
            }

            if (activeDownloadRef) {
                activeDownloadRef.filePath = tempFilePath;
            }

            // Download using resume-enabled download function
            const responseHeaders = await downloadFileWithResume(url, tempFilePath, {}, abortSignal);

            // Extract real filename from Content-Disposition header
            const contentDisposition = (responseHeaders && responseHeaders['content-disposition']) || '';
            if (contentDisposition) {
                try {
                    const cdMatch = contentDisposition.match(/filename\*?=['"]?(?:UTF-8'')?([^;\n"']+)/i);
                    if (cdMatch && cdMatch[1]) {
                        const cdFilename = decodeURIComponent(cdMatch[1].trim());
                        if (cdFilename && cdFilename.includes('.')) {
                            if (!targetFilename) tempFilename = cdFilename;
                            console.log('[DanieDownload] Detected filename from Content-Disposition:', cdFilename);
                        }
                    }
                } catch (err) {
                    console.error('[DanieDownload] Content-Disposition parse error:', err.message);
                }
            }

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

            // Determine extension from URL path, tempFilename, or Content-Disposition
            let ext = '';
            try {
                const urlPath = new URL(url).pathname;
                const urlFile = urlPath.substring(urlPath.lastIndexOf('/') + 1);
                if (urlFile && urlFile.includes('.')) {
                    ext = urlFile.split('.').pop();
                }
            } catch (err) {}
            if (!ext && tempFilename && tempFilename.includes('.')) {
                ext = tempFilename.split('.').pop();
            }
            if (!ext) ext = 'mp4'; // fallback

            // Detect mime type using file magic bytes (read only first 4100 bytes, not the whole file)
            let mime = (responseHeaders && responseHeaders['content-type']) || 'application/octet-stream';
            try {
                const fd = fs.openSync(tempFilePath, 'r');
                const magicBuffer = Buffer.alloc(4100);
                fs.readSync(fd, magicBuffer, 0, 4100, 0);
                fs.closeSync(fd);
                const detectedType = await fileType.fromBuffer(magicBuffer);
                if (detectedType) {
                    mime = detectedType.mime;
                    ext = detectedType.ext;
                }
            } catch (err) {
                console.error('[DanieDownload] file-type detection error:', err.message);
            }

            const extLower = ext.toLowerCase();
            const isArchive = ['zip', 'tar', 'gz', 'tgz', 'rar', 'rar5', '7z'].includes(extLower) ||
                              ['application/zip', 'application/x-tar', 'application/x-rar-compressed', 'application/x-gzip', 'application/x-zip-compressed'].includes(mime.toLowerCase());

            if (isArchive) {
                let FolderName = '';
                if (targetFilename) {
                    FolderName = cleanFileName(targetFilename);
                } else {
                    FolderName = cleanFileName(tempFilename);
                }

                await reply(`📦 Archive detected: *${tempFilename}*. Extracting files...`);
                const targetDir = path.join(__dirname, 'extracted_' + Date.now());
                try {
                    extractArchive(tempFilePath, targetDir);
                    
                    // Traverse and find files
                    const filesToUpload = getAllFiles(targetDir);
                    console.log(`[DanieDownload] Extracted files:`, filesToUpload);

                    // Detect shared root folder inside zip
                    let archiveRootFolder = null;
                    if (filesToUpload.length > 0) {
                        const normalizedFiles = filesToUpload.map(f => path.relative(targetDir, f).replace(/\\/g, '/'));
                        const firstRelative = normalizedFiles[0];
                        const firstRoot = firstRelative.split('/')[0];
                        const allShareRoot = normalizedFiles.every(f => {
                            return f.split('/')[0] === firstRoot && f.split('/').length > 1;
                        });
                        if (allShareRoot) {
                            archiveRootFolder = firstRoot;
                        }
                    }
                    
                    let uploadedCount = 0;
                    for (const filePath of filesToUpload) {
                        const baseName = path.basename(filePath);
                        const isJunk = baseName.startsWith('.') || baseName.startsWith('._') || filePath.includes('__MACOSX');
                        if (isJunk) continue;
                        
                        const stats = fs.statSync(filePath);
                        const fileSizeInBytes = stats.size;
                        const fileSizeInMB = (fileSizeInBytes / (1024 * 1024)).toFixed(2);
                        
                        if (fileSizeInBytes > 2000 * 1024 * 1024) {
                            await reply(`⚠️ Skipping extracted file *${baseName}* because it exceeds 2 GB size limit (${fileSizeInMB} MB).`);
                            continue;
                        }
                        
                        // Detect mime type of extracted file
                        let fileMime = 'application/octet-stream';
                        let fileExt = path.extname(filePath).substring(1);
                        try {
                            const fileBuffer = fs.readFileSync(filePath, { start: 0, end: 4100 });
                            const detectedType = await fileType.fromBuffer(fileBuffer);
                            if (detectedType) {
                                fileMime = detectedType.mime;
                                fileExt = detectedType.ext;
                            }
                        } catch (err) {}
                        
                        // Determine relative path and apply FolderName
                        let relPath = path.relative(targetDir, filePath).replace(/\\/g, '/');
                        if (archiveRootFolder) {
                            // Strip root folder
                            const prefixLength = archiveRootFolder.length + 1;
                            relPath = relPath.substring(prefixLength);
                        }

                        let finalFileNamePath = path.join(FolderName, relPath);
                        let finalFileName = finalFileNamePath.replace(/\\/g, '/')
                                                            .replace(/hdhub4u/gi, 'DANIEWATCH')
                                                            .replace(/vegamovies/gi, 'DANIEWATCH')
                                                            .replace(/rogmovies/gi, 'DANIEWATCH');
                        
                        if (fileExt && !finalFileName.toLowerCase().endsWith('.' + fileExt.toLowerCase())) {
                            finalFileName += '.' + fileExt;
                        }
                        
                        await reply(`📤 Uploading extracted file: *${finalFileName}* (${fileSizeInMB} MB)`);
                        
                        await conn.sendMessage(destJid, {
                            document: { url: filePath },
                            mimetype: fileMime,
                            fileName: finalFileName
                        }, destJid === from ? { quoted: mek } : {});
                        
                        uploadedCount++;
                    }
                    
                    await reply(`✅ Successfully extracted and processed archive. Uploaded *${uploadedCount}* file(s).`);
                } catch (err) {
                    await reply(`❌ Failed to extract or process archive: ${err.message}`);
                } finally {
                    // Clean up extracted directory and archive file
                    try {
                        if (fs.existsSync(targetDir)) {
                            if (fs.rmSync) fs.rmSync(targetDir, { recursive: true, force: true });
                            else fs.rmdirSync(targetDir, { recursive: true });
                        }
                    } catch (_) {}
                    try {
                        if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
                    } catch (_) {}
                }
            } else {
                // Non-archive file upload
                let displayName = '';
                if (targetFilename) {
                    displayName = cleanFileName(targetFilename);
                } else {
                    displayName = cleanFileName(tempFilename);
                }

                let finalFileName = displayName.replace(/hdhub4u/gi, 'DANIEWATCH')
                                                .replace(/vegamovies/gi, 'DANIEWATCH')
                                                .replace(/rogmovies/gi, 'DANIEWATCH');
                if (ext && !finalFileName.toLowerCase().endsWith('.' + ext.toLowerCase())) {
                    finalFileName += '.' + ext;
                }

                await conn.sendMessage(destJid, {
                    document: { url: tempFilePath },
                    mimetype: mime,
                    fileName: finalFileName
                }, destJid === from ? { quoted: mek } : {});

                // Delete temporary file
                fs.unlinkSync(tempFilePath);
            }
        }

    } catch (error) {
        if (error.message === 'Aborted') {
            console.log('[DanieDownload] Download task aborted.');
            throw error;
        }
        console.error('Download command error:', error);
        if (!silentErrors) {
            try {
                await reply(`❌ Failed to download/upload file: ${error.message}`);
            } catch (replyErr) {
                console.error('[DanieDownload] Failed to send error reply (connection likely closed):', replyErr.message);
            }
        }
        throw error;
    }
}

async function pCommandHandler(conn, mek, from, senderJid, q, reply) {
    console.log("=== P COMMAND TRIGGERED ===");
    console.log("q:", q);
    try {
        if (!q) {
            return reply(
                '❌ Please provide a TMDB link and download url(s)!\n\n' +
                '*Usage:*\n' +
                '`.p https://www.themoviedb.org/movie/550 = https://example.com/file1.mp4`\n' +
                '`.p https://www.themoviedb.org/movie/550 = https://example.com/file1.mp4, Episode 2 = https://example.com/file2.mp4`'
            );
        }

        const items = q.split(',').map(item => item.trim()).filter(Boolean);
        
        // Find TMDB URL in the first item
        let { customFilename: firstCustomName, url: firstUrl } = parseDownloadItem(items[0]);
        let tmdbUrl = '';
        if (firstCustomName && /themoviedb\.org\/(movie|tv)\/(\d+)/i.test(firstCustomName)) {
            tmdbUrl = firstCustomName;
        } else if (/themoviedb\.org\/(movie|tv)\/(\d+)/i.test(firstUrl)) {
            tmdbUrl = firstUrl;
        }

        if (!tmdbUrl) {
            return reply('❌ Error: First item must specify a valid TMDB URL (e.g. `.p https://www.themoviedb.org/movie/550 = ...`)');
        }

        const match = tmdbUrl.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
        const mediaType = match[1];
        const tmdbId = match[2];

        await reply(`⏳ Fetching TMDB metadata...`);
        const tmdb = await fetchTmdbById(tmdbId, mediaType);

        if (!tmdb) {
            return reply('❌ Error: Could not fetch metadata for that TMDB URL.');
        }

        const settings = loadSettings();
        const isGroupMode = settings.mode === 'group' && settings.groupJid;
        const destJid = isGroupMode ? settings.groupJid : (settings.privateJid || senderJid);
        const destLabel = isGroupMode ? `📤 Group: *${settings.groupName}*` : `📥 Private Chat: *${settings.privateName || 'You'}*`;

        // 1. Format details message (remove top/bottom branding, append daniewatch)
        let seasonText = '';
        let episodeText = '';
        if (mediaType === 'tv') {
            const seasonMatch = tmdbUrl.match(/\/season\/(\d+)/i);
            const specifiedSeason = seasonMatch ? parseInt(seasonMatch[1], 10) : null;

            if (specifiedSeason !== null) {
                const targetSeason = tmdb.seasons.find(s => s.season_number === specifiedSeason);
                const epCount = targetSeason ? targetSeason.episode_count : 0;
                const sLabel = `S${String(specifiedSeason).padStart(2, '0')}`;
                seasonText = `📺 *Season:* *${sLabel}*\n`;
                episodeText = `🔢 *Episodes:* *E01 - E${String(epCount).padStart(2, '0')}*\n`;
                
                if (targetSeason && targetSeason.overview) {
                    tmdb.overview = targetSeason.overview;
                }
            } else {
                const validSeasons = tmdb.seasons.filter(s => s.season_number > 0);
                if (validSeasons.length > 0) {
                    const minSeason = Math.min(...validSeasons.map(s => s.season_number));
                    const maxSeason = Math.max(...validSeasons.map(s => s.season_number));
                    const minLabel = `S${String(minSeason).padStart(2, '0')}`;
                    const maxLabel = `S${String(maxSeason).padStart(2, '0')}`;
                    
                    if (minSeason === maxSeason) {
                        seasonText = `📺 *Season:* *${minLabel}*\n`;
                    } else {
                        seasonText = `📺 *Season:* *${minLabel} - ${maxLabel}*\n`;
                    }
                    
                    episodeText = `🔢 *Episodes:*\n`;
                    validSeasons.forEach(s => {
                        const epCount = s.episode_count;
                        episodeText += `   • Season ${s.season_number}: *E01 - E${String(epCount).padStart(2, '0')}*\n`;
                    });
                }
            }
        }

        let detailsMessage = `📝 *Title:* *${tmdb.title}*\n`;
        detailsMessage += `📅 *Year:* *${tmdb.year}*\n`;
        if (seasonText) detailsMessage += seasonText;
        detailsMessage += `🎭 *Genre:* *${tmdb.genres}*\n`;
        if (episodeText) detailsMessage += episodeText;
        detailsMessage += `\n👑 *『 \u{1D403}\u{1D400}\u{1D40D}\u{1D408}\u{1D404}\u{1D416}\u{1D400}\u{1D413}\u{1D402}\u{1D407} 』* 👑`;

        // 2. Download and send poster image first to configured destJid
        const posterUrl = tmdb.posterUrl;
        let posterSent = false;
        if (posterUrl) {
            const tempPosterPath = path.join(__dirname, 'tmp_poster_' + Date.now() + '.jpg');
            try {
                const parsedPosterUrl = new URL(posterUrl);
                const posterResponse = await axios({
                    method: 'get',
                    url: posterUrl,
                    responseType: 'stream',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'image/*',
                        'Referer': parsedPosterUrl.origin + '/'
                    },
                    timeout: 30000
                });
                
                const posterWriter = fs.createWriteStream(tempPosterPath);
                posterResponse.data.pipe(posterWriter);
                
                await new Promise((resolve, reject) => {
                    posterWriter.on('finish', resolve);
                    posterWriter.on('error', reject);
                });
                
                if (fs.existsSync(tempPosterPath)) {
                    await conn.sendMessage(destJid, {
                        image: { url: tempPosterPath },
                        caption: detailsMessage
                    }, destJid === from ? { quoted: mek } : {});
                    posterSent = true;
                    fs.unlinkSync(tempPosterPath);
                }
            } catch (err) {
                console.error('[DanieDownload] Failed to download/send local TMDB poster:', err.message);
                if (fs.existsSync(tempPosterPath)) {
                    try { fs.unlinkSync(tempPosterPath); } catch (_) {}
                }
            }
        }
        
        if (!posterSent) {
            await conn.sendMessage(destJid, {
                text: detailsMessage
            }, destJid === from ? { quoted: mek } : {});
        }

        await reply(`✅ TMDB details and poster successfully fetched and sent to: *${destLabel}*`);

    } catch (error) {
        console.error('P command error:', error);
        reply(`❌ Failed to process P command: ${error.message}`);
    }
}

cmd({
    pattern: 'd',
    react: '📥',
    desc: 'Downloads files. Supports multiple files separated by commas, Vegamovies/Rogmovies/HDHub4u auto-scraping, and TMDB integration.',
    category: 'download',
    use: '.d <link>  OR  .d name = <link>  OR  .d name1 = link1, name2 link2',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
    const senderJid = m.sender || mek.sender || from;
    await downloadCommandHandler(conn, mek, from, senderJid, q, reply);
});

cmd({
    pattern: 'p',
    react: '🎬',
    desc: 'Downloads files with TMDB metadata. The first item\'s name should be a TMDB URL.',
    category: 'download',
    use: '.p <TMDB_URL> = <link1>, <name2> = <link2>, ...',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
    const senderJid = m.sender || mek.sender || from;
    await pCommandHandler(conn, mek, from, senderJid, q, reply);
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
}, async (conn, mek, m, { from }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
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
}, async (conn, mek, m, { from }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
    try {
        const settings = loadSettings();
        const modeEmoji = settings.mode === 'group' ? '📤' : '📥';
        const modeLabel = settings.mode === 'group'
            ? `Group → *${settings.groupName || 'Unknown'}*\n🆔 \`${settings.groupJid}\``
            : `Private Chat → *${settings.privateName || 'You'}*\n🆔 \`${settings.privateJid || 'N/A'}\``;

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

// =========================================================================
//  REGISTER DIRECT COMMAND HANDLERS
//  These bypass the obfuscated framework entirely via messages.upsert
// =========================================================================
DANIE_COMMANDS['config'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!isOwner(senderJid)) return reply('❌ Only the bot owner can use this command.');
    initUpsertListener(conn);
    const current = loadSettings();
    let modeLabel = '📥 *Private Chat*';
    if (current.mode === 'group') modeLabel = `📤 *Group* → ${current.groupName || current.groupJid}`;
    else if (current.mode === 'private' && current.privateJid) modeLabel = `📥 *Private Chat* → ${current.privateName || current.privateJid}`;
    if (args) return handleConfigReply(conn, mek, null, senderJid, args, reply);
    const cleanSender = cleanJid(senderJid);
    pendingConfig[cleanSender] = { step: 'mode', groups: [], chats: [], messageId: null };
    const sent = await reply(
        `⚙️ *DanieWatch Download Config*\n\n` +
        `Current setting: ${modeLabel}\n\n` +
        `Where should downloaded files be sent?\n\n` +
        `*Reply with:*\n` +
        `  \`1\` — 📥 Private Chats\n` +
        `  \`2\` — 📤 WhatsApp Groups\n\n` +
        `_Reply with just the number to select._`
    );
    if (sent && sent.key) {
        pendingConfig[cleanSender].messageId = sent.key.id;
    }
};

DANIE_COMMANDS['setgroup'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!isOwner(senderJid)) return reply('❌ Only the bot owner can use this command.');
    initUpsertListener(conn);
    let groupsObj;
    try { groupsObj = await conn.groupFetchAllParticipating(); } catch (err) { return reply(`❌ Failed to fetch groups: ${err.message}`); }
    const groups = Object.values(groupsObj).map(g => ({ jid: g.id, subject: g.subject || 'Unknown Group' }));
    if (groups.length === 0) return reply('❌ No groups found.');
    const cleanSender = cleanJid(senderJid);
    const arg = (args || '').trim().toLowerCase();
    if (!arg || arg === 'list') {
        pendingConfig[cleanSender] = { step: 'group', groups, messageId: null };
        let list = '📋 *Your Groups:*\n\n';
        groups.forEach((g, i) => { list += `  \`${i + 1}\` — ${g.subject}\n`; });
        list += `\n_Reply with just the number to select._`;
        const sent = await reply(list);
        if (sent && sent.key) {
            pendingConfig[cleanSender].messageId = sent.key.id;
        }
        return sent;
    }
    const num = parseInt(arg, 10);
    if (isNaN(num) || num < 1 || num > groups.length) return reply(`❌ Invalid selection. Use a number from 1 to ${groups.length}.`);
    const chosen = groups[num - 1];
    saveSettings({ mode: 'group', groupJid: chosen.jid, groupName: chosen.subject, privateJid: '', privateName: '' });
    return reply(`✅ Download target set to group: *${chosen.subject}*\n🆔 \`${chosen.jid}\``);
};

DANIE_COMMANDS['groupid'] = async (conn, mek, from, senderJid, args, reply) => {
    await reply(`*Current Chat ID:* \`${from}\``);
};

DANIE_COMMANDS['dlstatus'] = async (conn, mek, from, senderJid, args, reply) => {
    const settings = loadSettings();
    const modeEmoji = settings.mode === 'group' ? '📤' : '📥';
    const modeLabel = settings.mode === 'group'
        ? `Group → *${settings.groupName || 'Unknown'}*\n🆔 \`${settings.groupJid}\``
        : `Private Chat → *${settings.privateName || 'You'}*\n🆔 \`${settings.privateJid || 'N/A'}\``;
    await reply(`📊 *Download Config Status*\n\n${modeEmoji} Mode: *${settings.mode}*\n📍 Destination: ${modeLabel}\n\n_Use \`.config\` to change._`);
};
DANIE_COMMANDS['dlconfig'] = DANIE_COMMANDS['dlstatus'];
DANIE_COMMANDS['downloadstatus'] = DANIE_COMMANDS['dlstatus'];

DANIE_COMMANDS['d'] = async (conn, mek, from, senderJid, args, reply) => {
    await downloadCommandHandler(conn, mek, from, senderJid, args, reply);
};

DANIE_COMMANDS['p'] = async (conn, mek, from, senderJid, args, reply) => {
    await pCommandHandler(conn, mek, from, senderJid, args, reply);
};

DANIE_COMMANDS['sv'] = async (conn, mek, from, senderJid, args, reply) => {
    await searchCommandHandler(conn, mek, from, senderJid, args, reply, 'vegamovies');
};

DANIE_COMMANDS['sr'] = async (conn, mek, from, senderJid, args, reply) => {
    await searchCommandHandler(conn, mek, from, senderJid, args, reply, 'rogmovies');
};

async function searchCommandHandler(conn, mek, from, senderJid, q, reply, source = 'vegamovies') {
    try {
        const isRog = source === 'rogmovies';
        const siteName = isRog ? 'Rogmovies' : 'Vegamovies';
        const siteDomain = isRog ? ROGMOVIES_DOMAIN : VEGAMOVIES_DOMAIN;
        const cmdHint = isRog ? '.sr' : '.sv';

        if (!q || !q.trim()) {
            return reply(`❌ Please provide a search keyword!\n\n*Usage:*\n\`${cmdHint} Deadpool\``);
        }

        const query = q.trim();
        await reply(`🔍 Searching ${siteName} for *"${query}"*...`);

        initUpsertListener(conn);

        const url = `${siteDomain}/search.php?q=${encodeURIComponent(query)}&page=1`;
        console.log(`[DanieSearch] Fetching ${siteName} search API: ${url}`);
        
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Referer': siteDomain + '/'
            },
            timeout: 15000
        });

        if (!res.data || res.data.found === 0 || !res.data.hits || res.data.hits.length === 0) {
            return reply(`❌ No search results found for *"${query}"* on ${siteName}.`);
        }

        const hits = res.data.hits;
        const results = hits.map(h => ({
            title: h.document.post_title.replace(/&amp;/g, '&'),
            permalink: h.document.permalink,
            thumbnail: h.document.post_thumbnail
        }));

        const cleanSender = cleanJid(senderJid);
        pendingSearch[cleanSender] = {
            step: 'select_movie',
            results: results,
            sourceDomain: siteDomain,
            messageId: null
        };

        let responseText = `🔍 *${siteName} Search Results for "${query}":*\n\n`;
        results.forEach((r, idx) => {
            responseText += `  \`${idx + 1}\` — ${r.title}\n\n`;
        });
        responseText = responseText.trim() + `\n\n_Reply with the number of the movie you want to select._`;

        const sent = await reply(responseText);
        if (sent && sent.key) {
            pendingSearch[cleanSender].messageId = sent.key.id;
        }
    } catch(err) {
        console.error('[DanieSearch] Search failed:', err.message);
        reply(`❌ Search failed: ${err.message}`);
    }
}

async function executeFallbackDownload(conn, mek, from, senderJid, state, chosenHosts, reply) {
    const controller = new AbortController();
    const activeDownloadRef = { filePath: null };
    state.activeDownload = {
        controller,
        ref: activeDownloadRef
    };

    // Transition step back so the user can make another choice immediately
    if (state.episodesList && state.episodesList.length > 0) {
        state.step = 'select_episode';
    } else {
        state.step = 'select_resolution';
    }

    // Start background download pipeline
    (async () => {
        try {
            const hostsList = Array.isArray(chosenHosts) ? chosenHosts : [chosenHosts];
            let candidates = [];
            
            // Prefer VCloud hosts (vcloud.zip, hubcloud) over other landing pages (fastdl, filebee)
            const vcloudHosts = hostsList.filter(h => {
                const lh = (h.href || '').toLowerCase();
                return lh.includes('vcloud') || lh.includes('hubcloud');
            });
            const hostsToProcess = vcloudHosts.length > 0 ? vcloudHosts : hostsList;
            
            const candidates10g = [];
            const candidatesFslv2 = [];
            const candidatesFsl = [];
            const candidatesOther = [];

            for (const host of hostsToProcess) {
                if (isLandingUrl(host.href)) {
                    console.log(`[DanieSearch] Resolving sub-options for landing url: ${host.href}`);
                    
                    let subOpts = null;
                    // Try up to 2 attempts for sub-options extraction
                    for (let attempt = 1; attempt <= 2; attempt++) {
                        try {
                            subOpts = await extractSubOptions(host.href);
                            // Check if we got real server options (not just 'Original Link' fallback)
                            const hasRealServers = subOpts.some(opt => {
                                const t = opt.text.toLowerCase();
                                return t.includes('fsl') || t.includes('10gbps') || t.includes('server');
                            });
                            if (hasRealServers || attempt >= 2) break;
                            // Only got 'Original Link' - retry after delay
                            console.log(`[DanieSearch] Sub-options attempt ${attempt} returned no servers, retrying in 3s...`);
                            await new Promise(r => setTimeout(r, 3000));
                        } catch (subErr) {
                            console.error(`[DanieSearch] Sub-options attempt ${attempt} failed for ${host.href}:`, subErr.message);
                            if (attempt < 2) {
                                console.log(`[DanieSearch] Retrying sub-options in 3s...`);
                                await new Promise(r => setTimeout(r, 3000));
                            }
                        }
                    }
                    
                    if (subOpts && subOpts.length > 0) {
                        const opt10gbps = subOpts.find(opt => opt.text.toLowerCase().includes('10gbps'));
                        const optFslv2 = subOpts.find(opt => opt.text.toLowerCase().includes('fslv2'));
                        const optFsl = subOpts.find(opt => opt.text.toLowerCase().includes('fsl') && !opt.text.toLowerCase().includes('fslv2'));
                        
                        if (opt10gbps) candidates10g.push({ name: '10Gbps Server', href: opt10gbps.href });
                        if (optFslv2) candidatesFslv2.push({ name: 'FSLv2 Server', href: optFslv2.href });
                        if (optFsl) candidatesFsl.push({ name: 'FSL Server', href: optFsl.href });
                        
                        subOpts.forEach(opt => {
                            const txt = opt.text.toLowerCase();
                            if (!txt.includes('10gbps') && !txt.includes('fsl') && !txt.includes('fslv2') && !txt.includes('login') && !txt.includes('admin')) {
                                candidatesOther.push({ name: opt.text, href: opt.href });
                            }
                        });
                    }
                } else {
                    candidatesOther.push({ name: host.text || 'Direct Link', href: host.href });
                }
            }

            // If VCloud servers exist (FSLv2, FSL, 10Gbps), use ONLY those — skip unreliable hosts
            const hasVcloudServers = candidatesFslv2.length > 0 || candidatesFsl.length > 0 || candidates10g.length > 0;
            if (hasVcloudServers) {
                // Priority: FSLv2 -> FSL -> 10Gbps (last resort, often 404s on cloud IPs)
                candidates = [
                    ...candidatesFslv2,
                    ...candidatesFsl,
                    ...candidates10g
                ];
            } else {
                candidates = [...candidatesOther];
            }
            
            // If no specific candidates found, fallback to original hosts themselves
            if (candidates.length === 0) {
                for (const host of hostsList) {
                    candidates.push({ name: host.text || 'Direct Link', href: host.href });
                }
            }

            console.log(`[DanieSearch] Fallback system candidates:`, candidates.map(c => c.name));

            // Prepare base title using custom filename generation
            const primaryHost = hostsList[0] || {};
            let sanitizedTitle = generateCustomFileName(state, primaryHost);
            if (!sanitizedTitle) {
                sanitizedTitle = (state.resolutionHeading || state.title || 'Movie')
                    .replace(/[:*?"<>|\\/]/g, '') // remove invalid filename chars
                    .trim();
                if (primaryHost.episode) {
                    sanitizedTitle = `${sanitizedTitle} ${primaryHost.episode}`;
                }
            }

            let downloadSuccess = false;
            let lastError = null;

            for (let i = 0; i < candidates.length; i++) {
                const cand = candidates[i];
                
                // Resolve 10Gbps server links via redirect chain before download
                if (cand.name.toLowerCase().includes('10gbps') || cand.name.toLowerCase().includes('10 gbps')) {
                    console.log(`[DanieSearch] Resolving 10Gbps redirect chain for: ${cand.href}`);
                    try {
                        let resolved = await resolveFinalUrl(cand.href);
                        if (resolved && resolved.includes('link=')) {
                            resolved = decodeURIComponent(resolved.split('link=')[1].split('&')[0]);
                        }
                        if (resolved && resolved !== cand.href) {
                            console.log(`[DanieSearch] 10Gbps resolved to: ${resolved}`);
                            cand.href = resolved;
                        }
                    } catch (e) {
                        console.error(`[DanieSearch] 10Gbps resolution failed:`, e.message);
                    }
                }
                
                const downloadQuery = `${sanitizedTitle} = ${cand.href}`;
                console.log(`[DanieSearch] Fallback Attempt ${i + 1}: Trying ${cand.name}...`);
                
                try {
                    await downloadCommandHandler(conn, mek, from, senderJid, downloadQuery, reply, controller.signal, activeDownloadRef, cand.name, true);
                    downloadSuccess = true;
                    console.log(`[DanieSearch] Fallback Attempt ${i + 1} (${cand.name}) succeeded!`);
                    break; // Stop on first success!
                } catch (err) {
                    if (err.message === 'Aborted') {
                        throw err; // Stop if aborted by the user
                    }
                    console.error(`[DanieSearch] Fallback Attempt ${i + 1} (${cand.name}) failed:`, err.message);
                    lastError = err;
                }
            }

            if (!downloadSuccess) {
                throw lastError || new Error('All download links failed.');
            } else {
                const isTvShow = state.episodesList && state.episodesList.length > 0;
                if (!isTvShow) {
                    delete pendingSearch[cleanJid(senderJid)];
                }
            }

        } catch (err) {
            if (err.message === 'Aborted') {
                console.log('[DanieSearch] Background download successfully aborted.');
            } else {
                console.error('[DanieSearch] Background download failed:', err.message);
                try {
                    await reply(`❌ Failed to download: ${err.message}`);
                } catch (replyErr) {
                    console.error('[DanieSearch] Failed to send error reply:', replyErr.message);
                }
            }
        } finally {
            if (state.activeDownload && state.activeDownload.controller === controller) {
                state.activeDownload = null;
            }
        }
    })();
}

async function handleSearchReply(conn, mek, senderJid, text, reply) {
    const cleanSender = cleanJid(senderJid);
    const state = pendingSearch[cleanSender];
    if (!state) return;

    const from = mek.key.remoteJid;
    const num = parseInt(text.trim(), 10);

    if (state.step === 'select_movie') {
        const movies = state.results || [];
        if (isNaN(num) || num < 1 || num > movies.length) {
            return reply(`❌ Invalid movie number. Reply with a number from 1 to ${movies.length}.`);
        }

        const selectedMovie = movies[num - 1];

        try {
            const sourceDomain = state.sourceDomain || VEGAMOVIES_DOMAIN;
            const postUrl = selectedMovie.permalink.startsWith('http') 
                ? selectedMovie.permalink 
                : `${sourceDomain}${selectedMovie.permalink}`;

            console.log(`[DanieSearch] Scraping post page: ${postUrl}`);
            const allLinks = await scrapeAllPostLinks(postUrl);

            // Filter out unrelated links (keep only V-Cloud or landing page domains)
            const validLinks = allLinks.filter(l => {
                const lowerHref = l.href.toLowerCase();
                const lowerText = l.text.toLowerCase();
                const lowerHeading = (l.heading || '').toLowerCase();
                
                const isLandingDomain = lowerHref.includes('nexdrive') || 
                                        lowerHref.includes('vgmlink') || 
                                        lowerHref.includes('gdflix') || 
                                        lowerHref.includes('fastdl') || 
                                        lowerHref.includes('filebee') || 
                                        lowerHref.includes('hubcloud') || 
                                        lowerHref.includes('vcloud') || 
                                        lowerHref.includes('katdrive') || 
                                        lowerHref.includes('kmhd') || 
                                        lowerHref.includes('fastdl.zip');
                                        
                const isVcloudKeyword = lowerHref.includes('vcloud') || 
                                         lowerText.includes('v-cloud') || 
                                         lowerText.includes('vcloud') || 
                                         lowerHeading.includes('v-cloud') || 
                                         lowerHeading.includes('vcloud');
                                         
                return (isLandingDomain || isVcloudKeyword) && l.resolution !== 'Unknown';
            });

            if (validLinks.length === 0) {
                delete pendingSearch[cleanSender];
                return reply(`❌ No valid download links could be parsed from this post.`);
            }

            // If any link explicitly says "V-Cloud" in its text, keep ONLY V-Cloud links
            const hasVcloudText = validLinks.some(l => {
                const lt = l.text.toLowerCase();
                return lt.includes('v-cloud') || lt.includes('vcloud');
            });

            let displayLinks;
            if (hasVcloudText) {
                // V-Cloud links exist — keep ONLY those, drop G-Direct/TGDrive/etc
                displayLinks = validLinks.filter(l => {
                    const lt = l.text.toLowerCase();
                    return lt.includes('v-cloud') || lt.includes('vcloud');
                });
            } else {
                // No V-Cloud text labels — exclude known bad ones but keep the rest
                displayLinks = validLinks.filter(l => {
                    const lt = l.text.toLowerCase();
                    return !lt.includes('g-direct') && !lt.includes('gdirect') && 
                           !lt.includes('tgdrive') && !lt.includes('telegram');
                });
            }
            // Fall back to all valid links if filtering removed everything
            if (displayLinks.length === 0) displayLinks = validLinks;

            // Update state
            pendingSearch[cleanSender] = {
                step: 'select_resolution',
                title: selectedMovie.title,
                permalink: selectedMovie.permalink,
                thumbnail: selectedMovie.thumbnail,
                sourceDomain: state.sourceDomain,
                links: displayLinks,
                activeDownload: null,
                messageId: null
            };

            let listText = `🎬 *${selectedMovie.title}*\n\nSelect a resolution to download:\n\n`;
            displayLinks.forEach((l, i) => {
                const cleanText = l.text.replace(/⚡\s*/g, '').trim();
                const label = l.heading 
                    ? `${l.heading} — *${cleanText}* (${l.resolution})` 
                    : `${cleanText} (${l.resolution})`;
                listText += `  \`${i + 1}\` — ${label}\n`;
            });
            listText += `\n_Reply with the number of the resolution you want._`;

            // Try to download and send the movie poster first, then resolutions list
            let posterSent = null;
            const posterUrl = selectedMovie.thumbnail;
            if (posterUrl) {
                const tempPosterPath = path.join(__dirname, 'tmp_search_poster_' + Date.now() + '.jpg');
                try {
                    const posterResponse = await axios({
                        method: 'get',
                        url: posterUrl,
                        responseType: 'stream',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                        },
                        timeout: 15000
                    });
                    const writer = fs.createWriteStream(tempPosterPath);
                    posterResponse.data.pipe(writer);
                    await new Promise((resolve, reject) => {
                        writer.on('finish', resolve);
                        writer.on('error', reject);
                    });

                    if (fs.existsSync(tempPosterPath)) {
                        const sentMsg = await conn.sendMessage(from, {
                            image: { url: tempPosterPath },
                            caption: listText
                        }, { quoted: mek });
                        posterSent = sentMsg;
                        fs.unlinkSync(tempPosterPath);
                    }
                } catch (err) {
                    console.error('[DanieSearch] Failed to fetch/send search poster:', err.message);
                    if (fs.existsSync(tempPosterPath)) {
                        try { fs.unlinkSync(tempPosterPath); } catch (_) {}
                    }
                }
            }

            if (!posterSent) {
                const sent = await reply(listText);
                pendingSearch[cleanSender].messageId = sent.key.id;
            } else {
                pendingSearch[cleanSender].messageId = posterSent.key.id;
            }
        } catch (err) {
            console.error('[DanieSearch] Failed to load movie post details:', err.message);
            delete pendingSearch[cleanSender];
            reply(`❌ Failed to load movie details: ${err.message}`);
        }
    } else if (state.step === 'select_resolution') {
        const links = state.links || [];
        if (isNaN(num) || num < 1 || num > links.length) {
            return reply(`❌ Invalid resolution number. Reply with a number from 1 to ${links.length}.`);
        }

        // If there's an active download running, abort it before proceeding with the new choice
        if (state.activeDownload) {
            try {
                console.log('[DanieSearch] Aborting active download to switch to new resolution selection.');
                state.activeDownload.controller.abort();
                if (state.activeDownload.ref && state.activeDownload.ref.filePath) {
                    const fp = state.activeDownload.ref.filePath;
                    if (fs.existsSync(fp)) {
                        fs.unlinkSync(fp);
                        console.log(`[DanieSearch] Deleted old temp file: ${fp}`);
                    }
                }
            } catch (abortErr) {
                console.error('[DanieSearch] Failed to abort active download:', abortErr.message);
            }
            state.activeDownload = null;
        }

        const selectedLink = links[num - 1];

        try {
            console.log(`[DanieSearch] Resolving direct host links for redirect url: ${selectedLink.href}`);
            const directHosts = await extractDirectDownloadLinks(selectedLink.href);

            if (!directHosts || directHosts.length === 0) {
                return reply(`❌ No direct download links could be resolved for this resolution.`);
            }

            // Group hosts by episode to check if this is a series
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

            // Check if this post or resolution link represents a TV series/show
            const isTvShow = /season\s*\d+|series|episode/i.test(state.title || '') || 
                             (state.type === 'tv') || 
                             /season\s*\d+|series|episode/i.test(selectedLink.heading || '') || 
                             /season\s*\d+|series|episode/i.test(selectedLink.text || '');

            if (isTvShow && episodesMap.size > 0) {
                // TV Show episode selection!
                state.step = 'select_episode';
                state.resolutionHeading = selectedLink.heading || selectedLink.text;
                state.selectedResolution = selectedLink.resolution;
                state.episodesList = Array.from(episodesMap.keys()).sort((a, b) => {
                    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
                });
                state.episodesMap = Object.fromEntries(episodesMap);
                state.messageId = null;

                let episodeListText = `🌐 *Select an episode to download:* \n_${selectedLink.heading || selectedLink.text}_\n\n`;
                state.episodesList.forEach((ep, idx) => {
                    episodeListText += `  \`${idx + 1}\` — *${ep}*\n`;
                });
                episodeListText += `  \`${state.episodesList.length + 1}\` — 📥 *Download All Episodes*\n`;
                episodeListText += `\n_Reply to this message with the episode number._`;

                const sent = await reply(episodeListText);
                if (sent && sent.key) {
                    state.messageId = sent.key.id;
                }
            } else {
                // Movie or single file! Directly execute fallback download on all direct hosts
                state.selectedResolution = selectedLink.resolution;
                await executeFallbackDownload(conn, mek, from, senderJid, state, directHosts, reply);
            }
        } catch (err) {
            console.error('[DanieSearch] Failed to resolve hosts:', err.message);
            reply(`❌ Failed to resolve download hosts: ${err.message}`);
        }
    } else if (state.step === 'select_episode') {
        const epList = state.episodesList || [];
        const downloadAllOption = epList.length + 1;
        if (isNaN(num) || num < 1 || num > downloadAllOption) {
            return reply(`❌ Invalid episode number. Reply with a number from 1 to ${downloadAllOption}.`);
        }

        if (num === downloadAllOption) {
            // ── Download All Episodes sequentially ──
            await reply(`📥 *Downloading all ${epList.length} episodes one by one...*\nThis may take a while. Please wait.`);

            // Prevent the state from being deleted after first successful episode
            state.bulkDownloadActive = true;

            let successCount = 0;
            let failCount = 0;

            for (let i = 0; i < epList.length; i++) {
                const epLabel = epList[i];
                const episodeHosts = (state.episodesMap || {})[epLabel] || [];

                if (episodeHosts.length === 0) {
                    await reply(`⚠️ Skipping *${epLabel}* — no download hosts found.`);
                    failCount++;
                    continue;
                }

                await reply(`⏳ *[${i + 1}/${epList.length}]* Downloading *${epLabel}*...`);

                try {
                    // Create a fresh controller for each episode
                    const controller = new AbortController();
                    const activeDownloadRef = { filePath: null };
                    state.activeDownload = { controller, ref: activeDownloadRef };

                    // Build candidate list using the same logic as executeFallbackDownload
                    const hostsList = Array.isArray(episodeHosts) ? episodeHosts : [episodeHosts];
                    let candidates = [];

                    const candidates10g = [];
                    const candidatesFslv2 = [];
                    const candidatesFsl = [];
                    const candidatesOther = [];

                    for (const host of hostsList) {
                        if (isLandingUrl(host.href)) {
                            let subOpts = null;
                            for (let attempt = 1; attempt <= 2; attempt++) {
                                try {
                                    subOpts = await extractSubOptions(host.href);
                                    const hasRealServers = subOpts.some(opt => {
                                        const t = opt.text.toLowerCase();
                                        return t.includes('fsl') || t.includes('10gbps') || t.includes('server');
                                    });
                                    if (hasRealServers || attempt >= 2) break;
                                    await new Promise(r => setTimeout(r, 3000));
                                } catch (subErr) {
                                    if (attempt < 2) await new Promise(r => setTimeout(r, 3000));
                                }
                            }
                            if (subOpts && subOpts.length > 0) {
                                const opt10gbps = subOpts.find(opt => opt.text.toLowerCase().includes('10gbps'));
                                const optFslv2 = subOpts.find(opt => opt.text.toLowerCase().includes('fslv2'));
                                const optFsl = subOpts.find(opt => opt.text.toLowerCase().includes('fsl') && !opt.text.toLowerCase().includes('fslv2'));
                                if (opt10gbps) candidates10g.push({ name: '10Gbps Server', href: opt10gbps.href });
                                if (optFslv2) candidatesFslv2.push({ name: 'FSLv2 Server', href: optFslv2.href });
                                if (optFsl) candidatesFsl.push({ name: 'FSL Server', href: optFsl.href });
                                subOpts.forEach(opt => {
                                    const txt = opt.text.toLowerCase();
                                    if (!txt.includes('10gbps') && !txt.includes('fsl') && !txt.includes('fslv2') && !txt.includes('login') && !txt.includes('admin')) {
                                        candidatesOther.push({ name: opt.text, href: opt.href });
                                    }
                                });
                            }
                        } else {
                            candidatesOther.push({ name: host.text || 'Direct Link', href: host.href });
                        }
                    }

                    const hasVcloudServers = candidatesFslv2.length > 0 || candidatesFsl.length > 0 || candidates10g.length > 0;
                    if (hasVcloudServers) {
                        candidates = [...candidatesFslv2, ...candidatesFsl, ...candidates10g];
                    } else {
                        candidates = [...candidatesOther];
                    }
                    if (candidates.length === 0) {
                        for (const host of hostsList) {
                            candidates.push({ name: host.text || 'Direct Link', href: host.href });
                        }
                    }

                    const primaryHost = hostsList[0] || {};
                    let sanitizedTitle = generateCustomFileName(state, primaryHost);
                    if (!sanitizedTitle) {
                        sanitizedTitle = (state.resolutionHeading || state.title || 'Movie')
                            .replace(/[:*?"<>|\\/]/g, '').trim();
                        if (primaryHost.episode) sanitizedTitle = `${sanitizedTitle} ${primaryHost.episode}`;
                    }

                    let downloadSuccess = false;
                    for (let ci = 0; ci < candidates.length; ci++) {
                        const cand = candidates[ci];
                        if (cand.name.toLowerCase().includes('10gbps') || cand.name.toLowerCase().includes('10 gbps')) {
                            try {
                                let resolved = await resolveFinalUrl(cand.href);
                                if (resolved && resolved.includes('link=')) {
                                    resolved = decodeURIComponent(resolved.split('link=')[1].split('&')[0]);
                                }
                                if (resolved && resolved !== cand.href) cand.href = resolved;
                            } catch (e) {}
                        }
                        const downloadQuery = `${sanitizedTitle} = ${cand.href}`;
                        try {
                            await downloadCommandHandler(conn, mek, from, senderJid, downloadQuery, reply, controller.signal, activeDownloadRef, cand.name, true);
                            downloadSuccess = true;
                            break;
                        } catch (err) {
                            if (err.message === 'Aborted') throw err;
                        }
                    }

                    if (downloadSuccess) {
                        successCount++;
                    } else {
                        failCount++;
                        await reply(`❌ Failed to download *${epLabel}*. Skipping...`);
                    }
                    state.activeDownload = null;
                } catch (err) {
                    if (err.message === 'Aborted') {
                        await reply(`🛑 Bulk download aborted.`);
                        return;
                    }
                    failCount++;
                    await reply(`❌ Failed to download *${epLabel}*: ${err.message}`);
                    state.activeDownload = null;
                }
            }

            await reply(`✅ *Bulk download complete!*\n\n📦 Success: *${successCount}/${epList.length}*` + (failCount > 0 ? `\n❌ Failed: *${failCount}*` : ''));
            delete pendingSearch[cleanSender];
        } else {
            // ── Single episode download ──
            const selectedEpisode = epList[num - 1];
            const episodeHosts = (state.episodesMap || {})[selectedEpisode] || [];

            if (episodeHosts.length === 0) {
                return reply(`❌ No download hosts found for this episode.`);
            }

            // Trigger fallback download pipeline with all mirror hosts for this episode
            await executeFallbackDownload(conn, mek, from, senderJid, state, episodeHosts, reply);
        }
    }
}

cmd({
    pattern: 'sv',
    react: '🔍',
    desc: 'Searches for movies/series on Vegamovies and allows interactive resolution selection and download.',
    category: 'download',
    use: '.sv <keyword>',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
    const senderJid = m.sender || mek.sender || from;
    await searchCommandHandler(conn, mek, from, senderJid, q, reply, 'vegamovies');
});

cmd({
    pattern: 'sr',
    react: '🔍',
    desc: 'Searches for movies/series on Rogmovies and allows interactive resolution selection and download.',
    category: 'download',
    use: '.sr <keyword>',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q }) => {
    const reply = async (textMsg) => {
        return conn.sendMessage(from, { text: textMsg }, { quoted: mek });
    };
    const senderJid = m.sender || mek.sender || from;
    await searchCommandHandler(conn, mek, from, senderJid, q, reply, 'rogmovies');
});

// Export initUpsertListener so command.js can auto-initialize it
module.exports.initUpsertListener = initUpsertListener;
