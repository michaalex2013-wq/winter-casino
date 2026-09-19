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

function defaultDB() {
    return { users: {}, promos: { 'free': { amount: 250, limit: 100, used: 0 } }, adminBalance: 0, withdrawals: [], duels: {}, diceDuels: {}, adminSessions: {}, mines: {} };
}
function loadDB() {
    if (!fs.existsSync(DB_FILE)) return defaultDB();
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (db.adminBalance === undefined) db.adminBalance = 0;
        if (!db.users) db.users = {};
        if (!db.withdrawals) db.withdrawals = [];
        if (!db.duels) db.duels = {};
        if (!db.diceDuels) db.diceDuels = {};
        if (!db.adminSessions) db.adminSessions = {};
        if (!db.promos) db.promos = { 'free': { amount: 250, limit: 100, used: 0 } };
        if (!db.mines) db.mines = {};
        Object.keys(db.promos).forEach(k => { if (typeof db.promos[k] === 'number') db.promos[k] = { amount: db.promos[k], limit: 999, used: 0 }; });
        return db;
    } catch (e) { return defaultDB(); }
}
function saveDB(db) { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {} }
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function findUser(db, token) { return Object.values(db.users).find(u => u.token === token); }

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
    { id: 'plinko_win', name: 'Плинко', desc: 'Выиграть в Плинко x5+', icon: '🔻' }
];

function giveAch(db, user, id) {
    if (!user.achievements) user.achievements = [];
    if (!user.achievements.includes(id)) user.achievements.push(id);
}

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Заполните поля' });
    if (!username.startsWith('@')) return res.json({ ok: false, error: 'Ник должен начинаться с @' });
    if (username.slice(1).length < 5) return res.json({ ok: false, error: 'Минимум 5 символов после @' });
    if (password.length < 4) return res.json({ ok: false, error: 'Пароль минимум 4 символа' });
    const db = loadDB();
    if (db.users[username]) return res.json({ ok: false, error: 'Ник занят' });
    const token = genToken();
    db.users[username] = { username, password, token, stars: 100, grams: 0, lastWheel: 0, banned: false, frozen: false, created: Date.now(), usedPromos: [], achievements: [], prefix: '', bets: 0 };
    saveDB(db);
    res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Нет такого игрока' });
    if (u.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (u.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
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
    if (user.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
    if (user.grams === undefined) user.grams = 0;
    const now = Date.now();
    const left = Math.max(0, 24 * 60 * 60 * 1000 - (now - user.lastWheel));
    res.json({ ok: true, username: user.username, stars: user.stars, grams: user.grams, wheelLeft: left, achievements: user.achievements || [], allAchievements: ACHIEVEMENTS, prefix: user.prefix || '' });
});

app.post('/api/users', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const me = findUser(db, token);
    if (!me) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.values(db.users).map(u => ({
        username: u.username, stars: u.stars, grams: u.grams || 0,
        prefix: u.prefix || '', achievements: (u.achievements || []).length,
        banned: u.banned, frozen: u.frozen || false
    }));
    const top = list.slice().sort((a, b) => b.stars - a.stars).slice(0, 20);
    res.json({ ok: true, users: list, top, me: me.username });
});

app.post('/api/wheel', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (user.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
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
    giveAch(db, user, 'wheel_spin');
    saveDB(db);
    res.json({ ok: true, prize, stars: user.stars });
});

