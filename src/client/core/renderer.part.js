var Tv={uniforms:{tDiffuse:{value:null},uTime:{value:0},uDamage:{value:0},uLowHP:{value:0},uFlash:{value:0},uVignette:{value:.28},uDeath:{value:0},uScope:{value:0},uProtect:{value:0},uUnderRoof:{value:0}},vertexShader:"varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",fragmentShader:`
    uniform sampler2D tDiffuse; uniform float uTime, uDamage, uLowHP, uFlash, uVignette, uDeath, uScope, uProtect;
    varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      vec2 c = uv - 0.5;
      // \u53D7\u4F24\u65F6\u8F7B\u5FAE\u8272\u5DEE
      float ca = uDamage * 0.004 + uDeath * 0.006;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + c * ca).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - c * ca).b;
      float r = length(c * vec2(1.0, 0.8));
      // \u6697\u89D2
      col *= 1.0 - smoothstep(0.35, 0.95, r) * uVignette;
      // \u53D7\u51FB\u7EA2\u8FB9
      float edge = smoothstep(0.25, 0.8, r);
      col = mix(col, vec3(0.55, 0.02, 0.0), edge * clamp(uDamage, 0.0, 1.0) * 0.75);
      // \u4F4E\u8840\u91CF\u53BB\u9971\u548C + \u8109\u52A8
      float g = dot(col, vec3(0.299, 0.587, 0.114));
      float pulse = 0.5 + 0.5 * sin(uTime * 7.0);
      col = mix(col, vec3(g) * vec3(1.08, 0.92, 0.9), uLowHP * 0.55);
      col = mix(col, vec3(0.5, 0.0, 0.0), uLowHP * edge * (0.25 + 0.2 * pulse));
      // \u6B7B\u4EA1\uFF1A\u7070\u6697
      col = mix(col, vec3(g) * 0.6, uDeath * 0.8);
      // \u51FA\u751F\u4FDD\u62A4\uFF1A\u6DE1\u84DD\u8FB9
      col = mix(col, vec3(0.35, 0.6, 1.0), uProtect * edge * 0.18);
      // \u95EA\u767D
      col += uFlash;
      // \u80F6\u7247\u9897\u7C92
      col += (h(uv * 1000.0 + uTime) - 0.5) * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`},Zl=class{constructor(t,e){this.quality=e;let i=this.renderer=new Gl({canvas:t,antialias:!1,powerPreference:"high-performance",stencil:!1});i.setPixelRatio(Math.min(window.devicePixelRatio,e==="high"?1.5:e==="medium"?1.15:1)),i.toneMapping=ds,i.toneMappingExposure=.75,i.outputColorSpace=Re,i.shadowMap.enabled=!0,i.shadowMap.type=Ko,this.scene=new sn,this.camera=new je(78,16/9,.05,6e4),this.vmScene=new sn,this.vmCamera=new je(58,16/9,.01,50);let n=i.getDrawingBufferSize(new ct),s=new Ne(n.x,n.y,{type:Ye,samples:e==="low"?0:4});this.composer=new Yl(i,s),this.worldPass=new Pa(this.scene,this.camera),this.vmPass=new Pa(this.vmScene,this.vmCamera),this.vmPass.clear=!1,this.vmPass.clearDepth=!0,this.composer.addPass(this.worldPass),this.composer.addPass(this.vmPass),e!=="low"&&(this.bloom=new pr(new ct(n.x/2,n.y/2),.14,.35,3.2),this.composer.addPass(this.bloom)),this.fx=new fr(Tv),this.composer.addPass(this.fx),this.composer.addPass(new $l),this.resize(),window.addEventListener("resize",()=>this.resize())}resize(){let t=window.innerWidth,e=window.innerHeight;this.renderer.setSize(t,e,!1),this.composer.setSize(t,e),this.camera.aspect=t/e,this.camera.updateProjectionMatrix(),this.vmCamera.aspect=t/e,this.vmCamera.updateProjectionMatrix()}render(){this.composer.render()}};