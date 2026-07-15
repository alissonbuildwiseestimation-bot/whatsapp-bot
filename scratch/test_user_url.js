const path = require('path');

function cleanFileName(filename) {
    if (!filename) return '';
    return filename.replace(/\.(mp4|mkv|avi|webm|mov|3gp|srt)$/i, '').trim();
}

function processFilename(targetFilename, tempFilename, isArchive, ext, relativeFiles) {
    if (isArchive) {
        let FolderName = '';
        if (targetFilename) {
            FolderName = cleanFileName(targetFilename);
        } else {
            FolderName = cleanFileName(tempFilename);
        }

        // Detect shared root folder
        let archiveRootFolder = null;
        if (relativeFiles.length > 0) {
            const normalizedFiles = relativeFiles.map(f => f.replace(/\\/g, '/'));
            const firstRelative = normalizedFiles[0];
            const firstRoot = firstRelative.split('/')[0];
            const allShareRoot = normalizedFiles.every(f => {
                return f.split('/')[0] === firstRoot && f.split('/').length > 1;
            });
            if (allShareRoot) {
                archiveRootFolder = firstRoot;
            }
        }

        console.log(`Folder Name: "${FolderName}"`);
        console.log(`Detected Root Folder inside zip: "${archiveRootFolder}"`);

        return relativeFiles.map(f => {
            let relPath = f.replace(/\\/g, '/');
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
            
            // Check if extension is already there, append if not
            const fileExt = path.extname(f).substring(1);
            if (fileExt && !finalFileName.toLowerCase().endsWith('.' + fileExt.toLowerCase())) {
                finalFileName += '.' + fileExt;
            }
            return finalFileName;
        });
    } else {
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
        return finalFileName;
    }
}

// Test cases
console.log('=== TEST 1: ZIP Archive with top-level root ===');
const files1 = [
    'Little.House-Vegamovies.hot/01.mp4',
    'Little.House-Vegamovies.hot/02.mp4',
    'Little.House-Vegamovies.hot/SubFolder/03.mp4'
];
console.log(processFilename(
    'Little.House.Prairie.S01.480p.mp4',
    'Little.House-Vegamovies.hot.zip',
    true,
    'zip',
    files1
));

console.log('\n=== TEST 2: ZIP Archive without shared root ===');
const files2 = [
    '01.mp4',
    '02.mp4',
    'SubFolder/03.mp4'
];
console.log(processFilename(
    'Little.House.Prairie.S01.480p.mp4',
    'Little.House-Vegamovies.hot.zip',
    true,
    'zip',
    files2
));

console.log('\n=== TEST 3: Direct non-archive file with custom name ===');
console.log(processFilename(
    'MyMovie.mp4',
    'file_12345.mp4',
    false,
    'mp4',
    []
));

console.log('\n=== TEST 4: Direct non-archive file with no custom name ===');
console.log(processFilename(
    null,
    'some-movie-Vegamovies.mp4',
    false,
    'mp4',
    []
));
