const arr = require('./arr.js');

arr.forEach((item, idx) => {
    if (typeof item === 'string') {
        if (item.length > 2 && !/^[a-zA-Z0-9_$]+$/.test(item)) {
            console.log(`${idx}:`, JSON.stringify(item));
        }
    }
});
