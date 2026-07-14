const { cmd } = require('../Utils/command');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const fileType = require('file-type');

cmd({
    pattern: 'download',
    react: '📥',
    desc: 'Downloads a file from a direct link and uploads it to WhatsApp as a document.',
    category: 'download',
    use: '.download <direct-link>',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q, reply }) => {
    console.log("=== DOWNLOAD COMMAND TRIGGERED ===");
    console.log("q:", q);
    try {
        if (!q) {
            return reply('❌ Please provide a valid direct download link!\nExample: `.download https://example.com/file.zip`');
        }

        const url = q.trim();
        
        // Basic URL validation
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return reply('❌ Invalid link! The link must start with http:// or https://');
        }

        await reply('⏳ Downloading file... Please wait.');

        // Get filename from URL path first as a fallback
        let tempFilename = 'file_' + Date.now();
        try {
            const urlPath = new URL(url).pathname;
            const urlFile = urlPath.substring(urlPath.lastIndexOf('/') + 1);
            if (urlFile && urlFile.includes('.')) {
                tempFilename = decodeURIComponent(urlFile);
            }
        } catch (err) {}

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

        // Check if file exists and get stats
        if (!fs.existsSync(tempFilePath)) {
            throw new Error('Downloaded file does not exist on disk.');
        }

        const stats = fs.statSync(tempFilePath);
        const sizeInBytes = stats.size;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

        if (sizeInBytes > 2000 * 1024 * 1024) {
            fs.unlinkSync(tempFilePath);
            return reply(`❌ File is too large (${sizeInMB} MB). Max upload limit is 2 GB.`);
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

        await reply(`📤 Uploading file: *${tempFilename}* (${sizeInMB} MB)...`);

        // Send the file to user
        await conn.sendMessage(from, { 
            document: { url: tempFilePath }, 
            mimetype: mime, 
            fileName: tempFilename 
        }, { quoted: mek });

        // Delete temporary file
        fs.unlinkSync(tempFilePath);

    } catch (error) {
        console.error('Download command error:', error);
        reply(`❌ Failed to download/upload file: ${error.message}`);
    }
});

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

cmd({
    pattern: 'downloadgroup',
    alias: ['dg', 'dlgroup'],
    react: '📤',
    desc: 'Downloads a file from a direct link and uploads it directly to the configured group.',
    category: 'download',
    use: '.downloadgroup <direct-link>',
    filename: __filename
}, async (conn, mek, m, { from, quoted, q, reply }) => {
    const TARGET_GROUP = '120363263215689587@g.us';
    console.log("=== DOWNLOADGROUP COMMAND TRIGGERED ===");
    console.log("q:", q);
    try {
        if (!q) {
            return reply('❌ Please provide a valid direct download link!\nExample: `.downloadgroup https://example.com/file.zip`');
        }

        const url = q.trim();
        
        // Basic URL validation
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return reply('❌ Invalid link! The link must start with http:// or https://');
        }

        await reply('⏳ Downloading file... Please wait.');

        // Get filename from URL path first as a fallback
        let tempFilename = 'file_' + Date.now();
        try {
            const urlPath = new URL(url).pathname;
            const urlFile = urlPath.substring(urlPath.lastIndexOf('/') + 1);
            if (urlFile && urlFile.includes('.')) {
                tempFilename = decodeURIComponent(urlFile);
            }
        } catch (err) {}

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

        // Check if file exists and get stats
        if (!fs.existsSync(tempFilePath)) {
            throw new Error('Downloaded file does not exist on disk.');
        }

        const stats = fs.statSync(tempFilePath);
        const sizeInBytes = stats.size;
        const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

        if (sizeInBytes > 2000 * 1024 * 1024) {
            fs.unlinkSync(tempFilePath);
            return reply(`❌ File is too large (${sizeInMB} MB). Max upload limit is 2 GB.`);
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

        await reply(`📤 Uploading file to group: *${tempFilename}* (${sizeInMB} MB)...`);

        // Send the file to target group JID instead of "from"
        await conn.sendMessage(TARGET_GROUP, { 
            document: { url: tempFilePath }, 
            mimetype: mime, 
            fileName: tempFilename 
        });

        // Notify user of completion in private chat
        await reply(`✅ Successfully uploaded *${tempFilename}* to the group!`);

        // Delete temporary file
        fs.unlinkSync(tempFilePath);

    } catch (error) {
        console.error('Downloadgroup command error:', error);
        reply(`❌ Failed to download/upload file: ${error.message}`);
    }
});


