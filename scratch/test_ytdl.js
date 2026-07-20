const fs = require('fs');
const path = require('path');
const ytdl = require('@distube/ytdl-core');

async function testYtdl() {
    const ytUrl = 'https://www.youtube.com/watch?v=dfeUzm6KF4g'; // Fight club trailer
    console.log('Testing @distube/ytdl-core download for:', ytUrl);
    const outputPath = path.join(__dirname, 'test_trailer.mp4');

    try {
        const stream = ytdl(ytUrl, { filter: 'audioandvideo', quality: 'highestvideo' });
        const writer = fs.createWriteStream(outputPath);
        stream.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
            stream.on('error', reject);
        });

        const stats = fs.statSync(outputPath);
        console.log('Downloaded successfully! File size:', (stats.size / (1024 * 1024)).toFixed(2), 'MB');
        fs.unlinkSync(outputPath);
    } catch (e) {
        console.error('ytdl error:', e.message);
    }
}

testYtdl();
