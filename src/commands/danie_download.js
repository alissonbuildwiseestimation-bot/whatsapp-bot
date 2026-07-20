const { cmd } = require('../Utils/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fileType = require('file-type');
const { fetchTmdbMetadata, fetchTmdbById, scrapePostPage, resolveLandingLink, resolveVcloudLink, resolveFinalUrl, scrapeAllPostLinks, extractDirectDownloadLinks, extractSubOptions, searchHdhub4u } = require('../Utils/movie_scraper');

// Global handlers to prevent background network disconnect errors from crashing the Node process
process.on('unhandledRejection', (reason, promise) => {
    console.error('[DanieWatch] Unhandled Promise Rejection at:', promise, 'reason:', reason);
});
function formatUptime(seconds) {
    seconds = Number(seconds) || 0;
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0 || parts.length === 0) parts.push(`${s}s`);
    return parts.join(' ');
}

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


async function sendAndForwardFile(conn, targets, filePayload, sendOptions = {}) {
    let targetList = [];
    if (Array.isArray(targets) && targets.length > 0) {
        targetList = targets.map(t => typeof t === 'string' ? t : t.jid).filter(Boolean);
    }
    if (targetList.length === 0) {
        targetList = [sendOptions.from || sendOptions.destJid];
    }

    const primaryJid = targetList[0];
    console.log(`[DanieWatch] Uploading file to primary target (${primaryJid})...`);
    const sentMsg = await conn.sendMessage(primaryJid, filePayload, sendOptions.quoted ? { quoted: sendOptions.quoted } : {});

    if (targetList.length > 1 && sentMsg && sentMsg.key) {
        for (let i = 1; i < targetList.length; i++) {
            const nextJid = targetList[i];
            try {
                console.log(`[DanieWatch] Forwarding uploaded media to target ${i + 1}/${targetList.length}: ${nextJid}`);
                if (typeof conn.forwardMessage === 'function') {
                    await conn.forwardMessage(nextJid, sentMsg, { forceForward: true });
                } else if (conn.sendMessage) {
                    await conn.sendMessage(nextJid, { forward: sentMsg });
                }
            } catch (fwdErr) {
                console.error(`[DanieWatch] Failed to forward to target ${nextJid}:`, fwdErr.message);
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    return sentMsg;
}

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
        try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
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
                try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
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
                    try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
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
    if (!jid || typeof jid !== 'string') return '';
    const parts = jid.split('@');
    const user = parts[0].split(':')[0];
    let server = parts[1] || 's.whatsapp.net';
    if (server === 'c.us' || server === 's.whatsapp.net' || server === 'lid') {
        server = 's.whatsapp.net';
    }
    return `${user}@${server}`;
}

function isLandingUrl(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return lower.includes('vcloud') || 
           lower.includes('hubcloud') || 
           lower.includes('hubdrive') ||
           lower.includes('hubcdn') ||
           lower.includes('gadgetsweb') ||
           lower.includes('katdrive') ||
           lower.includes('kmhd') ||
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
const HDHUB4U_DOMAIN = process.env.HDHUB4U_DOMAIN || 'https://new3.hdhub4u.cl';

// =========================================================================
//  TASK QUEUE MANAGER — Sequential FIFO execution for .p, .d, and searches
// =========================================================================
class TaskQueueManager {
    constructor() {
        this.queue = [];
        this.activeTask = null;
        this.isProcessing = false;
    }

    add(task) {
        task.id = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
        task.addedAt = Date.now();
        this.queue.push(task);
        console.log(`[QueueManager] Added task "${task.description}" (ID: ${task.id}). Pending count: ${this.queue.length}`);
        
        this.processNext();
        return task;
    }

    async processNext() {
        if (this.isProcessing || this.queue.length === 0) return;

        this.isProcessing = true;
        const task = this.queue.shift();
        
        const controller = new AbortController();
        const ref = { filePath: null };
        this.activeTask = {
            ...task,
            controller,
            ref,
            startedAt: Date.now()
        };

        console.log(`[QueueManager] Processing task: "${task.description}" (ID: ${task.id})`);

        try {
            await task.executeFn(controller.signal, ref);
            console.log(`[QueueManager] Task completed successfully: "${task.description}"`);
        } catch (err) {
            if (err.message === 'Aborted') {
                console.log(`[QueueManager] Task aborted by user: "${task.description}"`);
            } else {
                console.error(`[QueueManager] Task failed with error: "${task.description}" -> ${err.message}`);
            }
        } finally {
            this.activeTask = null;
            this.isProcessing = false;
            setImmediate(() => this.processNext());
        }
    }

    cancelAll(senderJid) {
        const count = this.queue.length;
        this.queue = [];

        let activeAborted = false;
        if (this.activeTask) {
            try {
                this.activeTask.controller.abort();
                if (this.activeTask.ref && this.activeTask.ref.filePath) {
                    const fp = this.activeTask.ref.filePath;
                    if (fs.existsSync(fp)) {
                        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
                    }
                }
                activeAborted = true;
            } catch (e) {}
            this.activeTask = null;
        }
        return { count, activeAborted };
    }

    remove(index) {
        const num = parseInt(index, 10);
        if (isNaN(num) || num < 1 || num > this.queue.length) {
            return null;
        }
        const removed = this.queue.splice(num - 1, 1)[0];
        return removed;
    }

    updateCommand(index, newCommandText, conn, mek, from, senderJid, reply) {
        const num = parseInt(index, 10);
        if (isNaN(num) || num < 1 || num > this.queue.length) {
            return { error: `Invalid queue position ${index}. Total pending items in queue: ${this.queue.length}` };
        }

        const trimmed = (newCommandText || '').trim();
        let cmdPart = trimmed;
        if (cmdPart.startsWith(PREFIX)) {
            cmdPart = cmdPart.slice(PREFIX.length).trim();
        }

        const spaceIdx = cmdPart.indexOf(' ');
        const cmdName = spaceIdx !== -1 ? cmdPart.substring(0, spaceIdx).trim().toLowerCase() : cmdPart.toLowerCase();
        const cmdArgs = spaceIdx !== -1 ? cmdPart.substring(spaceIdx + 1).trim() : '';

        if (cmdName === 'p') {
            const executeFn = async (signal, ref) => {
                await pCommandHandler(conn, mek, from, senderJid, cmdArgs, reply, signal, ref);
            };
            const oldTask = this.queue[num - 1];
            this.queue[num - 1] = {
                ...oldTask,
                description: `🎬 TMDB Task: .p ${cmdArgs.substring(0, 40)}...`,
                commandText: trimmed,
                executeFn
            };
            return { success: true, item: this.queue[num - 1] };
        } else if (cmdName === 'd') {
            const executeFn = async (signal, ref) => {
                await downloadCommandHandler(conn, mek, from, senderJid, cmdArgs, reply, signal, ref);
            };
            const oldTask = this.queue[num - 1];
            this.queue[num - 1] = {
                ...oldTask,
                description: `📥 Download Task: .d ${cmdArgs.substring(0, 40)}...`,
                commandText: trimmed,
                executeFn
            };
            return { success: true, item: this.queue[num - 1] };
        } else {
            return { error: `Currently, only .p or .d commands can be updated in queue.` };
        }
    }

    getStatus() {
        let activeStr = 'None';
        if (this.activeTask) {
            activeStr = `🔄 *[PROCESSING]* ${this.activeTask.description}`;
        }

        let pendingStr = 'No pending items in queue.';
        if (this.queue.length > 0) {
            pendingStr = this.queue.map((t, idx) => `  \`${idx + 1}\` — ${t.description}`).join('\n');
        }

        return `📋 *Task Queue Status*\n\n` +
               `*Currently Processing:*\n${activeStr}\n\n` +
               `*Pending in Queue (${this.queue.length}):*\n${pendingStr}\n\n` +
               `_Use \`.c\` to cancel all, \`.qdel <num>\` to remove an item, or \`.qedit <num> <new_cmd>\` to update._`;
    }
}

const globalTaskQueue = new TaskQueueManager();

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

function removeActiveChat(jid) {
    if (!jid) return;
    const clean = cleanJid(typeof jid === 'string' ? jid : jid?.id);
    if (!clean) return;

    const chatsMap = loadActiveChats();
    if (chatsMap[clean]) {
        delete chatsMap[clean];
        try {
            const dir = path.dirname(ACTIVE_CHATS_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(ACTIVE_CHATS_PATH, JSON.stringify(chatsMap, null, 2), 'utf-8');
        } catch (e) {}
    }
}

function getAllPrivateChats(conn, cleanSender) {
    const rawChats = [];

    // 1. From saved active_chats.json (captured from live active WhatsApp chat events)
    const saved = loadActiveChats();
    Object.values(saved).forEach(c => rawChats.push(c));

    if (conn) {
        // 2. From conn.chats (active chat threads only)
        if (conn.chats) {
            try {
                const connChats = conn.chats instanceof Map ? Array.from(conn.chats.values()) : Object.values(conn.chats);
                connChats.forEach(c => rawChats.push(c));
            } catch (e) {}
        }

        // 3. From conn.store.chats (active chat threads only)
        if (conn.store && conn.store.chats) {
            try {
                const storeChats = typeof conn.store.chats.all === 'function'
                    ? conn.store.chats.all()
                    : (conn.store.chats instanceof Map ? Array.from(conn.store.chats.values()) : Object.values(conn.store.chats));
                storeChats.forEach(c => rawChats.push(c));
            } catch (e) {}
        }
    }

    // Deduplicate and filter out groups / broadcasts / LIDs
    const seen = new Set();
    let result = [];

    for (const c of rawChats) {
        if (!c || !c.id) continue;
        if (typeof c.id === 'string' && (c.id.includes('@lid') || c.id.endsWith('@g.us') || c.id.includes('broadcast'))) continue;
        const clean = cleanJid(c.id);
        if (!clean || clean.includes('@lid') || clean.endsWith('@g.us') || clean.includes('broadcast')) continue;

        const phone = clean.split('@')[0];
        // Must be a valid phone number (digits only, length 7 to 15)
        if (!/^\d{7,15}$/.test(phone)) continue;

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

    const selfChat = { id: cleanJid(cleanSender), name: 'You (Private Chat)' };
    const otherChats = result.filter(c => c.id !== selfChat.id);

    return [selfChat, ...otherChats];
}

function initUpsertListener(conn) {
    if (conn.danieDownloadUpsertRegistered) return;
    conn.danieDownloadUpsertRegistered = true;

    // Listen to WhatsApp sync events to capture active chat threads
    try {
        if (conn.ev) {
            conn.ev.on('chats.delete', (deletedJids) => {
                const arr = Array.isArray(deletedJids) ? deletedJids : [deletedJids];
                for (const j of arr) removeActiveChat(j);
            });
            conn.ev.on('chats.upsert', (chats) => {
                const arr = Array.isArray(chats) ? chats : [chats];
                for (const c of arr) if (c && c.id && !c.read_only) saveActiveChat(c.id, c.name || c.subject, c.notify);
            });
            conn.ev.on('chats.update', (chats) => {
                const arr = Array.isArray(chats) ? chats : [chats];
                for (const c of arr) if (c && c.id && !c.read_only) saveActiveChat(c.id, c.name || c.subject, c.notify);
            });
            conn.ev.on('messaging-history.set', (history) => {
                if (history && history.chats && Array.isArray(history.chats)) {
                    for (const c of history.chats) if (c && c.id && !c.read_only) saveActiveChat(c.id, c.name || c.subject, c.notify);
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

            // OWNER-ONLY ACCESS CHECK: Block all non-owners from messaging/sending commands to the bot
            if (!mek.key.fromMe && !isOwner(senderJid)) {
                return;
            }

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

            // ---- Handle commands starting with PREFIX ----
            if (trimmedText.startsWith(PREFIX)) {
                // Parse custom command and arguments
                const cmdPart = trimmedText.slice(PREFIX.length).trim();
                const spaceIdx = cmdPart.indexOf(' ');
                const cmdName = spaceIdx !== -1 ? cmdPart.substring(0, spaceIdx).trim().toLowerCase() : cmdPart.toLowerCase();
                const cmdArgs = spaceIdx !== -1 ? cmdPart.substring(spaceIdx + 1).trim() : '';

                const ALLOWED_COMMANDS = [
                    'sv', 'sr', 'sh',
                    'alive', 'allow', 'disallow', 'addowner', 'delowner', 'addsudo', 'delsudo', 'owners', 'allowed', 'sudolist', 'config', 'setgroup', 'dlstatus', 'dlconfig', 'downloadstatus',
                    'c', 'cancel', 'clearqueue', 'que', 'queue', 'q',
                    'd', 'p',
                    'jid', 'groupid'
                ];

                if (!ALLOWED_COMMANDS.includes(cmdName)) {
                    console.log(`[DanieWatch] Blocked disabled command: ".${cmdName}" from ${cleanSender}`);
                    if (mek.message.conversation) mek.message.conversation = '';
                    if (mek.message.extendedTextMessage?.text) mek.message.extendedTextMessage.text = '';
                    return;
                }

                console.log(`[DanieWatch] Command detected: "${cmdName}" args: "${cmdArgs}" from ${cleanSender}`);

                // If starting a new search command (.sv, .sr, .sh), reset uncompleted search state for user
                if (['sv', 'sr', 'sh'].includes(cmdName)) {
                    delete pendingSearch[cleanSender];
                }
                delete pendingConfig[cleanSender];

                if (DANIE_COMMANDS[cmdName]) {
                    console.log(`[DanieWatch] Executing command: "${cmdName}"`);
                    
                    // Clear message text to prevent obfuscated framework double-execution
                    if (mek.message.conversation) mek.message.conversation = '';
                    if (mek.message.extendedTextMessage?.text) mek.message.extendedTextMessage.text = '';

                    try {
                        await DANIE_COMMANDS[cmdName](conn, mek, from, senderJid, cmdArgs, reply);
                    } catch (cmdErr) {
                        console.error(`[DanieWatch] Error executing command "${cmdName}":`, cmdErr);
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

function loadSudo() {
    const sudoPath = path.join(__dirname, '..', 'data', 'sudo.json');
    if (!fs.existsSync(sudoPath)) return [];
    try {
        return JSON.parse(fs.readFileSync(sudoPath, 'utf8')) || [];
    } catch (_) {
        return [];
    }
}

function saveSudo(nums) {
    const sudoDir = path.join(__dirname, '..', 'data');
    if (!fs.existsSync(sudoDir)) fs.mkdirSync(sudoDir, { recursive: true });
    const sudoPath = path.join(sudoDir, 'sudo.json');
    fs.writeFileSync(sudoPath, JSON.stringify(nums, null, 2), 'utf8');
}

function isOwner(senderJid) {
    const ownerNum = (process.env.BOT_NUMBER || '').trim().replace(/[^0-9]/g, '');
    const envSudoNums = (process.env.SUDO || '').split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);
    const dynamicSudo = loadSudo();
    const allOwners = ['94717775628', '94758775628', ownerNum, ...envSudoNums, ...dynamicSudo].filter(Boolean);
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
    desc: 'Configure receiver destinations (groups & private numbers).',
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
        const cleanSender = cleanJid(senderJid);

        if (q && q.trim()) {
            return handleConfigReply(conn, mek, m, senderJid, q.trim(), reply);
        }

        let groupsObj = {};
        try {
            groupsObj = await conn.groupFetchAllParticipating();
        } catch (_) {}

        const groups = Object.values(groupsObj).map(g => ({
            jid: g.id,
            subject: g.subject || 'Unknown Group'
        }));

        pendingConfig[cleanSender] = { step: 'combined_config', groups, messageId: null };

        const current = loadSettings();
        let targetText = '';
        if (current.targets && current.targets.length > 0) {
            current.targets.forEach((t, idx) => {
                const icon = t.type === 'group' ? '📤' : '📥';
                targetText += `  ${idx + 1}. ${icon} *${t.name}* (${t.jid})\n`;
            });
        } else {
            targetText = `  _Defaulting to your Private Chat (*+${cleanSender.split('@')[0]}*)_\n`;
        }

        let groupListText = '';
        if (groups.length > 0) {
            groups.forEach((g, i) => {
                groupListText += `  ${i + 1}. 📤 ${g.subject}\n`;
            });
        } else {
            groupListText = '  _No active groups found._\n';
        }

        const sent = await reply(
            `⚙️ *DanieWatch Receiver Destinations Config*\n\n` +
            `🎯 *Current Active Receiver(s):*\n${targetText}\n` +
            `📋 *Available WhatsApp Groups:*\n${groupListText}\n` +
            `*How to set receivers:*\n` +
            `  • Reply with group serial numbers (e.g. \`1, 2\` or \`1-3\` or \`all\`)\n` +
            `  • Reply with phone numbers in +92 or 92 format (e.g. \`923253068800\`)\n` +
            `  • Combine both! (e.g. \`1, 2, +923253068800\`)\n` +
            `  • Reply \`clear\` to reset back to your default private chat.\n\n` +
            `_Reply to this message with your choices._`
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
    const groups = (state && state.groups) ? state.groups : [];
    const rawText = text.trim();
    const lowerText = rawText.toLowerCase();

    if (['clear', 'reset', '4', 'clean'].includes(lowerText)) {
        saveSettings({ mode: 'private', targets: [] });
        delete pendingConfig[cleanSender];
        return reply(`🗑️ All target receivers cleared!\n\nDefault receiver reset to your Private Chat: *+${cleanSender.split('@')[0]}*`);
    }

    let selectedTargets = [];

    if (lowerText === 'all') {
        selectedTargets = groups.map(g => ({ jid: cleanJid(g.jid), name: g.subject, type: 'group' }));
    } else {
        const parts = rawText.split(/[,;\n]+/);
        for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;

            if (trimmed.includes('-') && !trimmed.startsWith('+')) {
                const rangeParts = trimmed.split('-').map(s => s.trim());
                const startNum = parseInt(rangeParts[0], 10);
                const endNum = parseInt(rangeParts[1], 10);
                if (!isNaN(startNum) && !isNaN(endNum) && startNum >= 1 && endNum <= groups.length && startNum <= endNum) {
                    for (let i = startNum; i <= endNum; i++) {
                        const g = groups[i - 1];
                        if (g) selectedTargets.push({ jid: cleanJid(g.jid), name: g.subject, type: 'group' });
                    }
                    continue;
                }
            }

            const cleanNum = trimmed.replace(/[^0-9]/g, '');
            if (!cleanNum) continue;

            const intVal = parseInt(cleanNum, 10);
            if (cleanNum.length <= 3 && !isNaN(intVal) && intVal >= 1 && intVal <= groups.length) {
                const g = groups[intVal - 1];
                if (g) selectedTargets.push({ jid: cleanJid(g.jid), name: g.subject, type: 'group' });
            } else if (cleanNum.length >= 7) {
                const jid = cleanJid(`${cleanNum}@s.whatsapp.net`);
                selectedTargets.push({ jid, name: `+${cleanNum}`, type: 'private' });
            }
        }
    }

    if (selectedTargets.length === 0) {
        return reply('❌ Invalid choice! Reply with group serial number(s) (e.g. \`1, 2\`), phone number(s) (e.g. \`923253068800\`), or both combined (e.g. \`1, 2, +923253068800\`). Or reply \`clear\` to reset.');
    }

    const settings = loadSettings();
    selectedTargets.forEach(st => {
        if (!settings.targets.some(t => t.jid === st.jid)) {
            settings.targets.push(st);
        }
    });
    saveSettings(settings);
    delete pendingConfig[cleanSender];

    let resText = `✅ Saved ${selectedTargets.length} target receiver(s) for Upload & Auto-Forwarding:\n\n`;
    settings.targets.forEach((t, idx) => {
        const icon = t.type === 'group' ? '📤' : '📥';
        resText += `  ${idx + 1}. ${icon} *${t.name}* (${t.jid})\n`;
    });
    return reply(resText);
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
        const rawDest = isGroupMode ? settings.groupJid : (settings.privateJid || senderJid);
        const destJid = cleanJid(rawDest);
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
                try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
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
                        
                        const activeTargets = settings.targets && settings.targets.length > 0 ? settings.targets : [{ jid: destJid, name: 'Chat' }];
                        await sendAndForwardFile(conn, activeTargets, {
                            document: { url: filePath },
                            mimetype: fileMime,
                            fileName: finalFileName
                        }, { quoted: destJid === from ? mek : null, from });
                        
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
                    try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
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

                const activeTargets = settings.targets && settings.targets.length > 0 ? settings.targets : [{ jid: destJid, name: 'Chat' }];
                await sendAndForwardFile(conn, activeTargets, {
                    document: { url: tempFilePath },
                    mimetype: mime,
                    fileName: finalFileName
                }, { quoted: destJid === from ? mek : null, from });

                // Delete temporary file
                try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch (_) {}
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

async function pCommandHandler(conn, mek, from, senderJid, q, reply, abortSignal = null, activeDownloadRef = null) {
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
        const rawDest = isGroupMode ? settings.groupJid : (settings.privateJid || senderJid);
        const destJid = cleanJid(rawDest);
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
                    try { if (fs.existsSync(tempPosterPath)) fs.unlinkSync(tempPosterPath); } catch (_) {}
                }
            } catch (err) {
                console.error('[DanieDownload] Failed to download/send local TMDB poster:', err.message);
                if (fs.existsSync(tempPosterPath)) {
                    try { if (fs.existsSync(tempPosterPath)) fs.unlinkSync(tempPosterPath); } catch (_) {}
                }
            }
        }
        
        if (!posterSent) {
            await conn.sendMessage(destJid, {
                text: detailsMessage
            }, destJid === from ? { quoted: mek } : {});
        }

        await reply(`✅ TMDB details and poster successfully fetched and sent to: *${destLabel}*`);

        // Check if there are media download links provided in .p command
        const downloadItems = [];
        if (firstCustomName && /themoviedb\.org/i.test(firstCustomName) && firstUrl && !/themoviedb\.org/i.test(firstUrl)) {
            downloadItems.push(`${tmdb.title} = ${firstUrl}`);
        }
        for (let i = 1; i < items.length; i++) {
            downloadItems.push(items[i]);
        }

        if (downloadItems.length > 0) {
            const downloadQuery = downloadItems.join(', ');
            console.log(`[DanieWatch] Executing media downloads for .p command: ${downloadQuery}`);
            await downloadCommandHandler(conn, mek, from, senderJid, downloadQuery, reply, abortSignal, activeDownloadRef, null, true);
        }

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

DANIE_COMMANDS['jid'] = async (conn, mek, from, senderJid, args, reply) => {
    const targetJid = cleanJid(from);
    const sender = cleanJid(senderJid || from);
    await reply(`📌 *Current Chat JID:* \`${targetJid}\`\n👤 *Your JID:* \`${sender}\``);
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
    if (!args || !args.trim()) {
        return reply('❌ Please provide a download link!');
    }
    const label = args.length > 50 ? args.substring(0, 47) + '...' : args;
    const task = {
        type: 'd_command',
        description: `📥 Download Task: .d ${label}`,
        commandText: `.d ${args}`,
        senderJid,
        from,
        executeFn: async (signal, ref) => {
            await downloadCommandHandler(conn, mek, from, senderJid, args, reply, signal, ref);
        }
    };
    const queuedTask = globalTaskQueue.add(task);
    if (globalTaskQueue.activeTask && globalTaskQueue.activeTask.id !== queuedTask.id) {
        await reply(`📥 *Added to Queue* (Position #${globalTaskQueue.queue.length}):\n📥 Download Task: \`.d ${label}\``);
    }
};

DANIE_COMMANDS['p'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!args || !args.trim()) {
        return reply('❌ Please provide a TMDB link and download url(s)!');
    }
    const label = args.length > 50 ? args.substring(0, 47) + '...' : args;
    const task = {
        type: 'p_command',
        description: `🎬 TMDB Task: .p ${label}`,
        commandText: `.p ${args}`,
        senderJid,
        from,
        executeFn: async (signal, ref) => {
            await pCommandHandler(conn, mek, from, senderJid, args, reply, signal, ref);
        }
    };
    const queuedTask = globalTaskQueue.add(task);
    if (globalTaskQueue.activeTask && globalTaskQueue.activeTask.id !== queuedTask.id) {
        await reply(`📥 *Added to Queue* (Position #${globalTaskQueue.queue.length}):\n🎬 TMDB Task: \`.p ${label}\``);
    }
};

// Queue Control Commands
DANIE_COMMANDS['c'] = async (conn, mek, from, senderJid, args, reply) => {
    const cleanSender = cleanJid(senderJid);
    delete pendingSearch[cleanSender];
    delete pendingConfig[cleanSender];
    const { count, activeAborted } = globalTaskQueue.cancelAll(senderJid);
    let msg = `🛑 *Queue Cancelled!*`;
    if (activeAborted) msg += `\n- Aborted currently active download task.`;
    if (count > 0) msg += `\n- Cleared *${count}* pending queued task(s).`;
    if (!activeAborted && count === 0) msg += `\n_Queue was already empty._`;
    await reply(msg);
};
DANIE_COMMANDS['cancel'] = DANIE_COMMANDS['c'];
DANIE_COMMANDS['clearqueue'] = DANIE_COMMANDS['c'];
DANIE_COMMANDS['cancelall'] = DANIE_COMMANDS['c'];

DANIE_COMMANDS['que'] = async (conn, mek, from, senderJid, args, reply) => {
    await reply(globalTaskQueue.getStatus());
};
DANIE_COMMANDS['queue'] = DANIE_COMMANDS['que'];
DANIE_COMMANDS['qstatus'] = DANIE_COMMANDS['que'];

DANIE_COMMANDS['qdel'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!args || !args.trim()) {
        return reply('❌ Please specify the queue item number to delete (e.g. `.qdel 1`).');
    }
    const removed = globalTaskQueue.remove(args.trim());
    if (removed) {
        await reply(`✅ Removed item from queue:\n*${removed.description}*`);
    } else {
        await reply(`❌ Invalid queue position. Use \`.que\` to check active queue items.`);
    }
};
DANIE_COMMANDS['qremove'] = DANIE_COMMANDS['qdel'];

DANIE_COMMANDS['qedit'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!args || !args.trim()) {
        return reply('❌ Usage: `.qedit <number> <new_command>`\nExample: `.qedit 1 .p https://tmdb.org/... = link`');
    }
    const parts = args.trim().split(/\s+/);
    const indexNum = parts[0];
    const newCmd = parts.slice(1).join(' ');

    if (!newCmd) {
        return reply('❌ Please provide the new command string after the index number.');
    }

    const res = globalTaskQueue.updateCommand(indexNum, newCmd, conn, mek, from, senderJid, reply);
    if (res.error) {
        await reply(`❌ ${res.error}`);
    } else {
        await reply(`✅ Updated queue item #${indexNum}:\n*${res.item.description}*`);
    }
};
DANIE_COMMANDS['allow'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!isOwner(senderJid)) return reply('❌ Only the bot owner can use this command.');
    let num = (args || '').replace(/[^0-9]/g, '');
    if (!num && mek.message?.extendedTextMessage?.contextInfo?.participant) {
        num = cleanJid(mek.message.extendedTextMessage.contextInfo.participant).split('@')[0];
    }
    if (!num) return reply('❌ Please provide a WhatsApp phone number!\n*Example:* `.allow 923013068663` or reply to a message with `.allow`');
    const currentSudo = loadSudo();
    if (currentSudo.includes(num)) return reply(`⚠️ Phone number *${num}* is already allowed!`);
    currentSudo.push(num);
    saveSudo(currentSudo);
    await reply(`✅ Successfully allowed *${num}* to use DanieWatch Bot commands!`);
};
DANIE_COMMANDS['addowner'] = DANIE_COMMANDS['allow'];
DANIE_COMMANDS['addsudo'] = DANIE_COMMANDS['allow'];

DANIE_COMMANDS['disallow'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!isOwner(senderJid)) return reply('❌ Only the bot owner can use this command.');
    let num = (args || '').replace(/[^0-9]/g, '');
    if (!num && mek.message?.extendedTextMessage?.contextInfo?.participant) {
        num = cleanJid(mek.message.extendedTextMessage.contextInfo.participant).split('@')[0];
    }
    if (!num) return reply('❌ Please provide a WhatsApp phone number!\n*Example:* `.disallow 923013068663` or reply to a message with `.disallow`');
    let currentSudo = loadSudo();
    if (!currentSudo.includes(num)) return reply(`⚠️ Phone number *${num}* is not in the allowed list!`);
    currentSudo = currentSudo.filter(n => n !== num);
    saveSudo(currentSudo);
    await reply(`✅ Successfully removed *${num}* from allowed users!`);
};
DANIE_COMMANDS['delowner'] = DANIE_COMMANDS['disallow'];
DANIE_COMMANDS['delsudo'] = DANIE_COMMANDS['disallow'];

DANIE_COMMANDS['allowed'] = async (conn, mek, from, senderJid, args, reply) => {
    if (!isOwner(senderJid)) return reply('❌ Only the bot owner can use this command.');
    const ownerNum = (process.env.BOT_NUMBER || '').trim().replace(/[^0-9]/g, '');
    const envSudoNums = (process.env.SUDO || '').split(',').map(n => n.trim().replace(/[^0-9]/g, '')).filter(Boolean);
    const dynamicSudo = loadSudo();
    
    let text = `👑 *DanieWatch Allowed Users:*\n\n`;
    text += `📍 *Primary Owner:* *${ownerNum || 'N/A'}*\n`;
    if (envSudoNums.length) {
        text += `⚙️ *Config Sudo:* *${envSudoNums.join(', ')}*\n`;
    }
    if (dynamicSudo.length) {
        text += `👤 *Allowed Users:*\n`;
        dynamicSudo.forEach((n, idx) => {
            text += `  ${idx + 1}. *${n}*\n`;
        });
    } else {
        text += `\n_No extra allowed users added yet. Use \`.allow <number>\` to add._`;
    }
    await reply(text);
};
DANIE_COMMANDS['owners'] = DANIE_COMMANDS['allowed'];
DANIE_COMMANDS['sudolist'] = DANIE_COMMANDS['allowed'];

DANIE_COMMANDS['alive'] = async (conn, mek, from, senderJid, args, reply) => {
    try {
        if (conn && mek && mek.key) {
            await conn.sendMessage(from, { react: { text: '⚡', key: mek.key } });
        }
    } catch(e) {}
    const settings = loadSettings();
    const modeLabel = settings.mode === 'group' ? 'Group' : 'Private';
    const uptime = formatUptime(process.uptime());

    let targetSummary = 'Default Private Chat';
    if (settings.targetReceivers && settings.targetReceivers.length > 0) {
        targetSummary = `${settings.targetReceivers.length} Receiver(s)`;
    }

    const caption = `✨ *DANIEWATCH DOWNLOADER BOT* ✨\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `⚙️ *System Status:* Online & Active\n` +
                    `👑 *Developer:* Daniyal Aadil\n` +
                    `⏱️ *Uptime:* ${uptime}\n` +
                    `🔒 *Access Mode:* ${modeLabel}\n` +
                    `🎯 *Active Destinations:* ${targetSummary}\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `🚀 *Ready for Video & Movie Downloads!`;

    const logoPath = path.join(__dirname, '..', '..', 'assets', 'daniewatch_logo.png');
    if (fs.existsSync(logoPath)) {
        try {
            const imageBuffer = fs.readFileSync(logoPath);
            await conn.sendMessage(from, { image: imageBuffer, caption: caption }, { quoted: mek });
            return;
        } catch (e) {
            console.error('Error sending alive logo image:', e);
        }
    }
    await reply(caption);
};

DANIE_COMMANDS['qupdate'] = DANIE_COMMANDS['qedit'];

DANIE_COMMANDS['sv'] = async (conn, mek, from, senderJid, args, reply) => {
    await searchCommandHandler(conn, mek, from, senderJid, args, reply, 'vegamovies');
};

DANIE_COMMANDS['sr'] = async (conn, mek, from, senderJid, args, reply) => {
    await searchCommandHandler(conn, mek, from, senderJid, args, reply, 'rogmovies');
};

DANIE_COMMANDS['sh'] = async (conn, mek, from, senderJid, args, reply) => {
    await searchCommandHandler(conn, mek, from, senderJid, args, reply, 'hdhub4u');
};

async function searchCommandHandler(conn, mek, from, senderJid, q, reply, source = 'vegamovies') {
    try {
        const isRog = source === 'rogmovies';
        const isHdhub = source === 'hdhub4u' || source === 'hdhub';
        let siteName = 'Vegamovies';
        let siteDomain = VEGAMOVIES_DOMAIN;
        let cmdHint = '.sv';

        if (isRog) {
            siteName = 'Rogmovies';
            siteDomain = ROGMOVIES_DOMAIN;
            cmdHint = '.sr';
        } else if (isHdhub) {
            siteName = 'HDHub4u';
            siteDomain = HDHUB4U_DOMAIN;
            cmdHint = '.sh';
        }

        if (!q || !q.trim()) {
            return reply(`❌ Please provide a search keyword!\n\n*Usage:*\n\`${cmdHint} Money Heist\``);
        }

        const query = q.trim();
        await reply(`🔍 Searching ${siteName} for *"${query}"*...`);

        initUpsertListener(conn);

        let results = [];
        if (isHdhub) {
            results = await searchHdhub4u(query);
        } else {
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

            if (res.data && res.data.hits) {
                results = res.data.hits.map(h => ({
                    title: h.document.post_title.replace(/&amp;/g, '&'),
                    permalink: h.document.permalink,
                    thumbnail: h.document.post_thumbnail
                }));
            }
        }

        if (!results || results.length === 0) {
            return reply(`❌ No search results found for *"${query}"* on ${siteName}.`);
        }

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
    const hostsList = Array.isArray(chosenHosts) ? chosenHosts : [chosenHosts];
    if (!hostsList || hostsList.length === 0) {
        return reply(`❌ No download links found for this item. Please try a different search.`);
    }

    // Transition step back so user can make another search choice if desired
    if (state.episodesList && state.episodesList.length > 0) {
        state.step = 'select_episode';
    } else {
        state.step = 'select_resolution';
    }

    const primaryHost = hostsList[0] || {};
    let sanitizedTitle = generateCustomFileName(state, primaryHost);
    if (!sanitizedTitle) {
        sanitizedTitle = (state.resolutionHeading || state.title || 'Movie')
            .replace(/[:*?"<>|\\/]/g, '')
            .trim();
        if (primaryHost.episode) {
            sanitizedTitle = `${sanitizedTitle} ${primaryHost.episode}`;
        }
    }

    const task = {
        type: 'search_download',
        description: `🍿 Search Download: ${sanitizedTitle}`,
        commandText: `Search Download: ${sanitizedTitle}`,
        senderJid,
        from,
        executeFn: async (signal, ref) => {
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
                    for (let attempt = 1; attempt <= 2; attempt++) {
                        try {
                            subOpts = await extractSubOptions(host.href);
                            const hasRealServers = subOpts.some(opt => {
                                const t = opt.text.toLowerCase();
                                return t.includes('fsl') || t.includes('10gbps') || t.includes('server');
                            });
                            if (hasRealServers || attempt >= 2) break;
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
                candidates = [
                    ...candidatesFslv2,
                    ...candidatesFsl,
                    ...candidates10g
                ];
            } else {
                candidates = [...candidatesOther];
            }
            
            if (candidates.length === 0) {
                for (const host of hostsList) {
                    candidates.push({ name: host.text || 'Direct Link', href: host.href });
                }
            }

            console.log(`[DanieSearch] Fallback system candidates:`, candidates.map(c => c.name));

            let downloadSuccess = false;
            let lastError = null;

            for (let i = 0; i < candidates.length; i++) {
                const cand = candidates[i];
                
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
                    await downloadCommandHandler(conn, mek, from, senderJid, downloadQuery, reply, signal, ref, cand.name, true);
                    downloadSuccess = true;
                    console.log(`[DanieSearch] Fallback Attempt ${i + 1} (${cand.name}) succeeded!`);
                    break;
                } catch (err) {
                    if (err.message === 'Aborted') {
                        throw err;
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
        }
    };

    const queuedTask = globalTaskQueue.add(task);
    if (globalTaskQueue.activeTask && globalTaskQueue.activeTask.id !== queuedTask.id) {
        await reply(`📥 *Added to Queue* (Position #${globalTaskQueue.queue.length}):\n🍿 Download: *${sanitizedTitle}*`);
    }
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

            // Filter out unrelated links (keep only V-Cloud, Hubdrive, or landing page domains)
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
                                        lowerHref.includes('fastdl.zip') ||
                                        lowerHref.includes('hubdrive') ||
                                        lowerHref.includes('hubcdn') ||
                                        lowerHref.includes('gadgetsweb');
                                        
                const isVcloudKeyword = lowerHref.includes('vcloud') || 
                                         lowerHref.includes('hubcloud') || 
                                         lowerHref.includes('hubdrive') || 
                                         lowerText.includes('v-cloud') || 
                                         lowerText.includes('vcloud') || 
                                         lowerText.includes('drive') || 
                                         lowerText.includes('instant') || 
                                         lowerHeading.includes('v-cloud') || 
                                         lowerHeading.includes('vcloud');
                                         
                return (isLandingDomain || isVcloudKeyword) && l.resolution !== 'Unknown';
            });

            if (validLinks.length === 0) {
                delete pendingSearch[cleanSender];
                return reply(`❌ No valid download links could be parsed from this post.`);
            }

            // Prefer Hubdrive / V-Cloud / Drive links
            const hasDriveText = validLinks.some(l => {
                const lt = l.text.toLowerCase();
                const lh = l.href.toLowerCase();
                return lt.includes('v-cloud') || lt.includes('vcloud') || lt.includes('drive') || lh.includes('hubdrive');
            });

            let displayLinks;
            if (hasDriveText) {
                displayLinks = validLinks.filter(l => {
                    const lt = l.text.toLowerCase();
                    const lh = l.href.toLowerCase();
                    return lt.includes('v-cloud') || lt.includes('vcloud') || lt.includes('drive') || lh.includes('hubdrive') || lh.includes('vcloud') || lh.includes('hubcloud');
                });
            } else {
                displayLinks = validLinks.filter(l => {
                    const lt = l.text.toLowerCase();
                    return !lt.includes('g-direct') && !lt.includes('gdirect') && 
                           !lt.includes('tgdrive') && !lt.includes('telegram');
                });
            }
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
                        try { if (fs.existsSync(tempPosterPath)) fs.unlinkSync(tempPosterPath); } catch (_) {}
                    }
                } catch (err) {
                    console.error('[DanieSearch] Failed to fetch/send search poster:', err.message);
                    if (fs.existsSync(tempPosterPath)) {
                        try { if (fs.existsSync(tempPosterPath)) fs.unlinkSync(tempPosterPath); } catch (_) {}
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
                        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
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
            // Group hosts by episode to check if this is a series
            const episodesMap = new Map();

            // First check if state.links contains episode labels directly
            const resMatchingLinks = (state.links || []).filter(l => l.resolution === selectedLink.resolution || selectedLink.resolution === 'Unknown');
            resMatchingLinks.forEach(l => {
                if (l.episode) {
                    if (!episodesMap.has(l.episode)) {
                        episodesMap.set(l.episode, []);
                    }
                    const lowerText = l.text.toLowerCase();
                    const lowerHref = l.href.toLowerCase();
                    if (lowerText.includes('drive') || lowerHref.includes('hubdrive')) {
                        episodesMap.get(l.episode).unshift({ text: l.text, href: l.href, episode: l.episode });
                    } else {
                        episodesMap.get(l.episode).push({ text: l.text, href: l.href, episode: l.episode });
                    }
                }
            });

            let directHosts = [];
            if (episodesMap.size === 0) {
                console.log(`[DanieSearch] Resolving direct host links for redirect url: ${selectedLink.href}`);
                directHosts = await extractDirectDownloadLinks(selectedLink.href);

                if (!directHosts || directHosts.length === 0) {
                    return reply(`❌ No direct download links could be resolved for this resolution.`);
                }

                directHosts.forEach(h => {
                    const epLabel = h.episode;
                    if (epLabel) {
                        if (!episodesMap.has(epLabel)) {
                            episodesMap.set(epLabel, []);
                        }
                        episodesMap.get(epLabel).push(h);
                    }
                });
            }

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

                let episodeListText = `🌐 *Select episode(s) to download:* \n_${selectedLink.heading || selectedLink.text}_\n\n`;
                state.episodesList.forEach((ep, idx) => {
                    episodeListText += `  \`${idx + 1}\` — *${ep}*\n`;
                });
                episodeListText += `  \`${state.episodesList.length + 1}\` — 📥 *Download All Episodes*\n`;
                episodeListText += `\n_Reply with episode number(s) (e.g. \`1\`, \`1, 3, 5\`, \`1-5\`), or \`${state.episodesList.length + 1}\` for All._`;

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
        const rawText = text.trim().toLowerCase();

        let selectedIndices = [];

        if (rawText === 'all' || rawText === String(downloadAllOption)) {
            selectedIndices = epList.map((_, i) => i);
        } else {
            const parts = rawText.split(/[\s,]+/);
            for (const part of parts) {
                if (part.includes('-')) {
                    const rangeParts = part.split('-').map(s => s.trim());
                    const startNum = parseInt(rangeParts[0], 10);
                    const endNum = parseInt(rangeParts[1], 10);
                    if (!isNaN(startNum) && !isNaN(endNum) && startNum >= 1 && endNum <= epList.length && startNum <= endNum) {
                        for (let i = startNum; i <= endNum; i++) {
                            if (!selectedIndices.includes(i - 1)) selectedIndices.push(i - 1);
                        }
                    }
                } else {
                    const num = parseInt(part, 10);
                    if (!isNaN(num) && num >= 1 && num <= epList.length) {
                        if (!selectedIndices.includes(num - 1)) selectedIndices.push(num - 1);
                    }
                }
            }
        }

        if (selectedIndices.length === 0) {
            return reply(`❌ Invalid episode selection. Reply with episode number(s) (e.g. \`1\`, \`1, 3, 5\`, \`1-5\`), or \`${downloadAllOption}\` for All Episodes.`);
        }

        await reply(`📥 *Adding ${selectedIndices.length} episode(s) to download queue...*`);

        for (const idx of selectedIndices) {
            const epLabel = epList[idx];
            const episodeHosts = (state.episodesMap || {})[epLabel] || [];
            if (episodeHosts.length > 0) {
                await executeFallbackDownload(conn, mek, from, senderJid, state, episodeHosts, reply);
            } else {
                await reply(`⚠️ Skipping *${epLabel}* — no download hosts found.`);
            }
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
