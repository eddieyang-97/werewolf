import { roles } from './boards.js';

const phaseTitles = {
  dawn: '等待公布昨夜信息',
  'sheriff-signup': '警长竞选',
  'sheriff-speech': '警上发言',
  'sheriff-vote': '警长投票',
  'sheriff-runoff-speech': '警长 PK 发言',
  'sheriff-runoff-vote': '警长 PK 投票',
  'last-words': '遗言',
  'death-resolution': '等待结算',
  badge: '警徽交接',
  'speech-direction': '等待警长选择发言方向',
  discussion: '讨论发言',
  nomination: '警长归票',
  'exile-open': '等待放逐投票',
  'exile-locked': '等待放逐投票',
  'exile-vote': '放逐投票',
  'exile-runoff-speech': '放逐 PK 发言',
  'exile-runoff-vote': '放逐 PK 投票',
  'next-night': '等待进入夜间',
};

const labels = {
  'self-destruct': '自爆', 'open-election': '开始警长竞选', 'publish-night': '公布昨夜信息',
  candidacy: '选择是否上警', withdraw: '退水', 'finish-speech': '结束当前发言', shoot: '猎人开枪', duel: '骑士决斗',
  badge: '交接警徽', direction: '选择发言方向', 'open-nomination': '开始警长归票', nominate: '选择归票对象',
  'open-exile': '开始放逐投票', vote: '投票', 'close-vote': '查看投票结果', 'next-night': '进入天黑阶段', rematch: '再来一局',
  'start-timer': '开始倒计时',
  'host-eliminate': '标记出局', 'host-transfer-badge': '移交警徽',
  'thief-start': '选择起手身份', guard: '守卫请睁眼', knife: '狼人请睁眼', witch: '女巫请睁眼',
  'wolf-recognition': '不击杀',
  learn: '机械狼学习身份', medium: '通灵师查验', seer: '预言家查验', dreamer: '摄梦人选择目标',
  mixed: '混血儿选择榜样', 'mechanical-guard': '机械守卫', 'mechanical-poison': '机械女巫',
  poison: '毒师请选择目标', 'extra-knife': '机械狼额外刀', 'gun-check': '查看枪态',
  charm: '狼美人选择魅惑目标', swap: '魔术师交换号码牌',
};

export function matchLabel(control) {
  if (control.kind === 'open-sheriff-vote') return '开始投票';
  if (control.kind === 'shoot' && control.role === 'wolfKing') return '狼王开枪';
  return labels[control.action ?? control.kind];
}

export function choiceLabel(value, control, seats) {
  if (control.kind === 'start-timer') return `${value}秒`;
  if (control.kind === 'direction') return value === -1 ? '左起发言' : '右起发言';
  if (control.kind === 'candidacy') return value ? '上警' : '不上警';
  if (value === null) return { vote: '弃票', shoot: '不开枪', badge: '撕毁警徽', knife: '不击杀' }[control.action ?? control.kind] ?? '跳过';
  if (value === 'power') return '神牌';
  if (value === 'common') return '村民牌';
  if (value === 'confirm') return '确认';
  if (value === 'save') return '使用解药';
  if (typeof value === 'string' && value.startsWith('poison:')) return `毒 ${choiceLabel(Number(value.slice(7)), control, seats)}`;
  return `${value}号 · ${seats[value - 1]?.name ?? ''}`;
}

