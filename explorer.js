const board = document.querySelector('#board');
const panel = document.querySelector('#panel');
const title = document.querySelector('#title');
const body = document.querySelector('#body');

const blocks = [1284334, 1284335, 1284336, 1284337].map(height => ({
  name: height.toLocaleString('en-US'),
  type: 'Block',
  fields: { Height: height, Status: 'Finalized' },
}));

const validators = ['V-0419', 'V-0427', 'V-0451', 'V-0472'].map((id, index) => ({
  name: id,
  type: 'Validator',
  fields: { Node: index + 1, Status: 'Online' },
}));

const transactions = [
  ['Transfer', '0x8f3e…9d21', 'qatt1…7k3m', 'qatt1…p9fz', '125 QRC'],
  ['PoCD Reward', '0x4b7c…2a91', 'system', 'qatt1…m2xv', '512 QRC'],
  ['Stake', '0x91d2…e7f0', 'qatt1…k8nd', 'V-0427', '1,000 QCB'],
  ['Identity', '0x3aa9…c4be', 'qatt1…z9tp', 'DIS Update', '—'],
  ['Compute', '0x77e1…b2d4', 'qatt1…f5qm', 'PoCD Task #88231', '—'],
].map(([kind, hash, from, to, amount]) => ({
  name: hash,
  type: 'Transaction',
  fields: { Kind: kind, Hash: hash, From: from, To: to, Amount: amount, Status: 'Finalized' },
}));

const sections = {
  Blocks: blocks,
  Transactions: transactions,
  Validators: validators,
  'Recent Activity': transactions,
  'Validator Activity': validators,
  'Block Stream': blocks,
  Network: validators,
};

const metrics = {
  'Chain Height': { Height: '1,284,337', 'Last minute': '+128' },
  'Finality Time': { 'Average over last 1,000 blocks': '2.31 s' },
  'TPS (Live)': { 'Transactions per second': '4,728', Change: '+7.4%' },
  Consensus: { Round: '#3,918,552', Leader: 'V-0427', Phase: 'Finalize', Quorum: 'Present' },
  'Identity (DIS)': { 'Verified identities': '911,482', 'Attestations (24h)': '4,921' },
  'Computation (PoCD)': { 'Validator computation': '12.6 PFLOPS', Status: 'Active' },
  Economics: { 'QCB fixed supply': '10,000,000 QCB', 'QRC circulating supply': '3,862,417.53 QRC' },
  'Post-Quantum Security': { 'Signature scheme': 'ML-DSA-65 (FIPS 204)', Profile: 'qattice-v2' },
  'Chain Info': { Network: 'Qattice Devnet', 'Chain ID': 'qattice-1', Version: 'v0.1.0-phase0' },
  Analytics: { 'Average latency': '42 ms', 'Block propagation': '186 ms', Uptime: '100%' },
  'Network Map': { Nodes: '4', Regions: '3', Health: '100%' },
  Notifications: { Status: 'No notifications in the reference snapshot' },
};

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function show(name) {
  title.textContent = name;
  body.replaceChildren();
  if (!panel.open) panel.showModal();
}

function detail(name, fields, back) {
  show(name);
  if (back) {
    const button = element('button', '← Back', 'result back');
    button.addEventListener('click', back);
    body.append(button);
    button.focus();
  }
  const list = element('dl');
  for (const [key, value] of Object.entries(fields)) {
    list.append(element('dt', key), element('dd', String(value)));
  }
  body.append(list);
}

function browse(name, records) {
  show(name);
  const input = element('input', '', 'search');
  input.type = 'search';
  input.placeholder = 'Filter by height, hash, address or validator';
  input.setAttribute('aria-label', input.placeholder);
  const results = element('div');
  results.setAttribute('aria-live', 'polite');
  body.append(input, results);

  function render() {
    const normalize = value => value.toLowerCase().replaceAll(',', '');
    const query = normalize(input.value.trim());
    const matches = records.filter(record => normalize([
      record.name, record.type, ...Object.values(record.fields),
    ].join(' ')).includes(query));
    results.replaceChildren();
    for (const record of matches) {
      const button = element('button', record.name, 'result');
      button.append(element('small', record.type));
      button.addEventListener('click', () => detail(record.name, record.fields, () => {
        body.replaceChildren(input, results);
        title.textContent = name;
        button.focus();
      }));
      results.append(button);
    }
    if (!matches.length) results.append(element('p', 'No matching sample records.'));
  }

  input.addEventListener('input', render);
  render();
  input.focus();
}

