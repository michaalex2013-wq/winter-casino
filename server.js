const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = './db.json';
const ADMIN_PASSWORD = '30031985';

app.use(bodyParser.json({ limit: '10kb' }));
app.use(express.static('public'));

function loadDB() {
    if (!fs.existsSync(DB_FILE)) return { users: {}, promos: { 'free': { amount: 250, limit: 100, used: 0 } }, adminBalance: 0, chat: [], actionLogs: [] };
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (db.adminBalance === undefined) db.adminBalance = 0;
        if (!db.users) db.users = {};
        if (!db.promos) db.promos = { 'free': { amount: 250, limit: 100, used: 0 } };
        if (!db.chat) db.chat = [];
        if (!db.actionLogs) db.actionLogs = [];
        return db;
    } catch (e) { return { users: {}, promos: { 'free': { amount: 250, limit: 100, used: 0 } }, adminBalance: 0, chat: [], actionLogs: [] }; }
}
function saveDB(db) { try { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); } catch (e) {} }
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function findUser(db, token) { return Object.values(db.users).find(u => u.token === token); }

const ACHIEVEMENTS = [
    { id: 'first_win', name: 'Первая победа', desc: 'Выиграть', icon: '🏆' },
    { id: 'crash_master', name: 'Краш-мастер', desc: 'Краш x3+', icon: '📈' },
    { id: 'dice_lucky', name: 'Счастливый кубик', desc: '12 в кубиках', icon: '🎲' },
    { id: 'wheel_spin', name: 'Крутила', desc: 'Крутить колесо', icon: '🎡' },
    { id: 'rich_1000', name: 'Богач', desc: '1000 звёзд', icon: '💎' },
    { id: 'rich_10000', name: 'Миллионер', desc: '10000 звёзд', icon: '💰' },
    { id: 'gram_owner', name: 'Грамм', desc: 'Обмен на грамм', icon: '⚖️' },
    { id: 'promo_user', name: 'Промо-хантер', desc: 'Промокод', icon: '🎁' },
    { id: 'mines_win', name: 'Сапёр', desc: 'Выиграть в Минах', icon: '💣' },
    { id: 'plinko_win', name: 'Плинко', desc: 'Плинко x5+', icon: '🔻' },
    { id: 'daily_streak_7', name: 'Каждый день', desc: '7 дней подряд', icon: '📅' },
    { id: 'premium', name: 'Премиум', desc: 'Купить Premium', icon: '⭐' }
];
function giveAch(db, user, id) {
    if (!user.achievements) user.achievements = [];
    if (!user.achievements.includes(id)) user.achievements.push(id);
}
function getRank(stars) {
    if (stars >= 100000) return { name: 'Легенда', icon: '👑', color: '#ffd700' };
    if (stars >= 50000) return { name: 'Мастер', icon: '💎', color: '#a855f7' };
    if (stars >= 20000) return { name: 'Профи', icon: '🔥', color: '#ef4444' };
    if (stars >= 10000) return { name: 'Богач', icon: '💰', color: '#22c55e' };
    if (stars >= 5000) return { name: 'Опытный', icon: '⚡', color: '#3b82f6' };
    if (stars >= 1000) return { name: 'Игрок', icon: '🎮', color: '#a855f7' };
    return { name: 'Новичок', icon: '🌱', color: '#666' };
}

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Заполните поля' });
    if (!username.startsWith('@') || username.length < 6) return res.json({ ok: false, error: 'Ник: @ + 5+ символов' });
    if (password.length < 6) return res.json({ ok: false, error: 'Пароль мин 6 символов' });
    const db = loadDB();
    if (db.users[username]) return res.json({ ok: false, error: 'Ник занят' });
    const token = genToken();
    db.users[username] = {
        username, password, token, stars: 100, grams: 0, bets: 0, banned: false, frozen: false,
        prefix: '', achievements: [], usedPromos: [], friends: [], friendRequests: [],
        dailyStreak: 0, lastDailyBonus: 0, lastHourlyBonus: 0, lastLottery: 0, lastWheel: 0,
        premium: false, premiumUntil: 0, theme: 'dark', avatar: '👤', frame: 'none',
        status: 'online', lastSeen: Date.now(), created: Date.now()
    };
    saveDB(db);
    res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = loadDB();
    const u = db.users[username];
    if (!u || u.password !== password) return res.json({ ok: false, error: 'Неверный логин или пароль' });
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
    const now = Date.now();
    res.json({
        ok: true, username: u.username, stars: u.stars, grams: u.grams || 0, bets: u.bets || 0,
        prefix: u.prefix || '', avatar: u.avatar || '👤', frame: u.frame || 'none',
        theme: u.theme || 'dark', rank: getRank(u.stars),
        achievements: u.achievements || [], allAchievements: ACHIEVEMENTS,
        premium: u.premium && u.premiumUntil > now,
        dailyLeft: Math.max(0, 86400000 - (now - (u.lastDailyBonus || 0))),
        hourlyLeft: Math.max(0, 3600000 - (now - (u.lastHourlyBonus || 0))),
        lotteryLeft: Math.max(0, 86400000 - (now - (u.lastLottery || 0))),
        wheelLeft: Math.max(0, 86400000 - (now - (u.lastWheel || 0))),
        dailyStreak: u.dailyStreak || 0
    });
});

