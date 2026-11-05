const board = document.querySelector('#board');
const panel = document.querySelector('#panel');
const title = document.querySelector('#title');
const body = document.querySelector('#body');

const blocks = [1284337, 1284336, 1284335, 1284334].map(height => ({
  name: '#' + height.toLocaleString('en-US'), type: 'Block',
  fields: {Height: String(height), Status: 'Finalized', Network: 'Qattice Devnet'}
}));
const transactions = [
  ['Transfer','0x8f3e…9d21','qatt1…7k3m','qatt1…p9fz','125.0000 QRC','0.0050'],
  ['PoCD Reward','0x4b7c…2a91','system','qatt1…m2xv','512.0000 QRC','0.0000'],
  ['Stake','0x91d2…e7f0','qatt1…k8nd','V-0427','1,000.0000 QCB','0.0100'],
  ['Identity','0x3aa9…c4be','qatt1…z9tp','DIS Update','—','0.0150'],
  ['Compute','0x77e1…b2d4','qatt1…f5qm','PoCD Task #88231','—','0.0080']
].map(([kind,name,from,to,amount,fee]) => ({
  name, type: 'Transaction', fields: {Type:kind, From:from, To:to, Amount:amount,'Fee (QRC)':fee,Status:'Finalized'}
}));
const validators = ['V-0419','V-0427','V-0451','V-0472'].map((name,i) => ({
  name,type:'Validator',fields:{Node:'Node '+(i+1),Status:'Online'}
}));
const accounts = [...new Set(transactions.flatMap(t => [t.fields.From,t.fields.To]).filter(id => id.startsWith('qatt1')))]
  .map(name => ({name,type:'Account',fields:{Address:name,Activity:transactions.filter(t=>[t.fields.From,t.fields.To].includes(name)).map(t=>t.name).join(', ')}}));
const consensus = {'Current leader':'V-0427',Round:'3,918,552',Phase:'Finalize',Quorum:'Present','Voting power':'70.3% / 66.7%'};
const sections = {
  'Blocks':blocks, 'Transactions':transactions, 'Validators':validators, 'Validator Activity':validators,
  'Recent Activity':transactions, 'Consensus':consensus, 'Consensus Events':consensus,
  'Identity (DIS)':{'Verified identities':'911,482','Attestations (24h)':'4,921','Sybil resistance':'Active'},
  'Computation (PoCD)':{'Validator computation':'12.6 PFLOPS',Status:'Active'},
  'Economics':{'Total QCB':'10,000,000','QRC supply':'3,862,417.53','Demurrage (APR)':'2.00%'},
  'Network':{'Online nodes':'4 / 4','Average latency':'42 ms','Block propagation':'186 ms','Uptime (24h)':'100%'},
  'Analytics':{'Finality':'2.31 s','TPS':'4,728','Height':'1,284,337'},
  'Chain Info':{'Chain ID':'qattice-1',Profile:'qattice-v2',Version:'v0.1.0-phase0'},
  'Post-Quantum Security':{'Signature scheme':'ML-DSA-65 (FIPS 204)','Signing profile':'qattice-v2','Verified transactions':'1,284,337','Key rotations':'12'},
  'Notifications':{Status:'No new snapshot notifications'},
  'Settings':{Network:'Qattice Devnet',Mode:'Reference snapshot'},
  'Profile':{Session:'Explorer visitor'},
  'Network Selection':{Selected:'Qattice Devnet'}
};