export function timerText(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function exileVote(match) {
  if (match?.phase === 'exile-vote' || match?.phase === 'exile-runoff-vote') {
    return match.actions?.find(action => action.kind === 'vote');
  }
}

export function matchCommand({ matchId, window }, kind, choice) {
  return JSON.stringify({ kind, matchId, window, choice });
}

function seatList(seats) {
  return seats.length ? `${seats.join('、')}号` : '暂无';
}

function matchActionDetails(match, button, { connected, seatVote, host, nightVoiceOn, speechAvailable }) {
  const { actions = [], self = { inspections: [] } } = match;
  const activeActions = seatVote ? actions.filter(action => action !== seatVote) : actions;
  const controls = activeActions.map(entry => {
    if (entry.kind === 'candidacy') return entry.options.map(choice => button(choiceLabel(choice, entry), 'match-send', {
      value: matchCommand(match, entry.kind, choice), disabled: !connected,
    })).join('');
    const wolfRecognition = entry.action === 'wolf-recognition';
    return button(matchLabel(entry), wolfRecognition ? 'match-send' : 'match-control', {
      value: matchCommand(match, entry.kind, wolfRecognition ? entry.options[0] : undefined),
      disabled: !connected, variant: entry.kind === 'night-action' ? 'night-action' : 'primary',
    });
  });
  if (seatVote?.options.includes(null)) {
    controls.unshift(button('弃票', 'confirm-vote', { value: matchCommand(match, 'vote', null), disabled: !connected }));
  }
  if (host && match.nightNarration && speechAvailable) {
    controls.push(button(nightVoiceOn ? '关闭夜间播报' : '开启夜间播报', 'toggle-night-voice', { variant: 'quiet', disabled: !connected }));
  }
  if (host) controls.push(button('房主操作', 'manage', { variant: 'quiet', disabled: !connected }));

  const privateResults = self.inspections.map(result => `<li>第${result.round}晚 · ${result.seat}号 · ${
    result.claws ? (result.claws === 2 ? '双爪' : '单爪') : result.role ? roles[result.role].name : result.team === 'wolves' ? '狼人' : '好人'
  }</li>`).join('');
  return `
    ${self.teammates?.length ? `<p>狼队同伴：${self.teammates.join('、')}号</p>` : ''}
    ${self.disguise ? `<p>当前身份：${self.disguise === 'power' ? '神牌' : '村民牌'}</p>` : ''}
    ${self.copied ? `<p>已学习：${roles[self.copied].name}</p>` : ''}
    ${self.model ? `<p>你的榜样：${self.model}号</p>` : ''}
    ${actions.some(action => action.nightTimer) ? '<p data-night-action-clock></p>' : ''}
    ${seatVote ? '<p class="vote-instruction">请点击可投票的座位</p>' : ''}
    ${controls.length ? `<div class="match-actions">${controls.join('')}</div>` : seatVote ? '' : '<p>暂无可用操作</p>'}
    ${privateResults ? `<details><summary>我的查验记录</summary><ul>${privateResults}</ul></details>` : ''}`;
}

export function matchPanel(match, button, options) {
  const { connected, showingActions } = options;
  const { phase, round, speaker, sheriff, timer, actions = [], voteProgress } = match;
  const { electionRoster } = match;
  const finished = phase === 'finished';
  const tally = voteProgress ? `<p>已投 ${voteProgress.received} / ${voteProgress.expected}</p>` : '';
  const endings = { wolves: '狼人胜利', village: '好人胜利', abandoned: '房主已结束本局' };
  const publicInfo = phaseTitles[phase] ?? (finished ? endings[match.winner] : null);
  const cards = (match.roster ?? []).map(({ seat, role, extra, side }) => `<li>${seat}号 · ${roles[role].name}${extra ? `（${extra.map(id => roles[id].name).join('、')}）` : ''}${side === match.winner ? ' ✓' : ''}</li>`).join('');
  const nightResult = match.history.findLast(event => event.kind === 'night-result' && event.round === round);
  const results = phase !== 'night' && nightResult ? `<p>${nightResult.seats.length ? `昨夜出局：${nightResult.seats.join('、')}号` : '昨夜平安，无人出局'}</p>` : '';
  const duel = match.history.findLast(event => event.kind === 'duel' && event.round === round);
  const cue = match.nightCue;
  return `<section class="match-panel" aria-label="当前对局">
    <h2>${finished ? '对局结果' : phase === 'night' ? `第${round}晚` : `第${round}天`}</h2>
    ${cue ? `<p class="night-call"><strong>${roles[cue.role].name}请睁眼</strong></p>` : ''}
    ${publicInfo ? `<p>${publicInfo}</p>` : cue || (showingActions && actions.length) ? '' : '<p>请等待夜间操作完成</p>'}
    ${match.forced ? '<p>房主判定结果</p>' : ''}
    ${speaker ? `<p>${speaker}号正在发言</p>` : ''}
    ${electionRoster ? `<p>警上：${seatList(electionRoster.candidates)}</p>
      <p>警下：${seatList(electionRoster.voters)}</p>
      <p>已退水：${seatList(electionRoster.withdrawn)}</p>` : ''}
    ${results}${duel ? `<p>${historyText(duel)}</p>` : ''}${tally}
    ${timer ? (timer.deadline ? `<time data-match-deadline="${timer.deadline}">${timerText(timer.deadline - Date.now())}</time>`
      : `<p>${timerText(timer.remaining)}${timer.remaining ? '（暂停）' : ''}</p>`) : ''}
    ${sheriff ? `<p>${sheriff}号持有警徽</p>` : ''}
    <button type="button" class="button secondary" data-action="toggle-match-actions" aria-expanded="${showingActions}"
      aria-controls="match-action-details"${connected ? '' : ' disabled'}>${showingActions ? '隐藏操作' : '显示操作'}</button>
    <div id="match-action-details" class="match-action-details"${showingActions ? '' : ' hidden'}>${
      showingActions ? matchActionDetails(match, button, options) : ''}</div>
    ${cards ? `<ul class="match-roster">${cards}</ul>` : ''}
    ${button('对局详情', 'match-history', { variant: 'quiet' })}
  </section>`;
}

function historyText(event) {
  const seats = event.seats?.join('、');
  const label = {
    exile: '放逐', explosion: '自爆', shot: '开枪带走', departed: '出局', charmed: '因魅惑出局',
    'exile-vote': '放逐票', 'sheriff-vote': '警长票', 'host-elimination': '被房主标记出局',
  }[event.kind];
  if (event.kind === 'night-result') return seats ? `${seats}号出局` : '平安夜';
  if (event.kind === 'peaceful-day') return '无人被放逐';
  if (event.kind === 'sheriff' || event.kind === 'badge') return event.seat ? `${event.seat}号持有警徽` : '警徽流失';
  if (event.kind === 'nomination') return seats ? `警长归票：${seats}号` : '警长不归票';
  if (event.kind === 'direction') return `从${event.anchor}号${event.direction < 0 ? '左侧' : '右侧'}起发言`;
  if (event.kind === 'duel') return `骑士 ${event.seat} 号决斗 ${event.target} 号，${event.won ? event.target : event.seat} 号出局`;
  if (event.counts) return `${label}：${event.counts.map(({ seat, count }) => `${seat}号 ${count}票`).join('、') || '无有效票'}`;
  return `${event.seat}号${label}`;
}

export function matchHistory(history, button) {
  const groups = new Map();
  history.forEach((event, index) => {
    const night = event.phase === 'night' || event.kind === 'sheriff-vote';
    const key = event.round * 2 + Number(!night);
    if (!groups.has(key)) groups.set(key, { round: event.round, night, events: [] });
    groups.get(key).events.push({ event, index });
  });
  const rows = [...groups].sort(([a], [b]) => a - b).map(([, { round, night, events }]) => {
    const summary = events.filter(({ event }) => !event.ballot);
    const ballots = events.filter(({ event }) => event.ballot);
    const results = summary.map(({ event }) => `<li>${historyText(event)}</li>`).join('');
    const details = ballots.map(({ event, index }) => {
      const label = event.kind === 'sheriff-vote' ? (event.runoff ? '警长 PK 票型' : '警长票型') : (event.runoff ? '查看 PK 票型' : '查看票型');
      return button(label, 'vote-detail', { value: index });
    }).join('');
    return `<section class="match-history-row">
      <span class="history-icon" aria-hidden="true">${night ? '☾' : '☀'}</span>
      <ul class="match-history">${results || '<li>警长竞选</li>'}</ul>
      <div class="history-stage"><h2>第${round}${night ? '晚' : '天'}</h2>${details}</div>
    </section>`;
  }).join('');
  return `<h1 class="screen-reader-only">对局详情</h1><p class="history-heading">所有阶段信息</p>${rows || '<p>暂无已公布的对局信息。</p>'}`;
}

export function voteDetail(event, button) {
  const { groups, abstained } = event.ballot;
  const rows = groups.map(({ seat, count, voters }) => `<li>${voters.join(',')} 投给 <span>${seat}号 [${count}票]</span></li>`).join('');
  return `<div class="ballot-detail"><h3>投票结果</h3><ul>${rows}${abstained.length ? `<li>${abstained.join(',')}号弃票</li>` : ''}${!rows && !abstained.length ? '<li>无有效票</li>' : ''}</ul></div>
    ${button('我知道了', 'close', { variant: 'identity-accept' })}`;
}
