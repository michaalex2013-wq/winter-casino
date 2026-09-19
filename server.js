// ========== ТЕХ-РАБОТЫ ==========
// Если maintenance = true, все игровые и бонусные запросы блокируются
const MAINTENANCE_KEY = 'MAINTENANCE_ON_2026';

app.use('/api', (req, res, next) => {
    // Не блокируем admin-запросы
    if (req.path.startsWith('/admin/')) return next();
    // Не блокируем логин/регистрацию
    if (req.path === '/login' || req.path === '/register') return next();

    const db = loadDB();
    if (db.maintenance && db.maintenance.enabled) {
        return res.json({ ok: false, error: 'MAINTENANCE', maintenance: true, message: db.maintenance.message || 'Тех-работы. Заходите позже.' });
    }
    next();
});

app.post('/api/admin/maintenance-toggle', (req, res) => {
    const { password, enabled, message } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    db.maintenance = { enabled: !!enabled, message: String(message || 'Тех-работы').slice(0, 200) };
    logAction(db, 'maintenance', 'admin', enabled ? 'ON' : 'OFF');
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/check-maintenance', (req, res) => {
    const db = loadDB();
    res.json({ ok: true, maintenance: db.maintenance || { enabled: false } });
});

// ========== ЭКСПОРТ БАЗЫ ==========
app.post('/api/admin/export', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    // Не отдаём пароли и токены
    const safe = JSON.parse(JSON.stringify(db));
    Object.keys(safe.users || {}).forEach(u => {
        delete safe.users[u].password;
        delete safe.users[u].token;
    });
    res.json({ ok: true, data: safe });
});

// ========== ПРОСМОТР ИГРОКА В АДМИНКЕ ==========
app.post('/api/admin/user-info', (req, res) => {
    const { password, username } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    const s = db.stats?.[username] || { totalWin: 0, totalBet: 0, maxMult: 0, gamesPlayed: 0 };
    const txs = (db.transactions || []).filter(t => t.user === username).slice(-20).reverse();
    res.json({
        ok: true,
        user: {
            username: u.username,
            stars: u.stars,
            grams: u.grams || 0,
            prefix: u.prefix || '',
            banned: u.banned,
            frozen: u.frozen || false,
            premium: u.premium && u.premiumUntil > Date.now(),
            friends: (u.friends || []).length,
            clan: u.clan || null,
            marriedTo: u.marriedTo || null,
            achievements: (u.achievements || []).length,
            bets: u.bets || 0,
            created: u.created,
            stats: s
        },
        transactions: txs
    });
});

// ========== АНТИЧИТ ==========
// При каждой ставке записываем в очередь проверки.
// Если за последние 60 секунд у игрока более 40 ставок или сумма выигрыша > 1 000 000 за час — флаг.
function antiCheatCheck(db, user) {
    const now = Date.now();
    if (!db.anticheat) db.anticheat = {};
    if (!db.anticheat[user.username]) db.anticheat[user.username] = { recentBets: [], flags: [] };

    const ac = db.anticheat[user.username];
    ac.recentBets.push(now);
    // Держим только последние 5 минут
    ac.recentBets = ac.recentBets.filter(t => now - t < 5 * 60 * 1000);

    // Много ставок
    if (ac.recentBets.length > 40) {
        if (!ac.flags.find(f => f.type === 'many_bets' && now - f.date < 10 * 60 * 1000)) {
            ac.flags.push({ type: 'many_bets', date: now, detail: ac.recentBets.length + ' ставок за 5 мин' });
        }
    }

    // Слишком много звёзд (общий баланс > 10 000 000)
    if (user.stars > 10000000) {
        if (!ac.flags.find(f => f.type === 'huge_balance' && now - f.date < 10 * 60 * 1000)) {
            ac.flags.push({ type: 'huge_balance', date: now, detail: 'Баланс ' + user.stars });
        }
    }

    if (ac.flags.length > 50) ac.flags = ac.flags.slice(-50);
}

app.post('/api/admin/anticheat', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    if (!db.anticheat) db.anticheat = {};
    const all = [];
    Object.keys(db.anticheat).forEach(user => {
        db.anticheat[user].flags.forEach(f => all.push({ user, ...f }));
    });
    all.sort((a, b) => b.date - a.date);
    res.json({ ok: true, flags: all.slice(0, 50) });
});

app.post('/api/admin/anticheat-clear', (req, res) => {
    const { password, username } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    if (db.anticheat && db.anticheat[username]) {
        db.anticheat[username].flags = [];
        db.anticheat[username].recentBets = [];
    }
    saveDB(db);
    res.json({ ok: true });
});

// ========== МАСС-РАССЫЛКА ==========
app.post('/api/admin/broadcast', (req, res) => {
    const { password, text } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const msg = String(text || '').trim().slice(0, 500);
    if (!msg) return res.json({ ok: false, error: 'Пусто' });
    const db = loadDB();
    if (!db.broadcast) db.broadcast = [];
    db.broadcast.push({ text: msg, date: Date.now() });
    if (db.broadcast.length > 20) db.broadcast = db.broadcast.slice(-20);
    saveDB(db);
    res.json({ ok: true, count: Object.keys(db.users).length });
});

app.post('/api/broadcast-get', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!db.broadcast) return res.json({ ok: true, broadcast: null });
    const last = db.broadcast[db.broadcast.length - 1];
    if (!last) return res.json({ ok: true, broadcast: null });
    // Показываем только если игрок её не видел
    if (!user.seenBroadcasts) user.seenBroadcasts = [];
    if (user.seenBroadcasts.includes(last.date)) return res.json({ ok: true, broadcast: null });
    user.seenBroadcasts.push(last.date);
    if (user.seenBroadcasts.length > 20) user.seenBroadcasts = user.seenBroadcasts.slice(-20);
    saveDB(db);
    res.json({ ok: true, broadcast: last });
});

// ========== ТЁМНАЯ / СВЕТЛАЯ ТЕМА ==========
app.post('/api/set-theme', (req, res) => {
    const { token, theme } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!['dark', 'light'].includes(theme)) return res.json({ ok: false, error: 'Неверная тема' });
    user.theme = theme;
    saveDB(db);
    res.json({ ok: true });
});

// ========== ИСТОРИЯ ВСЕХ ТРАНЗАКЦИЙ (админ) ==========
app.post('/api/admin/all-transactions', (req, res) => {
    const { password, username } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    let list = db.transactions || [];
    if (username) list = list.filter(t => t.user === username);
    res.json({ ok: true, transactions: list.slice(-200).reverse() });
});
// ========== ТУРНИРЫ И РЕЙТИНГИ ==========

function startOfDay() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
function startOfWeek() {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}
function startOfMonth() {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

// При каждой игре записываем выигрыш в статистику
function trackWin(db, username, amount, game, mult) {
    if (!db.stats) db.stats = {};
    if (!db.stats[username]) db.stats[username] = { totalWin: 0, totalBet: 0, maxMult: 0, gamesPlayed: 0, history: [] };
    const s = db.stats[username];
    s.totalWin += amount;
    s.gamesPlayed++;
    if (mult > s.maxMult) s.maxMult = mult;
    s.history.push({ amount, game, mult, date: Date.now() });
    if (s.history.length > 500) s.history = s.history.slice(-500);
}

// Хелпер: посчитать выигрыш за период
function sumWinSince(history, since) {
    return (history || []).filter(h => h.date >= since).reduce((s, h) => s + h.amount, 0);
}

app.post('/api/leaderboard', (req, res) => {
    const { token, period } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    let since = 0;
    if (period === 'day') since = startOfDay();
    else if (period === 'week') since = startOfWeek();
    else if (period === 'month') since = startOfMonth();

    const list = Object.values(db.users).map(u => {
        const s = db.stats?.[u.username] || { history: [], maxMult: 0 };
        return {
            username: u.username,
            prefix: u.prefix || '',
            totalWin: period === 'all' ? (s.totalWin || 0) : sumWinSince(s.history, since),
            maxMult: s.maxMult || 0,
            gamesPlayed: s.gamesPlayed || 0
        };
    }).sort((a, b) => b.totalWin - a.totalWin).slice(0, 20);

    // Топ по крашу
    const crashTop = Object.values(db.users).map(u => {
        const s = db.stats?.[u.username] || { maxMult: 0 };
        return { username: u.username, prefix: u.prefix || '', maxMult: s.maxMult || 0 };
    }).sort((a, b) => b.maxMult - a.maxMult).slice(0, 10);

    res.json({ ok: true, list, crashTop, me: user.username });
});

// ЗАЛ СЛАВЫ (всё время)
app.post('/api/hall-of-fame', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.values(db.users).map(u => ({
        username: u.username,
        prefix: u.prefix || '',
        stars: u.stars,
        totalWin: (db.stats?.[u.username]?.totalWin || 0)
    })).sort((a, b) => b.totalWin - a.totalWin).slice(0, 10);
    res.json({ ok: true, list });
});

