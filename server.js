const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './db.json';
const ADMIN_PASSWORD = '50052916';

// DDoS / rate-limit
const globalLimiter = {};
const blacklist = {};
const loginAttempts = {};

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
    if (globalLimiter[ip].count > 400) { blacklist[ip] = now + 600000; return res.status(429).json({ error: 'Блок 10 мин' }); }
    if (globalLimiter[ip].count > 150) return res.status(429).json({ error: 'Много запросов' });
    next();
});

app.use(bodyParser.json({ limit: '1mb' }));
app.use(express.static('public'));

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

function defaultDB() {
    return { users: {}, promos: { 'nyashka': { amount: 500, limit: 100, used: 0 } }, adminBalance: 0, withdrawals: [], diceDuels: {}, mines: {}, crashGames: {}, adminSessions: {}, failedLogins: [], actionLogs: [], transactions: [] };
}

function loadDB() {
    if (!fs.existsSync(DB_FILE)) return defaultDB();
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        const d = defaultDB();
        Object.keys(d).forEach(k => { if (db[k] === undefined) db[k] = d[k]; });
        return db;
    } catch (e) { return defaultDB(); }
}
function saveDB(db) { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {} }
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function findUser(db, token) { return Object.values(db.users).find(u => u.token === token); }
function logAction(db, type, from, to, amount) {
    db.actionLogs.push({ type, from, to, amount: amount || 0, date: Date.now() });
    if (db.actionLogs.length > 500) db.actionLogs = db.actionLogs.slice(-500);
}
function logTx(db, user, type, amount, comment) {
    db.transactions.push({ user, type, amount, comment: comment || '', date: Date.now() });
    if (db.transactions.length > 2000) db.transactions = db.transactions.slice(-2000);
}

// ========== РЕГИСТРАЦИЯ ==========
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Заполните поля' });
    if (username.length < 3 || username.length > 20) return res.json({ ok: false, error: 'Ник 3-20 символов' });
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.json({ ok: false, error: 'Ник: латиница, цифры, _' });
    if (password.length < 6) return res.json({ ok: false, error: 'Пароль мин 6 символов' });
    const db = loadDB();
    if (db.users[username]) return res.json({ ok: false, error: 'Ник занят' });
    const token = genToken();
    db.users[username] = {
        username, password, token, tokens: 1000, bets: 0, banned: false, frozen: false,
        prefix: '', avatar: '👤', usedPromos: [], friends: [],
        dailyStreak: 0, lastDailyBonus: 0, created: Date.now(), lastSeen: Date.now()
    };
    saveDB(db);
    res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
    const ip = getIP(req);
    const now = Date.now();
    const a = loginAttempts[ip] || { count: 0, blockedUntil: 0 };
    if (a.blockedUntil > now) return res.json({ ok: false, error: 'Подождите ' + Math.ceil((a.blockedUntil - now) / 60000) + ' мин.' });

    const { username, password } = req.body;
    const db = loadDB();
    const u = db.users[username];
    if (!u || u.password !== password) {
        a.count = (a.count || 0) + 1;
        if (a.count >= 5) { a.blockedUntil = now + 900000; a.count = 0; }
        loginAttempts[ip] = a;
        return res.json({ ok: false, error: 'Неверный логин или пароль' });
    }
    if (u.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (u.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
    u.token = genToken();
    u.lastSeen = Date.now();
    saveDB(db);
    res.json({ ok: true, token: u.token, username });
});

app.post('/api/profile', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    if (u.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (u.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
    u.lastSeen = Date.now();
    saveDB(db);
    const now = Date.now();
    res.json({
        ok: true, username: u.username, tokens: u.tokens, bets: u.bets || 0,
        prefix: u.prefix || '', avatar: u.avatar || '👤',
        dailyLeft: Math.max(0, 86400000 - (now - (u.lastDailyBonus || 0))),
        dailyStreak: u.dailyStreak || 0
    });
});

app.post('/api/users', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const me = findUser(db, token);
    if (!me) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.values(db.users).map(u => ({
        username: u.username, tokens: u.tokens, prefix: u.prefix || '',
        avatar: u.avatar || '👤',
        online: (Date.now() - (u.lastSeen || 0)) < 300000
    }));
    res.json({ ok: true, users: list, me: me.username });
});

