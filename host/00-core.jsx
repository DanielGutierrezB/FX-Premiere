/**
 * FX Premiere host runtime. ExtendScript is ES3: no let/const, no arrow functions,
 * no Array.prototype helpers, no JSON object.
 */
var FXP = FXP || {};

FXP.VERSION = '1.0.0';
FXP.TICKS_PER_SECOND = 254016000000;
FXP.VIDEO_MEDIA_GUID = '228cda18-3625-4d2d-951e-348879e4ed93';
FXP.log = [];

FXP.trace = function (message) {
    if (FXP.log.length < 240) {
        FXP.log[FXP.log.length] = String(message);
    }
};

FXP.trim = function (value) {
    return String(value).replace(/^[\s\u00A0]+/, '').replace(/[\s\u00A0]+$/, '');
};

FXP.contains = function (list, value) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === value) {
            return true;
        }
    }
    return false;
};

FXP.errorText = function (error) {
    if (!error) {
        return 'Unknown error';
    }
    if (error.message) {
        return String(error.message);
    }
    return String(error);
};

FXP.json = {};

FXP.json.escape = function (value) {
    var text = String(value);
    var out = '';
    for (var i = 0; i < text.length; i++) {
        var ch = text.charAt(i);
        var code = text.charCodeAt(i);
        if (ch === '"') {
            out += '\\"';
        } else if (ch === '\\') {
            out += '\\\\';
        } else if (ch === '\n') {
            out += '\\n';
        } else if (ch === '\r') {
            out += '\\r';
        } else if (ch === '\t') {
            out += '\\t';
        } else if (code < 32 || code > 126) {
            var hex = code.toString(16);
            while (hex.length < 4) {
                hex = '0' + hex;
            }
            out += '\\u' + hex;
        } else {
            out += ch;
        }
    }
    return '"' + out + '"';
};

FXP.json.stringify = function (value) {
    if (value === null || value === undefined) {
        return 'null';
    }
    var type = typeof value;
    if (type === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (type === 'number') {
        return isFinite(value) ? String(value) : 'null';
    }
    if (type === 'string') {
        return FXP.json.escape(value);
    }
    if (type === 'function') {
        return 'null';
    }
    if (value instanceof Array) {
        var items = [];
        for (var i = 0; i < value.length; i++) {
            items[items.length] = FXP.json.stringify(value[i]);
        }
        return '[' + items.join(',') + ']';
    }
    var pairs = [];
    for (var key in value) {
        if (!value.hasOwnProperty(key)) {
            continue;
        }
        var entry = value[key];
        if (entry === undefined || typeof entry === 'function') {
            continue;
        }
        pairs[pairs.length] = FXP.json.escape(key) + ':' + FXP.json.stringify(entry);
    }
    return '{' + pairs.join(',') + '}';
};

FXP.json.parse = function (text) {
    var raw = FXP.trim(text);
    if (raw === '') {
        return null;
    }
    var first = raw.charAt(0);
    if (first !== '{' && first !== '[' && first !== '"') {
        return null;
    }
    return eval('(' + raw + ')');
};

FXP.round = function (value, digits) {
    var factor = Math.pow(10, digits || 0);
    return Math.round(value * factor) / factor;
};

FXP.pad2 = function (value) {
    var text = String(Math.floor(value));
    return text.length < 2 ? '0' + text : text;
};

/** Premiere's QE DOM expects durations as HH;MM;SS;FF strings. */
FXP.framesToTimecode = function (frames, fps) {
    var total = Math.max(0, Math.round(frames));
    var rate = Math.max(1, Math.round(fps || 25));
    var seconds = Math.floor(total / rate);
    return (
        FXP.pad2(Math.floor(seconds / 3600)) +
        ';' +
        FXP.pad2(Math.floor((seconds % 3600) / 60)) +
        ';' +
        FXP.pad2(seconds % 60) +
        ';' +
        FXP.pad2(total % rate)
    );
};
