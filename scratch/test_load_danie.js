try {
    require('../src/commands/danie_download');
    console.log('Successfully loaded danie_download.js!');
} catch (e) {
    console.error('FAILED TO LOAD danie_download.js:');
    console.error(e);
}
