const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './db.json';
const ADMIN_PASSWORD = '30031985';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

function loadDB() {
    if (!fs.existsSync(DB_FILE)) return { users: {}, promos: { 'free': 250 }, adminBalance: 0, withdrawals: [], duels: {}, adminSessions: {} };
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (db.adminBalance === undefined) db.adminBalance = 0;
        if (!db.promos) db.promos = { 'free': 250 };
        if (!db.users) db.users = {};
        if (!db.withdrawals) db.withdrawals = [];
        if (!db.duels) db.duels = {};
        if (!db.adminSessions) db.adminSessions = {};
        return db;
    } catch (e) { return { users: {}, promos: { 'free': 250 }, adminBalance: 0, withdrawals: [], duels: {}, adminSessions: {} }; }
}
function saveDB(db) { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {} }
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function findUser(db, token) { return Object.values(db.users).find(u => u.token === token); }

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Заполните поля' });
    if (!username.startsWith('@')) return res.json({ ok: false, error: 'Ник должен начинаться с @' });
    if (username.slice(1).length < 5) return res.json({ ok: false, error: 'Минимум 5 символов после @' });
    if (password.length < 4) return res.json({ ok: false, error: 'Пароль минимум 4 символа' });
    const db = loadDB();
    if (db.users[username]) return res.json({ ok: false, error: 'Ник занят' });
    const token = genToken();
    db.users[username] = { username, password, token, stars: 100, grams: 0, lastWheel: 0, banned: false, created: Date.now(), usedPromos: [] };
    saveDB(db);
    res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Нет такого игрока' });
    if (u.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (u.password !== password) return res.json({ ok: false, error: 'Неверный пароль' });
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
    if (user.grams === undefined) user.grams = 0;
    const now = Date.now();
    const left = Math.max(0, 24 * 60 * 60 * 1000 - (now - user.lastWheel));
    res.json({ ok: true, username: user.username, stars: user.stars, grams: user.grams, wheelLeft: left });
});

app.post('/api/wheel', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    const now = Date.now(), DAY = 24 * 60 * 60 * 1000;
    if (now - user.lastWheel < DAY) return res.json({ ok: false, error: 'Подождите' });
    const rand = Math.random() * 100;
    let prize;
    if (rand < 40) prize = 0;
    else if (rand < 70) prize = 10;
    else if (rand < 90) prize = 50;
    else prize = 100;
    user.stars += prize;
    user.lastWheel = now;
    saveDB(db);
    res.json({ ok: true, prize, stars: user.stars });
});

app.post('/api/crash', (req, res) => {
    const { token, bet, target } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    const b = parseInt(bet);
    const t = parseFloat(target);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    if (isNaN(t) || t < 1.01 || t > 5) return res.json({ ok: false, error: 'Цель от 1.01 до 5' });
    const chance = (1 / t) * 100 * 0.95;
    const win = Math.random() * 100 < chance;
    if (win) {
        const profit = Math.floor(b * (t - 1));
        const commission = Math.floor(profit * 0.05);
        user.stars += profit - commission;
        db.adminBalance += commission;
        saveDB(db);
        return res.json({ ok: true, win: true, mult: t, profit: profit - commission, stars: user.stars });
    }
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, win: false, mult: t, stars: user.stars });
});

app.post('/api/dice-bot', (req, res) => {
    const { token, bet, mode } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;
    let win = false, mult = 2;
    if (mode === 'over' && sum > 7) win = true;
    if (mode === 'under' && sum < 7) win = true;
    if (mode === 'seven' && sum === 7) { win = true; mult = 5; }
    if (win) {
        const profit = b * (mult - 1);
        const commission = Math.floor(profit * 0.05);
        user.stars += profit - commission;
        db.adminBalance += commission;
        saveDB(db);
        return res.json({ ok: true, d1, d2, sum, win: true, mult, stars: user.stars });
    }
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, d1, d2, sum, win: false, stars: user.stars });
});

// ДУЭЛИ МЕЖДУ ИГРОКАМИ
app.post('/api/duel-create', (req, res) => {
    const { token, bet, opponent } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const opp = db.users[opponent];
    if (!opp) return res.json({ ok: false, error: 'Игрок не найден' });
    if (opp.banned) return res.json({ ok: false, error: 'Соперник забанен' });
    if (opp.stars < b) return res.json({ ok: false, error: 'У соперника мало звёзд' });
    if (opponent === user.username) return res.json({ ok: false, error: 'Нельзя с самим собой' });
    const duelId = genToken();
    db.duels[duelId] = { challenger: user.username, opponent, bet: b, created: Date.now() };
    saveDB(db);
    res.json({ ok: true, duelId });
});

app.post('/api/duel-list', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const myDuels = Object.entries(db.duels).filter(([id, d]) => d.opponent === user.username).map(([id, d]) => ({ id, ...d }));
    res.json({ ok: true, duels: myDuels });
});

