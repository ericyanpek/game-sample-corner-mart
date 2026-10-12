import * as THREE from 'three';
import {assetUrl} from './asset-url.ts';
import ROOM_SPEC from '../assets/specs/room.json';
import {LAYOUT_SPEC,CHECKOUT_SPEC,transform,type LayoutId,type CheckoutId} from './navigation.ts';
import {customerName,customerActivity,itemMark,PRODUCT_SHORT} from './shopping-ui.ts';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {ShopCamera,SceneTap,type CameraDirection} from './camera.ts';
import {RoomCutaway} from './room-cutaway.ts';
import {prepareDoorMat} from './door-mat.ts';
import {FirstPersonCamera,firstPersonPose,withoutOwnHead,type FirstPersonTarget} from './first-person.ts';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {Shop,PRODUCT_IDS,DEFAULT_LAYOUT,PICKUP_TICKS,PAY_TICKS,PUTBACK_TICKS,SHOPPING_SPEC,SHELF_SPEC,SHELF_TIERS,type Product,type Customer} from './sim.ts';
import {DAY_THEME_IDS,DAY_THEME_SPEC,DAY_THEMES,type DayThemeId} from './day-themes.ts';
import RESTOCK_SPEC from '../assets/specs/restocking.json';
import {CHARACTER_SPEC,dressCharacter,type CharacterRole} from './appearance.ts';
import {customerEmotion} from './emotions.ts';
import {CharacterExpression,prepareExpressions,EXPRESSION_SPEC} from './expression-view.ts';

