const {test}=require('node:test');
const assert=require('node:assert/strict');
const {describeStatus}=require('../src/renderer/ui.js');

const base={mode:{kind:'active'},dns:{configured:false,partial:false,adapters:[]},running:true,busy:false,error:'',helper:false,active:false,upstream:'cloudflare'};
const now=Date.UTC(2026,8,26,12,0,0);

test('Jeder Dienstzustand erhält einen eigenen Oberflächenzustand mit Text',()=>{
  const cases=[
    [{},'setup','off'],
    [{active:true,dns:{configured:true}},'active','on'],
    [{mode:{kind:'timed',until:now+4*60000}},'paused-timed','off'],
    [{mode:{kind:'restart'}},'paused-restart','off'],
    [{mode:{kind:'off'}},'off','off'],
    [{busy:true,helper:true},'activating','pending'],
    [{busy:true,helper:false},'approval','pending'],
    [{running:false,error:'EACCES'},'unreachable','off'],
    [{error:'Abgebrochen'},'failed','off'],
    [{mode:{kind:'off'},error:'Adapter fehlt'},'failed','off']
  ];
  const keys=new Set();
  for(const [patch,key,toggle] of cases) {
    const d=describeStatus({...base,...patch},{now});
    assert.equal(d.key,key,JSON.stringify(patch));assert.equal(d.toggle,toggle,key);
    for(const field of ['title','description','kicker','pill'])assert.ok(d[field] && d[field].length>2,`${key}.${field}`);
    keys.add(d.key);
  }
  assert.equal(keys.size,9);
});

test('Aktivierung wird erst nach Bestätigung als aktiv angezeigt',()=>{
  const d=describeStatus({...base,busy:true,helper:true},{pending:'active'});
  assert.equal(d.toggle,'pending');assert.notEqual(d.key,'active');
  assert.equal(describeStatus({...base,busy:true,active:true,dns:{configured:true}},{pending:'off'}).key,'deactivating');
});

test('Fehler bleiben vollständig sichtbar und werden nie nur farbig markiert',()=>{
  const message='DNS-Hilfsdienst wurde vorzeitig beendet (Code 1). Die Windows-Freigabe wurde abgebrochen.';
  const d=describeStatus({...base,error:message});
  assert.equal(d.error,message);assert.match(d.title,/nicht/);assert.equal(d.icon,'shield-alert');
  const active=describeStatus({...base,active:true,dns:{configured:true},error:'Upstream antwortet nicht'});
  assert.equal(active.key,'active');assert.equal(active.error,'Upstream antwortet nicht');
});

test('Zeitpause zeigt Endzeit und Restdauer',()=>{
  const d=describeStatus({...base,mode:{kind:'timed',until:now+29*60000+1}},{now});
  assert.match(d.title,/Pausiert bis \d\d:\d\d Uhr/);assert.match(d.description,/Noch 30 Minuten/);
  assert.equal(d.action.mode,'active');
});

test('Verbindungszeile nennt Anbieter und Teilverbindungen',()=>{
  assert.match(describeStatus({...base,active:true,upstream:'quad9',dns:{configured:true}}).connection.text,/Quad9/);
  assert.equal(describeStatus({...base,dns:{partial:true}}).connection.tone,'warning');
  assert.equal(describeStatus({...base,running:false}).connection.tone,'danger');
});
