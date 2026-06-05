module.exports = {
  apps: [
    {
      name: "exchange-bot",
      script: "src/index.ts",
      interpreter: process.env.HOME + "/.bun/bin/bun",
      env: {
        NODE_ENV: "production",
        BOT_TOKEN: process.env.BOT_TOKEN,
        GROUP_CHAT_ID: process.env.GROUP_CHAT_ID,
        DB_PATH: process.env.DB_PATH || "./data/bot.sqlite",
        KARMA_TRIGGERS: process.env.KARMA_TRIGGERS || "обменялись",
        KARMA_DEDUP_HOURS: process.env.KARMA_DEDUP_HOURS || "24",
        KARMA_ANNOUNCE: process.env.KARMA_ANNOUNCE || "false",
        DEFAULT_LANGUAGE: process.env.DEFAULT_LANGUAGE || "en",
        SUPPORT_CONTACT: process.env.SUPPORT_CONTACT || "@apalevich",
      },
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
