const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// 数据库文件放在 data/ 目录，部署时记得持久化这个目录
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    nickname      TEXT    NOT NULL,
    avatar        TEXT,                         -- /uploads/xxx.png，可为空用默认头像
    verified      INTEGER NOT NULL DEFAULT 0,   -- 0 未验证 1 已验证
    verify_token  TEXT,
    verify_expires INTEGER,                     -- 毫秒时间戳
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    day        TEXT    NOT NULL,                -- 本地日期 YYYY-MM-DD
    result     TEXT    NOT NULL,               -- 'lu' 撸 / 'bulu' 不撸
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, day),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_decisions_day ON decisions(day);
`);

module.exports = db;
