export const roles = {
  wolf: {
    name: '狼人', description: '狼人阵营。夜里和同伴商量刀谁，任一有刀权的狼人可提交本夜刀口。',
    notes: ['白天有自爆机会时，可在对局操作里选择「自爆」。'],
  },
  wolfKing: {
    name: '狼王', art: 'wolf-king', description: '狼人阵营。与小狼共用狼刀。被放逐或被骑士决斗击杀后，如果对局继续，可以开枪带走一名玩家。',
    notes: ['普通狼刀不能选择狼王。', '自爆、被毒、被梦或被枪带走时没有枪权。'],
  },
  wolfBeauty: {
    name: '狼美人', art: 'wolf-beauty', description: '狼人阵营。先和狼队一起行动，再单独魅惑一名其他玩家。你出局时，被魅惑的玩家也会出局。',
    notes: ['不能自爆，普通狼刀也不能选择你。', '连续两晚不能选同一个座位。被骑士决斗击杀时，魅惑失效。'],
  },
  mechanical: {
    name: '机械狼', description: '狼人阵营。独立于小狼行动。整局可以学习一名玩家的身份一次，学到可用技能后，通常从下一晚起使用。',
    notes: ['某个夜晚开始时，如果小狼已全部出局，则由你使用普通狼刀。', '学习前，通灵师看到双爪。学习后，结果按学到的身份结算。', '学到猎人时，最早从学习后的白天起有枪权。学到女巫时获得一瓶毒药。机械守护可以把女巫的毒反弹给她。'],
  },
  thief: { name: '盗宝大师', art: 'mechanical', description: '持有狼、神、民三张牌。正式对局开始后，按规则在神、民身份之间切换。' },
  villager: { name: '村民', description: '好人阵营，属于民边。夜里没有主动技能，白天通过发言和投票找出狼人。' },
  medium: {
    name: '通灵师', description: '好人阵营，神职。每晚私下查验一名其他玩家，获得身份或狼爪结果。',
    notes: ['机械狼学习后按学到的身份查验。盗宝大师按查验时的变身身份结算。'],
  },
  witch: {
    name: '女巫', description: '好人阵营，神职。有一瓶解药和一瓶毒药。解药用于当夜的普通狼刀目标，毒药可以选择一名玩家。',
    notes: ['每晚最多用一瓶药。能否自救由本局配置决定。解药用掉后，夜间不再显示狼刀目标。'],
  },
  guard: {
    name: '守卫', description: '好人阵营，神职。每晚可以守护一名玩家，挡住普通狼刀。可以自守或空守，不能连续两夜选同一人。',
    notes: ['守护挡不住毒药。如果守护与解药同时作用于狼刀目标，该玩家出局。'],
  },
  hunter: {
    name: '猎人', description: '好人阵营，神职。因普通狼刀、同守同救或放逐出局时，如果对局继续，可以选择开枪带走一名玩家。',
    notes: ['可以在夜间查看枪态。被毒、被梦或被枪带走时没有枪权。'],
  },
  seer: {
    name: '预言家', description: '好人阵营，神职。每晚查验一名其他玩家，只有你能看到结果。',
    notes: ['查验显示「好人」或「狼人」。混血儿显示为好人。'],
  },
  fool: {
    name: '白痴', description: '好人阵营，神职。本局被放逐时立即离场，算作神边出局。',
    notes: ['按日间放逐流程结算遗言。狼人无需在夜间补刀。'],
  },
  mixed: {
    name: '混血儿', description: '首夜选择一名其他玩家作为榜样。榜样的原始阵营获胜时，你也获胜。',
    notes: ['屠边时属于民边。预言家查验和骑士决斗都按好人身份结算。'],
  },
  magician: {
    name: '魔术师', description: '好人阵营，神职。每晚最先行动，可交换两名玩家的号码牌。当晚针对号码的技能和查验会转到交换后的玩家身上。',
    notes: ['可以交换自己的号码，也可以跳过。每个座位全局只能参与一次交换。', '例如交换 2 号和 5 号后，狼人选择刀 2 号，女巫看到的仍是 2 号，实际受刀的是 5 号。'],
  },
  knight: {
    name: '骑士', description: '好人阵营，神职。警长竞选结束后，可在白天发言或归票阶段公开决斗一次。无警徽的房间同样可以决斗。',
    notes: ['选中狼人：对方出局，完成相关结算后直接进入下一夜。狼王可能开枪，狼美人不会触发魅惑。', '选中好人：你出局并有遗言，白天流程照常继续。PK 和投票时不能决斗。'],
  },
  poisoner: { name: '毒师', description: '持有一瓶毒药。' },
  dreamer: {
    name: '摄梦人', description: '好人阵营，神职。夜间可以让一名其他玩家入梦，当夜抵挡普通狼刀和毒药。',
    notes: ['连续两次摄梦落在同一人身上，该玩家出局。你在夜里死亡时，也会带走当夜的梦中人。', '因梦出局的猎人和狼王不能开枪。'],
  },
  masked: { name: '蒙面人', description: '夜间受到致死效果时，正式离场可以延迟到次日。' },
};

