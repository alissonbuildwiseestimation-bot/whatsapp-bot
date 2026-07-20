const path = require('path');
const fs = require('fs');

async function testYtCmd() {
    try {
        const youtubePath = path.join(__dirname, '../src/commands/youtube.js');
        const code = fs.readFileSync(youtubePath, 'utf8');
        
        // Match all http/https URLs or endpoints in youtube.js
        const urls = code.match(/https?:\/\/[^\s"',`\\]+/gi) || [];
        console.log('URLs in youtube.js:', [...new Set(urls)]);

        // Look for string literals in youtube.js
        const strings = code.match(/["']([^"']+)["']/g) || [];
        const filtered = strings.map(s => s.slice(1, -1)).filter(s => s.includes('http') || s.includes('api') || s.includes('yt') || s.includes('download'));
        console.log('Filtered strings in youtube.js:', [...new Set(filtered)]);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

testYtCmd();
