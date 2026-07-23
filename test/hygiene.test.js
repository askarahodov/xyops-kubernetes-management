'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { problemPod, deploymentIssue, podCandidate, jobCandidates, selectorFromDeployment } = require('../hygiene');

test('selectorFromDeployment builds label selector', () => {
  assert.equal(selectorFromDeployment({spec:{selector:{matchLabels:{app:'api',tier:'backend'}}}}), 'app=api,tier=backend');
});

test('problemPod detects CrashLoopBackOff', () => {
  const pod={metadata:{creationTimestamp:new Date().toISOString()},status:{phase:'Running',containerStatuses:[{restartCount:3,state:{waiting:{reason:'CrashLoopBackOff'}}}]}};
  assert.equal(problemPod(pod).reason,'CrashLoopBackOff');
});

test('deploymentIssue detects unavailable deployment', () => {
  assert.equal(deploymentIssue({spec:{replicas:3},status:{readyReplicas:1,unavailableReplicas:2}}).problematic,true);
});

test('podCandidate never selects Running pod', () => {
  const pod={metadata:{namespace:'default',name:'api',creationTimestamp:'2020-01-01T00:00:00Z'},status:{phase:'Running'}};
  assert.equal(podCandidate(pod,{},Date.now()),null);
});

test('podCandidate excludes kube-system by default', () => {
  const pod={metadata:{namespace:'kube-system',name:'done',creationTimestamp:'2020-01-01T00:00:00Z'},status:{phase:'Succeeded'}};
  assert.equal(podCandidate(pod,{},Date.now()),null);
});

test('jobCandidates protects latest CronJob jobs', () => {
  const jobs=[1,2,3,4].map(i=>({metadata:{namespace:'default',name:`backup-${i}`,creationTimestamp:`2026-01-0${i}T00:00:00Z`,ownerReferences:[{kind:'CronJob',name:'backup'}]},status:{succeeded:1,completionTime:`2026-01-0${i}T01:00:00Z`}}));
  const out=jobCandidates(jobs,{completed_job_days:0,keep_cronjob_jobs:3},Date.parse('2026-02-01T00:00:00Z'));
  assert.deepEqual(out.map(x=>x.name),['backup-1']);
});