// КРАШ
app.post('/api/crash', (req, res) => {
    const { token, bet, target } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (user.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
    const b = parseInt(bet);
    const t = parseFloat(target);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    if (isNaN(t) || t < 1.01 || t > 5) return res.json({ ok: false, error: 'Цель от 1.01 до 5' });
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

// КУБИКИ ПРОТИВ БОТА
app.post('/api/dice-bot', (req, res) => {
    const { token, bet, mode } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (user.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
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

// КУБИКИ ПРОТИВ ИГРОКА
app.post('/api/diceduel-create', (req, res) => {
    const { token, bet, opponent } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned) return res.json({ ok: false, error: 'BANNED', banned: true });
    if (user.frozen) return res.json({ ok: false, error: 'FROZEN', frozen: true });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const opp = db.users[opponent];
    if (!opp) return res.json({ ok: false, error: 'Игрок не найден' });
    if (opp.banned || opp.frozen) return res.json({ ok: false, error: 'Игрок недоступен' });
    if (opp.stars < b) return res.json({ ok: false, error: 'У соперника мало звёзд' });
    if (opponent === user.username) return res.json({ ok: false, error: 'Нельзя с самим собой' });
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
app.post('/api/diceduel-accept', (req, res) => {
    const { token, id } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const duel = db.diceDuels[id];
    if (!duel) return res.json({ ok: false, error: 'Вызов не найден' });
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

// МИНЫ
app.post('/api/mines-start', (req, res) => {
    const { token, bet } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    if (user.banned || user.frozen) return res.json({ ok: false, error: 'Недоступно' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const bombs = new Set();
    while (bombs.size < 3) bombs.add(Math.floor(Math.random() * 25));
    db.mines[user.username] = { bet: b, bombs: [...bombs], opened: [], active: true };
    user.stars -= b;
    saveDB(db);
    res.json({ ok: true, bombs: [...bombs].length, opened: 0, multiplier: 1.0 });
});
app.post('/api/mines-open', (req, res) => {
    const { token, cell } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const game = db.mines[user.username];
    if (!game || !game.active) return res.json({ ok: false, error: 'Нет активной игры' });
    if (game.opened.includes(cell)) return res.json({ ok: false, error: 'Уже открыто' });
    if (game.bombs.includes(cell)) {
        game.active = false;
        delete db.mines[user.username];
        saveDB(db);
        return res.json({ ok: true, bomb: true, stars: user.stars });
    }
    game.opened.push(cell);
    const opened = game.opened.length;
    const mult = 1 + opened * 0.3;
    saveDB(db);
    res.json({ ok: true, bomb: false, opened, multiplier: mult });
});
app.post('/api/mines-cash', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const game = db.mines[user.username];
    if (!game || !game.active) return res.json({ ok: false, error: 'Нет активной игры' });
    const mult = 1 + game.opened.length * 0.3;
    const win = Math.floor(game.bet * mult);
    user.stars += win;
    giveAch(db, user, 'mines_win');
    delete db.mines[user.username];
    saveDB(db);
    res.json({ ok: true, win, stars: user.stars });
});

// ПЛИНКО
app.post('/api/plinko', (req, res) => {
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

// РУЛЕТКА
app.post('/api/roulette', (req, res) => {
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

// ПРОМО
app.post('/api/promo', (req, res) => {
    const { token, code } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const key = String(code || '').trim().toLowerCase();
    const promo = db.promos[key];
    if (!promo) return res.json({ ok: false, error: 'Неверный промокод' });
    if (promo.used >= promo.limit) return res.json({ ok: false, error: 'Лимит исчерпан' });
    if (!user.usedPromos) user.usedPromos = [];
    if (user.usedPromos.includes(key)) return res.json({ ok: false, error: 'Уже использовали' });
    user.stars += promo.amount;
    user.usedPromos.push(key);
    promo.used = (promo.used || 0) + 1;
    giveAch(db, user, 'promo_user');
    saveDB(db);
    res.json({ ok: true, amount: promo.amount, stars: user.stars });
});

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
    if (isNaN(g) || g < 1) return res.json({ ok: false, error: 'Минимум 1 грамм' });
    if (user.grams < g) return res.json({ ok: false, error: 'Недостаточно' });
    user.grams -= g;
    const tgStars = g * 10;
    db.withdrawals.push({ username: user.username, grams: g, tgStars, date: Date.now(), status: 'pending' });
    saveDB(db);
    res.json({ ok: true, grams: user.grams, message: 'Заявка на ' + g + ' грамм. @gift_' });
});

// АДМИН
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
    const online = Object.entries(db.adminSessions || {}).filter(([id, s]) => now - s.loginAt < 5 * 60 * 1000).map(([id, s]) => ({ id, ip: s.ip, loginAt: s.loginAt }));
    res.json({ ok: true, online });
});
app.post('/api/admin/stats', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const users = Object.values(db.users);
    res.json({ ok: true, usersCount: users.length, totalStars: users.reduce((s, u) => s + u.stars, 0), adminBalance: db.adminBalance, banned: users.filter(u => u.banned).length, frozen: users.filter(u => u.frozen).length });
});
app.post('/api/admin/users', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, users: Object.values(db.users).map(u => ({ username: u.username, stars: u.stars, grams: u.grams || 0, banned: u.banned, frozen: u.frozen || false, prefix: u.prefix || '' })) });
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
app.post('/api/admin/freeze', (req, res) => {
    const { password, username, freeze } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    u.frozen = !!freeze;
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/delete', (req, res) => {
    const { password, username } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    if (!db.users[username]) return res.json({ ok: false, error: 'Не найден' });
    delete db.users[username];
    saveDB(db);
    res.json({ ok: true });
});
app.post('/api/admin/prefix', (req, res) => {
    const { password, username, prefix } = req.body;
    if (password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Не найден' });
    u.prefix = prefix || '';
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
    const key = String(code || '').trim().toLowerCase();
    const amt = parseInt(amount);
    const lim = parseInt(limit) || 100;
    if (!key || isNaN(amt) || amt <= 0) return res.json({ ok: false, error: 'Неверные данные' });
    const db = loadDB();
    db.promos[key] = { amount: amt, limit: lim, used: 0 };
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
