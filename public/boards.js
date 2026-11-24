export const roles = {
  wolf: { name: '狼人', mark: '狼', side: 'wolf', description: '与其他狼人合作。入夜后，狼队共同选择行动目标。' },
  mechanical: { name: '机械狼', mark: '械', side: 'wolf', description: '可以学习一名玩家的身份，并按本局规则使用对应能力。' },
  thief: { name: '盗宝大师', mark: '械', side: 'wolf', description: '持有狼、神、民三张牌。正式对局开始后，按规则在神、民身份之间切换。' },
  villager: { name: '村民', mark: '民', side: 'village', description: '通过白天的讨论和投票帮助好人找出狼人。' },
  medium: { name: '通灵师', mark: '灵', side: 'power', description: '夜间查验一名玩家，按本板子的规则获得身份结果。' },
  witch: { name: '女巫', mark: '巫', side: 'power', description: '持有解药和毒药，按本局规则选择使用。' },
  guard: { name: '守卫', mark: '卫', side: 'power', description: '夜间可守护一名玩家。不能连续两夜守护同一名玩家。' },
  hunter: { name: '猎人', mark: '猎', side: 'power', description: '因符合规则的原因出局时，可按结算顺序选择是否开枪。' },
  seer: { name: '预言家', mark: '验', side: 'power', description: '夜间可查验一名玩家，私下得知查验结果。' },
  fool: { name: '白痴／白神', mark: '白', side: 'power', description: '被放逐时，按本板子的白神规则处理。此时已计作离开神边。' },
  mixed: { name: '混血儿', mark: '混', side: 'village', description: '首夜选择一名榜样，跟随其胜利阵营。屠边计算时归入民边。' },
  poisoner: { name: '毒师', mark: '毒', side: 'power', description: '持有一瓶毒药。' },
  dreamer: { name: '摄梦人', mark: '梦', side: 'power', description: '夜间可使一名其他玩家入梦。梦中目标的保护和死亡按本局规则结算。' },
  masked: { name: '蒙面人', mark: '面', side: 'power', description: '夜间受到致死效果时，正式离场可以延迟到次日。' },
};

export const thiefDraw = ['poisoner', 'dreamer', 'hunter', 'medium'];

export const boards = {
  mechanical: { name: '机械狼通灵师', wolves: '3 小狼、1 机械狼', powers: '通灵师、女巫、守卫、猎人', villagers: '4 村民', preview: ['wolf', 'mechanical', 'medium', 'witch', 'guard', 'hunter', 'villager'] },
  classic: { name: '预女猎白混', wolves: '4 狼人', powers: '预言家、女巫、猎人、白痴／白神', villagers: '3 村民、1 混血儿', preview: ['wolf', 'seer', 'witch', 'hunter', 'fool', 'villager', 'mixed'] },
  thief: { name: '盗宝大师', wolves: '3 小狼、1 盗宝大师', powers: '蒙面人及未被盗宝大师抽中的 3 张神牌', villagers: '4 村民', preview: ['wolf', 'thief', 'masked', ...thiefDraw, 'villager'] },
};
