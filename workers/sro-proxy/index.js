var http = require('http');
var { load } = require('cheerio');

var SRO_URL = 'https://sro.nl/amerena/aanbod/banenzwemmen/';
var PORT = process.env.PORT || 3000;
var CACHE_TTL = 60 * 60 * 1000; // 1 hour

var cache = { data: null, timestamp: 0 };

// ==========================================
// HTML PARSING
// ==========================================

function classifyPool(text) {
    var lower = text.toLowerCase();
    if (lower.indexOf('breedte') !== -1 || lower.indexOf('25 meter') !== -1) {
        return { poolConfig: 'lanes25width', detail: 'In de breedte \u2013 25 meter' };
    }
    if (lower.indexOf('hele bad') !== -1) {
        return { poolConfig: 'fullpool', detail: 'Hele bad beschikbaar' };
    }
    var laneMatch = lower.match(/(\d+)\s*banen/);
    if (laneMatch && lower.indexOf('50') !== -1) {
        return { poolConfig: 'lanes50partial', detail: laneMatch[1] + ' banen van 50 meter' };
    }
    return { poolConfig: 'lanes50', detail: '' };
}

var DAY_MAP = {
    'maandag': 0, 'dinsdag': 1, 'woensdag': 2, 'donderdag': 3,
    'vrijdag': 4, 'zaterdag': 5, 'zondag': 6
};

function parseSchedule(html) {
    var $ = load(html);
    var results = [];
    var text = $('body').text();

    // Split into day sections by finding day name occurrences
    var dayNames = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
    var lower = text.toLowerCase();

    for (var d = 0; d < dayNames.length; d++) {
        var dayName = dayNames[d];
        var startPos = lower.indexOf(dayName);
        if (startPos === -1) continue;

        // Find next day or end of text
        var endPos = text.length;
        for (var nd = d + 1; nd < dayNames.length; nd++) {
            var nextPos = lower.indexOf(dayNames[nd], startPos + dayName.length);
            if (nextPos !== -1) {
                endPos = nextPos;
                break;
            }
        }

        var section = text.substring(startPos, endPos);

        // Find time ranges
        var timeRegex = /(\d{1,2}):(\d{2})\s*[-\u2013]\s*(\d{1,2}):(\d{2})/g;
        var match;
        while ((match = timeRegex.exec(section)) !== null) {
            var sh = parseInt(match[1], 10);
            var sm = parseInt(match[2], 10);
            var eh = parseInt(match[3], 10);
            var em = parseInt(match[4], 10);

            // Get surrounding text for pool classification
            var contextStart = Math.max(0, match.index - 20);
            var contextEnd = Math.min(section.length, match.index + match[0].length + 100);
            var context = section.substring(contextStart, contextEnd);

            var pool = classifyPool(context);

            results.push({
                day: DAY_MAP[dayName],
                startHour: sh,
                startMin: sm,
                endHour: eh,
                endMin: em,
                poolConfig: pool.poolConfig,
                detail: pool.detail
            });
        }
    }

    return results;
}

// ==========================================
// FETCH
// ==========================================

async function fetchSchedule() {
    var now = Date.now();
    if (cache.data && (now - cache.timestamp) < CACHE_TTL) {
        return cache.data;
    }

    var res = await fetch(SRO_URL, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SROProxy/1.0)' },
        signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) {
        throw new Error('SRO returned ' + res.status);
    }

    var html = await res.text();
    var schedule = parseSchedule(html);

    if (schedule.length > 0) {
        cache.data = schedule;
        cache.timestamp = now;
    }

    return schedule;
}

// ==========================================
// SERVER
// ==========================================

var ALLOWED_ORIGINS = [
    'https://veenspace.com',
    'https://www.veenspace.com',
    'https://vdveen.github.io'
];

function corsHeaders(origin) {
    var headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
    };
    if (origin && ALLOWED_ORIGINS.indexOf(origin) !== -1) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    // Also allow localhost for development
    if (origin && origin.match(/^https?:\/\/localhost/)) {
        headers['Access-Control-Allow-Origin'] = origin;
    }
    return headers;
}

var server = http.createServer(async function (req, res) {
    var origin = req.headers.origin || '';

    if (req.method === 'OPTIONS') {
        var h = corsHeaders(origin);
        h['Access-Control-Allow-Methods'] = 'GET';
        h['Access-Control-Max-Age'] = '86400';
        res.writeHead(204, h);
        res.end();
        return;
    }

    if (req.url !== '/' && req.url !== '/schedule') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    try {
        var schedule = await fetchSchedule();
        var body = JSON.stringify({
            schedule: schedule,
            cached: cache.timestamp > 0,
            updated: new Date(cache.timestamp).toISOString()
        });
        res.writeHead(200, corsHeaders(origin));
        res.end(body);
    } catch (err) {
        res.writeHead(502, corsHeaders(origin));
        res.end(JSON.stringify({ error: err.message, schedule: [] }));
    }
});

server.listen(PORT, function () {
    console.log('SRO proxy listening on port ' + PORT);
});
