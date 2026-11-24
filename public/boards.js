export const roles = {
  wolf: { name: '狼人', description: '与其他狼人合作。入夜后，狼队共同选择行动目标。' },
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

export const nightSchedules = {
  mechanical: ['guard', 'knife', 'witch', 'mechanical', 'medium', 'hunter'],
  classic: ['mixed', 'knife', 'witch', 'seer', 'hunter'],
  thief: ['thief-start', 'dreamer', 'knife', 'poisoner', 'medium', 'hunter'],
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
    preview: [...fourVillagers, ...threeWolves, 'thief', 'masked', null, null, null],
  },
};
