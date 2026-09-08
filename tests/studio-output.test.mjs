import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validTransport,mixVolumes} from '../src/lib/studio-output.ts';
test('transport ignores stale deck identities and invalid commands',()=>{
  const command={type:'transport',signature:'a|b',deck:'B',action:'seek',value:12};
  assert.equal(validTransport(command,'a|b'),true);
  assert.equal(validTransport(command,'new|b'),false);
  for(const value of [NaN,Infinity,-1,'12'])assert.equal(validTransport({...command,value},'a|b'),false);
  assert.equal(validTransport({...command,deck:'C'},'a|b'),false);
  assert.equal(validTransport({...command,action:'destroy'},'a|b'),false);
});
test('program gain follows crossfader and individual trims',()=>{
  assert.deepEqual(mixVolumes(0,100,100),[100,0]);
  assert.deepEqual(mixVolumes(.5,80,60),[40,30]);
  assert.deepEqual(mixVolumes(1,100,50),[0,50]);
  assert.deepEqual(mixVolumes(2,-10,120),[0,100]);
  assert.deepEqual(mixVolumes(NaN,Infinity,100),[0,0]);
});
