const axios = require('axios');
const cheerio = require('cheerio');

async function printSiblings() {
    const url = 'https://nexdrive.fit/genxfm784776492707/';
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(response.data);
        
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (href && (href.includes('fastdl') || href.includes('filebee') || href.includes('vcloud'))) {
                // Find preceding heading (h1-h6 or strong or p text containing Episode)
                let heading = '';
                
                // Traverse backwards from the anchor's parent to find the closest heading or label
                let curr = $(el).closest('p, div');
                let found = false;
                while (curr.length && !found) {
                    let sib = curr.prev();
                    while (sib.length) {
                        const name = sib[0].name.toLowerCase();
                        const text = sib.text().trim();
                        if (/^h[1-6]$/.test(name) || (name === 'p' && text.toLowerCase().includes('episode'))) {
                            heading = text;
                            found = true;
                            break;
                        }
                        sib = sib.prev();
                    }
                    curr = curr.parent();
                }

                console.log(`Link: "${$(el).text().trim()}" -> Href: "${href}" [Heading: "${heading}"]`);
            }
        });
    } catch(e) {
        console.error(e);
    }
}
printSiblings();
