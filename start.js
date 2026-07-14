const { fork, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting your custom DanieWatch Downloader Bot...');

// Auto-update: Pull fresh files from GitHub at startup
try {
    console.log('🔄 Checking for fresh bot files from GitHub...');
    // Run git pull. Use a 20-second timeout to avoid getting stuck if connection is slow/unstable.
    const pullOutput = execSync('git pull', { stdio: 'pipe', encoding: 'utf-8', timeout: 20000 });
    
    if (pullOutput.includes('Already up to date.')) {
        console.log('✅ Your bot is already up-to-date with the repository.');
    } else {
        console.log('🎉 Successfully fetched fresh files from GitHub!');
        console.log(pullOutput);
        
        // If package.json was modified in the pull, let's notify the user
        if (pullOutput.includes('package.json') || pullOutput.includes('pnpm-lock.yaml')) {
            console.log('⚠️ Dependencies might have changed. It is recommended to run "npm install" or "pnpm install" to ensure all packages are updated.');
        }
    }
} catch (error) {
    console.warn('⚠️ Warning: Failed to fetch updates from GitHub (perhaps offline, no git repo initialized, or local conflicts exist):');
    console.warn(error.message);
}

const botBrainPath = path.join(__dirname, 'queen.js');

if (!fs.existsSync(botBrainPath)) {
    console.error('❌ Error: queen.js is missing! Please make sure the brain file is in the folder.');
    process.exit(1);
}

// Start the bot process
const child = fork(botBrainPath, [], {
    stdio: 'inherit',
    windowsHide: true
});

child.on('error', (err) => {
    console.error('❌ Bot crashed with error:', err.message);
});

child.on('exit', (code) => {
    console.log(`🤖 Bot process exited with code ${code}`);
});