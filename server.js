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
    if (!fs.existsSync(DB_FILE)) return { users: {}, duels: {}, adminBalance: 0 };
    try {
        const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        if (db.adminBalance === undefined) db.adminBalance = 0;
        if (!db.duels) db.duels = {};
        return db;
    } catch (e) { return { users: {}, duels: {}, adminBalance: 0 }; }
}
function saveDB(db) { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function genToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function findUser(db, token) { return Object.values(db.users).find(u => u.token === token); }

const PROMOS = { 'free': { amount: 250 } };

app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ ok: false, error: 'Заполните поля' });
    if (!username.startsWith('@')) return res.json({ ok: false, error: 'Ник должен начинаться с @' });
    if (username.slice(1).length < 5) return res.json({ ok: false, error: 'Минимум 5 символов после @' });
    if (password.length < 4) return res.json({ ok: false, error: 'Пароль минимум 4 символа' });
    const db = loadDB();
    if (db.users[username]) return res.json({ ok: false, error: 'Ник занят' });
    const token = genToken();
    db.users[username] = { username, password, token, stars: 100, grams: 0, lastWheel: 0, inventory: [], banned: false, created: Date.now(), usedPromos: [] };
    saveDB(db);
    res.json({ ok: true, token, username });
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const db = loadDB();
    const u = db.users[username];
    if (!u) return res.json({ ok: false, error: 'Нет такого игрока' });
    if (u.banned) return res.json({ ok: false, error: 'Вы забанены' });
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
    if (user.banned) return res.json({ ok: false, error: 'Вы забанены' });
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
    const now = Date.now(), DAY = 24 * 60 * 60 * 1000;
    if (now - user.lastWheel < DAY) return res.json({ ok: false, error: 'Подождите', left: DAY - (now - user.lastWheel) });
    const prizes = [0, 10, 50, 100];
    const prize = prizes[Math.floor(Math.random() * prizes.length)];
    user.stars += prize;
    user.lastWheel = now;
    saveDB(db);
    res.json({ ok: true, prize, stars: user.stars });
});

const CASES = {
    poor:    { price: 50,   prizes: [20, 25, 30, 40, 50, 60, 80, 100] },
    medium:  { price: 100,  prizes: [40, 60, 80, 100, 120, 150, 180, 200] },
    cute:    { price: 250,  prizes: [100, 150, 200, 250, 300, 400, 500] },
    admin:   { price: 500,  prizes: [200, 300, 400, 500, 600, 750, 900, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 2000] },
    rich:    { price: 1000, prizes: [400, 600, 800, 1000, 1200, 1500, 1800, 2000] }
};

app.post('/api/case', (req, res) => {
    const { token, caseType } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const box = CASES[caseType];
    if (!box) return res.json({ ok: false, error: 'Нет такого кейса' });
    if (user.stars < box.price) return res.json({ ok: false, error: 'Мало звёзд' });
    user.stars -= box.price;
    const prize = box.prizes[Math.floor(Math.random() * box.prizes.length)];
    user.stars += prize;
    saveDB(db);
    res.json({ ok: true, prize, stars: user.stars });
});

app.post('/api/promo', (req, res) => {
    const { token, code } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const key = String(code || '').trim().toLowerCase();
    const promo = PROMOS[key];
    if (!promo) return res.json({ ok: false, error: 'Неверный промокод' });
    if (!user.usedPromos) user.usedPromos = [];
    if (user.usedPromos.includes(key)) return res.json({ ok: false, error: 'Уже использовали' });
    user.stars += promo.amount;
    user.usedPromos.push(key);
    saveDB(db);
    res.json({ ok: true, amount: promo.amount, stars: user.stars });
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

app.post('/api/duel-bot', (req, res) => {
    const { token, bet } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const b = parseInt(bet);
    if (b <= 0 || user.stars < b) return res.json({ ok: false, error: 'Мало звёзд' });
    const my = Math.floor(Math.random() * 11) + 2;
    const bot = Math.floor(Math.random() * 11) + 2;
    if (my > bot) {
        const win = Math.floor(b * 0.5);
        const commission = Math.floor(win * 0.05);
        user.stars += win - commission;
        db.adminBalance += commission;
        saveDB(db);
        return res.json({ ok: true, my, bot, result: 'win', stars: user.stars });
    } else if (my < bot) {
        user.stars -= b;
        saveDB(db);
        return res.json({ ok: true, my, bot, result: 'lose', stars: user.stars });
    }
    res.json({ ok: true, my, bot, result: 'draw', stars: user.stars });
});

app.post('/api/withdraw', (req, res) => {
    const { token, amount } = req.body;
    const db = loadDB();
    const user = findUser(db, token);
    if (!user) return res.json({ ok: false, error: 'Не авторизован' });
    const amt = parseInt(amount);
    if (isNaN(amt) || amt < 1000) return res.json({ ok: false, error: 'Минимум 1000' });
    if (user.stars < amt) return res.json({ ok: false, error: 'Недостаточно' });
    user.stars -= amt;
    if (!user.withdrawals) user.withdrawals = [];
    user.withdrawals.push({ amount: amt, date: Date.now(), status: 'pending' });
    saveDB(db);
    res.json({ ok: true, stars: user.stars, message: 'Заявка создана. @gift' });
});

app.post('/api/admin/login', (req, res) => {
    if (req.body.password !== ADMIN_PASSWORD) return res.json({ ok: false, error: 'Неверный пароль' });
    res.json({ ok: true });
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
    res.json({ ok: true, users: Object.values(db.users).map(u => ({ username: u.username, stars: u.stars, banned: u.banned })) });
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log('Сайт запущен: http://localhost:' + PORT));

