// Transport Ship's visual and environmental behavior. Shared gameplay only
// calls these hooks; the scene and rules remain separate from the game loop.
var transportShipPackage = {
  id: 'transport-ship',
  loading: {
    textures: '生成集装箱 / 甲板 / 船体纹理',
    scene: '搭建运输船',
    environment: '天空与海洋',
  },
  load: If,
  createTextures(quality) { return Rf(quality); },
  createEnvironment(renderer, scene, quality) { return new Jl(renderer, scene, quality); },
  initAmbient(fx, map) { fx.initAmbient(map.funnelTop); },
  addLights(scene, map, quality) {
    const lights = [];
    for (const spot of map.lampSpots.slice(0, quality === 'low' ? 0 : 4)) {
      const light = new yn(16767392, 5, 9, 1.8);
      light.position.copy(spot);
      scene.add(light);
      lights.push(light);
    }
    return lights;
  },
  initialCamera(camera) {
    camera.position.set(-20, 12, 30);
    camera.lookAt(0, 2, 0);
  },
  previewCamera(camera, time) {
    const angle = time * .045;
    camera.position.set(Math.cos(angle) * 46 - 6, 13 + Math.sin(angle * 2.1) * 3,
      Math.sin(angle) * 34);
    camera.lookAt(-4, 1.5, 0);
    camera.fov = 60;
    camera.updateProjectionMatrix();
  },
  environmentSpeed(environment) { return environment.shipSpeed; },
};
