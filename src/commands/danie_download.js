const { cmd } = require('../Utils/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fileType = require('file-type');
const { fetchTmdbMetadata, fetchTmdbById, scrapePostPage, resolveLandingLink, resolveVcloudLink } = require('../Utils/movie_scraper');

function cleanFileName(filename) {
    if (!filename) return '';
    // Strip extensions like .mp4, .mkv, .avi, .webm, etc.
    return filename.replace(/\.(mp4|mkv|avi|webm|mov|3gp|srt)$/i, '').trim();
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

const pendingConfig = {};

// Our command prefix
const PREFIX = '.';

// Map of our command names to handler functions (populated after they're defined)
const DANIE_COMMANDS = {};

function initUpsertListener(conn) {
    if (conn.danieDownloadUpsertRegistered) return;
    conn.danieDownloadUpsertRegistered = true;

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

            // ---- Check if it's one of our dot-commands ----
            if (trimmedText.startsWith(PREFIX)) {
                const withoutPrefix = trimmedText.slice(PREFIX.length);
                const spaceIdx = withoutPrefix.search(/\s/);
                const cmdName = (spaceIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, spaceIdx)).toLowerCase();
                const args = spaceIdx === -1 ? '' : withoutPrefix.slice(spaceIdx + 1).trim();

                if (DANIE_COMMANDS[cmdName]) {
                    console.log(`[DanieWatch] Handling command: .${cmdName} args="${args}"`);
                    await DANIE_COMMANDS[cmdName](conn, mek, from, senderJid, args, reply);
                    return;
                }
            }

            // ---- Check if it's a plain-number reply for pending config ----
            if (pendingConfig[cleanSender] && !trimmedText.startsWith(PREFIX)) {
                console.log(`[DanieWatch] Found pending config for ${cleanSender}. Directing text "${trimmedText}" to handleConfigReply.`);
                await handleConfigReply(conn, mek, null, senderJid, trimmedText, reply);
                return;
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
        pendingConfig[cleanSender] = { step: 'mode', groups: [], chats: [] };

        await reply(
            `⚙️ *DanieWatch Download Config*\n\n` +
            `Current setting: ${modeLabel}\n\n` +
            `Where should downloaded files be sent?\n\n` +
            `*Reply with:*\n` +
            `  \`1\` — 📥 Private Chats\n` +
            `  \`2\` — 📤 WhatsApp Groups\n\n` +
            `_Reply with just the number to select._`
        );
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
                let chats = [];
                if (conn.store && conn.store.chats) {
                    chats = conn.store.chats.all();
                } else if (conn.chats) {
                    chats = Object.values(conn.chats);
                }

                // Filter private chats (s.whatsapp.net, c.us, lid)
                let privateChats = chats.filter(c => c.id && (c.id.endsWith('@s.whatsapp.net') || c.id.endsWith('@c.us') || c.id.endsWith('@lid')));

                const seenJids = new Set();
                privateChats = privateChats.filter(c => {
                    if (seenJids.has(c.id)) return false;
                    seenJids.add(c.id);
                    return true;
                });

                // Always include oneself first
                const selfChat = { id: cleanSender, name: 'You (Private Chat)' };
                privateChats = [selfChat, ...privateChats.filter(c => cleanJid(c.id) !== cleanSender)];

                // Limit top 15
                privateChats = privateChats.slice(0, 15);

                pendingConfig[cleanSender] = { step: 'private_chat', chats: privateChats };

                let list = '📋 *Select a Private Chat:*\n\n';
                privateChats.forEach((c, i) => {
                    const name = c.name || c.subject || c.verifiedName || c.notify || c.id.split('@')[0];
                    list += `  \`${i + 1}\` — ${name}\n`;
                });
                list += `\n_Reply with just the number to choose._`;

                return reply(list);
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

                pendingConfig[cleanSender] = { step: 'group', groups };

                let list = '📋 *Select a WhatsApp Group:*\n\n';
                groups.forEach((g, i) => {
                    list += `  \`${i + 1}\` — ${g.subject}\n`;
                });
                list += `\n_Reply with just the number to choose._`;

                return reply(list);
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

// =========================================================================
//  .download — Enhanced: supports multiple files, movie scraping, TMDB info
// =========================================================================
async function downloadCommandHandler(conn, mek, from, senderJid, q, reply) {
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

            // Extract real filename from Content-Disposition header (CDN/R2/S3 links often have the real name here)
            const contentDisposition = response.headers['content-disposition'] || '';
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
            let mime = response.headers['content-type'] || 'application/octet-stream';
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

                await reply(`📤 Uploading file: *${finalFileName}* (${sizeInMB} MB)\n📍 To: ${destLabel}`);

                await conn.sendMessage(destJid, {
                    document: { url: tempFilePath },
                    mimetype: mime,
                    fileName: finalFileName
                }, destJid === from ? { quoted: mek } : {});

                if (destJid !== from) {
                    await reply(`✅ *${finalFileName}* (${sizeInMB} MB) successfully sent to the configured destination!`);
                }

                // Delete temporary file
                fs.unlinkSync(tempFilePath);
            }
        }

        await reply('✅ Processed all download items.');

    } catch (error) {
        console.error('Download command error:', error);
        reply(`❌ Failed to download/upload file: ${error.message}`);
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
    pattern: 'download',
    react: '📥',
    desc: 'Downloads files. Supports multiple files separated by commas, Vegamovies/Rogmovies/HDHub4u auto-scraping, and TMDB integration.',
    category: 'download',
    use: '.download <link>  OR  .download name = <link>  OR  .download name1 = link1, name2 link2',
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
    pendingConfig[cleanSender] = { step: 'mode', groups: [], chats: [] };
    await reply(
        `⚙️ *DanieWatch Download Config*\n\n` +
        `Current setting: ${modeLabel}\n\n` +
        `Where should downloaded files be sent?\n\n` +
        `*Reply with:*\n` +
        `  \`1\` — 📥 Private Chats\n` +
        `  \`2\` — 📤 WhatsApp Groups\n\n` +
        `_Reply with just the number to select._`
    );
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
        pendingConfig[cleanSender] = { step: 'group', groups };
        let list = '📋 *Your Groups:*\n\n';
        groups.forEach((g, i) => { list += `  \`${i + 1}\` — ${g.subject}\n`; });
        list += `\n_Reply with just the number to select._`;
        return reply(list);
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

DANIE_COMMANDS['download'] = async (conn, mek, from, senderJid, args, reply) => {
    await downloadCommandHandler(conn, mek, from, senderJid, args, reply);
};

DANIE_COMMANDS['p'] = async (conn, mek, from, senderJid, args, reply) => {
    await pCommandHandler(conn, mek, from, senderJid, args, reply);
};

// Export initUpsertListener so command.js can auto-initialize it
module.exports.initUpsertListener = initUpsertListener;
