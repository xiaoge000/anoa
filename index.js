const express = require('express');
const bodyParser = require('body-parser');
const { google } = require('googleapis');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(bodyParser.json());

// ✅ 环境变量配置（Cloud Run 中设置）
const BOT_TOKEN = process.env.TELEGRAM_TOKEN;
const SHEET_ID = process.env.SHEET_ID;
const SHEET_NAME = process.env.SHEET_NAME || '话术平台表';
const GOOGLE_KEY_FILE = process.env.GOOGLE_KEY_FILE || 'key.json';

// ✅ 初始化 Telegram Bot（Webhook 模式！）
const bot = new TelegramBot(BOT_TOKEN);

// ✅ 初始化 Google Sheets 授权
const auth = new google.auth.GoogleAuth({
  keyFile: GOOGLE_KEY_FILE,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// ✅ 缓存数据结构
let fullData = null;
let menuMap = {};

// ✅ 工具函数：分割数组
function chunkArray(arr, size) {
  const res = [];
  for (let i = 0; i < arr.length; i += size) {
    res.push(arr.slice(i, i + size));
  }
  return res;
}

// ✅ 从表格获取数据
async function fetchSheet() {
  if (fullData) return fullData;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:D`,
  });
  fullData = res.data.values;
  return fullData;
}

// ✅ 获取分类
async function getCategories() {
  const rows = await fetchSheet();
  const set = new Set();
  for (let i = 1; i < rows.length; i++) {
    const cat = rows[i][0];
    if (cat) set.add(cat.trim());
  }
  return [...set];
}

// ✅ 获取分类下菜单
async function getMenusByCategory(category) {
  const rows = await fetchSheet();
  const result = [];
  let index = 0;
  menuMap = {};
  for (let i = 1; i < rows.length; i++) {
    const full = rows[i][1];
    if (full && full.startsWith(`（${category}）`)) {
      const label = full.replace(`（${category}）`, '').trim();
      const id = `m_${index++}`;
      result.push({ id, label });
      menuMap[id] = full;
    }
  }
  return result;
}

// ✅ 获取菜单对应话术内容
async function getContent(fullMenu) {
  const rows = await fetchSheet();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === fullMenu) {
      return {
        text: rows[i][2] || '（无话术）',
        image: rows[i][3] || null,
      };
    }
  }
  return null;
}

// ✅ /start 菜单入口
bot.onText(/\/start|\/home/, async (msg) => {
  const categories = await getCategories();
  const buttons = chunkArray(
    categories.map(cat => ({ text: cat, callback_data: `cat_${cat}` })), 2
  );
  bot.sendMessage(msg.chat.id, '📋 请选择分类：', {
    reply_markup: { inline_keyboard: buttons },
  });
});

// ✅ /tc 刷新缓存
bot.onText(/\/tc/, (msg) => {
  fullData = null;
  bot.sendMessage(msg.chat.id, '♻️ 已刷新缓存，请重新点击菜单');
});

// ✅ /help 帮助指令
bot.onText(/\/help/, (msg) => {
  bot.sendMessage(msg.chat.id, `📖 使用说明：\n1️⃣ /start 进入菜单\n2️⃣ 点击分类 → 菜单\n3️⃣ 显示话术内容+图片\n4️⃣ /tc 可刷新缓存`);
});

// ✅ 按钮点击处理
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('cat_')) {
    const category = data.slice(4);
    const menus = await getMenusByCategory(category);
    const buttons = chunkArray(
      menus.map(m => ({ text: m.label, callback_data: `menu_${m.id}` })), 2
    );
    return bot.sendMessage(chatId, `📁 分类【${category}】，请选择：`, {
      reply_markup: { inline_keyboard: buttons },
    });
  }

  if (data.startsWith('menu_')) {
    const id = data.slice(5);
    const fullMenu = menuMap[id];
    const content = await getContent(fullMenu);
    if (!content) return bot.sendMessage(chatId, '❌ 未找到话术');
    await bot.sendMessage(chatId, `📋 *话术如下：*\n\n${content.text}`, { parse_mode: 'Markdown' });
    if (content.image) await bot.sendPhoto(chatId, content.image);
  }

  bot.answerCallbackQuery(query.id);
});

// ✅ 私聊关键词搜索
bot.on('message', async (msg) => {
  if (msg.chat.type !== 'private' || msg.text.startsWith('/')) return;
  const keyword = msg.text.trim().toLowerCase();
  const rows = await fetchSheet();
  const matches = rows.filter((row, i) => i > 0 && (
    (row[1] && row[1].toLowerCase().includes(keyword)) ||
    (row[2] && row[2].toLowerCase().includes(keyword))
  )).slice(0, 5);

  if (matches.length === 0) {
    await bot.sendMessage(msg.chat.id, '⚠️ 没有找到相关话术');
  } else {
    for (const row of matches) {
      const title = row[1] || '（无菜单）';
      const content = row[2] || '（无话术）';
      const image = row[3];
      await bot.sendMessage(msg.chat.id, `📌 *${title}*\n\n${content}`, { parse_mode: 'Markdown' });
      if (image) await bot.sendPhoto(msg.chat.id, image);
    }
  }
});

// ✅ Webhook 路由（必须有 bot.processUpdate）
app.post('/webhook', (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ✅ 启动服务（Cloud Run 会注入 PORT）
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot 已启动，监听端口 ${PORT}`);
});