function element(tag, value, className) {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  return node;
}
function open(label) {
  title.textContent = label;
  body.replaceChildren();
  if (!panel.open) panel.showModal();
}
function fields(values) {
  const list = element('dl','');
  for (const [label,value] of Object.entries(values)) list.append(element('dt',label),element('dd',value));
  body.append(list);
}
function detail(record, back) {
  open(record.type + ' ' + record.name);
  if (back) {
    const button = element('button','← Back','close back');
    button.onclick = back;
    body.append(button);
    button.focus();
  }
  fields(record.fields);
}
function results(container, records, back) {
  container.replaceChildren();
  for (const record of records) {
    const button = element('button',record.name,'result');
    button.append(element('small',record.type));
    button.onclick = () => detail(record,back);
    container.append(button);
  }
  if (!records.length) container.append(element('p','No matching records in this snapshot.'));
}
function section(name) {
  if (name === 'Dashboard') { if (panel.open) panel.close(); return; }
  open(name);
  const data = sections[name];
  if (Array.isArray(data)) results(body,data,() => section(name));
  else fields(data);
}
function search(query = '') {
  open('Search Qattice');
  const input = element('input','','search');
  input.type = 'search';
  input.placeholder = 'Search blocks, transactions, accounts or validators';
  input.setAttribute('aria-label',input.placeholder);
  input.value = query;
  const matches = element('div','');
  matches.setAttribute('aria-live','polite');
  body.append(input,matches);
  const update = () => {
    const term = input.value.trim().toLowerCase().replace(/[,#]/g,'').replaceAll('...','…');
    const records = [...blocks,...transactions,...accounts,...validators];
    results(matches,records.filter(r=>[r.name,r.type,...Object.values(r.fields)]
      .some(v=>v.toLowerCase().replace(/[,#]/g,'').includes(term))),() => search(input.value));
  };
  input.addEventListener('input',update);
  update();
  input.focus();
}
function zone(label,x,y,w,h,action=()=>section(label)) {
  const button = element('button',label,'zone');
  button.style.cssText = 'left:'+x/16.72+'%;top:'+y/9.41+'%;width:'+w/16.72+'%;height:'+h/9.41+'%';
  button.onclick = action;
  board.append(button);
}
const sidebar = [
  ['Dashboard',93,44],['Blocks',143,40],['Transactions',187,40],['Validators',230,41],
  ['Consensus',274,46],['Identity (DIS)',325,42],['Computation (PoCD)',370,41],
  ['Economics',414,39],['Network',456,40],['Analytics',500,40],['Chain Info',545,43]
];
sidebar.forEach(([label,y,h])=>zone(label,12,y,208,h));
const nav = [
  ['Dashboard',378,94],['Analytics',474,76],['Consensus',550,86],['Validators',636,83],
  ['Identity (DIS)',719,104],['Computation (PoCD)',823,145],['Economics',968,85],['Network',1053,80]
];
nav.forEach(([label,x,w])=>zone(label,x,16,w,40));
zone('Search',1160,16,335,40,()=>search());
zone('Notifications',1516,16,39,40);
zone('Settings',1570,16,40,40);
zone('Profile',1620,16,44,40);
zone('Network Selection',16,637,203,39);
zone('Chain Info',13,703,215,199);
[
  ['Analytics',242,92,698,87],['Validators',953,92,237,87],['Economics',1203,92,460,87],
  ['Network',242,194,451,241],['Consensus',706,194,474,241],
  ['Post-Quantum Security',242,447,343,177],['Identity (DIS)',598,447,331,177],
  ['Computation (PoCD)',941,447,341,177],['Economics',1295,447,368,177],
  ['Network',1462,641,201,266],['Validators',1036,641,412,266]
].forEach(args=>zone(...args));
[1225,1335,1444,1557].forEach((x,i)=>zone(blocks[3-i].name,x,253,90,115,()=>detail(blocks[3-i],()=>section('Blocks'))));
[
  ['Recent Activity',256,159],['Blocks',416,110],['Transactions',527,137],
  ['Validator Activity',665,151],['Consensus Events',817,188]
].forEach(([label,x,w])=>zone(label,x,649,w,37));
transactions.forEach((record,i)=>zone(record.type+' '+record.name,254,726+i*34,752,33,()=>detail(record,()=>section('Transactions'))));
document.addEventListener('keydown',event=>{
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase()==='k') {
    event.preventDefault();
    search();
  }
});
