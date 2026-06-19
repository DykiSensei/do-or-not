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
    mode       TEXT    NOT NULL DEFAULT 'spin', -- 'spin' 轮盘随机 / 'manual' 手动选择
    photo      TEXT,                            -- 打卡照片 /uploads/xxx，可为空
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, day),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_decisions_day ON decisions(day);

  CREATE TABLE IF NOT EXISTS comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    decision_id INTEGER NOT NULL,                -- 评论挂在哪条打卡(决定)下
    user_id     INTEGER NOT NULL,                -- 谁评论的
    body        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    FOREIGN KEY(decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_comments_decision ON comments(decision_id);
`);

// 迁移：给老库的 decisions 表补上 mode / photo 列（已部署的实例升级用）
const decisionCols = db.prepare('PRAGMA table_info(decisions)').all().map((c) => c.name);
if (!decisionCols.includes('mode')) {
  db.exec("ALTER TABLE decisions ADD COLUMN mode TEXT NOT NULL DEFAULT 'spin'");
}
if (!decisionCols.includes('photo')) {
  db.exec('ALTER TABLE decisions ADD COLUMN photo TEXT');
}

module.exports = db;
