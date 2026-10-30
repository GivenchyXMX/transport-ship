// A map package owns scene construction and rules. The game loop only keeps
// the resulting scene, collision world and navigation grid.
var registeredMaps=new Map([['transport-ship',{...transportShipPackage,rules:__TRANSPORT_SHIP_RULES__}]]);
function getRegisteredMap(id){
  const map=registeredMaps.get(id);
  if(!map)throw new Error('未知地图: '+id);
  return map;
}
function releaseMapObjects(roots,world){
  const geometries=new Set,materials=new Set;
  for(const root of roots){
    root.traverse(object=>{
      if(object.geometry)geometries.add(object.geometry);
      const list=Array.isArray(object.material)?object.material:[object.material];
      for(const material of list)if(material)materials.add(material);
    });
    root.parent?.remove(root);
  }
  for(const geometry of geometries)geometry.dispose?.();
  for(const material of materials)material.dispose?.();
  world.colliders.length=0;
  world.grid.clear();
}
function createMapRuntime(id,scene,materials){
  const definition=getRegisteredMap(id);
  validateMapRules(definition.rules);
  if(definition.id!==definition.rules.id)throw new Error('地图 ID 与规则数据不一致: '+id);
  const world=new gr;
  const before=new Set(scene.children);
  let map;
  try{map=definition.load(scene,materials,world)}
  catch(error){releaseMapObjects(scene.children.filter(object=>!before.has(object)),world);throw error}
  const roots=scene.children.filter(object=>!before.has(object));
  const runtime={id:definition.id,rules:definition.rules,world,map};
  runtime.addLights=quality=>{
    for(const light of definition.addLights(scene,map,quality))roots.push(light);
  };
  runtime.dispose=()=>{
    if(runtime.disposed)return;
    runtime.disposed=true;
    releaseMapObjects(roots,world);
  };
  return runtime;
}
function createMapNavigation(runtime){
  const {minX,minZ,maxX,maxZ,cell,radius}=runtime.rules.nav;
  return new Ql(runtime.world,minX,minZ,maxX,maxZ,cell,radius);
}
