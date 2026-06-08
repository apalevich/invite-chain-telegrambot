module.exports = {
  apps: [
    {
      name: "exchange-bot",
      script: "src/index.ts",
      interpreter: process.env.HOME + "/.bun/bin/bun",
      // Config is intentionally NOT set here. Bun auto-loads `.env` at runtime,
      // and any real env var pm2 injects would OVERRIDE `.env` (Bun never
      // overrides an already-set env var). Duplicating config here silently
      // shadowed `.env` and pinned KARMA_TRIGGERS to the "обменялись" fallback.
      // Keep `.env` the single source of truth.
      error_file: "logs/err.log",
      out_file: "logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
