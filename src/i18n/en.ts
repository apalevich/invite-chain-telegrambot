export const en = {
  "profile.joined": "User joined on {date}",
  "profile.chain": "Invitation chain: {chain}",
  "profile.karma": "Karma: {karma}",
  "profile.footer": "Experience a problem? Contact {contact}",

  "error.no_record": "I have no record of this user.",
  "error.forward_hidden": "This person hides their forwarded-message identity, so I can't look them up.",
  "error.not_member": "I don't recognize you. Support: {contact}",

  "language.select": "Choose your language:",
  "language.changed": "Language changed to {language}.",

  "karma.credited": "Exchanged! Both {user1} and {user2} earned +1 karma.",
  "karma.undo_forbidden": "Only {admin} can undo an exchange.",
  "karma.undo_success": "Undo: karma reverted for {user1} and {user2}.",
  "karma.undo_already_done": "This exchange was already undone.",
} as const;

export type EnLocaleKey = keyof typeof en;
