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

    // 1. Terminate PID recorded in session/bot.pid if active and different from me and my parent
    if (fs.existsSync(pidFile)) {
        try {
            const oldPidStr = fs.readFileSync(pidFile, 'utf-8').trim();
            const oldPid = parseInt(oldPidStr, 10);
            if (!isNaN(oldPid) && oldPid !== myPid && oldPid !== parentPid) {
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
                        process.kill(oldPid, 'SIGKILL');
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

    // 2. Safely release occupied Port 3000 if occupied by a different process
    const targetPort = process.env.PORT || '3000';
    if (process.platform === 'win32') {
        try {
            const portPsScript = [
                `$portPids = Get-NetTCPConnection -LocalPort ${targetPort} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess;`,
                `foreach ($pid in $portPids) {`,
                `  if ($pid -ne ${myPid} -and $pid -ne ${parentPid || 0} -and $pid -gt 0) {`,
                `    Write-Host "Releasing port ${targetPort} held by PID: $pid";`,
                `    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue;`,
                `  }`,
                `}`
            ].join(' ');
            execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${portPsScript}"`, { stdio: 'ignore' });
        } catch (_) {}
    } else {
        try {
            const portPidStr = execSync(`lsof -t -i:${targetPort} || true`, { encoding: 'utf-8' }).trim();
            if (portPidStr) {
                const pids = portPidStr.split(/\s+/).map(p => parseInt(p, 10)).filter(Boolean);
                for (const p of pids) {
                    if (p > 0 && p !== myPid && p !== parentPid && p !== process.ppid) {
                        console.log(`[SingleInstance] Releasing port ${targetPort} held by PID: ${p}`);
                        try { process.kill(p, 'SIGKILL'); } catch (_) {}
                    }
                }
            }
        } catch (_) {}
    }

    // 3. Write current PID to lockfile
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
