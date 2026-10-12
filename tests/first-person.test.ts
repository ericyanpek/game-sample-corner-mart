import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {FirstPersonCamera,EYE_HEIGHT} from '../src/first-person.ts';

// Camera calculations do not require a WebGL context or DOM layout.
const rig=()=>new FirstPersonCamera(new EventTarget() as HTMLCanvasElement);
const pose=(heading:number)=>({position:new THREE.Vector3(2,.027,-1),heading});
const deg=THREE.MathUtils.radToDeg;

test('wide and portrait canvas resizing keeps both fields of view bounded',()=>{
  const eye=rig();
  for(const aspect of [16/9,2,2.5,3.2,.75,.46,16/9]){
    eye.resize(aspect);
    const left=new THREE.Vector3(-1,0,.5).unproject(eye.camera).normalize();
    const right=new THREE.Vector3(1,0,.5).unproject(eye.camera).normalize();
    assert.ok(deg(left.angleTo(right))<=88+1e-8,`horizontal FOV at ${aspect}`);
    assert.ok(eye.camera.fov<=68,`vertical FOV at ${aspect}`);
    assert.equal(eye.camera.aspect,aspect);
  }
  const projection=eye.camera.projectionMatrix.toArray();
  for(const invalid of [0,-1,NaN,Infinity])eye.resize(invalid);
  assert.deepEqual(eye.camera.projectionMatrix.toArray(),projection);
  eye.dispose();
});

test('automatic turns stay bounded across frame rates and settle toward the actor',()=>{
  for(const fps of [20,30,60,120]){
    const eye=rig(),target=pose(Math.PI);eye.begin(pose(0));
    let previous=eye.snapshot().heading;
    for(let frame=0;frame<fps*5;frame++){
      eye.update(target,1/fps);
      const current=eye.snapshot().heading;
      assert.ok(current>=previous-1e-10,'no reversal or overshoot');
      assert.ok(deg(current-previous)<=90/fps+1e-8,'automatic turn speed');
      previous=current;
    }
    assert.ok(Math.abs(previous-Math.PI)<1e-6,'eventually faces forward');
    eye.dispose();
  }
});

test('heading wrap takes the short arc while reduced motion keeps automatic turns gentle',()=>{
  const eye=rig();
  eye.begin(pose(THREE.MathUtils.degToRad(179)));
  eye.update(pose(THREE.MathUtils.degToRad(-179)),1/60);
  assert.ok(deg(eye.snapshot().heading)>179&&deg(eye.snapshot().heading)<181);
  eye.begin(pose(0));
  eye.update(pose(Math.PI),1/60,true);
  assert.ok(deg(eye.snapshot().heading)>0&&deg(eye.snapshot().heading)<=1+1e-8);
  eye.dispose();
});

test('a browser stall cannot create a sudden automatic camera spin',()=>{
  const eye=rig();eye.begin(pose(0));
  eye.update(pose(Math.PI),2);
  assert.ok(deg(eye.snapshot().heading)<=4.5+1e-8);
  const previous=eye.snapshot();
  for(const interval of [0,-1,NaN,Infinity])eye.update(pose(Math.PI),interval);
  assert.deepEqual(eye.snapshot(),previous);
  eye.dispose();
});

test('turn smoothing retains eye height and exact actor position without movement lag',()=>{
  const eye=rig();eye.begin(pose(0));
  const moving=pose(Math.PI/2);moving.position.set(3,.027,4);
  eye.update(moving,1/60);
  assert.equal(eye.camera.position.y,.027+EYE_HEIGHT);
  assert.ok(Math.abs(eye.camera.position.distanceTo(moving.position)-Math.hypot(EYE_HEIGHT,.1))<1e-9);
  const forward=eye.camera.getWorldDirection(new THREE.Vector3());
  assert.ok(Math.abs(forward.dot(eye.camera.up)-Math.sin(THREE.MathUtils.degToRad(-6)))<1e-9);
  eye.dispose();
});