// ========== ПРОФИЛЬ ==========
app.post('/api/set-avatar', (req, res) => {
    const { token, avatar } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const a = String(avatar || '').slice(0, 100000);
    if (!a) return res.json({ ok: false, error: 'Пусто' });
    u.avatar = a;
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/set-nick', (req, res) => {
    const { token, newNick } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    if (!newNick || newNick.length < 3 || newNick.length > 20) return res.json({ ok: false, error: 'Ник 3-20 символов' });
    if (!/^[a-zA-Z0-9_]+$/.test(newNick)) return res.json({ ok: false, error: 'Ник: латиница, цифры, _' });
    if (db.users[newNick]) return res.json({ ok: false, error: 'Ник занят' });
    delete db.users[u.username];
    u.username = newNick;
    db.users[newNick] = u;
    saveDB(db);
    res.json({ ok: true });
});

// ========== ЕЖЕДНЕВНЫЙ БОНУС ==========
app.post('/api/daily-bonus', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now();
    if (now - (u.lastDailyBonus || 0) < 86400000) return res.json({ ok: false, error: 'Уже получен' });
    const diff = now - (u.lastDailyBonus || 0);
    if (u.lastDailyBonus > 0 && diff < 172800000) u.dailyStreak = (u.dailyStreak || 0) + 1;
    else u.dailyStreak = 1;
    if (u.dailyStreak > 30) u.dailyStreak = 30;
    const bonus = 500 + u.dailyStreak * 200;
    u.tokens += bonus;
    u.lastDailyBonus = now;
    logTx(db, u.username, 'daily', bonus, 'Серия ' + u.dailyStreak);
    saveDB(db);
    res.json({ ok: true, amount: bonus, streak: u.dailyStreak, tokens: u.tokens });
});

// ========== ПРОМОКОДЫ ==========
app.post('/api/promo', (req, res) => {
    const { token, code } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const key = String(code || '').trim().toLowerCase();
    const p = db.promos[key];
    if (!p) return res.json({ ok: false, error: 'Неверный промокод' });
    if (p.used >= p.limit) return res.json({ ok: false, error: 'Лимит исчерпан' });
    if (!u.usedPromos) u.usedPromos = [];
    if (u.usedPromos.includes(key)) return res.json({ ok: false, error: 'Уже использован' });
    u.tokens += p.amount;
    u.usedPromos.push(key);
    p.used++;
    logTx(db, u.username, 'promo', p.amount, key);
    saveDB(db);
    res.json({ ok: true, amount: p.amount, tokens: u.tokens });
});

// ========== КУБИКИ vs БОТ ==========
app.post('/api/dice-bot', (req, res) => {
    const { token, bet, mode } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    if (!b || b <= 0 || u.tokens < b) return res.json({ ok: false, error: 'Мало токенов' });
    u.bets = (u.bets || 0) + 1;
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;
    let win = false, mult = 2;
    if (mode === 'over' && sum > 7) win = true;
    if (mode === 'under' && sum < 7) win = true;
    if (mode === 'seven' && sum === 7) { win = true; mult = 5; }
    if (win) {
        const profit = b * (mult - 1);
        u.tokens += profit;
        saveDB(db);
        return res.json({ ok: true, d1, d2, sum, win: true, mult, profit, tokens: u.tokens });
    }
    u.tokens -= b;
    saveDB(db);
    res.json({ ok: true, d1, d2, sum, win: false, tokens: u.tokens });
});

