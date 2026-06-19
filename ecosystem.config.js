// PM2 进程配置：pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'do-or-not',
      script: 'server.js',
      instances: 1,            // SQLite 单写，保持单实例
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
