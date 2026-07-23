'use strict';
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const files=['xyops-hygiene-plugin.json','workflow-namespace-health.json','workflow-diagnose-deployment.json','workflow-cleanup-preview.json','workflow-cleanup-apply.json','workflow-cronjob-health.json'];

test('all hygiene XYPDF files are valid and documented',()=>{
  for(const file of files){
    const data=JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
    assert.equal(data.type,'xypdf');
    assert.ok(String(data.description).length>=100);
    for(const item of data.items) assert.ok(String(item.data.notes||'').length>=120);
  }
});

test('cleanup apply defaults to safe values',()=>{
  const data=JSON.parse(fs.readFileSync(path.join(root,'xyops-hygiene-plugin.json'),'utf8'));
  const plugin=data.items.find(item=>item.data.id==='pmlc2ha8fk8s_cleanup_apply').data;
  const values=Object.fromEntries(plugin.params.map(item=>[item.id,item.value]));
  assert.equal(values.dry_run,true);
  assert.equal(values.confirm_cleanup,false);
  assert.equal(values.allow_kube_system,false);
});