// ========== КУБИКИ PvP ==========
app.post('/api/dice-pvp-create', (req, res) => {
    const { token, bet, opponent } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    if (!b || b <= 0 || u.tokens < b) return res.json({ ok: false, error: 'Мало токенов' });
    const opp = db.users[opponent];
    if (!opp) return res.json({ ok: false, error: 'Игрок не найден' });
    if (opp.tokens < b) return res.json({ ok: false, error: 'У соперника мало токенов' });
    if (opponent === u.username) return res.json({ ok: false, error: 'Нельзя с собой' });
    const id = genToken();
    db.diceDuels[id] = { challenger: u.username, opponent, bet: b, created: Date.now() };
    saveDB(db);
    res.json({ ok: true, id });
});

app.post('/api/dice-pvp-list', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.entries(db.diceDuels).filter(([id, d]) => d.opponent === u.username).map(([id, d]) => ({ id, ...d }));
    res.json({ ok: true, duels: list });
});

app.post('/api/dice-pvp-accept', (req, res) => {
    const { token, id } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const duel = db.diceDuels[id];
    if (!duel) return res.json({ ok: false, error: 'Вызов не найден' });
    if (duel.opponent !== u.username) return res.json({ ok: false, error: 'Не ваш вызов' });
    const ch = db.users[duel.challenger];
    if (ch.tokens < duel.bet || u.tokens < duel.bet) { delete db.diceDuels[id]; saveDB(db); return res.json({ ok: false, error: 'Мало токенов' }); }
    const c1 = Math.floor(Math.random() * 6) + 1, c2 = Math.floor(Math.random() * 6) + 1;
    const o1 = Math.floor(Math.random() * 6) + 1, o2 = Math.floor(Math.random() * 6) + 1;
    const chSum = c1 + c2, opSum = o1 + o2;
    let result;
    if (chSum > opSum) { ch.tokens += duel.bet; u.tokens -= duel.bet; result = 'lose'; }
    else if (chSum < opSum) { u.tokens += duel.bet; ch.tokens -= duel.bet; result = 'win'; }
    else result = 'draw';
    delete db.diceDuels[id];
    saveDB(db);
    res.json({ ok: true, c1, c2, o1, o2, chSum, opSum, result, tokens: u.tokens });
});

// ========== МИНЫ ==========
app.post('/api/mines-start', (req, res) => {
    const { token, bet, bombs } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    const bombsCount = Math.min(Math.max(parseInt(bombs) || 3, 1), 24);
    if (!b || b <= 0 || u.tokens < b) return res.json({ ok: false, error: 'Мало токенов' });
    const bombSet = new Set();
    while (bombSet.size < bombsCount) bombSet.add(Math.floor(Math.random() * 25));
    db.mines[u.username] = { bet: b, bombs: [...bombSet], opened: [], active: true, bombsCount };
    u.tokens -= b;
    saveDB(db);
    res.json({ ok: true, bombsCount, tokens: u.tokens });
});

app.post('/api/mines-open', (req, res) => {
    const { token, cell } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const game = db.mines[u.username];
    if (!game || !game.active) return res.json({ ok: false, error: 'Нет игры' });
    if (game.opened.includes(cell)) return res.json({ ok: false, error: 'Открыто' });
    if (game.bombs.includes(cell)) {
        game.active = false;
        delete db.mines[u.username];
        saveDB(db);
        return res.json({ ok: true, bomb: true, tokens: u.tokens });
    }
    game.opened.push(cell);
    const mult = Math.pow(25 / (25 - game.bombsCount), game.opened.length);
    saveDB(db);
    res.json({ ok: true, bomb: false, opened: game.opened.length, multiplier: mult });
});

app.post('/api/mines-cash', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const game = db.mines[u.username];
    if (!game || !game.active) return res.json({ ok: false, error: 'Нет игры' });
    const mult = Math.pow(25 / (25 - game.bombsCount), game.opened.length);
    const win = Math.floor(game.bet * mult);
    u.tokens += win;
    delete db.mines[u.username];
    saveDB(db);
    res.json({ ok: true, win, tokens: u.tokens });
});

