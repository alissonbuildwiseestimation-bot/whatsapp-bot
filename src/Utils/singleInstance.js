const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function killPreviousInstances() {
    const sessionDir = path.join(__dirname, '..', '..', 'session');
    if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
    }

    const pidFile = path.join(sessionDir, 'bot.pid');
    const myPid = process.pid;
    const parentPid = process.ppid;

    // Avoid redundant execution in the same process
    if (process.env.SINGLE_INSTANCE_INITIALIZED === String(myPid)) {
        return;
    }
    process.env.SINGLE_INSTANCE_INITIALIZED = String(myPid);

    console.log(`[SingleInstance] Initializing single-instance guard (PID: ${myPid}, Parent: ${parentPid})...`);

    // 1. Gracefully terminate PID recorded in session/bot.pid if active and different from me and my parent
    if (fs.existsSync(pidFile)) {
        try {
            const oldPidStr = fs.readFileSync(pidFile, 'utf-8').trim();
            const oldPid = parseInt(oldPidStr, 10);
            if (!isNaN(oldPid) && oldPid > 0 && oldPid !== myPid && oldPid !== parentPid && oldPid !== process.ppid) {
                let isRunning = false;
                try {
                    process.kill(oldPid, 0);
                    isRunning = true;
                } catch (e) {
                    isRunning = e.code === 'EPERM';
                }

                if (isRunning) {
                    console.log(`[SingleInstance] Found previous running bot process (PID: ${oldPid}). Terminating...`);
                    try {
                        process.kill(oldPid, 'SIGTERM');
                    } catch (_) {}

                    if (process.platform === 'win32') {
                        try {
                            execSync(`taskkill /F /PID ${oldPid}`, { stdio: 'ignore' });
                        } catch (_) {}
                    }
                }
            }
        } catch (e) {
            console.error('[SingleInstance] Error checking/killing old PID:', e.message);
        }
    }

    // 2. Write current PID to lockfile
    try {
        fs.writeFileSync(pidFile, String(myPid), 'utf-8');
    } catch (e) {
        console.error('[SingleInstance] Failed to write PID file:', e.message);
    }

    // Clean lockfile on process exit
    const cleanupLock = () => {
        try {
            if (fs.existsSync(pidFile)) {
                const currentContent = fs.readFileSync(pidFile, 'utf-8').trim();
                if (currentContent === String(myPid)) {
                    fs.unlinkSync(pidFile);
                }
            }
        } catch (_) {}
    };

    process.once('exit', cleanupLock);
    process.once('SIGINT', () => { cleanupLock(); process.exit(0); });
    process.once('SIGTERM', () => { cleanupLock(); process.exit(0); });
}

module.exports = { killPreviousInstances };