function zone(label, x, y, width, height, action) {
  const button = element('button', '', 'zone');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  for (const [property, value, total] of [
    ['left', x, 1050], ['top', y, 591], ['width', width, 1050], ['height', height, 591],
  ]) button.style[property] = `${value / total * 100}%`;
  button.addEventListener('click', action || (() => {
    if (sections[label]) browse(label, sections[label]);
    else detail(label, metrics[label]);
  }));
  board.append(button);
}

const search = () => browse('Search', [...blocks, ...transactions, ...validators]);
const chain = () => detail('Chain Info', metrics['Chain Info']);
const consensus = () => detail('Consensus', metrics.Consensus);
const economics = () => detail('Economics', metrics.Economics);
const dashboard = () => board.scrollIntoView({ block: 'start' });

[
  ['Explorer', 237, 9, 60, 27, dashboard],
  ['Analytics', 298, 9, 46, 27],
  ['Consensus', 344, 9, 58, 27],
  ['Validators', 402, 9, 50, 27],
  ['Identity (DIS)', 452, 9, 62, 27],
  ['Computation (PoCD)', 514, 9, 91, 27],
  ['Economics', 605, 9, 56, 27],
  ['Network', 661, 9, 51, 27],
  ['Search', 728, 9, 211, 27, search],
  ['Notifications', 949, 8, 31, 29],
  ['Dashboard', 7, 58, 132, 28, dashboard],
  ['Blocks', 8, 90, 130, 26],
  ['Transactions', 8, 117, 130, 27],
  ['Validators', 8, 144, 130, 27],
  ['Consensus', 8, 171, 130, 32],
  ['Identity (DIS)', 8, 204, 130, 27],
  ['Computation (PoCD)', 8, 231, 130, 28],
  ['Economics', 8, 259, 130, 27],
  ['Network', 8, 286, 130, 27],
  ['Analytics', 8, 313, 130, 27],
  ['Chain Info', 8, 340, 130, 29],
  ['Qattice Devnet', 9, 399, 128, 25, chain],
  ['Network health', 8, 442, 134, 124, () => browse('Network', validators)],
  ['Chain Height', 152, 58, 149, 55],
  ['Finality Time', 309, 58, 145, 55],
  ['TPS (Live)', 462, 58, 128, 55],
  ['Active Validators', 598, 58, 149, 55, () => browse('Validators', validators)],
  ['Total QCB', 755, 58, 144, 55, economics],
  ['QRC Supply', 907, 58, 137, 55, economics],
  ['Network Overview', 152, 122, 283, 152, () => browse('Network', validators)],
  ['Consensus', 444, 122, 297, 152],
  ['Block Stream', 750, 122, 295, 27],
  ['Post-Quantum Security', 152, 280, 216, 112],
  ['Identity (DIS)', 375, 280, 209, 112],
  ['Computation (PoCD)', 591, 280, 215, 112],
  ['Economics', 813, 280, 231, 112],
  ['Recent Activity', 160, 405, 102, 26],
  ['Blocks', 266, 405, 64, 26],
  ['Transactions', 331, 405, 87, 26],
  ['Validator Activity', 419, 405, 96, 26],
  ['Consensus Events', 516, 405, 119, 26, consensus],
  ['Network Topology & Node Health', 650, 402, 260, 167, () => browse('Network', validators)],
  ['Network Map', 918, 402, 126, 167],
].forEach(args => zone(...args));

blocks.forEach((block, index) => {
  zone(`Block ${block.name}`, [766, 838, 903, 975][index], 157, 59, 73,
    () => detail(`Block ${block.name}`, block.fields));
});

transactions.forEach((record, index) => {
  zone(`Transaction ${record.name}`, 160, 456 + 21 * index, 474, 21,
    () => detail(record.name, record.fields));
});

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    search();
  }
});