// ========== КРАШ ==========
app.post('/api/crash-start', (req, res) => {
    const { token, bet, target } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    const t = parseFloat(target);
    if (!b || b <= 0 || u.tokens < b) return res.json({ ok: false, error: 'Мало токенов' });
    if (t < 1.1 || t > 10) return res.json({ ok: false, error: 'Цель 1.1-10' });
    u.bets = (u.bets || 0) + 1;
    const crashPoint = (Math.random() * 8 + 1.1).toFixed(2);
    const win = parseFloat(crashPoint) >= t;
    if (win) {
        const profit = Math.floor(b * (t - 1));
        u.tokens += profit;
        saveDB(db);
        return res.json({ ok: true, crashPoint: parseFloat(crashPoint), target: t, win: true, profit, tokens: u.tokens });
    }
    u.tokens -= b;
    saveDB(db);
    res.json({ ok: true, crashPoint: parseFloat(crashPoint), target: t, win: false, tokens: u.tokens });
});

// ========== АДМИН ==========
app.post('/api/admin/login', (req, res) => {
    const ip = getIP(req);
    const now = Date.now();
    const a = loginAttempts['admin_' + ip] || { count: 0, blockedUntil: 0 };
    if (a.blockedUntil > now) return res.json({ ok: false, error: 'Подождите ' + Math.ceil((a.blockedUntil - now) / 60000) + ' мин.' });
    if (req.body.password !== ADMIN_PASSWORD) {
        a.count = (a.count || 0) + 1;
        if (a.count >= 3) { a.blockedUntil = now + 1800000; a.count = 0; }
        loginAttempts['admin_' + ip] = a;
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
    res.json({ ok: true });
});

app.post('/api/admin/online', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const now = Date.now();
    const online = Object.values(db.users).filter(u => (now - (u.lastSeen || 0)) < 300000).map(u => ({ username: u.username, tokens: u.tokens }));
    res.json({ ok: true, online, total: Object.keys(db.users).length });
});

app.post('/api/admin/stats', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const users = Object.values(db.users);
    const now = Date.now();
    res.json({
        ok: true,
        usersCount: users.length,
        onlineCount: users.filter(u => (now - (u.lastSeen || 0)) < 300000).length,
        totalTokens: users.reduce((s, u) => s + u.tokens, 0),
        banned: users.filter(u => u.banned).length,
        frozen: users.filter(u => u.frozen).length
    });
});

app.post('/api/admin/users', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const now = Date.now();
    res.json({ ok: true, users: Object.values(db.users).map(u => ({
        username: u.username, tokens: u.tokens, banned: u.banned, frozen: u.frozen || false,
        prefix: u.prefix || '', online: (now - (u.lastSeen || 0)) < 300000
    })) });
});

app.post('/api/admin/give', (req, res) => {
    const { password, username, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Игрок не найден' });
    const amt = parseInt(amount) || 0;
    u.tokens += amt;
    logAction(db, 'give', 'admin', username, amt);
    saveDB(db);
    res.json({ ok: true, tokens: u.tokens });
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
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/admin/addpromo', (req, res) => {
    const { password, code, amount, limit } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const key = String(code || '').trim().toLowerCase();
    const amt = parseInt(amount);
    if (!key || !amt || amt <= 0) return res.json({ ok: false, error: 'Неверные данные' });
    const db = loadDB();
    db.promos[key] = { amount: amt, limit: parseInt(limit) || 100, used: 0 };
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
    const db = loadDB();
    delete db.promos[String(code || '').trim().toLowerCase()];
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/admin/failed', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, failed: (db.failedLogins || []).slice(-20).reverse() });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log('Няшка-Казик запущен: ' + PORT));