// ========== КВЕСТЫ ==========
const DAILY_QUESTS = [
    { id: 'play10', name: 'Сделать 10 ставок', target: 10, reward: 500 },
    { id: 'win1000', name: 'Выиграть 1000 звёзд', target: 1000, reward: 300 },
    { id: 'crash3', name: 'Выиграть в краше x3', target: 1, reward: 1000 },
    { id: 'dice_play', name: 'Сыграть в кубики 5 раз', target: 5, reward: 250 },
    { id: 'chat', name: 'Написать 3 сообщения в чат', target: 3, reward: 150 }
];

app.post('/api/quests-get', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const today = startOfDay();
    if (!user.quests || user.quests.date !== today) {
        user.quests = { date: today, progress: {}, claimed: [] };
        saveDB(db);
    }
    res.json({ ok: true, quests: DAILY_QUESTS, progress: user.quests.progress, claimed: user.quests.claimed });
});

app.post('/api/quests-claim', (req, res) => {
    const { token, questId } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const q = DAILY_QUESTS.find(x => x.id === questId);
    if (!q) return res.json({ ok: false, error: 'Нет квеста' });
    const today = startOfDay();
    if (!user.quests || user.quests.date !== today) return res.json({ ok: false, error: 'Квесты сброшены' });
    if (user.quests.claimed.includes(questId)) return res.json({ ok: false, error: 'Уже получено' });
    const prog = user.quests.progress[questId] || 0;
    if (prog < q.target) return res.json({ ok: false, error: 'Не выполнено' });
    user.stars += q.reward;
    user.quests.claimed.push(questId);
    logTx(db, user.username, 'quest', q.reward, q.name);
    saveDB(db);
    res.json({ ok: true, reward: q.reward, stars: user.stars });
});

function questProgress(db, user, questId, amount) {
    const today = startOfDay();
    if (!user.quests || user.quests.date !== today) user.quests = { date: today, progress: {}, claimed: [] };
    if (!user.quests.progress[questId]) user.quests.progress[questId] = 0;
    user.quests.progress[questId] += amount;
}

// ========== БАТЛ-ПАСС ==========
const BATTLEPASS_LEVELS = 30;
const BATTLEPASS_XP_PER_LEVEL = 500;

function bpAddXp(db, user, amount) {
    if (!user.bp) user.bp = { xp: 0, level: 0, season: 1, claimed: [], premiumClaimed: [] };
    user.bp.xp += amount;
    const newLevel = Math.min(BATTLEPASS_LEVELS, Math.floor(user.bp.xp / BATTLEPASS_XP_PER_LEVEL));
    if (newLevel > user.bp.level) user.bp.level = newLevel;
}

app.post('/api/bp-get', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.bp) user.bp = { xp: 0, level: 0, season: 1, claimed: [], premiumClaimed: [] };
    const rewards = [];
    for (let i = 1; i <= BATTLEPASS_LEVELS; i++) {
        rewards.push({
            level: i,
            free: { type: 'stars', amount: 100 * i },
            premium: { type: 'stars', amount: 300 * i }
        });
    }
    res.json({ ok: true, bp: user.bp, maxLevel: BATTLEPASS_LEVELS, xpPerLevel: BATTLEPASS_XP_PER_LEVEL, rewards });
});

app.post('/api/bp-claim', (req, res) => {
    const { token, level, track } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.bp) return res.json({ ok: false, error: 'Нет прогресса' });
    if (level > user.bp.level) return res.json({ ok: false, error: 'Уровень не достигнут' });
    const key = track === 'premium' ? 'premiumClaimed' : 'claimed';
    if (track === 'premium' && !user.premium) return res.json({ ok: false, error: 'Нужен Premium' });
    if (user.bp[key].includes(level)) return res.json({ ok: false, error: 'Уже получено' });
    const amount = track === 'premium' ? 300 * level : 100 * level;
    user.stars += amount;
    user.bp[key].push(level);
    logTx(db, user.username, 'battlepass', amount, track + ' уровень ' + level);
    saveDB(db);
    res.json({ ok: true, amount, stars: user.stars });
});

// ========== БИРЖА ==========
// Пользователи могут выставлять звёзды/граммы на продажу друг другу
app.post('/api/market-list', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!db.market) db.market = [];
    // убираем старые лоты (>24ч)
    const now = Date.now();
    db.market = db.market.filter(l => now - l.date < 24 * 60 * 60 * 1000 && !l.sold);
    saveDB(db);
    res.json({ ok: true, lots: db.market.slice().reverse() });
});

app.post('/api/market-sell', (req, res) => {
    const { token, grams, price } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const g = parseInt(grams);
    const p = parseInt(price);
    if (g < 1 || p < 1) return res.json({ ok: false, error: 'Неверные значения' });
    if (user.grams < g) return res.json({ ok: false, error: 'Недостаточно граммов' });
    if (!db.market) db.market = [];
    user.grams -= g;
    db.market.push({ id: genToken(), seller: user.username, grams: g, price: p, date: Date.now(), sold: false });
    saveDB(db);
    res.json({ ok: true, grams: user.grams });
});

app.post('/api/market-buy', (req, res) => {
    const { token, lotId } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    if (!db.market) return res.json({ ok: false, error: 'Нет лотов' });
    const lot = db.market.find(l => l.id === lotId);
    if (!lot || lot.sold) return res.json({ ok: false, error: 'Лот недоступен' });
    if (lot.seller === user.username) return res.json({ ok: false, error: 'Свой лот' });
    if (user.stars < lot.price) return res.json({ ok: false, error: 'Мало звёзд' });
    const seller = db.users[lot.seller];
    if (!seller) return res.json({ ok: false, error: 'Продавец удалён' });
    user.stars -= lot.price;
    user.grams += lot.grams;
    seller.stars += lot.price;
    lot.sold = true;
    logTx(db, user.username, 'market-buy', -lot.price, '+' + lot.grams + ' грамм');
    logTx(db, seller.username, 'market-sell', lot.price, '-' + lot.grams + ' грамм');
    saveDB(db);
    res.json({ ok: true, stars: user.stars, grams: user.grams });
});

app.post('/api/market-cancel', (req, res) => {
    const { token, lotId } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const lot = (db.market || []).find(l => l.id === lotId && !l.sold);
    if (!lot) return res.json({ ok: false, error: 'Лот не найден' });
    if (lot.seller !== user.username) return res.json({ ok: false, error: 'Не ваш лот' });
    user.grams += lot.grams;
    lot.sold = true;
    saveDB(db);
    res.json({ ok: true, grams: user.grams });
});
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './db.json';
const ADMIN_PASSWORD = '30031985';

// ========== ЗАЩИТА ОТ DDOS ==========
const globalLimiter = {};
const gameLimiter = {};
const blacklist = {};
const loginAttempts = {};
const registerAttempts = {};
const chatCooldown = {};

function getIP(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}

