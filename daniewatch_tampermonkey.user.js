// ==UserScript==
// @name         DanieWatch Bot Link Grabber
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Adds a floating "Copy Bot Command" button to easily copy download links in the WhatsApp bot format.
// @author       Danie
// @include      *://*vegamovies*/*
// @include      *://*rogmovies*/*
// @include      *://*hdhub4u*/*
// @include      *://*vcloud*/*
// @include      *://*hubcloud*/*
// @include      *://*vgmlink*/*
// @include      *://*gdflix*/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // CSS styling for buttons and notifications
    GM_addStyle(`
        .dw-btn {
            background: linear-gradient(135deg, #10B981, #059669);
            color: white !important;
            border: none;
            padding: 8px 12px;
            font-size: 13px;
            font-weight: bold;
            border-radius: 6px;
            cursor: pointer;
            box-shadow: 0 4px 6px rgba(0,0,0,0.15);
            transition: all 0.2s ease-in-out;
            margin: 4px;
            display: inline-flex;
            align-items: center;
            font-family: system-ui, -apple-system, sans-serif;
            text-decoration: none !important;
        }
        .dw-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0,0,0,0.2);
            background: linear-gradient(135deg, #34D399, #10B981);
        }
        .dw-btn:active {
            transform: translateY(0);
        }
        .dw-toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #1F2937;
            color: #F9FAFB;
            padding: 12px 24px;
            border-radius: 8px;
            box-shadow: 0 10px 15px rgba(0,0,0,0.3);
            z-index: 99999;
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            font-weight: 500;
            border-left: 4px solid #10B981;
            transform: translateY(100px);
            opacity: 0;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .dw-toast.show {
            transform: translateY(0);
            opacity: 1;
        }
    `);

    // Show a toast notification
    function showToast(message) {
        let toast = document.querySelector('.dw-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'dw-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        setTimeout(() => toast.classList.add('show'), 50);
        setTimeout(() => {
            toast.classList.remove('show');
        }, 3000);
    }

    // Clean movie title
    function getCleanTitle() {
        let title = document.title || '';
        title = title.replace(/^download\s+/i, '')
                     .replace(/\s*-\s*vegamovies.*/i, '')
                     .replace(/\s*-\s*rogmovies.*/i, '')
                     .replace(/\s*-\s*hdhub4u.*/i, '')
                     .replace(/\s*page\s+\d+/gi, '')
                     .replace(/\[[^\]]*\]/g, '')
                     .trim();
        return title;
    }

    // Copy to clipboard
    function copyCommand(filename, url) {
        const command = `.download ${filename} = ${url}`;
        GM_setClipboard(command);
        showToast(`📋 Copied: "${filename}"`);
    }

    // Process pages depending on domain
    const host = window.location.hostname;

    function detectResolution(element) {
        let parentText = '';
        let current = element;
        for (let i = 0; i < 4; i++) {
            if (!current) break;
            parentText += ' ' + current.textContent;
            let heading = current.querySelector('h1, h2, h3, h4, h5, h6, strong');
            if (heading) parentText += ' ' + heading.textContent;
            current = current.parentElement;
        }
        
        let prev = element.closest('p, div, center');
        if (prev) {
            let prevSibling = prev.previousElementSibling;
            let checks = 0;
            while (prevSibling && checks < 5) {
                const text = prevSibling.textContent;
                if (text.match(/480p|720p|1080p|2160p|4k/i)) {
                    parentText += ' ' + text;
                    break;
                }
                prevSibling = prevSibling.previousElementSibling;
                checks++;
            }
        }

        const combinedText = parentText.toLowerCase();
        if (combinedText.includes('2160p') || combinedText.includes('4k')) return '2160p';
        if (combinedText.includes('1080p')) return '1080p';
        if (combinedText.includes('720p')) return '720p';
        if (combinedText.includes('480p')) return '480p';
        return '720p';
    }

    if (host.includes('vegamovies') || host.includes('rogmovies') || host.includes('hdhub4u')) {
        const buttons = [];

        // 1. Grab by class name (vegamovies/rogmovies button template)
        document.querySelectorAll('button.dwd-button, .dwd-button').forEach(btn => {
            const link = btn.closest('a');
            if (link && !buttons.some(b => b.link === link)) {
                buttons.push({ link, target: btn });
            }
        });

        // 2. Grab other anchors matching download patterns
        document.querySelectorAll('a[href]').forEach(link => {
            const href = link.href;
            if (!href || href.startsWith('#')) return;

            const lowerHref = href.toLowerCase();
            if (lowerHref.includes('/category/') || lowerHref.includes('/tag/') || lowerHref.includes('/genre/') || lowerHref.includes('?s=') || lowerHref.includes('/author/')) {
                return;
            }

            if (lowerHref.includes('imdb.com') || lowerHref.includes('youtube.com') || lowerHref.includes('telegram') || lowerHref.includes('facebook') || lowerHref.includes('twitter') || lowerHref.includes('pinterest')) {
                return;
            }

            const text = link.textContent.trim().toLowerCase();
            const isExternal = !href.includes(window.location.hostname);
            const hasDwdKeyword = text.includes('download') || text.includes('click here') || text.includes('v-cloud') || text.includes('g-direct') || text.includes('hubcloud') || text.includes('gdflix');

            if ((isExternal && hasDwdKeyword) || text === 'download now' || link.classList.contains('btn')) {
                if (!buttons.some(b => b.link === link)) {
                    buttons.push({ link, target: link });
                }
            }
        });

        // Inject Bot buttons next to actual download links
        buttons.forEach(({ link, target }) => {
            const res = detectResolution(target);
            
            const btn = document.createElement('button');
            btn.className = 'dw-btn';
            btn.textContent = `📋 Bot [${res}]`;
            btn.style.marginLeft = '10px';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const cleanTitle = getCleanTitle();
                let fileSuffix = `[${res}].mp4`;
                copyCommand(`${cleanTitle} ${fileSuffix}`, link.href);
            });

            // Insert next to the anchor link or the button itself
            link.parentNode.insertBefore(btn, link.nextSibling);
        });
    } else if (host.includes('vcloud') || host.includes('hubcloud') || host.includes('gdflix') || host.includes('vgmlink')) {
        // Redirect/Landing pages or Final V-Cloud page
        // Find direct download servers
        const btns = document.querySelectorAll('a.btn, h2 a.btn');
        btns.forEach(btn => {
            const text = btn.textContent.toLowerCase();
            const href = btn.href;
            if (!href) return;

            if (text.includes('download file') || text.includes('pixeldrain') || text.includes('fsl') || text.includes('mega')) {
                const copyBtn = document.createElement('button');
                copyBtn.className = 'dw-btn';
                copyBtn.textContent = '📋 Copy Bot Link';
                copyBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    let directUrl = href;
                    if (directUrl.includes('pixeldrain.com/u/')) {
                        const id = directUrl.split('/u/')[1].split('?')[0];
                        directUrl = `https://pixeldrain.com/api/file/${id}?download`;
                    }
                    const cleanTitle = getCleanTitle();
                    copyCommand(`${cleanTitle}.mp4`, directUrl);
                });
                btn.parentNode.insertBefore(copyBtn, btn.nextSibling);
            }
        });
    }
})();
