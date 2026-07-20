const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('anju-xpro-baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, 'config.env');
if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
}

const SESSION_DIR = path.join(__dirname, 'session');

let pairingCodeRequested = false;

async function startPairing(cleanStart = true) {
    try { require('./src/Utils/singleInstance').killPreviousInstances(); } catch(e) {}
    if (cleanStart && fs.existsSync(SESSION_DIR)) {
        try {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        } catch (e) {}
    }
    
    if (!fs.existsSync(SESSION_DIR)) {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    let botNumber = process.env.BOT_NUMBER;
    
    if (!botNumber || botNumber.includes('your account') || botNumber.trim() === '') {
        console.log('❌ BOT_NUMBER is not configured!');
        console.log('Please edit the file named "config.env" in the root directory and add your number:');
        console.log('----------------------------------------');
        console.log('BOT_NUMBER=923013068663');
        console.log('----------------------------------------');
        process.exit(1);
    }

    botNumber = botNumber.replace(/[^0-9]/g, '');
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true,
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    console.log(`🤖 Target Phone Number: +${botNumber}`);
    console.log('⏳ Connecting to WhatsApp servers...');

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr && !pairingCodeRequested) {
            pairingCodeRequested = true;
            console.log('⏳ Requesting pairing code from WhatsApp...');
            try {
                const code = await sock.requestPairingCode(botNumber);
                console.log('\n=========================================');
                console.log(`🔑 YOUR PAIRING CODE:  ${code.toUpperCase()}`);
                console.log('=========================================');
                console.log('How to use:');
                console.log('1. Open WhatsApp on your phone.');
                console.log('2. Go to Settings -> Linked Devices -> Link a Device.');
                console.log('3. Tap "Link with phone number instead" at the bottom.');
                console.log('4. Enter the code above.');
                console.log('=========================================\n');
                console.log('Waiting for authorization from WhatsApp... Keep this terminal open.');
            } catch (err) {
                console.error('❌ Failed to request pairing code:', err.message);
                pairingCodeRequested = false;
                process.exit(1);
            }
        }

        if (connection === 'open') {
            console.log('\n=========================================');
            console.log('🎉 SUCCESS! WhatsApp Connected Successfully!');
            console.log(`🤖 Logged in as: ${sock.user.name || sock.user.id}`);
            console.log('=========================================');
            console.log('You can now close this terminal and start your bot with:');
            console.log('  pnpm start  or  node start.js');
            console.log('=========================================\n');
            process.exit(0);
        }
        
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            console.log(`🔄 Socket connection closed. Status Code: ${statusCode || 'unknown'}, Error:`, lastDisconnect?.error);
            if (shouldReconnect) {
                console.log('🔄 Reconnecting in background...');
                startPairing(false);
            } else {
                console.log('❌ Connection logged out! Clearing session directory...');
                try {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                } catch (e) {}
                process.exit(1);
            }
        }
    });
}

// Clean start to pair fresh
startPairing(true).catch(err => {
    console.error('Error starting pairing:', err);
});