app.use((req, res, next) => {
    const ip = getIP(req);
    const now = Date.now();
    if (blacklist[ip] && blacklist[ip] > now) return res.status(429).json({ error: 'IP заблокирован' });
    if (!globalLimiter[ip]) globalLimiter[ip] = { count: 1, reset: now + 60000 };
    else {
        if (now > globalLimiter[ip].reset) globalLimiter[ip] = { count: 1, reset: now + 60000 };
        else globalLimiter[ip].count++;
    }
    if (globalLimiter[ip].count > 300) {
        blacklist[ip] = now + 10 * 60 * 1000;
        return res.status(429).json({ error: 'Слишком много запросов. Блок на 10 минут.' });
    }
    if (globalLimiter[ip].count > 100) return res.status(429).json({ error: 'Слишком много запросов. Подождите минуту.' });
    next();
});

app.use(bodyParser.json({ limit: '10kb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10kb' }));
app.use(express.static('public'));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
});

function gameLimit(req, res, next) {
    const ip = getIP(req);
    const now = Date.now();
    if (!gameLimiter[ip]) gameLimiter[ip] = { count: 1, reset: now + 60000 };
    else {
        if (now > gameLimiter[ip].reset) gameLimiter[ip] = { count: 1, reset: now + 60000 };
        else gameLimiter[ip].count++;
    }
    if (gameLimiter[ip].count > 30) return res.status(429).json({ error: 'Слишком много игр. Подождите.' });
    next();
}

// ========== БАЗА ==========
function defaultDB() {
    return {
        users: {},
        promos: { 'free': { amount: 250, limit: 100, used: 0 } },
        adminBalance: 0,
        withdrawals: [],
        diceDuels: {},
        adminSessions: {},
        failedLogins: [],
        mines: {},
        chat: [],
        actionLogs: [],
        transactions: []
    };
}
function loadDB() {
    if (!fs.existsSync(DB_FILE)) return defaultDB();
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (db.adminBalance === undefined) db.adminBalance = 0;
        if (!db.users) db.users = {};
        if (!db.withdrawals) db.withdrawals = [];
        if (!db.diceDuels) db.diceDuels = {};
        if (!db.adminSessions) db.adminSessions = {};
        if (!db.failedLogins) db.failedLogins = [];
        if (!db.promos) db.promos = { 'free': { amount: 250, limit: 100, used: 0 } };
        if (!db.mines) db.mines = {};
        if (!db.chat) db.chat = [];
        if (!db.actionLogs) db.actionLogs = [];
        if (!db.transactions) db.transactions = [];
        Object.keys(db.promos).forEach(k => { if (typeof db.promos[k] === 'number') db.promos[k] = { amount: db.promos[k], limit: 999, used: 0 }; });
        return db;
    } catch (e) { return defaultDB(); }
}
function saveDB(db) { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {} }
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function findUser(db, token) { return Object.values(db.users).find(u => u.token === token); }
function getRank(stars) {
    if (stars >= 100000) return { name: 'Легенда', icon: '👑', color: '#ffd700' };
    if (stars >= 50000) return { name: 'Мастер', icon: '💎', color: '#a855f7' };
    if (stars >= 20000) return { name: 'Профи', icon: '🔥', color: '#ef4444' };
    if (stars >= 10000) return { name: 'Богач', icon: '💰', color: '#22c55e' };
    if (stars >= 5000) return { name: 'Опытный', icon: '⚡', color: '#3b82f6' };
    if (stars >= 1000) return { name: 'Игрок', icon: '🎮', color: '#a855f7' };
    return { name: 'Новичок', icon: '🌱', color: '#666' };
}
function logAction(db, type, from, to, amount, extra) {
    db.actionLogs.push({ type, from, to, amount, extra: extra || '', date: Date.now() });
    if (db.actionLogs.length > 500) db.actionLogs = db.actionLogs.slice(-500);
}
function logTx(db, user, type, amount, comment) {
    if (!db.transactions) db.transactions = [];
    db.transactions.push({ user, type, amount, comment: comment || '', date: Date.now() });
    if (db.transactions.length > 2000) db.transactions = db.transactions.slice(-2000);
}

