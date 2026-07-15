function parseDownloadItem(item) {
    let customFilename = null;
    let url = item.trim();

    const firstEqIdx = item.indexOf('=');
    if (firstEqIdx !== -1) {
        const leftPart = item.substring(0, firstEqIdx).trim();
        const rightPart = item.substring(firstEqIdx + 1).trim();
        
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

const input1 = "Little.House.on.the.Prairie.S01.480p.WEB-DL.HIN-ENG.x264.ESub.mp4 = https://pub-f4ba9fb2017042968ec12c06f4b42344.r2.dev/f89dcad128acf340960ba71c64b4b3da?token=1784097413124";

const input2 = "https://556138dca7367763ed46eecaa4284eca.r2.cloudflarestorage.com/hub2/Little.House.on.the.Prairie.S01.480p.WEB-DL.HIN-ENG.x264.ESub-Vegamovies.hot.zip?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=26b6cf8a0399b5880643f585c8c3dbe5%2F20260715%2Fauto%2Fs3%2Faws4_request&X-Amz-Date=20260715T063653Z&X-Amz-Expires=10800&X-Amz-SignedHeaders=host&response-content-disposition=Little.House.on.the.Prairie.S01.480p.WEB-DL.HIN-ENG.x264.ESub-Vegamovies.hot.zip&X-Amz-Signature=2dc81e04f52a7ffc280158437a4b81a6861e62406ccd4dd58dc5a30d6cd81195";

console.log('Result 1 (Custom Name + URL with token):', parseDownloadItem(input1));
console.log('Result 2 (Direct URL with multiple query params):', parseDownloadItem(input2));
