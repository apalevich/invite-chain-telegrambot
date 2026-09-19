export const ru = {
  "profile.joined": "Пользователь присоединился {date}",
  "profile.chain": "Цепочка приглашений: {chain}",
  "profile.karma": "Карма: {karma}",
  "profile.footer": "Проблема? Свяжитесь с {contact}",

  "error.no_record": "У меня нет записи об этом пользователе.",
  "error.forward_hidden": "Этот человек скрывает свою личность при пересылке, поэтому я не могу его найти.",
  "error.not_member": "Я вас не знаю. Поддержка: {contact}",

  "language.select": "Выберите язык:",
  "language.changed": "Язык изменён на {language}.",

  "karma.credited": "Обменялись! {user1} и {user2} получили по +1 карме.",
  "karma.undo_forbidden": "Отменить обмен может только {admin}.",
  "karma.undo_success": "Отменено: карма списана у {user1} и {user2}.",
  "karma.undo_already_done": "Этот обмен уже был отменён.",
} as const;

export type RuLocaleKey = keyof typeof ru;