const ACHIEVEMENTS = [
    { id: 'first_win', name: 'Первая победа', desc: 'Выиграть в любую игру', icon: '🏆' },
    { id: 'crash_master', name: 'Краш-мастер', desc: 'Выиграть в краше x3+', icon: '📈' },
    { id: 'dice_lucky', name: 'Счастливый кубик', desc: 'Выкинуть 12 в кубиках', icon: '🎲' },
    { id: 'wheel_spin', name: 'Крутила', desc: 'Крутить колесо', icon: '🎡' },
    { id: 'rich_1000', name: 'Богач', desc: 'Накопить 1000 звёзд', icon: '💎' },
    { id: 'rich_10000', name: 'Миллионер', desc: 'Накопить 10000 звёзд', icon: '💰' },
    { id: 'duel_win', name: 'Дуэлянт', desc: 'Победить в дуэли', icon: '⚔️' },
    { id: 'gram_owner', name: 'Грамм', desc: 'Обменять звёзды на грамм', icon: '⚖️' },
    { id: 'promo_user', name: 'Промо-хантер', desc: 'Активировать промокод', icon: '🎁' },
    { id: 'mines_win', name: 'Сапёр', desc: 'Выиграть в Минах', icon: '💣' },
    { id: 'plinko_win', name: 'Плинко', desc: 'Выиграть в Плинко x5+', icon: '🔻' },
    { id: 'daily_streak_7', name: 'Каждый день', desc: '7 дней подряд заходить', icon: '📅' },
    { id: 'premium', name: 'Премиум', desc: 'Купить подписку Premium', icon: '⭐' }
];
function giveAch(db, user, id) {
    if (!user.achievements) user.achievements = [];
    if (!user.achievements.includes(id)) user.achievements.push(id);
}
function validateUsername(u) {
    if (!u || typeof u !== 'string') return false;
    if (!u.startsWith('@')) return false;
    if (u.length < 6 || u.length > 32) return false;
    return /^@[a-zA-Z0-9_]+$/.test(u);
}
function checkLoginRate(ip) {
    const now = Date.now();
    const a = loginAttempts[ip] || { count: 0, blockedUntil: 0 };
    if (a.blockedUntil > now) return { blocked: true, wait: Math.ceil((a.blockedUntil - now) / 60000) };
    return { blocked: false };
}
function recordLoginFail(ip) {
    const now = Date.now();
    const a = loginAttempts[ip] || { count: 0, blockedUntil: 0 };
    a.count += 1;
    if (a.count >= 5) { a.blockedUntil = now + 15 * 60 * 1000; a.count = 0; }
    loginAttempts[ip] = a;
}
function checkRegisterRate(ip) {
    const now = Date.now();
    const r = registerAttempts[ip] || { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (now > r.resetAt) { r.count = 0; r.resetAt = now + 60 * 60 * 1000; }
    if (r.count >= 3) return { blocked: true, wait: Math.ceil((r.resetAt - now) / 60000) };
    return { blocked: false };
}
function recordRegister(ip) {
    const now = Date.now();
    const r = registerAttempts[ip] || { count: 0, resetAt: now + 60 * 60 * 1000 };
    if (now > r.resetAt) { r.count = 0; r.resetAt = now + 60 * 60 * 1000; }
    r.count += 1;
    registerAttempts[ip] = r;
}

// ========== РЕГИСТРАЦИЯ / ЛОГИН ==========
app.post('/api/register', (req, res) => {
    const ip = getIP(req);
    const rate = checkRegisterRate(ip);
    if (rate.blocked) return res.json({ ok: false, error: 'Слишком много попыток. Подождите ' + rate.wait + ' мин.' });
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Заполните поля' });
    if (!validateUsername(username)) return res.json({ ok: false, error: 'Ник: @ + 5-31 символов (латиница, цифры, _)' });
    if (typeof password !== 'string' || password.length < 6) return res.json({ ok: false, error: 'Пароль минимум 6 символов' });
    if (password.length > 128) return res.json({ ok: false, error: 'Пароль слишком длинный' });
    const db = loadDB();
    if (db.users[username]) return res.json({ ok: false, error: 'Ник занят' });
    recordRegister(ip);
    const token = genToken();
    db.users[username] = {
        username, password, token, stars: 100, grams: 0, lastWheel: 0,
        banned: false, frozen: false, created: Date.now(),
        usedPromos: [], achievements: [], prefix: '', bets: 0,
        // НОВОЕ:
        lastDailyBonus: 0, dailyStreak: 0,
        lastHourlyBonus: 0,
        lastLottery: 0,
        premium: false, premiumUntil: 0,
        wheelCooldown: 0
    };
    saveDB(db);
    res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
    const ip = getIP(req);
    const rate = checkLoginRate(ip);
    if (rate.blocked) return res.json({ ok: false, error: 'Слишком много попыток. Подождите ' + rate.wait + ' мин.' });
    const { username, password } = req.body;
    const db = loadDB();
    const u = db.users[username];
    if (!u || u.password !== password) {
        recordLoginFail(ip);
        return res.json({ ok: false, error: 'Неверный логин или пароль' });
    }
    if (u.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (u.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
    u.token = genToken();
    saveDB(db);
    res.json({ ok: true, token: u.token, username });
});

app.post('/api/profile', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (user.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
    if (user.grams === undefined) user.grams = 0;
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;
    const wheelLeft = Math.max(0, DAY - (now - user.lastWheel));
    const dailyLeft = Math.max(0, DAY - (now - (user.lastDailyBonus || 0)));
    const hourlyLeft = Math.max(0, HOUR - (now - (user.lastHourlyBonus || 0)));
    const lotteryLeft = Math.max(0, DAY - (now - (user.lastLottery || 0)));
    const premiumActive = user.premium && user.premiumUntil > now;

    res.json({
        ok: true,
        username: user.username,
        stars: user.stars,
        grams: user.grams,
        wheelLeft, dailyLeft, hourlyLeft, lotteryLeft,
        dailyStreak: user.dailyStreak || 0,
        premium: premiumActive,
        premiumUntil: user.premiumUntil || 0,
        achievements: user.achievements || [],
        allAchievements: ACHIEVEMENTS,
        prefix: user.prefix || '',
        rank: getRank(user.stars),
        bets: user.bets || 0
    });
});

app.post('/api/users', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const me = findUser(db, token);
    if (!me) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.values(db.users).map(u => ({
        username: u.username, stars: u.stars, grams: u.grams || 0,
        prefix: u.prefix || '', achievements: (u.achievements || []).length,
        banned: u.banned, frozen: u.frozen || false, rank: getRank(u.stars).name
    }));
    res.json({ ok: true, users: list, me: me.username });
});

// ========== БОНУСЫ ==========
app.post('/api/daily-bonus', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now(), DAY = 24 * 60 * 60 * 1000;
    const last = user.lastDailyBonus || 0;
    if (now - last < DAY) return res.json({ ok: false, error: 'Бонус уже получен', left: DAY - (now - last) });

    // Серия: если заходил вчера (24-48ч назад) — серия +1, иначе сброс
    const diff = now - last;
    if (last > 0 && diff < 2 * DAY) user.dailyStreak = (user.dailyStreak || 0) + 1;
    else user.dailyStreak = 1;
    if (user.dailyStreak > 30) user.dailyStreak = 30;

    const base = 100;
    const bonus = base + user.dailyStreak * 50;
    const premiumBonus = user.premium && user.premiumUntil > now ? Math.floor(bonus * 2) : bonus;

    user.stars += premiumBonus;
    user.lastDailyBonus = now;
    if (user.dailyStreak >= 7) giveAch(db, user, 'daily_streak_7');
    logTx(db, user.username, 'daily', premiumBonus, 'Серия: ' + user.dailyStreak);
    saveDB(db);
    res.json({ ok: true, amount: premiumBonus, streak: user.dailyStreak, stars: user.stars });
});

app.post('/api/hourly-bonus', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now(), HOUR = 60 * 60 * 1000;
    const last = user.lastHourlyBonus || 0;
    if (now - last < HOUR) return res.json({ ok: false, error: 'Бонус уже получен', left: HOUR - (now - last) });

    let bonus = 25;
    if (user.premium && user.premiumUntil > now) bonus *= 2;
    user.stars += bonus;
    user.lastHourlyBonus = now;
    logTx(db, user.username, 'hourly', bonus, '');
    saveDB(db);
    res.json({ ok: true, amount: bonus, stars: user.stars });
});

app.post('/api/lottery-buy', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now(), DAY = 24 * 60 * 60 * 1000;
    const last = user.lastLottery || 0;
    if (now - last < DAY) return res.json({ ok: false, error: 'Билет можно купить раз в сутки' });
    if (user.stars < 500) return res.json({ ok: false, error: 'Нужно 500 звёзд' });

    user.stars -= 500;
    user.lastLottery = now;

    // Шанс: 1% - 100000, 4% - 10000, 15% - 2000, 30% - 500, 50% - 100
    const r = Math.random() * 100;
    let prize;
    if (r < 1) prize = 100000;
    else if (r < 5) prize = 10000;
    else if (r < 20) prize = 2000;
    else if (r < 50) prize = 500;
    else prize = 100;

    user.stars += prize;
    logTx(db, user.username, 'lottery', prize - 500, 'Билет лотереи');
    saveDB(db);
    res.json({ ok: true, prize, stars: user.stars });
});

// ========== ПРЕМИУМ ==========
app.post('/api/premium-buy', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now();
    if (user.premium && user.premiumUntil > now) return res.json({ ok: false, error: 'Премиум уже активен' });
    if (user.stars < 50000) return res.json({ ok: false, error: 'Нужно 50000 звёзд' });

    user.stars -= 50000;
    user.premium = true;
    user.premiumUntil = now + 30 * 24 * 60 * 60 * 1000;
    giveAch(db, user, 'premium');
    logTx(db, user.username, 'premium', -50000, 'Премиум на 30 дней');
    saveDB(db);
    res.json({ ok: true, stars: user.stars, premiumUntil: user.premiumUntil });
});

// ========== УСКОРЕНИЕ КОЛЕСА ==========
app.post('/api/skip-wheel-cooldown', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const cost = 5000;
    if (user.stars < cost) return res.json({ ok: false, error: 'Нужно 5000 звёзд' });
    user.stars -= cost;
    user.lastWheel = 0;
    logTx(db, user.username, 'skip-wheel', -cost, '');
    saveDB(db);
    res.json({ ok: true, stars: user.stars });
});

// ========== ПОКУПКА ПРОМОКОДА ==========
app.post('/api/buy-promo', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const cost = 10000;
    if (user.stars < cost) return res.json({ ok: false, error: 'Нужно 10000 звёзд' });

    user.stars -= cost;
    const code = 'BUY' + Math.random().toString(36).slice(2, 8).toUpperCase();
    db.promos[code.toLowerCase()] = { amount: 15000, limit: 1, used: 0 };
    logTx(db, user.username, 'buy-promo', -cost, code);
    saveDB(db);
    res.json({ ok: true, code, stars: user.stars });
});

// ========== ИГРЫ ==========
app.post('/api/wheel', gameLimit, (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const now = Date.now(), DAY = 24 * 60 * 60 * 1000;
    if (now - user.lastWheel < DAY) return res.json({ ok: false, error: 'Подождите' });
    const rand = Math.random() * 100;
    let prize;
    if (rand < 40) prize = 0;
    else if (rand < 70) prize = 10;
    else if (rand < 90) prize = 50;
    else prize = 100;
    if (user.premium && user.premiumUntil > now) prize *= 2;
    user.stars += prize;
    user.lastWheel = now;
    giveAch(db, user, 'wheel_spin');
    saveDB(db);
    res.json({ ok: true, prize, stars: user.stars });
});

