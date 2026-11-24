export const roles = {
  wolf: { name: '狼人', description: '与其他狼人合作。入夜后，狼队共同选择行动目标。' },
  wolfKing: { name: '狼王', art: 'wolf-king', description: '与小狼一起行动。白天被放逐后，若对局仍在进行，可开枪带走一名玩家。自爆、被毒、被梦或被枪带走时不能开枪。狼队的普通狼刀不能选择你。' },
  mechanical: { name: '机械狼', description: '可以学习一名玩家的身份，并按本局规则使用对应能力。' },
  thief: { name: '盗宝大师', art: 'mechanical', description: '持有狼、神、民三张牌。正式对局开始后，按规则在神、民身份之间切换。' },
  villager: { name: '村民', description: '通过白天的讨论和投票帮助好人找出狼人。' },
  medium: { name: '通灵师', description: '夜间查验一名玩家，按本板子的规则获得身份结果。' },
  witch: { name: '女巫', description: '持有解药和毒药，按本局规则选择使用。' },
  guard: { name: '守卫', description: '夜间可守护一名玩家。不能连续两夜守护同一名玩家。' },
  hunter: { name: '猎人', description: '因符合规则的原因出局时，可按结算顺序选择是否开枪。' },
  seer: { name: '预言家', description: '夜间可查验一名玩家，私下得知查验结果。' },
  fool: { name: '白痴', description: '被放逐时，按本板子的白神规则处理。此时已计作离开神边。' },
  mixed: { name: '混血儿', description: '首夜选择一名榜样，跟随其胜利阵营。屠边计算时归入民边。' },
  poisoner: { name: '毒师', description: '持有一瓶毒药。' },
  dreamer: { name: '摄梦人', description: '夜间可使一名其他玩家入梦。梦中目标的保护和死亡按本局规则结算。' },
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
  wolves: ['wolf', 'wolfKing'],
  village: ['villager', 'seer', 'witch', 'hunter', 'fool', 'guard', 'medium', 'dreamer', 'poisoner', 'masked'],
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
  custom: ['mixed', 'guard', 'dreamer', 'knife', 'witch', 'poisoner', 'seer', 'medium', 'hunter'],
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