app.post('/api/users', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const me = findUser(db, token);
    if (!me) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.values(db.users).map(u => ({
        username: u.username, stars: u.stars, grams: u.grams || 0,
        prefix: u.prefix || '', rank: getRank(u.stars).name,
        avatar: u.avatar || '👤',
        online: (Date.now() - (u.lastSeen || 0)) < 300000
    }));
    res.json({ ok: true, users: list, me: me.username });
});

app.post('/api/wheel', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now();
    if (now - (u.lastWheel || 0) < 86400000) return res.json({ ok: false, error: 'Подождите' });
    const r = Math.random() * 100;
    let p;
    if (r < 40) p = 0;
    else if (r < 70) p = 10;
    else if (r < 90) p = 50;
    else p = 100;
    if (u.premium && u.premiumUntil > now) p *= 2;
    u.stars += p;
    u.lastWheel = now;
    giveAch(db, u, 'wheel_spin');
    saveDB(db);
    res.json({ ok: true, prize: p, stars: u.stars });
});

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
    const bonus = 100 + u.dailyStreak * 50;
    const total = u.premium && u.premiumUntil > now ? bonus * 2 : bonus;
    u.stars += total;
    u.lastDailyBonus = now;
    if (u.dailyStreak >= 7) giveAch(db, u, 'daily_streak_7');
    saveDB(db);
    res.json({ ok: true, amount: total, streak: u.dailyStreak, stars: u.stars });
});

app.post('/api/hourly-bonus', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now();
    if (now - (u.lastHourlyBonus || 0) < 3600000) return res.json({ ok: false, error: 'Уже получен' });
    let b = 25;
    if (u.premium && u.premiumUntil > now) b *= 2;
    u.stars += b;
    u.lastHourlyBonus = now;
    saveDB(db);
    res.json({ ok: true, amount: b, stars: u.stars });
});

app.post('/api/lottery-buy', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now();
    if (now - (u.lastLottery || 0) < 86400000) return res.json({ ok: false, error: 'Раз в сутки' });
    if (u.stars < 500) return res.json({ ok: false, error: 'Нужно 500' });
    u.stars -= 500;
    u.lastLottery = now;
    const r = Math.random() * 100;
    let p;
    if (r < 1) p = 100000;
    else if (r < 5) p = 10000;
    else if (r < 20) p = 2000;
    else if (r < 50) p = 500;
    else p = 100;
    u.stars += p;
    saveDB(db);
    res.json({ ok: true, prize: p, stars: u.stars });
});

app.post('/api/premium-buy', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const now = Date.now();
    if (u.premium && u.premiumUntil > now) return res.json({ ok: false, error: 'Уже активен' });
    if (u.stars < 50000) return res.json({ ok: false, error: 'Нужно 50000' });
    u.stars -= 50000;
    u.premium = true;
    u.premiumUntil = now + 2592000000;
    giveAch(db, u, 'premium');
    saveDB(db);
    res.json({ ok: true, stars: u.stars });
});

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
    u.stars += p.amount;
    u.usedPromos.push(key);
    p.used = (p.used || 0) + 1;
    giveAch(db, u, 'promo_user');
    saveDB(db);
    res.json({ ok: true, amount: p.amount, stars: u.stars });
});

app.post('/api/exchange', (req, res) => {
    const { token, stars } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const amt = parseInt(stars);
    if (!amt || amt < 1000 || amt % 1000 !== 0) return res.json({ ok: false, error: 'Кратно 1000' });
    if (u.stars < amt) return res.json({ ok: false, error: 'Мало звёзд' });
    u.stars -= amt;
    u.grams = (u.grams || 0) + amt / 1000;
    giveAch(db, u, 'gram_owner');
    saveDB(db);
    res.json({ ok: true, stars: u.stars, grams: u.grams });
});