app.post('/api/crash', gameLimit, (req, res) => {
    const { token, bet, target } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    const t = parseFloat(target);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    if (isNaN(t) || t < 1.01 || t > 5) return res.json({ ok: false, error: 'Цель 1.01-5' });
    user.bets = (user.bets || 0) + 1;
    const chance = (1 / t) * 100 * 0.95;
    const win = Math.random() * 100 < chance;
    if (win) {
        const profit = Math.floor(b * (t - 1));
        const commission = Math.floor(profit * 0.05);
        user.stars += profit - commission;
        db.adminBalance += commission;
        giveAch(db, user, 'first_win');
        if (t >= 3) giveAch(db, user, 'crash_master');
        if (user.stars >= 1000) giveAch(db, user, 'rich_1000');
        saveDB(db);
        return res.json({ ok: true, win: true, mult: t, profit: profit - commission, stars: user.stars });
    }
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, win: false, mult: t, stars: user.stars });
});

app.post('/api/dice-bot', gameLimit, (req, res) => {
    const { token, bet, mode } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;
    if (sum === 12) giveAch(db, user, 'dice_lucky');
    let win = false, mult = 2;
    if (mode === 'over' && sum > 7) win = true;
    if (mode === 'under' && sum < 7) win = true;
    if (mode === 'seven' && sum === 7) { win = true; mult = 5; }
    if (win) {
        const profit = b * (mult - 1);
        const commission = Math.floor(profit * 0.05);
        user.stars += profit - commission;
        db.adminBalance += commission;
        giveAch(db, user, 'first_win');
        saveDB(db);
        return res.json({ ok: true, d1, d2, sum, win: true, mult, stars: user.stars });
    }
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, d1, d2, sum, win: false, stars: user.stars });
});

app.post('/api/diceduel-create', gameLimit, (req, res) => {
    const { token, bet, opponent } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const opp = db.users[opponent];
    if (!opp) return res.json({ ok: false, error: 'Не найден' });
    if (opp.banned || opp.frozen) return res.json({ ok: false, error: 'Недоступен' });
    if (opp.stars < b) return res.json({ ok: false, error: 'У соперника мало' });
    if (opponent === user.username) return res.json({ ok: false, error: 'Нельзя с собой' });
    const id = genToken();
    db.diceDuels[id] = { challenger: user.username, opponent, bet: b, created: Date.now() };
    saveDB(db);
    res.json({ ok: true, id });
});
app.post('/api/diceduel-list', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.entries(db.diceDuels).filter(([id, d]) => d.opponent === user.username).map(([id, d]) => ({ id, ...d }));
    res.json({ ok: true, duels: list });
});
app.post('/api/diceduel-accept', gameLimit, (req, res) => {
    const { token, id } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const duel = db.diceDuels[id];
    if (!duel) return res.json({ ok: false, error: 'Не найден' });
    if (duel.opponent !== user.username) return res.json({ ok: false, error: 'Не ваш вызов' });
    const ch = db.users[duel.challenger];
    const op = db.users[duel.opponent];
    if (ch.stars < duel.bet || op.stars < duel.bet) { delete db.diceDuels[id]; saveDB(db); return res.json({ ok: false, error: 'Мало звёзд' }); }
    const c1 = Math.floor(Math.random() * 6) + 1, c2 = Math.floor(Math.random() * 6) + 1;
    const o1 = Math.floor(Math.random() * 6) + 1, o2 = Math.floor(Math.random() * 6) + 1;
    const chSum = c1 + c2, opSum = o1 + o2;
    let result, winner, loser;
    if (chSum > opSum) { winner = ch; loser = op; result = 'lose'; }
    else if (chSum < opSum) { winner = op; loser = ch; result = 'win'; }
    else { result = 'draw'; }
    let commission = 0;
    if (winner) {
        const prize = Math.floor(duel.bet * 1.5);
        commission = Math.floor(prize * 0.05);
        winner.stars += prize - commission;
        loser.stars -= duel.bet;
        db.adminBalance += commission;
        giveAch(db, winner, 'duel_win');
    }
    delete db.diceDuels[id];
    saveDB(db);
    res.json({ ok: true, c1, c2, o1, o2, chSum, opSum, result, stars: user.stars });
});

app.post('/api/mines-start', gameLimit, (req, res) => {
    const { token, bet, bombs } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    const bombsCount = Math.min(Math.max(parseInt(bombs) || 3, 1), 24);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const bombSet = new Set();
    while (bombSet.size < bombsCount) bombSet.add(Math.floor(Math.random() * 25));
    db.mines[user.username] = { bet: b, bombs: [...bombSet], opened: [], active: true, bombsCount };
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, bombsCount });
});
app.post('/api/mines-open', gameLimit, (req, res) => {
    const { token, cell } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const game = db.mines[user.username];
    if (!game || !game.active) return res.json({ ok: false, error: 'Нет игры' });
    if (game.opened.includes(cell)) return res.json({ ok: false, error: 'Открыто' });
    if (game.bombs.includes(cell)) {
        game.active = false;
        delete db.mines[user.username];
        saveDB(db);
        return res.json({ ok: true, bomb: true, stars: user.stars });
    }
    game.opened.push(cell);
    const bombs = game.bombsCount || 3;
    const mult = Math.pow(25 / (25 - bombs), game.opened.length);
    saveDB(db);
    res.json({ ok: true, bomb: false, opened: game.opened.length, multiplier: mult });
});
app.post('/api/mines-cash', gameLimit, (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const game = db.mines[user.username];
    if (!game || !game.active) return res.json({ ok: false, error: 'Нет игры' });
    const bombs = game.bombsCount || 3;
    const mult = Math.pow(25 / (25 - bombs), game.opened.length);
    const win = Math.floor(game.bet * mult);
    user.stars += win;
    giveAch(db, user, 'mines_win');
    delete db.mines[user.username];
    saveDB(db);
    res.json({ ok: true, win, stars: user.stars });
});

app.post('/api/plinko', gameLimit, (req, res) => {
    const { token, bet, risk } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const LOW = [0.5, 1, 0.3, 1.2, 0.7, 0.2, 0.7, 1.2, 0.3, 1, 0.5];
    const MID = [0.3, 0.5, 1.5, 0.7, 0.4, 5, 0.4, 0.7, 1.5, 0.5, 0.3];
    const HIGH = [0, 0.2, 0.5, 2, 0.3, 10, 0.3, 2, 0.5, 0.2, 0];
    const table = risk === 'high' ? HIGH : risk === 'mid' ? MID : LOW;
    const idx = Math.floor(Math.random() * table.length);
    const mult = table[idx];
    if (mult > 0) {
        const win = Math.floor(b * mult);
        const profit = win - b;
        if (profit > 0) {
            const commission = Math.floor(profit * 0.05);
            user.stars += profit - commission;
            db.adminBalance += commission;
        } else user.stars -= (b - win);
        if (mult >= 5) giveAch(db, user, 'plinko_win');
        saveDB(db);
        return res.json({ ok: true, idx, mult, win, stars: user.stars });
    }
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, idx, mult: 0, win: 0, stars: user.stars });
});

app.post('/api/roulette', gameLimit, (req, res) => {
    const { token, bet, color } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const rand = Math.random();
    let result, mult;
    if (rand < 0.486) { result = 'red'; mult = 2; }
    else if (rand < 0.972) { result = 'black'; mult = 2; }
    else { result = 'green'; mult = 14; }
    if (result === color) {
        const profit = b * (mult - 1);
        const commission = Math.floor(profit * 0.05);
        user.stars += profit - commission;
        db.adminBalance += commission;
        saveDB(db);
        return res.json({ ok: true, result, win: true, mult, stars: user.stars });
    }
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, result, win: false, stars: user.stars });
});

// ========== ПРОМО ==========
app.post('/api/promo', (req, res) => {
    const { token, code } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const key = String(code || '').trim().toLowerCase().slice(0, 32);
    const promo = db.promos[key];
    if (!promo) return res.json({ ok: false, error: 'Неверный промокод' });
    if (promo.used >= promo.limit) return res.json({ ok: false, error: 'Лимит исчерпан' });
    if (!user.usedPromos) user.usedPromos = [];
    if (user.usedPromos.includes(key)) return res.json({ ok: false, error: 'Уже использовали' });
    user.stars += promo.amount;
    user.usedPromos.push(key);
    promo.used = (promo.used || 0) + 1;
    giveAch(db, user, 'promo_user');
    logTx(db, user.username, 'promo', promo.amount, key);
    saveDB(db);
    res.json({ ok: true, amount: promo.amount, stars: user.stars });
});

