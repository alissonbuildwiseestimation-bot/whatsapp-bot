const { cmd } = require('../Utils/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fileType = require('file-type');

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
    // Default: send to private chat
    return { mode: 'private', groupJid: '', groupName: '' };
}

function saveSettings(settings) {
    try {
        // Ensure session directory exists
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
// pendingConfig[senderJid] = { step: 'mode'|'group', groups: [...] }
const pendingConfig = {};

// Owner check helper — uses BOT_NUMBER / SUDO from config.env
function isOwner(senderJid) {
    const ownerNum = (process.env.BOT_NUMBER || '').trim();
    const sudoNums = (process.env.SUDO || '').split(',').map(n => n.trim()).filter(Boolean);
    const allOwners = [ownerNum, ...sudoNums];
    const senderNum = senderJid.replace(/@.*/, '');
    return allOwners.includes(senderNum);
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

        // If user passed an argument, handle it as a reply
        if (q && q.trim()) {
            return handleConfigReply(conn, mek, m, senderJid, q.trim(), reply);
        }

        // Start the wizard — step 1: choose mode
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

// Handle replies to the .config wizard
async function handleConfigReply(conn, mek, m, senderJid, text, reply) {
    const state = pendingConfig[senderJid];

    // No pending state? treat text as a fresh choice
    const step = state ? state.step : 'mode';

    if (step === 'mode') {
        if (text === '1') {
            // Private mode
            const settings = { mode: 'private', groupJid: '', groupName: '' };
            saveSettings(settings);
            delete pendingConfig[senderJid];
            return reply('✅ Download mode set to *Private Chat*.\n\nAll files from `.download` will be sent directly to you.');
        }

        if (text === '2') {
            // Group mode — fetch groups list
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

                // Store groups and advance step
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

        // Invalid choice
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
    desc: 'Quick-set the target group for downloads. Use ".setgroup list" to see groups, or ".setgroup <number>" to pick one.',
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

        // Fetch groups
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

        // ".setgroup list" or no arg — show the list
        if (!arg || arg === 'list') {
            // Store in pending so ".setgroup <num>" can use it immediately
            pendingConfig[senderJid] = { step: 'group', groups };

            let list = '📋 *Your Groups:*\n\n';
            groups.forEach((g, i) => {
                list += `  \`${i + 1}\` — ${g.subject}\n`;
            });
            list += `\n_Reply with \`.setgroup <number>\` to select._`;
            return reply(list);
        }

        // ".setgroup <number>"
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
//  .download — Enhanced: supports "filename | url" and config-driven dest
// =========================================================================
cmd({
    pattern: 'download',
    react: '📥',
    desc: 'Downloads a file from a direct link. Sends to the configured destination (private or group).\nUse: .download <link>  OR  .download filename | <link>',
    category: 'download',
    use: '.download <direct-link>  OR  .download myfile.zip | <direct-link>',
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
                '`.download myname.zip | https://example.com/file.zip`\n\n' +
                '_Use \`.config\` to set destination (private/group)._'
            );
        }

        // Parse "filename | url" or just "url"
        let customFilename = null;
        let url = q.trim();

        if (q.includes('|')) {
            const parts = q.split('|').map(p => p.trim());
            if (parts.length >= 2) {
                customFilename = parts[0];
                url = parts.slice(1).join('|').trim(); // rejoin in case URL contains |
            }
        }

        // Basic URL validation
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return reply('❌ Invalid link! Must start with http:// or https://');
        }

        // Load settings to determine destination
        const settings = loadSettings();
        const isGroupMode = settings.mode === 'group' && settings.groupJid;
        const destJid = isGroupMode ? settings.groupJid : from;
        const destLabel = isGroupMode ? `📤 Group: *${settings.groupName}*` : '📥 *Private Chat*';

        await reply(`⏳ Downloading file...\n📍 Destination: ${destLabel}`);

        // Determine filename
        let tempFilename = customFilename || ('file_' + Date.now());
        if (!customFilename) {
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

        // Check file exists
        if (!fs.existsSync(tempFilePath)) {
            throw new Error('Downloaded file does not exist on disk.');
        }

        const stats = fs.statSync(tempFilePath);
        const sizeInBytes = stats.size;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

        if (sizeInBytes > 2000 * 1024 * 1024) {
            fs.unlinkSync(tempFilePath);
            return reply(`❌ File too large (${sizeInMB} MB). Max is 2 GB.`);
        }

        // Detect MIME type
        let mime = response.headers['content-type'] || 'application/octet-stream';
        try {
            const fileBuffer = fs.readFileSync(tempFilePath, { start: 0, end: 4100 });
            const detectedType = await fileType.fromBuffer(fileBuffer);
            if (detectedType) {
                mime = detectedType.mime;
            }
        } catch (err) {}

        await reply(`📤 Uploading: *${tempFilename}* (${sizeInMB} MB)\n📍 To: ${destLabel}`);

        // Send file to configured destination
        await conn.sendMessage(destJid, {
            document: { url: tempFilePath },
            mimetype: mime,
            fileName: tempFilename
        }, isGroupMode ? {} : { quoted: mek });

        // If sent to a group, also confirm in private chat
        if (isGroupMode && destJid !== from) {
            await reply(`✅ *${tempFilename}* (${sizeInMB} MB) sent to *${settings.groupName}*!`);
        } else {
            // Message is already in the same chat, no extra confirmation needed
        }

        // Cleanup
        fs.unlinkSync(tempFilePath);

    } catch (error) {
        console.error('Download command error:', error);
        reply(`❌ Failed to download/upload: ${error.message}`);
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