app.post('/api/duel-accept', (req, res) => {
    const { token, duelId } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const duel = db.duels[duelId];
    if (!duel) return res.json({ ok: false, error: 'Вызов не найден' });
    if (duel.opponent !== user.username) return res.json({ ok: false, error: 'Это не ваш вызов' });
    const challenger = db.users[duel.challenger];
    const opponent = db.users[duel.opponent];
    if (challenger.stars < duel.bet || opponent.stars < duel.bet) {
        delete db.duels[duelId];
        saveDB(db);
        return res.json({ ok: false, error: 'У кого-то мало звёзд' });
    }
    const d1 = Math.floor(Math.random() * 11) + 2;
    const d2 = Math.floor(Math.random() * 11) + 2;
    let result, winner, loser;
    if (d1 > d2) { winner = opponent; loser = challenger; result = 'win'; }
    else if (d1 < d2) { winner = challenger; loser = opponent; result = 'lose'; }
    else { result = 'draw'; }
    let commission = 0;
    if (winner) {
        const prize = Math.floor(duel.bet * 1.5);
        commission = Math.floor(prize * 0.05);
        winner.stars += prize - commission;
        loser.stars -= duel.bet;
        db.adminBalance += commission;
    }
    delete db.duels[duelId];
    saveDB(db);
    res.json({ ok: true, d1, d2, result, stars: user.stars, commission, challenger: duel.challenger, opponent: duel.opponent });
});

app.post('/api/promo', (req, res) => {
    const { token, code } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const key = String(code || '').trim().toLowerCase();
    if (!db.promos[key]) return res.json({ ok: false, error: 'Неверный промокод' });
    if (!user.usedPromos) user.usedPromos = [];
    if (user.usedPromos.includes(key)) return res.json({ ok: false, error: 'Уже использовали' });
    const amount = db.promos[key];
    user.stars += amount;
    user.usedPromos.push(key);
    saveDB(db);
    res.json({ ok: true, amount, stars: user.stars });
});

app.post('/api/exchange', (req, res) => {
    const { token, stars } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.grams === undefined) user.grams = 0;
    const amt = parseInt(stars);
    if (isNaN(amt) || amt < 1000 || amt % 1000 !== 0) return res.json({ ok: false, error: 'Кратно 1000, минимум 1000' });
    if (user.stars < amt) return res.json({ ok: false, error: 'Недостаточно звёзд' });
    const grams = amt / 1000;
    user.stars -= amt;
    user.grams += grams;
    saveDB(db);
    res.json({ ok: true, stars: user.stars, grams: user.grams, exchanged: grams });
});

app.post('/api/withdraw', (req, res) => {
    const { token, grams } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.grams === undefined) user.grams = 0;
    const g = parseInt(grams);
    if (isNaN(g) || g < 1) return res.json({ ok: false, error: 'Минимум 1 грамм' });
    if (user.grams < g) return res.json({ ok: false, error: 'Недостаточно граммов' });
    user.grams -= g;
    const tgStars = g * 10;
    const wr = { username: user.username, grams: g, tgStars, date: Date.now(), status: 'pending' };
    db.withdrawals.push(wr);
    saveDB(db);
    res.json({ ok: true, grams: user.grams, message: 'Заявка на ' + g + ' грамм (' + tgStars + ' звёзд). Напишите @gift_' });
});

app.post('/api/admin/login', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Неверный пароль' });
    const db = loadDB();
    const ip = req.ip || 'unknown';
    const adminId = 'admin_' + genToken();
    db.adminSessions[adminId] = { ip, loginAt: Date.now() };
    saveDB(db);
    res.json({ ok: true, adminId });
});

app.post('/api/admin/online', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const now = Date.now();
    const online = Object.entries(db.adminSessions || {})
        .filter(([id, s]) => now - s.loginAt < 5 * 60 * 1000)
        .map(([id, s]) => ({ id, ip: s.ip, loginAt: s.loginAt }));
    res.json({ ok: true, online });
});

app.post('/api/admin/stats', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const users = Object.values(db.users);
    res.json({ ok: true, usersCount: users.length, totalStars: users.reduce((s, u) => s + u.stars, 0), adminBalance: db.adminBalance, banned: users.filter(u => u.banned).length });
});

app.post('/api/admin/users', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, users: Object.values(db.users).map(u => ({ username: u.username, stars: u.stars, grams: u.grams || 0, banned: u.banned })) });
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
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/admin/addpromo', (req, res) => {
    const { password, code, amount } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const key = String(code || '').trim().toLowerCase();
    const amt = parseInt(amount);
    if (!key || isNaN(amt) || amt <= 0) return res.json({ ok: false, error: 'Неверные данные' });
    const db = loadDB();
    db.promos[key] = amt;
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
    const key = String(code || '').trim().toLowerCase();
    const db = loadDB();
    delete db.promos[key];
    saveDB(db);
    res.json({ ok: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log('OK: ' + PORT));