// ========== ОБМЕН / ВЫВОД ==========
app.post('/api/exchange', (req, res) => {
    const { token, stars } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    if (user.grams === undefined) user.grams = 0;
    const amt = parseInt(stars);
    if (isNaN(amt) || amt < 1000 || amt % 1000 !== 0) return res.json({ ok: false, error: 'Кратно 1000' });
    if (user.stars < amt) return res.json({ ok: false, error: 'Недостаточно' });
    const grams = amt / 1000;
    user.stars -= amt;
    user.grams += grams;
    giveAch(db, user, 'gram_owner');
    logTx(db, user.username, 'exchange', -amt, grams + ' грамм');
    saveDB(db);
    res.json({ ok: true, stars: user.stars, grams: user.grams, exchanged: grams });
});

app.post('/api/withdraw', (req, res) => {
    const { token, grams } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    if (user.grams === undefined) user.grams = 0;
    const g = parseInt(grams);
    if (isNaN(g) || g < 1) return res.json({ ok: false, error: 'Мин 1 грамм' });
    if (user.grams < g) return res.json({ ok: false, error: 'Недостаточно' });
    user.grams -= g;
    const tgStars = g * 1000;
    db.withdrawals.push({ username: user.username, grams: g, tgStars, date: Date.now(), status: 'pending' });
    logTx(db, user.username, 'withdraw', -g, g + ' грамм = ' + tgStars + ' звёзд');
    saveDB(db);
    res.json({ ok: true, grams: user.grams, message: 'Заявка на ' + g + ' грамм = ' + tgStars + ' звёзд в Wintegramm. @gift' });
});

// ========== ИСТОРИЯ ТРАНЗАКЦИЙ ==========
app.post('/api/transactions', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const list = (db.transactions || []).filter(t => t.user === user.username).slice(-50).reverse();
    res.json({ ok: true, transactions: list });
});

// ========== ЧАТ ==========
app.post('/api/chat-get', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!db.chat) db.chat = [];
    res.json({ ok: true, messages: db.chat.slice(-50) });
});
app.post('/api/chat-send', (req, res) => {
    const { token, text } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const now = Date.now();
    const last = chatCooldown[user.username] || 0;
    if (now - last < 3000) return res.json({ ok: false, error: 'Подождите 3 секунды' });
    chatCooldown[user.username] = now;
    const msg = String(text || '').trim().slice(0, 200);
    if (!msg) return res.json({ ok: false, error: 'Пусто' });
    if (!db.chat) db.chat = [];
    db.chat.push({ user: user.username, text: msg, date: now, prefix: user.prefix || '', rank: getRank(user.stars).icon });
    if (db.chat.length > 200) db.chat = db.chat.slice(-200);
    saveDB(db);
    res.json({ ok: true });
});