export const thiefDraw = ['poisoner', 'dreamer', 'hunter', 'medium'];

export const presetSeatCount = 12;
export const customBoardName = '自定义配置';
export const defaultSheriffMode = 'double';
export const sheriffModes = { double: '双爆吞警徽', single: '单爆吞警徽', none: '无警徽' };
export const customRuleOptions = {
  victoryMode: { side: '屠边', town: '屠城' },
  firstNightKnife: { enabled: '首夜有刀', disabled: '首夜无刀' },
  witchSelfSave: { forbidden: '不能自救', allowed: '可以自救' },
};
export const defaultCustomRules = { victoryMode: 'side', firstNightKnife: 'enabled', witchSelfSave: 'forbidden' };
export const customRoleGroups = {
  wolves: ['wolf', 'wolfKing', 'wolfBeauty'],
  village: ['villager', 'seer', 'witch', 'hunter', 'fool', 'guard', 'medium', 'dreamer', 'magician', 'knight', 'poisoner', 'masked'],
  other: ['mixed'],
};
export const customRoles = Object.values(customRoleGroups).flat();

export function repeatableRole(role) {
  return role === 'wolf' || role === 'villager';
}

export function customLineupError(lineup, victoryMode = defaultCustomRules.victoryMode) {
  if (!Array.isArray(lineup)) return '请选择自定义角色。';
  if (lineup.length < 3) return '自定义配置至少需要 3 人。';
  if (lineup.length > presetSeatCount) return `自定义配置最多支持 ${presetSeatCount} 人。`;
  const counts = new Set();
  for (const role of lineup) {
    if (!customRoles.includes(role)) return '配置中有不支持的角色。';
    if (counts.has(role) && !repeatableRole(role)) return '特殊角色每种只能选一张。';
    counts.add(role);
  }
  if (counts.has('guard') && counts.has('dreamer')) return '守卫和摄梦人不能同时入局。';
  const hasWolf = customRoleGroups.wolves.some(role => counts.has(role));
  const hasGod = customRoleGroups.village.some(role => role !== 'villager' && counts.has(role));
  const hasVillager = counts.has('villager') || counts.has('mixed');
  if (victoryMode === 'town') {
    if (!hasWolf || !(hasGod || hasVillager)) return '屠城至少需要一张狼牌和一张好人牌。';
  } else if (!hasWolf || !hasGod || !hasVillager) {
    return '屠边至少需要一张狼牌、一张神牌和一张民牌。';
  }
  return '';
}

export const nightSchedules = {
  mechanical: ['guard', 'knife', 'witch', 'mechanical', 'medium', 'hunter'],
  classic: ['mixed', 'knife', 'witch', 'seer', 'hunter'],
  thief: ['thief-start', 'dreamer', 'knife', 'poisoner', 'medium', 'hunter'],
  custom: ['magician', 'mixed', 'guard', 'dreamer', 'knife', 'wolfBeauty', 'witch', 'poisoner', 'seer', 'medium', 'hunter'],
};

const fourVillagers = ['villager', 'villager', 'villager', 'villager'];
const threeWolves = ['wolf', 'wolf', 'wolf'];

export const boards = {
  mechanical: {
    name: '机械狼通灵师',
    preview: [...fourVillagers, ...threeWolves, 'mechanical', 'medium', 'witch', 'guard', 'hunter'],
  },
  classic: {
    name: '预女猎白混',
    preview: [...fourVillagers.slice(0, 3), 'mixed', ...threeWolves, 'wolf', 'seer', 'witch', 'hunter', 'fool'],
  },
  thief: {
    name: '盗宝大师',
    preview: [...fourVillagers, 'wolf', 'wolf', 'wolfKing', 'thief', 'masked', null, null, null],
  },
};
