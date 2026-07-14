// Simple inline parser test
function parseDownloadItem(item) {
    let customFilename = null;
    let url = item.trim();

    if (item.includes('=')) {
        const parts = item.split('=').map(p => p.trim());
        if (parts.length >= 2) {
            customFilename = parts[0];
            url = parts.slice(1).join('=').trim();
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

console.log('Test 1 (no name):', parseDownloadItem('https://example.com/file.zip'));
console.log('Test 2 (= separator):', parseDownloadItem('myfile.zip = https://example.com/file.zip'));
console.log('Test 3 (space separator):', parseDownloadItem('my file name.zip https://example.com/file.zip'));