// ========== АДМИН ==========
app.post('/api/admin/login', (req, res) => {
    const ip = getIP(req);
    const rate = checkLoginRate(ip);
    if (rate.blocked) return res.json({ ok: false, error: 'Слишком много попыток. Подождите ' + rate.wait + ' мин.' });
    if (req.body.password !== ADMIN_PASSWORD) {
        recordLoginFail(ip);
        const db = loadDB();
        const masked = '*'.repeat(Math.min(String(req.body.password || '').length, 20));
        db.failedLogins.push({ ip, password: masked, length: String(req.body.password || '').length, date: Date.now() });
        if (db.failedLogins.length > 50) db.failedLogins = db.failedLogins.slice(-50);
        saveDB(db);
        return res.json({ ok: false, error: 'Неверный пароль' });
    }
    const db = loadDB();
    const adminId = 'admin_' + genToken();
    db.adminSessions[adminId] = { ip, loginAt: Date.now() };
    saveDB(db);
    res.json({ ok: true, adminId });
});
app.post('/api/admin/failed-logins', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, failedLogins: (db.failedLogins || []).slice().reverse() });
});
app.post('/api/admin/online', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const now = Date.now();
    const online = Object.entries(db.adminSessions || {}).filter(([id, s]) => now - s.loginAt < 5 * 60 * 1000).map(([id, s]) => ({ id, ip: s.ip, loginAt: s.loginAt }));
    res.json({ ok: true, online });
});
app.post('/api/admin/stats', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const users = Object.values(db.users);
    res.json({
        ok: true,
        usersCount: users.length,
        totalStars: users.reduce((s, u) => s + u.stars, 0),
        adminBalance: db.adminBalance,
        banned: users.filter(u => u.banned).length,
        frozen: users.filter(u => u.frozen).length,
        premium: users.filter(u => u.premium && u.premiumUntil > Date.now()).length
    });
});
app.post('/api/admin/users', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, users: Object.values(db.users).map(u => ({ username: u.username, stars: u.stars, grams: u.grams || 0, banned: u.banned, frozen: u.frozen || false, prefix: u.prefix || '', premium: u.premium && u.premiumUntil > Date.now() })) });
});
app.post('/api/admin/withdrawals', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, withdrawals: db.withdrawals || [] });
});
app.post('/api/admin/give', (req, res) => {
    const { password, username, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    u.stars += parseInt(amount) || 0;
    logAction(db, 'give', 'admin', username, parseInt(amount) || 0);
    saveDB(db);
    res.json({ ok: true, stars: u.stars });
});
app.post('/api/admin/ban', (req, res) => {
    const { password, username, ban } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    u.banned = !!ban;
    logAction(db, ban ? 'ban' : 'unban', 'admin', username);
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/freeze', (req, res) => {
    const { password, username, freeze } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    u.frozen = !!freeze;
    logAction(db, freeze ? 'freeze' : 'unfreeze', 'admin', username);
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/delete', (req, res) => {
    const { password, username } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    if (!db.users[username]) return res.json({ ok: false, error: 'Не найден' });
    delete db.users[username];
    logAction(db, 'delete', 'admin', username);
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/prefix', (req, res) => {
    const { password, username, prefix } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    u.prefix = String(prefix || '').slice(0, 20);
    logAction(db, 'prefix', 'admin', username, 0, u.prefix);
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/achievement', (req, res) => {
    const { password, username, achId, remove } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    if (!u.achievements) u.achievements = [];
    if (remove) u.achievements = u.achievements.filter(a => a !== achId);
    else if (!u.achievements.includes(achId)) u.achievements.push(achId);
    logAction(db, 'achievement', 'admin', username, 0, achId);
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/achievements-list', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    res.json({ ok: true, achievements: ACHIEVEMENTS });
});
app.post('/api/admin/addpromo', (req, res) => {
    const { password, code, amount, limit } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const key = String(code || '').trim().toLowerCase().slice(0, 32);
    const amt = parseInt(amount);
    const lim = parseInt(limit) || 100;
    if (!key || isNaN(amt) || amt <= 0) return res.json({ ok: false, error: 'Неверные данные' });
    const db = loadDB();
    db.promos[key] = { amount: amt, limit: lim, used: 0 };
    logAction(db, 'addpromo', 'admin', '', amt, key);
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/promos', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, promos: db.promos });
});
app.post('/api/admin/delpromo', (req, res) => {
    const { password, code } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const key = String(code || '').trim().toLowerCase().slice(0, 32);
    const db = loadDB();
    delete db.promos[key];
    logAction(db, 'delpromo', 'admin', '', 0, key);
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/action-logs', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, logs: (db.actionLogs || []).slice(-100).reverse() });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
// ========== БАКАРА ==========
function baccaratValue(cards) {
    let sum = 0;
    for (const c of cards) {
        if (['10', 'J', 'Q', 'K'].includes(c.v)) continue;
        if (c.v === 'A') sum += 1;
        else sum += parseInt(c.v);
    }
    return sum % 10;
}

app.post('/api/baccarat-start', gameLimit, (req, res) => {
    const { token, bet, side } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    if (!['player', 'banker', 'tie'].includes(side)) return res.json({ ok: false, error: 'Неверная ставка' });

    user.stars -= b;
    const deck = createDeck();
    const player = [deck.pop(), deck.pop()];
    const banker = [deck.pop(), deck.pop()];
    let pv = baccaratValue(player);
    let bv = baccaratValue(banker);

    if (pv < 8 && bv < 8) {
        if (pv <= 5) player.push(deck.pop());
        pv = baccaratValue(player);
        if (bv <= 5) {
            const thirdCard = player.length === 3 ? parseInt(player[2].v) || 10 : null;
            let shouldDraw = false;
            if (bv <= 2) shouldDraw = true;
            else if (bv === 3 && thirdCard !== 8) shouldDraw = true;
            else if (bv === 4 && thirdCard >= 2 && thirdCard <= 7) shouldDraw = true;
            else if (bv === 5 && thirdCard >= 4 && thirdCard <= 7) shouldDraw = true;
            else if (bv === 6 && thirdCard >= 6 && thirdCard <= 7) shouldDraw = true;
            if (shouldDraw) banker.push(deck.pop());
            bv = baccaratValue(banker);
        }
    }

    let winner;
    if (pv > bv) winner = 'player';
    else if (bv > pv) winner = 'banker';
    else winner = 'tie';

    let result = 'lose';
    let win = 0;
    if (winner === side) {
        result = 'win';
        if (side === 'player') win = b * 2;
        else if (side === 'banker') win = Math.floor(b * 1.95);
        else win = b * 9;
        user.stars += win;
        const profit = win - b;
        if (profit > 0) {
            const commission = Math.floor(profit * 0.05);
            user.stars -= commission;
            db.adminBalance += commission;
        }
    }
    saveDB(db);
    res.json({ ok: true, player, banker, pv, bv, winner, result, win, stars: user.stars });
});

// ========== ТИР ==========
app.post('/api/shooter-start', gameLimit, (req, res) => {
    const { token, bet } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });

    user.stars -= b;
    // Мишени: 5 штук, у каждой множитель. Сложнее попасть = больше награда.
    const targets = [];
    for (let i = 0; i < 5; i++) {
        const size = Math.random(); // 0 = большая (легко), 1 = маленькая (сложно)
        let mult, hitChance;
        if (size < 0.4) { mult = 1.2; hitChance = 0.8; }
        else if (size < 0.7) { mult = 2; hitChance = 0.55; }
        else if (size < 0.9) { mult = 5; hitChance = 0.3; }
        else { mult = 15; hitChance = 0.1; }
        const hit = Math.random() < hitChance;
        targets.push({ mult, hit });
    }
    const totalMult = targets.filter(t => t.hit).reduce((s, t) => s + t.mult, 0);
    const win = Math.floor(b * totalMult);
    if (win > 0) {
        user.stars += win;
        const profit = win - b;
        if (profit > 0) {
            const commission = Math.floor(profit * 0.05);
            user.stars -= commission;
            db.adminBalance += commission;
        }
    }
    saveDB(db);
    res.json({ ok: true, targets, totalMult, win, stars: user.stars });
});

// ========== КОСТИ (CRAPS) ==========
app.post('/api/craps-roll', gameLimit, (req, res) => {
    const { token, bet, betType } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const allowed = ['pass', 'dontpass', 'seven', 'craps'];
    if (!allowed.includes(betType)) return res.json({ ok: false, error: 'Неверный тип' });

    user.stars -= b;
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;

    let win = false, mult = 2;
    if (betType === 'pass' && [7, 11].includes(sum)) win = true;
    else if (betType === 'pass' && [2, 3, 12].includes(sum)) win = false;
    else if (betType === 'dontpass' && [2, 3].includes(sum)) win = true;
    else if (betType === 'dontpass' && [7, 11].includes(sum)) win = false;
    else if (betType === 'dontpass' && sum === 12) { win = false; mult = 1; } // push
    else if (betType === 'seven' && sum === 7) { win = true; mult = 5; }
    else if (betType === 'craps' && [2, 3, 12].includes(sum)) { win = true; mult = 8; }
    else if (betType === 'pass') {
        // Point established — упростим: если 4-6, 8-10 — win 50/50
        win = Math.random() < 0.49;
    }

    let prize = 0;
    if (win) {
        prize = b * mult;
        user.stars += prize;
        const profit = prize - b;
        if (profit > 0) {
            const commission = Math.floor(profit * 0.05);
            user.stars -= commission;
            db.adminBalance += commission;
        }
    } else if (mult === 1 && prize === 0) {
        user.stars += b; // push
    }
    saveDB(db);
    res.json({ ok: true, d1, d2, sum, win, mult, prize, stars: user.stars });
});

// ========== РУЛЕТКА С ЧИСЛАМИ И ДЮЖИНАМИ ==========
const ROULETTE_RED = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
const ROULETTE_BLACK = [2,4,6,8,10,11,13,15,17,20,22,24,26,28,29,31,33,35];

app.post('/api/roulette-adv', gameLimit, (req, res) => {
    const { token, bet, betType, betValue } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });

    user.stars -= b;
    const result = Math.floor(Math.random() * 37); // 0-36
    let isRed = ROULETTE_RED.includes(result);
    let isBlack = ROULETTE_BLACK.includes(result);
    let color = result === 0 ? 'green' : isRed ? 'red' : 'black';
    let win = false, mult = 0;

    if (betType === 'color') {
        if (betValue === color) { win = true; mult = color === 'green' ? 14 : 2; }
    } else if (betType === 'number') {
        if (parseInt(betValue) === result) { win = true; mult = 36; }
    } else if (betType === 'dozen') {
        const d = parseInt(betValue); // 1, 2, 3
        if (d === 1 && result >= 1 && result <= 12) { win = true; mult = 3; }
        if (d === 2 && result >= 13 && result <= 24) { win = true; mult = 3; }
        if (d === 3 && result >= 25 && result <= 36) { win = true; mult = 3; }
    } else if (betType === 'parity') {
        if (result !== 0 && betValue === 'even' && result % 2 === 0) { win = true; mult = 2; }
        if (result !== 0 && betValue === 'odd' && result % 2 !== 0) { win = true; mult = 2; }
    } else if (betType === 'half') {
        if (betValue === 'low' && result >= 1 && result <= 18) { win = true; mult = 2; }
        if (betValue === 'high' && result >= 19 && result <= 36) { win = true; mult = 2; }
    }

    let prize = 0;
    if (win) {
        prize = b * mult;
        user.stars += prize;
        const profit = prize - b;
        if (profit > 0) {
            const commission = Math.floor(profit * 0.05);
            user.stars -= commission;
            db.adminBalance += commission;
        }
    }
    saveDB(db);
    res.json({ ok: true, result, color, win, mult, prize, stars: user.stars });
});
app.listen(PORT, '0.0.0.0', () => console.log('OK: ' + PORT));// ========== СОЦИАЛЬНОЕ ==========

// ДРУЗЬЯ
app.post('/api/friends-list', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.friends) user.friends = [];
    if (!user.friendRequests) user.friendRequests = [];
    const friends = user.friends.map(f => {
        const u = db.users[f];
        if (!u) return null;
        return { username: f, stars: u.stars, online: (Date.now() - (u.lastSeen || 0)) < 5 * 60 * 1000, status: u.status || 'online', prefix: u.prefix || '' };
    }).filter(Boolean);
    const requests = user.friendRequests.map(f => {
        const u = db.users[f];
        if (!u) return null;
        return { username: f, stars: u.stars };
    }).filter(Boolean);
    res.json({ ok: true, friends, requests });
});