interface Actor {
  root:THREE.Group; mixer:THREE.AnimationMixer|null; last:THREE.Vector3;
  ownedMaterials:THREE.Material[];
  expression:CharacterExpression;
  action:string; actions:Map<string,THREE.AnimationAction>; parts:Map<string,THREE.Object3D>;
  items:Map<string,{object:THREE.Object3D;base:number}>;slots:THREE.Object3D[];basket:THREE.Object3D; item:THREE.Object3D|null; product:string|null; card:THREE.Object3D;
}
export type InspectTarget={kind:'shelf';product:Product}|{kind:'customer';id:number}|{kind:'worker'|'sign'}|{kind:'checkout';station?:CheckoutId};
export class ShopView {
  renderer:THREE.WebGLRenderer;
  scene=new THREE.Scene();
  camera=new THREE.OrthographicCamera();
  controls:OrbitControls;
  cameraRig:ShopCamera;
  firstPersonRig:FirstPersonCamera;
  firstPersonTarget:FirstPersonTarget|null=null;
  onFirstPersonChange:(target:FirstPersonTarget|null,reason?:'left'|'unavailable'|'reload')=>void=()=>{};
  get renderCamera(){return this.firstPersonTarget?this.firstPersonRig.camera:this.camera;}
  cutaway:RoomCutaway|null=null;
  model:THREE.Group|null=null;
  character:THREE.Group|null=null;
  grayTemplate:THREE.Group|null=null;
  clips:THREE.AnimationClip[]=[];
  props=new Map<string,THREE.Object3D>();
  carton:THREE.Object3D|null=null;
  actionLabels=new Map<string,HTMLDivElement>();
  floorSlots:THREE.Mesh[]=[];
  visualTick=0;
  showRoutes=true;
  currentLayout:LayoutId='aisle';
  routeLines=[0x4e8177,0xdc884b,0x9eaa94].map(color=>{
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(18000),3));g.setDrawRange(0,0);
    return new THREE.LineSegments(g,new THREE.LineBasicMaterial({color,transparent:true,opacity:.6,depthWrite:false}));
  });
  actors=new Map<number,Actor>();
  worker:Actor|null=null;
  cashier:Actor|null=null;
  checkoutAsset:THREE.Object3D|null=null;
  checkoutStatuses:ReturnType<Shop['checkoutStatus']>[]=[];
  loader=new GLTFLoader(new THREE.LoadingManager().setURLModifier(assetUrl));
  map=new Map<string,THREE.Object3D>();
  labels=new Map<Product,HTMLButtonElement>();
  frames:number[]=[];
  loaded=false;
  version:'v1'|'v2'|'gray'='gray';
  selected:Product='drinks';
  loadId=0;
  private preparations=new Map<string,Promise<void>>();
  onLoadProgress:(done:number,total:number,label:string)=>void=()=>{};
  tierAssets=new Map<number,THREE.Group>();
  tierRoot:THREE.Group|null=null;
  tier=-1;
  onSelect:(p:Product)=>void=()=>{};
  onCustomerSelect:(id:number)=>void=()=>{};
  selectedCustomer:number|null=null;
  followCustomer=false;
  followWorker=false;
  onWorkerSelect:()=>void=()=>{};
  onSignSelect=()=>{};
  onCheckoutSelect:(station:CheckoutId)=>void=()=>{};
  onEmptySelect=()=>{};
  onFocusLost=()=>{};
  setGuidedInput(locked:boolean){this.controls.enabled=!locked&&!this.firstPersonTarget;}
  inspection:InspectTarget|null=null;
  get cameraDriven(){return this.cameraRig.automatic;}
  selectionRing=new THREE.Mesh(new THREE.RingGeometry(.28,.31,48),new THREE.MeshBasicMaterial({color:'#ffedac',transparent:true,opacity:.85,depthWrite:false}));
  deliveryCrates=new Map<Product,THREE.Object3D>();
  cartonProduct:Product|null=null;
  basketAsset:THREE.Object3D|null=null;
  dayTheme:DayThemeId|null=null;
  daySign:THREE.Group|null=null;
  signFaces=new Map<DayThemeId,THREE.Object3D>();
  hemisphere=new THREE.HemisphereLight(0xfff7df,0x819b91,2.4);
  sun=new THREE.DirectionalLight(0xffe9be,3.2);
  fill=new THREE.DirectionalLight(0xc4e5ff,1.1);
  interior=new THREE.PointLight(0xffd99c,0,8,2);
  reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  constructor(public canvas:HTMLCanvasElement,public stage:HTMLElement) {
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.08;
    this.scene.background=new THREE.Color('#d4e1d8');
    this.scene.add(this.hemisphere);
    const sun=this.sun;sun.position.set(5,9,5);sun.castShadow=true;
    sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.1,far:25});
    sun.shadow.normalBias=.025;sun.shadow.bias=-.0001;this.scene.add(sun);
    const fill=this.fill;fill.position.set(-3,4,-4);this.scene.add(fill);
    this.interior.position.set(0,2.6,-.5);this.scene.add(this.interior);
    const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:'#ccd9ce',roughness:1}));
    ground.rotation.x=-Math.PI/2;ground.position.y=-.185;ground.receiveShadow=true;this.scene.add(ground);
    this.cameraRig=new ShopCamera(this.camera,canvas);this.controls=this.cameraRig.controls;
    this.firstPersonRig=new FirstPersonCamera(canvas);
    new ResizeObserver(()=>this.resize()).observe(stage);this.reset(true);
    this.selectionRing.rotation.x=-Math.PI/2;this.selectionRing.position.y=.041;this.selectionRing.visible=false;this.scene.add(this.selectionRing);
    const tap=new SceneTap();let lastHover=0;
    canvas.addEventListener('pointerdown',e=>{tap.down(e.pointerId,e.clientX,e.clientY,e.button);canvas.focus({preventScroll:true});canvas.style.cursor='grabbing';});
    canvas.addEventListener('pointercancel',e=>{tap.cancel(e.pointerId);canvas.style.cursor='grab';});
    canvas.addEventListener('pointermove',e=>{
      tap.move(e.pointerId,e.clientX,e.clientY);
      if(this.firstPersonTarget||tap.active||performance.now()-lastHover<50)return;
      lastHover=performance.now();canvas.style.cursor=this.pick(e.clientX,e.clientY)?'pointer':'grab';
    });
    canvas.addEventListener('pointerup',e=>{
      canvas.style.cursor='grab';
      if(!tap.up(e.pointerId,e.clientX,e.clientY,e.button))return;
      if(this.firstPersonTarget)return;
      if(!this.loaded)return;
      const target=this.pick(e.clientX,e.clientY);
      if(target?.kind==='worker')this.onWorkerSelect();
      else if(target?.kind==='customer')this.onCustomerSelect(target.id);
      else if(target?.kind==='shelf')this.onSelect(target.product);
      else if(target?.kind==='sign')this.onSignSelect();
      else if(target?.kind==='checkout')this.onCheckoutSelect(target.station??'main');
      else this.onEmptySelect();
    });
    canvas.addEventListener('keydown',e=>{
      const direction=({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'up',ArrowDown:'down'} as const)[e.key as 'ArrowLeft'];
      if(direction){e.preventDefault();this.turnCamera(direction);}
    });
    for(const p of PRODUCT_IDS){
      const b=document.createElement('button');b.className='world-label';b.dataset.shelf=p;b.onclick=()=>this.onSelect(p);
      document.querySelector('#shelf-labels')!.append(b);this.labels.set(p,b);
    }
    this.routeLines.forEach(l=>{l.frustumCulled=false;this.scene.add(l);});
    for(let i=0;i<8;i++){
      const dot=new THREE.Mesh(new THREE.RingGeometry(.105,.12,24),new THREE.MeshBasicMaterial({color:'#76927e',transparent:true,opacity:.38,depthWrite:false}));
      dot.rotation.x=-Math.PI/2;dot.position.y=.036;this.scene.add(dot);this.floorSlots.push(dot);
    }
  }
  pick(x:number,y:number):InspectTarget|null{
    if(this.firstPersonTarget)return null;
    if(!this.model||!this.loaded)return null;
    const r=this.canvas.getBoundingClientRect(),ray=new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((x-r.left)/r.width*2-1,-(y-r.top)/r.height*2+1),this.camera);
    const hit=ray.intersectObjects([this.model,...[...this.actors.values()].map(a=>a.root),...(this.worker?[this.worker.root]:[]),...(this.cashier?[this.cashier.root]:[]),...(this.daySign?[this.daySign]:[])],true).find(h=>{
      for(let o:THREE.Object3D|null=h.object;o;o=o.parent)if(!o.visible)return false;
      return true;
    });
    if(!hit)return null;
    for(let o:THREE.Object3D|null=hit.object;o;o=o.parent){
      if(o.userData.worker)return {kind:'worker'};
      if(o.userData.customerId)return {kind:'customer',id:o.userData.customerId};
      if(o.userData.product)return {kind:'shelf',product:o.userData.product as Product};
      if(o===this.daySign)return {kind:'sign'};
      if(o.userData.checkoutId)return {kind:'checkout',station:o.userData.checkoutId};
      if(o===this.cashier?.root)return {kind:'checkout',station:'main'};
    }
    return null;
  }
  resize() {
    const {width,height}=this.stage.getBoundingClientRect();const aspect=width/height;
    if(!width||!height)return;
    const span=Math.max(7.4,9.6/aspect)*ROOM_SPEC.horizontalScale;
    this.camera.left=-span*aspect/2;this.camera.right=span*aspect/2;this.camera.top=span/2;this.camera.bottom=-span/2;
    this.camera.near=.1;this.camera.far=80;this.camera.updateProjectionMatrix();
    this.firstPersonRig.resize(aspect);this.renderer.setSize(width,height,false);
  }
  reset(instant=false){
    this.exitFirstPerson();
    this.followCustomer=false;this.followWorker=false;this.inspection=null;this.selectionRing.visible=false;
    this.cameraRig.reset(instant);
    this.resize();
  }
  enterFirstPerson(target:FirstPersonTarget,shop:Shop){
    const pose=firstPersonPose(shop,target);
    if(!this.loaded||!pose)return false;
    this.cameraRig.suspend();this.firstPersonTarget=target;this.firstPersonRig.begin(pose);
    this.selectionRing.visible=false;this.onFirstPersonChange(target);return true;
  }
  exitFirstPerson(reason?:'left'|'unavailable'|'reload'){
    if(!this.firstPersonTarget)return;
    this.firstPersonTarget=null;this.firstPersonRig.end();this.cameraRig.resume();this.onFirstPersonChange(null,reason);
  }
  turnCamera(direction:CameraDirection){
    if(this.firstPersonTarget)this.firstPersonRig.turn(direction);else this.cameraRig.turn(direction);
  }
  setCameraElevation(degrees:number){this.exitFirstPerson();this.cameraRig.setElevation(degrees);}
  inspect(target:InspectTarget){
    this.exitFirstPerson();
    this.inspection=target;this.cameraRig.focus();
    this.followCustomer=target.kind==='customer';this.followWorker=target.kind==='worker';
    if(target.kind==='customer')this.selectedCustomer=target.id;
  }
  /** Project a generous callout envelope, including carried items, without traversing meshes each frame. */
  screenTarget(target:InspectTarget){
    if(this.firstPersonTarget)return null;
    let point:THREE.Vector3,half=new THREE.Vector3(.5,.8,.5);
    if(target.kind==='customer'){
      const actor=this.actors.get(target.id);if(!actor)return null;
      point=actor.root.position.clone().add(new THREE.Vector3(0,.8,0));
    }else if(target.kind==='worker'){
      if(!this.worker?.root.visible)return null;point=this.worker.root.position.clone().add(new THREE.Vector3(0,.8,0));
    }else if(target.kind==='shelf'){
      const root=target.product==='drinks'?this.tierRoot:null;
      const p=LAYOUT_SPEC.presets[this.currentLayout][target.product].position;
      point=root?root.getWorldPosition(new THREE.Vector3()).setY(1.1):new THREE.Vector3(p[0],1.1,p[1]);
      half.set(1,1.1,1);
    }else if(target.kind==='checkout'){
      const station=CHECKOUT_SPEC.stations[target.station??'main'];
      point=new THREE.Vector3((station.position[0]+station.cashier[0])/2,.8,station.position[1]);half.set(.85,.8,.8);
    }else {if(!this.daySign)return null;point=this.daySign.position.clone().add(new THREE.Vector3(0,.65,0));half.set(.5,.7,.5);}
    const center=point.clone().project(this.camera),r=this.canvas.getBoundingClientRect();
    const x=r.left+(center.x+1)/2*r.width,y=r.top+(1-center.y)/2*r.height;
    if(center.z < -1||center.z>1||x<r.left+8||x>r.right-8||y<r.top+8||y>r.bottom-8)return null;
    let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
    const corner=new THREE.Vector3();
    for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
      corner.set(point.x+sx*half.x,point.y+sy*half.y,point.z+sz*half.z).project(this.camera);
      const px=r.left+(corner.x+1)/2*r.width,py=r.top+(1-corner.y)/2*r.height;
      left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);
    }
    return {x,y,bounds:{left,top,width:right-left,height:bottom-top},viewport:r};
  }
  setDayTheme(theme:DayThemeId){
    this.dayTheme=theme;const light=DAY_THEMES[theme].lighting;
    this.scene.background=new THREE.Color(light.background);this.hemisphere.color.set(light.sky);
    this.hemisphere.groundColor.set(light.ground);this.hemisphere.intensity=light.ambient;
    this.sun.color.set(light.sun);this.sun.intensity=light.intensity;this.sun.position.fromArray(light.position);
    this.fill.color.set(light.fill);this.fill.intensity=light.fillIntensity;
    this.renderer.toneMappingExposure=light.exposure;this.interior.intensity=light.interior;
    for(const [id,face] of this.signFaces)face.visible=id===theme;
  }
  async prepareDaySign(){
    if(!this.dayTheme||this.daySign)return;
    const asset=await this.loader.loadAsync('/assets/days/day-sign.glb');
    let root:THREE.Object3D|undefined;
    asset.scene.traverse(o=>{
      if(o.userData.asset_id===DAY_THEME_SPEC.board.root)root=o;
      for(const id of DAY_THEME_IDS)if(o.userData.asset_id==='theme.'+id)this.signFaces.set(id,o);
      if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}
    });
    if(!root||root.userData.contract!=='day-themes-v1'||this.signFaces.size!==3)throw Error('营业告示牌缺少主题接口');
    root.updateWorldMatrix(true,true);
    const common=new THREE.Group();root.add(common);
    for(const child of [...root.children])if(child!==common&&![...this.signFaces.values()].includes(child))common.attach(child);
    this.batch(common);for(const face of this.signFaces.values())this.batch(face);
    this.daySign=asset.scene;this.daySign.position.fromArray(DAY_THEME_SPEC.board.placement);this.daySign.rotation.y=DAY_THEME_SPEC.board.yaw;
    this.scene.add(this.daySign);this.setDayTheme(this.dayTheme);
  }
  focusDaySign(){
    if(this.daySign)this.inspect({kind:'sign'});
  }
  grayModel() {
    const group=new THREE.Group();
    const box=(id:string,x:number,y:number,z:number,w:number,h:number,d:number,color:string,product?:Product)=>{
      const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.8}));
      m.position.set(x,y,z);m.userData={asset_id:id,product};group.add(m);return m;
    };
    box('floor',0,-.08,0,6*ROOM_SPEC.horizontalScale,.16,5*ROOM_SPEC.horizontalScale,'#dbcaa8');
    for(const p of PRODUCT_IDS){const [x,z]=LAYOUT_SPEC.presets.aisle[p].position;box('shelf.'+p,x,.65,z,1.35,1.3,.7,'#8ca998',p);}
    box('checkout',-1.9,.45,1.1,1.65,.9,.78,'#d58d64');
    return group;
  }
  grayCharacter() {
    const root=new THREE.Group();
    const m=new THREE.Mesh(new THREE.CapsuleGeometry(.16,.42,3,8),new THREE.MeshStandardMaterial({color:'#e1a172'}));
    m.position.y=.43;root.add(m);return root;
  }
  // Merge only render meshes within each semantic group, preserving product and stock visibility.
  batch(root:THREE.Object3D) {
    root.updateMatrixWorld(true);
    const inverse=root.matrixWorld.clone().invert(),buckets=new Map<THREE.Material,THREE.BufferGeometry[]>();
    const originals:THREE.Mesh[]=[];
    root.traverse(o=>{
      if(!(o instanceof THREE.Mesh)||Array.isArray(o.material)||o.userData.receiveOnly)return;
      for(let parent=o.parent;parent&&parent!==root;parent=parent.parent)if(parent.userData.cutawayWall)return;
      const geometry=o.geometry.clone();geometry.applyMatrix4(inverse.clone().multiply(o.matrixWorld));
      // Custom bevel normals and exports can differ in optional attributes; retain common PBR attributes.
      for(const key of Object.keys(geometry.attributes))if(!['position','normal','uv','color'].includes(key))geometry.deleteAttribute(key);
      if(!geometry.getAttribute('uv'))geometry.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(geometry.getAttribute('position').count*2),2));
      const arr=buckets.get(o.material)||[];arr.push(geometry);buckets.set(o.material,arr);originals.push(o);
    });
    for(const [material,geos] of buckets){
      const g=mergeGeometries(geos,false);if(!g)continue;
      const mesh=new THREE.Mesh(g,material);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);
      geos.forEach(x=>x.dispose());
    }
    originals.forEach(m=>{m.removeFromParent();m.geometry.dispose();});
  }
  disposeModel(){
    if(!this.model)return;
    // Cached shelf geometry is shared by all instances; only the room is disposed.
    this.tierRoot?.removeFromParent();this.tierRoot=null;this.tier=-1;
    this.model.children.filter(o=>o.userData.checkoutId).forEach(o=>o.removeFromParent());
    this.disposeRoom(this.model);
  }
  private disposeRoom(root:THREE.Group){
    const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
    root.traverse(o=>{if(o instanceof THREE.Mesh){geometries.add(o.geometry);(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}});
    root.removeFromParent();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
  /** Share asset preparation across retries and room changes; failed work can be retried. */
  private prepareShared(key:string,prepare:()=>Promise<void>){
    let pending=this.preparations.get(key);
    if(!pending){
      pending=Promise.resolve().then(prepare).catch(error=>{this.preparations.delete(key);throw error;});
      this.preparations.set(key,pending);
    }
    return pending;
  }
  async prepareCharacter(){
    if(this.character)return;
    const [asset,props,ranges]=await Promise.all([
      this.loader.loadAsync(CHARACTER_SPEC.asset),this.loader.loadAsync('/assets/interaction-props.glb'),
      fetch(assetUrl('/assets/actions.json')).then(r=>{if(!r.ok)throw Error('动作清单加载失败');return r.json();}) as Promise<{name:string;start:number;end:number;fps:number}[]>
    ]);
    let contract:string|undefined;
    asset.scene.traverse(o=>{if(o.userData.character_contract)contract=o.userData.character_contract;});
    if(contract!==CHARACTER_SPEC.contract)throw Error('人物资产接口不一致');
    prepareExpressions(asset.scene);
    let expressionContract:string|undefined;
    asset.scene.traverse(o=>{if(o.userData.expression_contract)expressionContract=o.userData.expression_contract;});
    if(expressionContract!==EXPRESSION_SPEC.contract)throw Error('人物表情接口不一致');
    const variants:THREE.Object3D[]=[];asset.scene.traverse(o=>{if(o.userData.appearance_family||o.userData.expression)variants.push(o);});
    for(const variant of variants)this.batch(variant);
    const full=new THREE.AnimationClip('Timeline',-1,asset.animations.flatMap(c=>c.tracks));
    this.clips=ranges.map(r=>THREE.AnimationUtils.subclip(full,r.name,r.start,r.end,r.fps));
    // The newer two-slot basket comes from prepareBasket, regardless of download order.
    props.scene.traverse(o=>{if(o.userData.asset_id?.startsWith('prop.')&&o.userData.asset_id!=='prop.basket')this.props.set(o.userData.asset_id,o);});
    this.character=asset.scene;
    for(const a of this.actors.values())this.disposeActor(a);this.actors.clear();
    if(this.cashier){this.disposeActor(this.cashier);this.cashier=null;}
    if(this.worker){this.disposeActor(this.worker);this.worker=null;}
  }
  async prepareTiers(){
    if(this.tierAssets.size===3)return;
    const [assets,premium]=await Promise.all([
      Promise.all(SHELF_TIERS.map(t=>this.loader.loadAsync(`/assets/shelves/${t.key}.glb`))),
      this.loader.loadAsync('/assets/shelves/premium-drink.glb')
    ]);
    premium.scene.traverse(o=>{if(o.userData.asset_id==='prop.premium')this.props.set('prop.premium',o);});
    assets.forEach((asset,tier)=>{
      const parts=new Map<string,THREE.Object3D>();
      asset.scene.traverse(o=>{
        if(o.userData.asset_id)parts.set(o.userData.asset_id,o);
        if(o instanceof THREE.Mesh){
          o.castShadow=true;o.receiveShadow=true;
          for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.transparent){m.depthWrite=false;o.castShadow=false;}
        }
      });
      asset.scene.updateMatrixWorld(true);
      const contract=SHELF_SPEC.contract,stop=parts.get('stop.drinks'),label=parts.get('label.drinks');
      if(!parts.has(contract.interaction_id)||parts.get(contract.root_id)?.userData.capacity!==SHELF_TIERS[tier].capacity||
        !stop||!label||stop.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(contract.stop_local))>1e-5||
        label.getWorldPosition(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(contract.label_local))>1e-5||
        Array.from({length:SHELF_TIERS[tier].capacity},(_,i)=>parts.has(contract.unit_prefix+i)).some(ok=>!ok))
        throw Error(`货架 ${SHELF_TIERS[tier].name} 不符合统一接口，未进行升级。`);
      if(tier===2&&SHELF_SPEC.door_ids.some(id=>!parts.has(id)))throw Error('冷藏柜缺少柜门挂点');
      for(const [id,o] of parts)if(id==='shelf.drinks.shell'||/^(regular|premium)\.drinks\.\d+$/.test(id))this.batch(o);
      this.tierAssets.set(tier,asset.scene);
    });
  }
  activateTier(tier:number){
    if(this.tier===tier||!this.model||!this.tierAssets.has(tier))return;
    this.tierRoot?.removeFromParent();
    this.tierRoot=this.tierAssets.get(tier)!.clone(true);
    this.tierRoot.position.fromArray(SHELF_SPEC.contract.placement);
    this.model.add(this.tierRoot);this.tier=tier;
    this.map.clear();this.model.traverse(o=>{if(o.userData.asset_id)this.map.set(o.userData.asset_id,o);});
    this.model.updateMatrixWorld(true);
  }
  async load(version:'v1'|'v2'|'gray',tier=0) {
    this.exitFirstPerson('reload');
    const ticket=++this.loadId;this.loaded=false;
    const tasks:[string,()=>Promise<void>][]=[
      ['人物与动作',()=>this.prepareCharacter()],
      ['三档货架',()=>this.prepareTiers()],
      ['购物篮',()=>this.prepareBasket()],
      ['补货箱',()=>this.prepareCrates()],
      ['收银台',()=>this.prepareCheckouts()],
      ...(this.dayTheme?[['营业告示牌',()=>this.prepareDaySign()] as [string,()=>Promise<void>]]:[]),
    ];
    let done=0,failed=false;const total=tasks.length+1;
    this.onLoadProgress(0,total,'正在准备店铺');
    const track=async<T>(work:Promise<T>,label:string)=>{
      const result=await work;
      if(ticket===this.loadId&&!failed)this.onLoadProgress(++done,total,label);
      return result;
    };
    // Fetch independent assets together; mounting waits until their contracts are validated.
    const room=version==='gray'?Promise.resolve(this.grayModel()):this.loader.loadAsync(ROOM_SPEC.assets[version]).then(asset=>asset.scene);
    let root:THREE.Group;
    try{
      [root]=await Promise.all([track(room,'店铺空间'),...tasks.map(([key,prepare])=>track(this.prepareShared(key,prepare),key))]);
    }catch(error){
      failed=true;void room.then(unused=>this.disposeRoom(unused),()=>{});
      throw error;
    }
    if(ticket!==this.loadId){this.disposeRoom(root);return;}
    this.disposeModel();this.model=root;this.scene.add(root);this.map.clear();
    // Replace only the old counter and the plant occupying the employee corridor.
    const obsolete:THREE.Object3D[]=[];
    root.traverse(o=>{if(o.userData.asset_id==='checkout'||/^(Checkout[ _]|Terminal[ _]|Paper[ _]bags[ _]|Planter[ _]-2\.53|Leaf[ _]-2\.53)/.test(o.userData.asset_id||o.name))obsolete.push(o);});
    obsolete.forEach(o=>o.removeFromParent());
    prepareDoorMat(root);
    this.cutaway=new RoomCutaway(root);
    root.traverse(o=>{if(o.userData.asset_id)this.map.set(o.userData.asset_id,o);if(o instanceof THREE.Mesh){o.castShadow=!o.userData.receiveOnly;o.receiveShadow=true;}});
    for(const id of ['shelf.drinks','label.drinks','stop.drinks',...Array.from({length:4},(_,i)=>'stock.drinks.'+i)]){
      const old=this.map.get(id);if(old)old.visible=false;
    }
    if(version!=='gray'){
      for(const key of ['store.static',...PRODUCT_IDS.map(p=>'shelf.'+p),...PRODUCT_IDS.flatMap(p=>Array.from({length:24},(_,i)=>'unit.'+p+'.'+i))]){
        const part=this.map.get(key);if(part)this.batch(part);
      }
      for(const wall of this.cutaway.walls.values())this.batch(wall.root);
    }
    for(const [id,station] of Object.entries(CHECKOUT_SPEC.stations)){
      const desk=this.checkoutAsset!.clone(true);desk.userData.asset_id='checkout.'+id;desk.userData.checkoutId=id;
      desk.position.set(station.position[0],.027,station.position[1]);desk.rotation.y=station.yaw;root.add(desk);
    }
    this.activateTier(tier);
    this.map.get('nav.delivery')?.position.set(DEFAULT_LAYOUT.delivery[0],0,DEFAULT_LAYOUT.delivery[1]);
    this.map.get('nav.checkout')?.position.set(DEFAULT_LAYOUT.checkout[0],0,DEFAULT_LAYOUT.checkout[1]);
    this.version=version;this.frames=[];this.loaded=true;
  }
  async prepareBasket(){
    if(!this.basketAsset){
      const asset=await this.loader.loadAsync('/assets/shopping/basket.glb');
      const parts=new Map<string,THREE.Object3D>();
      asset.scene.traverse(o=>{if(o.userData.asset_id)parts.set(o.userData.asset_id,o);if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});
      asset.scene.updateMatrixWorld(true);
      const root=parts.get(SHOPPING_SPEC.basket.root);
      if(!root||root.userData.capacity!==2||root.userData.slot_contract!=='shopping-v1')throw Error('购物篮不符合双挂点接口');
      for(const slot of SHOPPING_SPEC.basket.slots){
        const o=parts.get(slot.id);if(!o||root.worldToLocal(o.getWorldPosition(new THREE.Vector3())).distanceTo(new THREE.Vector3().fromArray(slot.position))>1e-5)throw Error('购物篮挂点位置不一致');
      }
      this.basketAsset=root;
    }
    this.props.set('prop.basket',this.basketAsset);
  }
  async prepareCrates(){
    if(this.deliveryCrates.size===PRODUCT_IDS.length)return;
    await Promise.all(PRODUCT_IDS.map(async p=>{
      if(this.deliveryCrates.has(p))return;
      const gltf=await this.loader.loadAsync(`/assets/restocking/crate-${p}.glb`);
      let root:THREE.Object3D|undefined;
      gltf.scene.traverse(o=>{if(o.userData.asset_id===RESTOCK_SPEC.products[p].root)root=o;});
      if(!root||root.userData.contract!==RESTOCK_SPEC.contract)throw Error('周转箱接口无效：'+p);
      this.batch(root);this.deliveryCrates.set(p,root);
    }));
  }
  async prepareCheckouts(){
    if(this.checkoutAsset)return;
    const gltf=await this.loader.loadAsync(CHECKOUT_SPEC.asset);
    gltf.scene.traverse(o=>{if(o.userData.contract===CHECKOUT_SPEC.contract)this.checkoutAsset=o;});
    if(!this.checkoutAsset)throw Error('收银台资产接口不一致');
    this.batch(this.checkoutAsset);
  }
  disposeActor(a:Actor){this.scene.remove(a.root);a.mixer?.stopAllAction();a.mixer?.uncacheRoot(a.root);a.ownedMaterials.forEach(m=>m.dispose());}
  createActor(id:number,role:CharacterRole='customer'):Actor {
    this.grayTemplate??=this.grayCharacter();
    const root=(this.character??this.grayTemplate).clone(true);
    const ownedMaterials=dressCharacter(root,role,id);
    const expression=new CharacterExpression(root);
    const mixer=this.clips.length?new THREE.AnimationMixer(root):null;
    const actions=new Map(this.clips.map(c=>[c.name,mixer!.clipAction(c)]));
    const parts=new Map<string,THREE.Object3D>();
    root.traverse(o=>{if(o.userData.asset_id)parts.set(o.userData.asset_id,o);});
    const basket=this.prop('basket'),card=this.prop('card');root.add(basket,card);basket.visible=false;card.visible=false;
    const slots:THREE.Object3D[]=[];basket.traverse(o=>{const index=SHOPPING_SPEC.basket.slots.findIndex(s=>s.id===o.userData.asset_id);if(index>=0)slots[index]=o;});
    this.scene.add(root);return {root,mixer,ownedMaterials,expression,last:new THREE.Vector3(999,0,0),actions,action:'',parts,basket,card,item:null,product:null,items:new Map(),slots};
  }
  prop(name:string) {
    const source=this.props.get('prop.'+name);
    if(!source)throw Error('商品道具尚未加载：'+name);
    return source.clone(true);
  }
  pose(a:Actor,name:string,progress:number,loop=false){
    const action=a.actions.get(name);if(!action)return;
    if(a.action!==name){a.mixer!.stopAllAction();action.reset().play();a.action=name;}
    action.enabled=true;action.paused=false;
    action.time=(loop?((progress%1)+1)%1:THREE.MathUtils.clamp(progress,0,1))*action.getClip().duration;
    a.mixer!.update(0);
    a.root.updateMatrixWorld(true);
  }
  atHand(a:Actor,object:THREE.Object3D,side:'left'|'right',dy=0){
    const hand=a.parts.get('hold.'+side);
    if(!hand)return;
    const p=hand.getWorldPosition(new THREE.Vector3());a.root.worldToLocal(p);p.y+=dy;
    object.position.copy(p);object.rotation.set(0,0,0);
  }
  customerItem(a:Actor,p:Product,premium=false){
    const key=premium?'premium':p;
    if(a.product!==key){a.item?.removeFromParent();a.item=this.prop(key);a.root.add(a.item);a.product=key;}
    return a.item!;
  }
  syncActor(a:Actor,c:Customer,shop:Shop,dt:number,paused:boolean,speed:number) {
    const position=new THREE.Vector3(c.pos[0],.027,c.pos[1]);
    const moving=c.nav.moving;
    const blend=paused?1:Math.max(0,Math.min(1,this.visualTick-shop.state.tick));
    a.root.position.set(THREE.MathUtils.lerp(c.nav.previous[0],c.pos[0],blend),.027,THREE.MathUtils.lerp(c.nav.previous[1],c.pos[1],blend));
    a.root.rotation.y=c.facing;a.last.copy(position);
    const elapsed=this.visualTick-c.phaseStarted;
    const transitioning=Boolean(shop.state.layoutChange)||c.approach;
    const name=moving?'Walk':transitioning?'Wait':c.state==='pickup'||c.state==='putback'?'PickUp':c.state==='pay'?'Pay':'Wait';
    const progress=c.state==='pickup'?elapsed/PICKUP_TICKS:c.state==='putback'?1-elapsed/PUTBACK_TICKS:c.state==='pay'?elapsed/PAY_TICKS:this.visualTick/9+c.id*.17;
    this.pose(a,name,progress,moving||name==='Wait');
    a.expression.update(customerEmotion(c,shop.state.tick).emotion,this.visualTick,c.id,this.reducedMotion.matches);
    a.root.updateMatrixWorld(true);
    a.basket.visible=true;this.atHand(a,a.basket,'right');
    const keys=new Set<string>();
    c.shopping.forEach((line,index)=>{
      const kind=line.premium?'premium':line.product,key=line.product+':'+kind;keys.add(key);
      let entry=a.items.get(key);
      if(!entry){
        const object=this.prop(kind);object.scale.setScalar(SHOPPING_SPEC.basket.itemScale[kind]);
        const base=-new THREE.Box3().setFromObject(object).min.y;
        a.root.add(object);entry={object,base};a.items.set(key,entry);
      }
      const item=entry.object;item.visible=shop.itemVisible(c,line);item.userData.shoppingProduct=line.product;item.userData.sku=kind;
      if(!transitioning&&line.product===c.product&&(c.state==='pickup'&&elapsed<12||c.state==='putback')){
        this.atHand(a,item,'left',.02);item.userData.location='hand';
      }else if(!transitioning&&(c.state==='service'||c.state==='pay')){
        const station=shop.station(c);
        const slot=CHECKOUT_SPEC.itemSlots[Math.min(index,CHECKOUT_SPEC.itemSlots.length-1)];
        const world=new THREE.Vector3().fromArray(slot).applyAxisAngle(new THREE.Vector3(0,1,0),station.yaw);
        world.add(new THREE.Vector3(station.position[0],.027+entry.base,station.position[1]));
        a.root.worldToLocal(world);item.position.copy(world);item.rotation.set(0,0,0);item.userData.location='counter';item.userData.checkout=c.checkout??'main';
      }else{
        const slot=a.slots[index];
        const position=slot?slot.getWorldPosition(new THREE.Vector3()):a.basket.localToWorld(new THREE.Vector3().fromArray(SHOPPING_SPEC.basket.slots[index].position));
        a.root.worldToLocal(position);position.y+=entry.base;item.position.copy(position);item.rotation.set(0,0,0);item.userData.location='basket';
      }
    });
    for(const [key,entry] of a.items)if(!keys.has(key)){entry.object.removeFromParent();a.items.delete(key);}
    a.item=[...a.items.values()].find(entry=>entry.object.visible)?.object??null;
    a.product=a.item?.userData.sku??null;
    a.card.visible=c.state==='pay'&&!transitioning;this.atHand(a,a.card,'left',.015);
  }
  label(key:string,text:string,position:THREE.Vector3,kind='',progress?:number){
    if(this.firstPersonTarget)return;
    position.project(this.camera);
    if(Math.abs(position.x)>1||Math.abs(position.y)>1||Math.abs(position.z)>1)return;
    let el=this.actionLabels.get(key);
    if(!el){el=document.createElement('div');this.stage.append(el);this.actionLabels.set(key,el);}
    el.className='action-label '+kind;el.textContent=text;
    if(progress!==undefined){const bar=document.createElement('i');bar.style.width=`${Math.round(THREE.MathUtils.clamp(progress,0,1)*100)}%`;el.append(bar);}
    el.style.left=((position.x+1)/2*this.stage.clientWidth)+'px';el.style.top=((1-position.y)/2*this.stage.clientHeight)+'px';el.hidden=false;
  }
  update(shop:Shop,dt:number,paused=false,speed=1,alpha=0) {
    // Restored shoppers can already hold goods. Wait for all prop assets before
    // creating their meshes, including during an asynchronous room reimport.
    if(!this.loaded){this.controls.update();this.renderer.render(this.scene,this.camera);return;}
    this.updateInspection(shop,dt,paused,alpha);
    this.cutaway?.update(this.renderCamera);
    const s=shop.state;this.visualTick=s.tick+(paused?0:alpha);
    this.activateTier(s.drinksTier);
    this.currentLayout=s.layoutId;
    const pose=LAYOUT_SPEC.presets[s.layoutId].drinks;
    if(this.tierRoot){this.tierRoot.position.set(pose.position[0],0,pose.position[1]);this.tierRoot.rotation.y=pose.yaw;}
    this.drawRoutes(shop);
    const opening=shop.wantsDoor(),door=THREE.MathUtils.clamp(s.drinksDoor+(paused?0:alpha*(opening?.16:-.12)),0,1);
    for(const key of SHELF_SPEC.door_ids){const pivot=this.map.get(key);if(pivot)pivot.rotation.y=THREE.MathUtils.degToRad(pivot.userData.open_degrees)*door;}
    this.actionLabels.forEach(el=>el.hidden=true);
    for(const [id,a] of this.actors)if(!shop.state.customers.some(c=>c.id===id)){
      this.disposeActor(a);this.actors.delete(id);
    }
    for(const c of shop.state.customers){
      if(!this.actors.has(c.id))this.actors.set(c.id,this.createActor(c.id));
      const a=this.actors.get(c.id)!;a.root.userData.customerId=c.id;this.syncActor(a,c,shop,dt,paused,speed);
      const selected=c.id===this.selectedCustomer;
      const active=['pickup','pay','putback'].includes(c.state);
      const feeling=customerEmotion(c,s.tick);
      if(selected||active){
        const title=selected?`${customerName(c,this.dayTheme&&this.dayTheme!=='breakfast'?'合购客':undefined)} #${c.id} · ${customerActivity(shop,c)}\n${c.shopping.map(i=>itemMark(shop,c,i)+' '+PRODUCT_SHORT[i.product]+(i.status==='missing'?'缺货':'')).join('　')}\n${feeling.label}`:customerActivity(shop,c);
        this.label('customer.'+c.id,title,a.root.position.clone().add(new THREE.Vector3(0,selected?1.55:1.20,0)),selected?'shopping-selected':c.state==='pay'?'pay':'',
          c.state==='pay'?1-c.timer/PAY_TICKS:c.state==='service'?1-c.timer/(c.serviceDuration-PAY_TICKS):undefined);
      }else if(feeling.emotion!=='focused'){
        this.label('emotion.'+c.id,feeling.label,a.root.position.clone().add(new THREE.Vector3(0,1.24,0)),'emotion-cue '+feeling.emotion);
      }

    }
    if(!this.cashier)this.cashier=this.createActor(0,'cashier');
    const mainStation=CHECKOUT_SPEC.stations.main;
    this.cashier.root.position.set(mainStation.cashier[0],.027,mainStation.cashier[1]);this.cashier.root.rotation.y=Math.PI/2;
    this.pose(this.cashier,s.service!==null?'Pay':'Wait',this.visualTick/(s.service!==null?14:24),true);
    this.cashier.expression.update('focused',this.visualTick,0,this.reducedMotion.matches);
    if((s.upgrades.staff||s.orders.length||s.delivery)&&!this.worker){this.worker=this.createActor(0,'worker');this.worker.root.userData.worker=true;this.carton=null;this.cartonProduct=null;}
    if(this.worker){
      this.worker.root.visible=Boolean(s.upgrades.staff||s.orders.length||s.delivery);
      const d=s.delivery,pos=d?.pos??shop.layout.delivery;
      const crateProduct=d?.product??'drinks';
      if(!this.carton||this.cartonProduct!==crateProduct){
        this.carton?.removeFromParent();this.carton=this.deliveryCrates.get(crateProduct)!.clone(true);
        this.cartonProduct=crateProduct;this.worker.root.add(this.carton);
      }
      const target=new THREE.Vector3(pos[0],.027,pos[1]);
      const blend=paused?1:alpha,previous=d?.nav.previous??pos;
      this.worker.root.position.set(THREE.MathUtils.lerp(previous[0],pos[0],blend),.027,THREE.MathUtils.lerp(previous[1],pos[1],blend));
      this.worker.last.copy(target);this.worker.root.rotation.y=d?.facing??Math.PI/2;
      const progress=d?(this.visualTick-d.phaseStarted)/d.phaseDuration:0;
      const walking=d?.nav.moving,transitioning=Boolean(s.layoutChange)||d?.approach;
      const workerAction=walking?(d?.phase==='returning'?'Walk':'Carry'):transitioning?'Wait':d?.phase==='stocking'||d?.phase==='loading'?'Stock':s.helperService!==null?'Pay':'Wait';
      this.pose(this.worker,workerAction,workerAction==='Stock'?(d?.phase==='loading'?1-progress:progress):this.visualTick/9,workerAction!=='Stock');
      this.worker.expression.update('focused',this.visualTick,-1,this.reducedMotion.matches);
      this.carton!.visible=Boolean(d&&d.phase!=='returning');
      const carry=RESTOCK_SPEC.carryPositionThree;
      this.carton!.position.set(carry[0],d?.phase==='loading'?.2+(carry[1]-.2)*Math.min(1,progress):carry[1],carry[2]);
      if(d){
        this.label('worker',s.layoutChange?'让出货架位置':d.nav.blocked>3?'等通道空出来':({loading:'抱起货箱',walking:'搬运 '+shop.goodsFor(d.product,d.premium).name,stocking:'上架 '+d.quantity+' 件',returning:'补货完成'}[d.phase]),
          this.worker.root.position.clone().add(new THREE.Vector3(0,1.23,0)),'worker',d.phase==='stocking'?progress:undefined);
        const label=this.actionLabels.get('worker');if(label)label.onclick=this.onWorkerSelect;
        const unit=this.customerItem(this.worker,d.product,d.premium);unit.visible=!transitioning&&d.phase==='stocking'&&progress>.12&&progress<.9;
        this.atHand(this.worker,unit,'left',.03);
      }else if(this.worker.item)this.worker.item.visible=false;
    }
    this.checkoutStatuses=(['main','flex'] as CheckoutId[]).map(id=>shop.checkoutStatus(id));
    for(const status of this.checkoutStatuses){
      const pos=CHECKOUT_SPEC.stations[status.id].position;
      this.label('checkout.'+status.id,`${status.id==='main'?'1':'2'}号 · ${status.text}`,new THREE.Vector3(pos[0],1.40,pos[1]),
        status.state==='open'?'checkout-open':'checkout-paused');
      const el=this.actionLabels.get('checkout.'+status.id);
      if(!el)continue;
      el.onclick=()=>this.onCheckoutSelect(status.id);el.dataset.checkout=status.id;
      el.title=status.detail;el.setAttribute('role','button');el.tabIndex=0;el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.onCheckoutSelect(status.id);}};
    }
    for(const [i,dot] of this.floorSlots.entries()){const p=shop.queuePosition(i);dot.position.x=p[0];dot.position.z=p[1];dot.visible=!this.firstPersonTarget&&i<shop.state.queue.length&&!shop.state.layoutChange;}
    for(const r of s.receipts){
      const age=this.visualTick-r.tick;
      const c=s.customers.find(c=>c.id===r.customer),station=CHECKOUT_SPEC.stations[c?.checkout??'main'];
      if(age>=0&&age<20)this.label('receipt.'+r.id,`+${r.amount} 币 · ${r.lines.length} 件 ✓`,new THREE.Vector3(station.position[0]+.35,1.65+age*.022,station.position[1]),'receipt');
    }
    for(const [key,el] of this.actionLabels)if(el.hidden){el.remove();this.actionLabels.delete(key);}
    this.model?.updateMatrixWorld(true);
    for(const p of PRODUCT_IDS){
      const shelf=s.shelves[p];
      if(p!=='drinks')for(let i=0;i<4;i++){const stock=this.map.get('stock.'+p+'.'+i);if(stock)stock.visible=shelf.unlocked;}
      const count=shop.onShelf(p),normal=count-shop.premiumOnShelf(p);
      for(let i=0;i<shop.capacity(p);i++){
        const unit=this.map.get('unit.'+p+'.'+i);if(unit)unit.visible=shelf.unlocked&&i<count;
        if(p==='drinks'){
          const regular=this.map.get('regular.drinks.'+i),premium=this.map.get('premium.drinks.'+i);
          if(regular)regular.visible=i<normal;if(premium)premium.visible=i>=normal&&i<count;
        }
      }
      const anchor=this.map.get('label.'+p),v=anchor?anchor.getWorldPosition(new THREE.Vector3()):new THREE.Vector3(DEFAULT_LAYOUT.shelves[p][0],1.8,-1.65);
      v.project(this.camera);const b=this.labels.get(p)!;
      b.hidden=!!this.firstPersonTarget||Math.abs(v.x)>1||Math.abs(v.y)>1||Math.abs(v.z)>1;
      b.style.left=((v.x+1)/2*this.stage.clientWidth)+'px';b.style.top=((1-v.y)/2*this.stage.clientHeight)+'px';
      b.textContent=shelf.unlocked?`${{drinks:'饮料',bread:'面包',fruit:'水果'}[p]} ${shop.available(p)} 件`:'待开张';
      b.className='world-label'+(this.selected===p?' selected':'')+(!shelf.unlocked?' locked':shop.available(p)<=3?' low':'');
    }
    const observer=this.firstPersonTarget?.kind==='customer'?this.actors.get(this.firstPersonTarget.id):
      this.firstPersonTarget?.kind==='worker'?this.worker:this.firstPersonTarget?.kind==='cashier'?this.cashier:null;
    withoutOwnHead(observer?.root,()=>this.renderer.render(this.scene,this.renderCamera));
    if(dt>0){this.frames.push(dt*1000);if(this.frames.length>2400)this.frames.shift();}
  }
  private updateInspection(shop:Shop,dt:number,paused:boolean,alpha:number){
    if(this.firstPersonTarget){
      const pose=firstPersonPose(shop,this.firstPersonTarget,paused?1:alpha);
      if(pose){
        this.firstPersonRig.update(pose,dt,this.reducedMotion.matches);this.selectionRing.visible=false;return;
      }
      const reason=this.firstPersonTarget.kind==='customer'?'left':'unavailable';
      this.exitFirstPerson(reason);this.reset();this.onFocusLost();
    }
    const target=new THREE.Vector3().fromArray(ROOM_SPEC.cameraTarget);let zoom=1;
    const position=(pos:number[],previous:number[],height:number)=>{
      target.set(pos[0],height,pos[1]);
      if(!paused)target.set(THREE.MathUtils.lerp(previous[0],pos[0],alpha),height,THREE.MathUtils.lerp(previous[1],pos[1],alpha));
    };
    const focus=this.inspection;let ring=false;
    if(focus?.kind==='customer'){
      const c=shop.state.customers.find(c=>c.id===focus.id);
      if(!c){this.reset();this.onFocusLost();return;}
      position(c.pos,c.nav.previous,.73);zoom=2.15;ring=true;
    }else if(focus?.kind==='worker'){
      if(!shop.state.delivery&&!shop.state.orders.length&&!shop.state.upgrades.staff){this.reset();this.onFocusLost();return;}
      const d=shop.state.delivery,p=d?.pos??shop.layout.delivery;position(p,d?.nav.previous??p,.6);
      zoom=1.9;ring=true;
    }else if(focus?.kind==='shelf'){
      const p=shop.layout.shelves[focus.product];target.set(p[0],.9,p[1]-.35);zoom=1.7;
    }else if(focus?.kind==='checkout'){const pos=CHECKOUT_SPEC.stations[focus.station??'main'].position;target.set(pos[0],.75,pos[1]);zoom=1.65;}
    else if(focus?.kind==='sign'&&this.daySign){target.copy(this.daySign.position).add(new THREE.Vector3(0,.65,0));zoom=2;}
    if(focus)zoom*=ROOM_SPEC.horizontalScale;
    this.selectionRing.visible=ring;
    if(ring)this.selectionRing.position.set(target.x,.041,target.z);
    this.cameraRig.update(target,zoom,dt,this.reducedMotion.matches);
  }
  drawRoutes(shop:Shop){
    const s=shop.state,sets:number[][]=[[],[],[]];
    const segment=(arr:number[],a:number[],b:number[])=>arr.push(a[0],.041,a[1],b[0],.041,b[1]);
    if(this.showRoutes){
      for(const c of s.customers){let p=c.pos;for(const q of c.nav.path){segment(sets[0],p,q);p=q;}}
      if(s.delivery){let p=s.delivery.pos;for(const q of s.delivery.nav.path){segment(sets[1],p,q);p=q;}}
      // The swing envelope stays reserved for every shelf tier so upgrades remain safe.
      for(const sign of [-1,1]){
        const center=[-sign*.68,.408],pose=shop.nav.preset.drinks;
        let last=transform(pose,[center[0]+sign*.676,center[1]]);
        for(let deg=5;deg<=100;deg+=5){const a=deg*Math.PI/180,q=transform(pose,[center[0]+sign*.676*Math.cos(a),center[1]+.676*Math.sin(a)]);segment(sets[2],last,q);last=q;}
      }
      for(const p of Object.values(shop.layout.shelves))for(let i=0;i<24;i++)segment(sets[2],[p[0]+Math.cos(i*Math.PI/12)*.25,p[1]+Math.sin(i*Math.PI/12)*.25],[p[0]+Math.cos((i+1)*Math.PI/12)*.25,p[1]+Math.sin((i+1)*Math.PI/12)*.25]);
    }
    this.routeLines.forEach((line,i)=>{const a=line.geometry.getAttribute('position') as THREE.BufferAttribute;const values=sets[i].slice(0,a.array.length);(a.array as Float32Array).set(values);a.needsUpdate=true;line.geometry.setDrawRange(0,values.length/3);line.visible=this.showRoutes&&!this.firstPersonTarget;});
  }
  metrics(){
    const frames=this.frames.filter(t=>t<1000).slice(-1800).sort((a,b)=>a-b);
    const gl=this.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    const q=transform(LAYOUT_SPEC.presets[this.currentLayout].drinks,[0,.435]);
    const pick=new THREE.Vector3(q[0],1.65,q[1]).project(this.camera),rect=this.canvas.getBoundingClientRect();
    const screen=(p:THREE.Vector3)=>{p.project(this.camera);return {x:rect.left+(p.x+1)/2*rect.width,y:rect.top+(1-p.y)/2*rect.height};};
    const targets=[
      ...PRODUCT_IDS.map(product=>{
        const root=product==='drinks'?this.tierRoot:this.map.get('shelf.'+product);
        const point=root?new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()):new THREE.Vector3();
        return {kind:'shelf',product,...screen(point)};
      }),
      ...[...this.actors].map(([id,a])=>({kind:'customer',id,...screen(a.root.position.clone().add(new THREE.Vector3(0,.72,0)))})),
      ...(this.worker?.root.visible?[{kind:'worker',...screen(this.worker.root.position.clone().add(new THREE.Vector3(0,.72,0)))}]:[]),
      ...(this.daySign?[{kind:'sign',...screen(this.daySign.position.clone().add(new THREE.Vector3(0,.65,0)))}]:[]),
      ...Object.entries(CHECKOUT_SPEC.stations).map(([station,p])=>({kind:'checkout',station,...screen(new THREE.Vector3(p.position[0],.95,p.position[1]))})),
    ];
    const signBounds=this.daySign?new THREE.Box3().setFromObject(this.daySign):null;
    const bounds=(o?:THREE.Object3D|null)=>{
      if(!o)return null;const b=new THREE.Box3().setFromObject(o);
      return {min:b.min.toArray(),max:b.max.toArray(),size:b.getSize(new THREE.Vector3()).toArray()};
    };
    return {version:this.version,loaded:this.loaded,frames:frames.length,median:frames[Math.floor(frames.length*.5)]??0,p95:frames[Math.floor(frames.length*.95)]??0,
      render:{...this.renderer.info.render},actors:this.actors.size,geometry:this.renderer.info.memory.geometries,
      gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
      shelfWidth:this.map.has('shelf.drinks')?new THREE.Box3().setFromObject(this.map.get('shelf.drinks')!).getSize(new THREE.Vector3()).x:null,
      ids:[...this.map.keys()],clips:this.clips.map(c=>({name:c.name,duration:c.duration,tracks:c.tracks.length})),visual:this.visualState(),
      layoutId:this.currentLayout,shelfYaw:this.tierRoot?.rotation.y,routesVisible:this.showRoutes,followingCustomer:this.followCustomer,followingWorker:this.followWorker,
      firstPerson:this.firstPersonTarget?{target:this.firstPersonTarget,...this.firstPersonRig.snapshot()}:null,
      inspection:this.inspection,camera:{position:this.renderCamera.position.toArray(),target:this.controls.target.toArray(),zoom:this.camera.zoom,driven:this.cameraDriven,
        azimuth:this.controls.getAzimuthalAngle(),polar:this.controls.getPolarAngle(),walls:this.cutaway?.snapshot()},targets,
      checkouts:this.checkoutStatuses,checkoutContract:this.checkoutAsset?.userData.contract,roomRevision:this.map.get('corner.shop')?.userData.room_revision??null,
      space:{architecture:bounds(this.map.get('store.static')),fixtures:Object.fromEntries(PRODUCT_IDS.map(p=>[p,bounds(this.map.get('shelf.'+p))])),
        counters:Object.fromEntries((['main','flex'] as const).map(id=>[id,bounds(this.model?.children.find(o=>o.userData.checkoutId===id))]))},
      deliveryCrate:{product:this.cartonProduct,visible:this.carton?.visible??false,contract:this.carton?.userData.contract??null,loaded:[...this.deliveryCrates.keys()]},
      shelfTier:this.tier,shelfPlacement:this.tierRoot?.position.toArray(),shelfStop:this.layout().shelves.drinks,
      shelfPickScreen:{x:rect.left+(pick.x+1)/2*rect.width,y:rect.top+(1-pick.y)/2*rect.height},
      doorAngles:SHELF_SPEC.door_ids.map(id=>this.map.get(id)?.rotation.y??null),
      dayTheme:this.dayTheme,daySign:this.daySign?{position:this.daySign.position.toArray(),faces:DAY_THEME_IDS.filter(id=>this.signFaces.get(id)?.visible),
        bounds:{min:signBounds!.min.toArray(),max:signBounds!.max.toArray()}}:null,
      lighting:{background:(this.scene.background as THREE.Color).getHexString(),sun:this.sun.color.getHexString(),sunPosition:this.sun.position.toArray(),interior:this.interior.intensity}};
  }
  visualState(){
    const actor=(a:Actor)=>({appearance:a.root.userData.appearance,emotion:a.expression.emotion,action:a.action,basket:a.basket.visible,item:a.item?.visible??false,itemKind:a.product,card:a.card.visible,
      position:a.root.position.toArray(),left:a.parts.get('arm.left')?.quaternion.toArray(),itemWorld:a.item?.getWorldPosition(new THREE.Vector3()).toArray(),
      cardWorld:a.card.getWorldPosition(new THREE.Vector3()).toArray(),basketSlots:a.slots.map(o=>o.position.toArray()),
      items:[...a.items.values()].map(({object:o})=>({product:o.userData.shoppingProduct,sku:o.userData.sku,visible:o.visible,location:o.userData.location,world:o.getWorldPosition(new THREE.Vector3()).toArray()}))});
    return {customers:[...this.actors].map(([id,a])=>({id,...actor(a)})),worker:this.worker?{...actor(this.worker),visible:this.worker.root.visible,carton:this.carton?.visible}:null,cashier:this.cashier?actor(this.cashier):null,
      shelf:Object.fromEntries(PRODUCT_IDS.map(p=>[p,Array.from({length:p==='drinks'&&this.tier>=0?SHELF_TIERS[this.tier].capacity:24},(_,i)=>this.map.get(`unit.${p}.${i}`)).filter(o=>o?.visible).length])),
      premiumUnits:Array.from({length:48},(_,i)=>this.map.get(`premium.drinks.${i}`)).filter(o=>o?.visible&&o.parent?.visible).length};
  }
  layout(){
    const point=(key:string,fallback:[number,number]):[number,number]=>{
      const o=this.map.get(key);if(!o)return [...fallback];
      const p=o.getWorldPosition(new THREE.Vector3());return [p.x,p.z];
    };
    return {entrance:point('nav.entrance',DEFAULT_LAYOUT.entrance),aisle:point('nav.aisle',DEFAULT_LAYOUT.aisle),
      checkout:point('nav.checkout',DEFAULT_LAYOUT.checkout),delivery:point('nav.delivery',DEFAULT_LAYOUT.delivery),shelves:Object.fromEntries(PRODUCT_IDS.map(p=>[p,point('stop.'+p,DEFAULT_LAYOUT.shelves[p])])) as Record<Product,[number,number]>};
  }
}
