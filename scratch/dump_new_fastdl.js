const axios = require('axios');

async function dump() {
    const url = 'https://fastdl.zip/embed.php?download=GInVmupPKndZcD9mPLlfxBSdG';
    try {
        const res = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': 'https://nexdrive.fit/'
            }
        });
        console.log(res.data);
    } catch(e) {
        console.error(e);
    }
}
dump();