app.post('/api/withdraw', (req, res) => {
    const { token, grams } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const g = parseInt(grams);
    if (!g || g < 1) return res.json({ ok: false, error: 'Мин 1 грамм' });
    if ((u.grams || 0) < g) return res.json({ ok: false, error: 'Мало граммов' });
    u.grams -= g;
    db.withdrawals.push({ username: u.username, grams: g, tgStars: g * 1000, date: Date.now(), status: 'pending' });
    saveDB(db);
    res.json({ ok: true, grams: u.grams, message: 'Заявка на ' + g + ' грамм = ' + (g * 1000) + ' звёзд. @gift' });
});

app.post('/api/crash', (req, res) => {
    const { token, bet, target } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    const t = parseFloat(target);
    if (b <= 0 || u.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    if (t < 1.1 || t > 5) return res.json({ ok: false, error: 'Множитель 1.1-5' });
    u.bets = (u.bets || 0) + 1;
    const chance = (1 / t) * 100 * 0.95;
    const win = Math.random() * 100 < chance;
    if (win) {
        const profit = Math.floor(b * (t - 1));
        const comm = Math.floor(profit * 0.05);
        u.stars += profit - comm;
        db.adminBalance = (db.adminBalance || 0) + comm;
        giveAch(db, u, 'first_win');
        if (t >= 3) giveAch(db, u, 'crash_master');
        if (u.stars >= 1000) giveAch(db, u, 'rich_1000');
        saveDB(db);
        return res.json({ ok: true, win: true, mult: t, profit: profit - comm, stars: u.stars });
    }
    u.stars -= b;
    saveDB(db);
    res.json({ ok: true, win: false, mult: t, stars: u.stars });
});

app.post('/api/dice-bot', (req, res) => {
    const { token, bet, mode } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    if (b <= 0 || u.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    u.bets = (u.bets || 0) + 1;
    const d1 = Math.floor(Math.random() * 6) + 1;
    const d2 = Math.floor(Math.random() * 6) + 1;
    const sum = d1 + d2;
    if (sum === 12) giveAch(db, u, 'dice_lucky');
    let win = false, mult = 2;
    if (mode === 'over' && sum > 7) win = true;
    if (mode === 'under' && sum < 7) win = true;
    if (mode === 'seven' && sum === 7) { win = true; mult = 5; }
    if (win) {
        const profit = b * (mult - 1);
        const comm = Math.floor(profit * 0.05);
        u.stars += profit - comm;
        db.adminBalance = (db.adminBalance || 0) + comm;
        giveAch(db, u, 'first_win');
        saveDB(db);
        return res.json({ ok: true, d1, d2, sum, win: true, mult, stars: u.stars });
    }
    u.stars -= b;
    saveDB(db);
    res.json({ ok: true, d1, d2, sum, win: false, stars: u.stars });
});

app.post('/api/diceduel-create', (req, res) => {
    const { token, bet, opponent } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    if (b <= 0 || u.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const opp = db.users[opponent];
    if (!opp) return res.json({ ok: false, error: 'Не найден' });
    if (opp.stars < b) return res.json({ ok: false, error: 'Мало у соперника' });
    if (opponent === u.username) return res.json({ ok: false, error: 'Нельзя с собой' });
    const id = genToken();
    db.diceDuels[id] = { challenger: u.username, opponent, bet: b, created: Date.now() };
    saveDB(db);
    res.json({ ok: true, id });
});
app.post('/api/diceduel-list', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const list = Object.entries(db.diceDuels).filter(([id, d]) => d.opponent === u.username).map(([id, d]) => ({ id, ...d }));
    res.json({ ok: true, duels: list });
});
app.post('/api/diceduel-accept', (req, res) => {
    const { token, id } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const duel = db.diceDuels[id];
    if (!duel) return res.json({ ok: false, error: 'Не найден' });
    if (duel.opponent !== u.username) return res.json({ ok: false, error: 'Не ваш вызов' });
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
        db.adminBalance = (db.adminBalance || 0) + commission;
        giveAch(db, winner, 'duel_win');
    }
    delete db.diceDuels[id];
    saveDB(db);
    res.json({ ok: true, c1, c2, o1, o2, chSum, opSum, result, stars: u.stars });
});

app.post('/api/mines-start', (req, res) => {
    const { token, bet, bombs } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    const bombsCount = Math.min(Math.max(parseInt(bombs) || 3, 1), 24);
    if (b <= 0 || u.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const bombSet = new Set();
    while (bombSet.size < bombsCount) bombSet.add(Math.floor(Math.random() * 25));
    db.mines[u.username] = { bet: b, bombs: [...bombSet], opened: [], active: true, bombsCount };
    u.stars -= b;
    saveDB(db);
    res.json({ ok: true, bombsCount });
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
        return res.json({ ok: true, bomb: true, stars: u.stars });
    }
    game.opened.push(cell);
    const mult = Math.pow(25 / (25 - (game.bombsCount || 3)), game.opened.length);
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
    const mult = Math.pow(25 / (25 - (game.bombsCount || 3)), game.opened.length);
    const win = Math.floor(game.bet * mult);
    u.stars += win;
    giveAch(db, u, 'mines_win');
    delete db.mines[u.username];
    saveDB(db);
    res.json({ ok: true, win, stars: u.stars });
});

app.post('/api/plinko', (req, res) => {
    const { token, bet, risk } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    if (b <= 0 || u.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    u.bets = (u.bets || 0) + 1;
    const LOW = [0.5, 1, 0.3, 1.2, 0.7, 0.2, 0.7, 1.2, 0.3, 1, 0.5];
    const MID = [0.3, 0.5, 1.5, 0.7, 0.4, 5, 0.4, 0.7, 1.5, 0.5, 0.3];
    const HIGH = [0, 0.2, 0.5, 2, 0.3, 10, 0.3, 2, 0.5, 0.2, 0];
    const table = risk === 'high' ? HIGH : risk === 'mid' ? MID : LOW;
    const idx = Math.floor(Math.random() * table.length);
    const mult = table[idx];
    const win = Math.floor(b * mult);
    if (win > b) {
        const profit = win - b;
        const comm = Math.floor(profit * 0.05);
        u.stars += profit - comm;
        db.adminBalance = (db.adminBalance || 0) + comm;
        if (mult >= 5) giveAch(db, u, 'plinko_win');
        saveDB(db);
        return res.json({ ok: true, idx, mult, win, stars: u.stars });
    }
    u.stars -= (b - win);
    saveDB(db);
    res.json({ ok: true, idx, mult, win, stars: u.stars });
});

app.post('/api/roulette', (req, res) => {
    const { token, bet, color } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    if (b <= 0 || u.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    u.bets = (u.bets || 0) + 1;
    const rand = Math.random();
    let result, mult;
    if (rand < 0.486) { result = 'red'; mult = 2; }
    else if (rand < 0.972) { result = 'black'; mult = 2; }
    else { result = 'green'; mult = 14; }
    if (result === color) {
        const profit = b * (mult - 1);
        const comm = Math.floor(profit * 0.05);
        u.stars += profit - comm;
        db.adminBalance = (db.adminBalance || 0) + comm;
        saveDB(db);
        return res.json({ ok: true, result, win: true, mult, stars: u.stars });
    }
    u.stars -= b;
    saveDB(db);
    res.json({ ok: true, result, win: false, stars: u.stars });
});

app.post('/api/chat-get', (req, res) => {
    const { token } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    res.json({ ok: true, messages: (db.chat || []).slice(-50) });
});
app.post('/api/chat-send', (req, res) => {
    const { token, text } = req.body;
    const db = loadDB();
    const u = findUser(db, token);
    if (!u) return res.json({ ok: false, error: 'Не авторизован' });
    const msg = String(text || '').trim().slice(0, 200);
    if (!msg) return res.json({ ok: false, error: 'Пусто' });
    if (!db.chat) db.chat = [];
    db.chat.push({ user: u.username, text: msg, date: Date.now(), prefix: u.prefix || '', rank: getRank(u.stars).icon });
    if (db.chat.length > 200) db.chat = db.chat.slice(-200);
    saveDB(db);
    res.json({ ok: true });
});

app.post('/api/admin/login', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Неверный пароль' });
    res.json({ ok: true });
});
app.post('/api/admin/stats', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    const users = Object.values(db.users);
    res.json({ ok: true, usersCount: users.length, totalStars: users.reduce((s, u) => s + u.stars, 0), adminBalance: db.adminBalance || 0, banned: users.filter(u => u.banned).length });
});
app.post('/api/admin/users', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Нет доступа' });
    const db = loadDB();
    res.json({ ok: true, users: Object.values(db.users).map(u => ({ username: u.username, stars: u.stars, grams: u.grams || 0, banned: u.banned, frozen: u.frozen || false, prefix: u.prefix || '' })) });
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log('OK: ' + PORT));