app.post('/api/friend-request', (req, res) => {
    const { token, username } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const target = db.users[username];
    if (!target) return res.json({ ok: false, error: 'Игрок не найден' });
    if (username === user.username) return res.json({ ok: false, error: 'Нельзя себя' });
    if (!user.friends) user.friends = [];
    if (user.friends.includes(username)) return res.json({ ok: false, error: 'Уже в друзьях' });
    if (!target.friendRequests) target.friendRequests = [];
    if (target.friendRequests.includes(user.username)) return res.json({ ok: false, error: 'Заявка уже отправлена' });
    target.friendRequests.push(user.username);
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/friend-accept', (req, res) => {
    const { token, username } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.friendRequests) user.friendRequests = [];
    if (!user.friendRequests.includes(username)) return res.json({ ok: false, error: 'Нет заявки' });
    user.friendRequests = user.friendRequests.filter(u => u !== username);
    if (!user.friends) user.friends = [];
    if (!user.friends.includes(username)) user.friends.push(username);
    const other = db.users[username];
    if (other) {
        if (!other.friends) other.friends = [];
        if (!other.friends.includes(user.username)) other.friends.push(user.username);
    }
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/friend-decline', (req, res) => {
    const { token, username } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.friendRequests) user.friendRequests = [];
    user.friendRequests = user.friendRequests.filter(u => u !== username);
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/friend-remove', (req, res) => {
    const { token, username } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.friends) user.friends = [];
    user.friends = user.friends.filter(u => u !== username);
    const other = db.users[username];
    if (other && other.friends) other.friends = other.friends.filter(u => u !== user.username);
    saveDB(db);
    res.json({ ok: true });
});

// ЛИЧНЫЕ СООБЩЕНИЯ
app.post('/api/dm-list', (req, res) => {
    const { token, withUser } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!db.dms) db.dms = {};
    const key1 = user.username + '|' + withUser;
    const key2 = withUser + '|' + user.username;
    const msgs = (db.dms[key1] || []).concat(db.dms[key2] || []).sort((a, b) => a.date - b.date).slice(-50);
    res.json({ ok: true, messages: msgs });
});

app.post('/api/dm-send', (req, res) => {
    const { token, to, text } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const target = db.users[to];
    if (!target) return res.json({ ok: false, error: 'Игрок не найден' });
    const now = Date.now();
    const last = chatCooldown['dm_' + user.username] || 0;
    if (now - last < 2000) return res.json({ ok: false, error: 'Подождите 2 секунды' });
    chatCooldown['dm_' + user.username] = now;
    const msg = String(text || '').trim().slice(0, 500);
    if (!msg) return res.json({ ok: false, error: 'Пусто' });
    if (!db.dms) db.dms = {};
    const key = user.username + '|' + to;
    if (!db.dms[key]) db.dms[key] = [];
    db.dms[key].push({ from: user.username, to, text: msg, date: now });
    if (db.dms[key].length > 100) db.dms[key] = db.dms[key].slice(-100);
    saveDB(db);
    res.json({ ok: true });
});

// СТАТУСЫ
app.post('/api/set-status', (req, res) => {
    const { token, status } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const allowed = ['online', 'away', 'dnd', 'offline'];
    if (!allowed.includes(status)) return res.json({ ok: false, error: 'Неверный статус' });
    user.status = status;
    user.lastSeen = Date.now();
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/heartbeat', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false });
    user.lastSeen = Date.now();
    saveDB(db);
    res.json({ ok: true });
});

// ЛЕНТА АКТИВНОСТИ
app.post('/api/feed', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!db.feed) db.feed = [];
    res.json({ ok: true, feed: db.feed.slice(-30).reverse() });
});

function addFeed(db, type, user, text) {
    if (!db.feed) db.feed = [];
    db.feed.push({ type, user, text, date: Date.now() });
    if (db.feed.length > 100) db.feed = db.feed.slice(-100);
}

// СВАДЬБЫ
app.post('/api/marry-propose', (req, res) => {
    const { token, username } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const target = db.users[username];
    if (!target) return res.json({ ok: false, error: 'Игрок не найден' });
    if (username === user.username) return res.json({ ok: false, error: 'Нельзя себя' });
    if (user.marriedTo) return res.json({ ok: false, error: 'Вы уже женаты' });
    if (target.marriedTo) return res.json({ ok: false, error: 'Игрок уже женат' });
    target.marryProposal = user.username;
    saveDB(db);
    addFeed(db, 'marry', user.username, 'предложил брак ' + username);
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/marry-accept', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.marryProposal) return res.json({ ok: false, error: 'Нет предложений' });
    const proposer = db.users[user.marryProposal];
    if (!proposer) return res.json({ ok: false, error: 'Игрок удалён' });
    if (proposer.marriedTo || user.marriedTo) return res.json({ ok: false, error: 'Кто-то уже женат' });
    user.marriedTo = proposer.username;
    proposer.marriedTo = user.username;
    user.marryProposal = null;
    saveDB(db);
    addFeed(db, 'marry', user.username, 'женился на ' + proposer.username);
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/marry-decline', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    user.marryProposal = null;
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/marry-divorce', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.marriedTo) return res.json({ ok: false, error: 'Вы не женаты' });
    const partner = db.users[user.marriedTo];
    if (partner) partner.marriedTo = null;
    user.marriedTo = null;
    saveDB(db);
    res.json({ ok: true });
});

// КЛАНЫ
app.post('/api/clan-create', (req, res) => {
    const { token, name } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.clan) return res.json({ ok: false, error: 'Вы уже в клане' });
    const cleanName = String(name || '').trim().slice(0, 20);
    if (cleanName.length < 3) return res.json({ ok: false, error: 'Минимум 3 символа' });
    if (user.stars < 10000) return res.json({ ok: false, error: 'Нужно 10000 звёзд' });
    if (!db.clans) db.clans = {};
    if (db.clans[cleanName]) return res.json({ ok: false, error: 'Имя занято' });
    user.stars -= 10000;
    db.clans[cleanName] = { name: cleanName, leader: user.username, members: [user.username], created: Date.now() };
    user.clan = cleanName;
    saveDB(db);
    addFeed(db, 'clan', user.username, 'создал клан ' + cleanName);
    saveDB(db);
    res.json({ ok: true, clan: cleanName });
});

app.post('/api/clan-list', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!db.clans) db.clans = {};
    const clans = Object.values(db.clans).map(c => ({
        name: c.name,
        leader: c.leader,
        membersCount: c.members.length,
        totalStars: c.members.reduce((s, m) => s + (db.users[m]?.stars || 0), 0)
    })).sort((a, b) => b.totalStars - a.totalStars);
    res.json({ ok: true, clans });
});

app.post('/api/clan-join', (req, res) => {
    const { token, name } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.clan) return res.json({ ok: false, error: 'Вы уже в клане' });
    if (!db.clans || !db.clans[name]) return res.json({ ok: false, error: 'Клан не найден' });
    if (db.clans[name].members.length >= 20) return res.json({ ok: false, error: 'Клан полон' });
    db.clans[name].members.push(user.username);
    user.clan = name;
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/clan-leave', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.clan) return res.json({ ok: false, error: 'Вы не в клане' });
    const clan = db.clans[user.clan];
    if (clan) {
        clan.members = clan.members.filter(m => m !== user.username);
        if (clan.members.length === 0) delete db.clans[user.clan];
        else if (clan.leader === user.username) clan.leader = clan.members[0];
    }
    user.clan = null;
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/clan-info', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (!user.clan) return res.json({ ok: true, clan: null });
    const clan = db.clans[user.clan];
    if (!clan) { user.clan = null; saveDB(db); return res.json({ ok: true, clan: null }); }
    const members = clan.members.map(m => ({ username: m, stars: db.users[m]?.stars || 0, leader: m === clan.leader }));
    res.json({ ok: true, clan: { name: clan.name, leader: clan.leader, members } });
});

// АВАТАРЫ И РАМКИ
app.post('/api/set-avatar', (req, res) => {
    const { token, avatar } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    // Только emoji из набора или короткая строка
    const clean = String(avatar || '').slice(0, 10);
    user.avatar = clean || '👤';
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/set-frame', (req, res) => {
    const { token, frame } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const allowed = ['none', 'gold', 'purple', 'pink', 'rainbow', 'fire'];
    if (!allowed.includes(frame)) return res.json({ ok: false, error: 'Неверная рамка' });
    user.frame = frame;
    saveDB(db);
    res.json({ ok: true });
});

