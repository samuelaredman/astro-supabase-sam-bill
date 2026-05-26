export type EmojiCategory = { label: string; emojis: string[] };

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    label: 'Reactions',
    emojis: ['😂','😭','😍','🤩','😤','😠','😱','🤯','😴','🤔','🙃','😎','😬','🤡','💀','🥹','😏','🥱','🫠','🤦'],
  },
  {
    label: 'Hands & Hearts',
    emojis: ['👍','👎','👏','🙌','🤝','🫶','❤️','💯','💪','🤌','👌','🤙','✌️','🤞','💔','🖤','🤍','🫂','🙏','✋'],
  },
  {
    label: 'Gaming',
    emojis: ['🎮','🕹️','👾','🏆','🥇','🎯','💣','⚔️','🛡️','🧙','🐉','👻','🤖','💥','🎲','🏅','🎭','🚀','⚡','🌟'],
  },
  {
    label: 'Objects & Nature',
    emojis: ['🔥','💎','💰','💵','💸','🔮','🧩','📝','🔑','👁️','🎵','🍿','☕','🌈','🌙','❄️','🌊','🦋','🦊','🐸'],
  },
  {
    label: 'Symbols',
    emojis: ['✅','❌','⭐','💫','❓','❗','💤','🎉','🎊','🚩','♾️','🔁','☠️','💢','👀','🫡','💡','🏳️','🔴','🟢'],
  },
];

export type ImageEmote = { key: string; path: string };

export const IMAGE_EMOTES: ImageEmote[] = [
  { key: '5Head',        path: '/emotes/5Head.webp' },
  { key: 'catJam',       path: '/emotes/catJam.webp' },
  { key: 'Clap',         path: '/emotes/Clap.webp' },
  { key: 'COPIUM',       path: '/emotes/COPIUM.webp' },
  { key: 'ddHuh',        path: '/emotes/ddHuh.webp' },
  { key: 'DonoWall',     path: '/emotes/DonoWall.webp' },
  { key: 'EZ',           path: '/emotes/EZ.webp' },
  { key: 'gachiBASS',    path: '/emotes/gachiBASS.webp' },
  { key: 'gachiHyper',   path: '/emotes/gachiHyper.webp' },
  { key: 'GIGACHAD',     path: '/emotes/GIGACHAD.webp' },
  { key: 'KEKW',         path: '/emotes/KEKW.webp' },
  { key: 'LULW',         path: '/emotes/LULW.webp' },
  { key: 'MLADY',        path: '/emotes/MLADY.webp' },
  { key: 'monkaW',       path: '/emotes/monkaW.webp' },
  { key: 'MonkaS',       path: '/emotes/MonkaS.webp' },
  { key: 'NODDERS',      path: '/emotes/NODDERS.webp' },
  { key: 'NOPERS',       path: '/emotes/NOPERS.webp' },
  { key: 'OMEGALUL',     path: '/emotes/OMEGALUL.webp' },
  { key: 'OOOO',         path: '/emotes/OOOO.webp' },
  { key: 'PartyKirby',   path: '/emotes/PartyKirby.webp' },
  { key: 'peepoClap',    path: '/emotes/peepoClap.webp' },
  { key: 'peepoLeave',   path: '/emotes/peepoLeave.webp' },
  { key: 'PeepoNoob',    path: '/emotes/PeepoNoob.webp' },
  { key: 'pepeD',        path: '/emotes/pepeD.webp' },
  { key: 'PepeHands',    path: '/emotes/PepeHands.webp' },
  { key: 'pepeJAM',      path: '/emotes/pepeJAM.webp' },
  { key: 'PepeLaugh',    path: '/emotes/PepeLaugh.webp' },
  { key: 'Pepega',       path: '/emotes/Pepega.webp' },
  { key: 'PepegaCredit', path: '/emotes/PepegaCredit.webp' },
  { key: 'POGGERS',      path: '/emotes/POGGERS.webp' },
  { key: 'Sadge',        path: '/emotes/Sadge.webp' },
];

export const IMAGE_EMOTE_MAP: Record<string, string> = Object.fromEntries(
  IMAGE_EMOTES.map(e => [e.key, e.path])
);

