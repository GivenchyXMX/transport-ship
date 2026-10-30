var mr=class r extends Yt{constructor(){let t=r.SkyShader,e=new be({name:t.name,uniforms:$i.clone(t.uniforms),vertexShader:t.vertexShader,fragmentShader:t.fragmentShader,side:ni,depthWrite:!1});super(new Le(1,1,1),e),this.isSky=!0}};mr.SkyShader={name:"SkyShader",uniforms:{turbidity:{value:2},rayleigh:{value:1},mieCoefficient:{value:.005},mieDirectionalG:{value:.8},sunPosition:{value:new R},cloudScale:{value:2e-4},cloudSpeed:{value:2e-5},cloudCoverage:{value:0},cloudDensity:{value:.4},cloudElevation:{value:.5},showSunDisc:{value:1},sunGlare:{value:.55},time:{value:0}},vertexShader:`
		uniform vec3 sunPosition;
		uniform float rayleigh;
		uniform float turbidity;
		uniform float mieCoefficient;

		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying float vSunfade;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		// constants for atmospheric scattering
		const float e = 2.71828182845904523536028747135266249775724709369995957;
		const float pi = 3.141592653589793238462643383279502884197169;

		// wavelength of used primaries, according to preetham
		const vec3 lambda = vec3( 680E-9, 550E-9, 450E-9 );
		// this pre-calculation replaces older TotalRayleigh(vec3 lambda) function:
		// (8.0 * pow(pi, 3.0) * pow(pow(n, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * pn)) / (3.0 * N * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * pn))
		const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

		// mie stuff
		// K coefficient for the primaries
		const float v = 4.0;
		const vec3 K = vec3( 0.686, 0.678, 0.666 );
		// MieConst = pi * pow( ( 2.0 * pi ) / lambda, vec3( v - 2.0 ) ) * K
		const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

		// earth shadow hack
		// cutoffAngle = pi / 1.95;
		const float cutoffAngle = 1.6110731556870734;
		const float steepness = 1.5;
		const float EE = 1000.0;

		float sunIntensity( float zenithAngleCos ) {
			zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
			return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
		}

		vec3 totalMie( float T ) {
			float c = ( 0.2 * T ) * 10E-18;
			return 0.434 * c * MieConst;
		}

		void main() {

			vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
			vWorldPosition = worldPosition.xyz;

			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
			gl_Position.z = gl_Position.w; // set z to camera.far

			vSunDirection = normalize( sunPosition );

			vSunE = sunIntensity( vSunDirection.y );

			vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );

			float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );

			// extinction (absorption + out scattering)
			// rayleigh coefficients
			vBetaR = totalRayleigh * rayleighCoefficient;

			// mie coefficients
			vBetaM = totalMie( turbidity ) * mieCoefficient;

		}`,fragmentShader:`
		varying vec3 vWorldPosition;
		varying vec3 vSunDirection;
		varying vec3 vBetaR;
		varying vec3 vBetaM;
		varying float vSunE;

		uniform float mieDirectionalG;
		uniform float cloudScale;
		uniform float cloudSpeed;
		uniform float cloudCoverage;
		uniform float cloudDensity;
		uniform float cloudElevation;
		uniform float showSunDisc;
		uniform float sunGlare;
		uniform float time;

		// gradient at a lattice corner; sinless hash so every GPU produces the same clouds
		vec2 gradient( vec2 i ) {
			vec3 p = fract( i.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
			p += dot( p, p.yzx + 33.33 );
			return fract( ( p.xx + p.yz ) * p.zy ) * 2.0 - 1.0;
		}

		// 2D gradient noise: isotropic lobes like Perlin at value-noise cost
		float noise( vec2 p ) {
			vec2 i = floor( p );
			vec2 f = fract( p );
			vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 ); // quintic fade
			float a = dot( gradient( i ), f );
			float b = dot( gradient( i + vec2( 1.0, 0.0 ) ), f - vec2( 1.0, 0.0 ) );
			float c = dot( gradient( i + vec2( 0.0, 1.0 ) ), f - vec2( 0.0, 1.0 ) );
			float d = dot( gradient( i + vec2( 1.0, 1.0 ) ), f - vec2( 1.0, 1.0 ) );
			return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.6; // ~[-1,1]
		}

		// fbm; per-octave drift makes clouds billow instead of scrolling as a rigid stamp
		float fbm( vec2 p, float drift ) {
			float result = 0.0;
			float amplitude = 1.0;
			for ( int i = 0; i < 4; i ++ ) {
				result += amplitude * noise( p );
				amplitude *= 0.5;
				p = p * 2.0 + drift;
			}
			return result;
		}

		// constants for atmospheric scattering
		const float pi = 3.141592653589793238462643383279502884197169;

		const float n = 1.0003; // refractive index of air
		const float N = 2.545E25; // number of molecules per unit volume for air at 288.15K and 1013mb (sea level -45 celsius)

		// optical length at zenith for molecules
		const float rayleighZenithLength = 8.4E3;
		const float mieZenithLength = 1.25E3;
		// 66 arc seconds -> degrees, and the cosine of that
		const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

		// 3.0 / ( 16.0 * pi )
		const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
		// 1.0 / ( 4.0 * pi )
		const float ONE_OVER_FOURPI = 0.07957747154594767;

		float rayleighPhase( float cosTheta ) {
			return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
		}

		float hgPhase( float cosTheta, float g ) {
			float g2 = pow( g, 2.0 );
			float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
			return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
		}

		void main() {

			vec3 direction = normalize( vWorldPosition - cameraPosition );

			// optical length
			// cutoff angle at 90 to avoid singularity in next formula.
			float zenithAngle = acos( max( 0.0, direction.y ) );
			float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
			float sR = rayleighZenithLength * inverse;
			float sM = mieZenithLength * inverse;

			// combined extinction factor
			vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

			// in scattering
			float cosTheta = dot( direction, vSunDirection );

			float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
			vec3 betaRTheta = vBetaR * rPhase;

			float mPhase = hgPhase( cosTheta, mieDirectionalG );
			vec3 betaMTheta = vBetaM * mPhase;

			vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
			Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - vSunDirection.y, 5.0 ), 0.0, 1.0 ) );

			// nightsky
			float theta = acos( direction.y ); // elevation --> y-axis, [-pi/2, pi/2]
			float phi = atan( direction.z, direction.x ); // azimuth --> x-axis [-pi/2, pi/2]
			vec2 uv = vec2( phi, theta ) / vec2( 2.0 * pi, pi ) + vec2( 0.5, 0.0 );
			vec3 L0 = vec3( 0.1 ) * Fex;

			// composition + solar disc
			float sundisc = clamp( ( cosTheta - sunAngularDiameterCos ) * 50000.0, 0.0, 1.0 ) * showSunDisc;
			float sunCorona = smoothstep( 0.9997, 0.99994, cosTheta ) * showSunDisc;
			vec3 sundiscColor = ( vec3( 1.0, 0.93, 0.76 ) * sunCorona * mix( 0.32, 0.72, sunGlare ) + vec3( sundisc * 0.35 ) ) * min( vSunE * Fex, vec3( 1.0 ) );

			// The slider changes both the radius and brightness of the scattering halo.
			float sunFacing = smoothstep( mix( 0.88, 0.2, sunGlare ), 0.98, cosTheta );
			float glowCap = mix( 0.55, mix( 0.18, 0.72, sunGlare ), sunFacing );
			vec3 skyTint = mix( vec3( 1.0, 0.86, 0.72 ), vec3( 0.82, 0.91, 1.0 ), smoothstep( 0.05, 0.5, vSunDirection.y ) );
			vec3 skyGlow = min( ( Lin + L0 ) * 0.04, skyTint * glowCap );
			float halo = pow( max( cosTheta, 0.0 ), mix( 280.0, 20.0, sunGlare ) );
			vec3 haloTint = mix( vec3( 1.0, 0.60, 0.36 ), vec3( 1.0, 0.95, 0.82 ), smoothstep( 0.0, 0.6, vSunDirection.y ) );
			vec3 haloColor = haloTint * halo * sunGlare * smoothstep( -0.12, 0.08, vSunDirection.y ) * 0.75;
			// Use a clear daylight gradient; the scattering model made a broad grey patch around the sun.
			vec3 clearDaySky = mix( vec3( 0.50, 0.70, 0.86 ), vec3( 0.18, 0.47, 0.82 ), smoothstep( -0.08, 0.9, direction.y ) );
			float clearDay = smoothstep( 0.35, 0.55, vSunDirection.y );
			vec3 texColor = mix( skyGlow + vec3( 0.0, 0.0003, 0.00075 ), clearDaySky, clearDay ) + sundiscColor;

			// Clouds
			if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {

				// Project to cloud plane (higher elevation = clouds appear lower/closer)
				float elevation = mix( 1.0, 0.1, cloudElevation );
				vec2 cloudUV = direction.xz / ( direction.y * elevation );
				cloudUV *= cloudScale;
				cloudUV += time * cloudSpeed;

				// Cloud density field
				float evolve = time * cloudSpeed * 300.0;
				float cloudNoise = clamp( fbm( cloudUV * 1000.0, evolve ) * 0.7 + 0.5, 0.0, 1.0 );

				// Large-scale coverage variation: clear gaps next to dense banks
				float region = noise( cloudUV * 300.0 ) * 0.37 + 0.5;
				float cov = clamp( cloudCoverage + ( region - 0.5 ) * 0.6, 0.0, 1.0 );

				// Carve clouds where noise rises above the coverage level
				float threshold = 1.0 - cov;
				float cloudMask = smoothstep( threshold, threshold + 0.3, cloudNoise );

				// Fade clouds near horizon (adjusted by elevation)
				float horizonFade = smoothstep( 0.0, 0.03 + 0.06 * cloudElevation, direction.y );
				cloudMask *= horizonFade;

				// Cloud lighting from the sky's own radiance
				float dayFactor = smoothstep( -0.08, 0.3, vSunDirection.y );
				vec3 sunColor = vSunE * Fex * 0.22 * 0.04; // 0.22 ~ albedo/pi, 0.04 = exposure; the aerial composite adds the eye-leg extinction
				vec3 skyAmbient = min( Lin * 0.04, vec3( glowCap ) ) + vec3( 0.0, 0.0003, 0.00075 );

				// Beer-powder self-shadow from the sampled density
				float depth = max( 0.0, cloudNoise - threshold );
				float beer = exp( depth * -4.0 );
				float powder = 1.0 - beer * beer; // beer*beer == exp(-8*depth)
				float shade = mix( 0.45, 1.0, clamp( beer * powder * 2.6, 0.0, 1.0 ) ); // 2.6 = 1/0.385, normalizes beer*powder peak to 1

				// Henyey-Greenstein forward lobe ( g = 0.7 ): silver lining on rims toward the sun
				float silver = clamp( 0.51 / pow( 1.49 - cosTheta * 1.4, 1.5 ), 0.0, 3.0 ); // 0.51=1-g^2, 1.49=1+g^2, 1.4=2g
				float edge = cloudMask * ( 1.0 - cloudMask ) * 4.0;

				vec3 cloudColor = skyAmbient + sunColor * shade;
				cloudColor += sunColor * silver * edge * 0.6;
				cloudColor *= max( dayFactor, 0.03 );
				cloudColor = min( cloudColor, vec3( mix( 1.0, mix( 0.5, 1.0, sunGlare ), sunFacing ) ) );

				// Keep a soft cloud-free opening around the sun at every glare setting.
				float alpha = ( 1.0 - exp( depth * cloudDensity * -12.0 ) ) * horizonFade;
				alpha *= 1.0 - smoothstep( 0.93, 0.995, cosTheta );

				// Occlude the sun disc/glow behind opaque cloud
				texColor -= L0 * 0.04 * alpha;

				// Composite through the atmosphere so distant clouds dissolve into haze
				vec3 cloudAerial = mix( texColor, cloudColor, Fex );
				texColor = mix( texColor, cloudAerial, alpha );

			}
			// Atmospheric glare remains visible in front of thin clouds and haze.
			texColor += haloColor;

			gl_FragColor = vec4( texColor, 1.0 );

			#include <tonemapping_fragment>
			#include <colorspace_fragment>

		}`};var $h={day:{elev:40,azim:128,turbidity:2,rayleigh:1.5,mie:.0012,mieG:.72,sunColor:16773340,sunInt:4.3,hemiSky:15790313,hemiGround:8226964,hemiInt:.58,envInt:.8,exposure:.68,fog:11125462,fogDensity:.0006,deep:206399,shallow:1010296,skyZen:4159672,skyHor:12375012,cloudLit:16777215,cloudShade:9280168,cloudCover:.47},dusk:{elev:6.5,azim:160,turbidity:6,rayleigh:2,mie:.003,mieG:.8,sunColor:16754010,sunInt:3.4,hemiSky:15775888,hemiGround:5263444,hemiInt:.4,envInt:.7,exposure:.76,fog:13933176,fogDensity:.0009,deep:662572,shallow:2771544,skyZen:3821432,skyHor:15900784,cloudLit:16760970,cloudShade:5917272,cloudCover:.5}},Df=`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm4(vec2 p){ float s=0., a=.5; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=.5;} return s; }
float fbm6(vec2 p){ float s=0., a=.5; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=.5;} return s; }
`,Xv=[[1,.25,.1,58],[.9,.55,.09,33],[.75,-.45,.08,19],[.25,1,.07,11],[-.5,.8,.05,6.5],[.95,-.1,.05,4.2]];function Yv(r){let i=[],n=[];for(let c=0;c<=110;c++){let h=c===0?0:6*Math.pow(1.058,c)-5;for(let u=0;u<160;u++){let d=u/160*Math.PI*2;i.push(Math.cos(d)*h,0,Math.sin(d)*h)}}for(let c=0;c<110;c++)for(let h=0;h<160;h++){let u=c*160+h,d=c*160+(h+1)%160,f=u+160,p=d+160;n.push(u,d,f,d,p,f)}let s=new ce;s.setAttribute("position",new jt(i,3)),s.setIndex(n);let a=Xv.map(([c,h,u,d])=>{let f=Math.hypot(c,h);return new ge(c/f,h/f,u,d)}),o=new be({uniforms:{uTime:{value:0},uShip:{value:0},uWaves:{value:a},uSunDir:{value:new R},uSunColor:{value:new zt},uDeep:{value:new zt(r.deep)},uShallow:{value:new zt(r.shallow)},uZen:{value:new zt(r.skyZen)},uHor:{value:new zt(r.skyHor)},uFog:{value:new zt(r.fog)},uFogDensity:{value:r.fogDensity},uCam:{value:new R}},vertexShader:`
      uniform float uTime, uShip; uniform vec4 uWaves[6];
      varying vec3 vW; varying vec3 vN; varying float vH;
      void main(){
        vec3 p = (modelMatrix * vec4(position,1.0)).xyz;
        vec2 xz = p.xz + vec2(uShip, 0.0);
        float dist = length(p.xz);
        float fade = smoothstep(1400.0, 250.0, dist);
        vec3 disp = vec3(0.0); vec3 T = vec3(1,0,0), B = vec3(0,0,1);
        for(int i=0;i<6;i++){
          vec4 w = uWaves[i];
          float k = 6.2831853 / w.w; float c = sqrt(9.8 / k); vec2 d = w.xy;
          float st = w.z * fade;
          float f = k * (dot(d, xz) - c * uTime);
          float a = st / k;
          float sf = sin(f), cf = cos(f);
          disp += vec3(d.x * a * cf, a * sf, d.y * a * cf);
          T += vec3(-d.x*d.x*st*sf, d.x*st*cf, -d.x*d.y*st*sf);
          B += vec3(-d.x*d.y*st*sf, d.y*st*cf, -d.y*d.y*st*sf);
        }
        // \u8239\u4F53\u9644\u8FD1\u538B\u4F4E\u6CE2\u6D6A\uFF0C\u907F\u514D\u7A7F\u8FC7\u7532\u677F
        float hullD = max(abs(p.z) - 12.5, 0.0) + max(-66.0 - p.x, 0.0) + max(p.x - 80.0, 0.0);
        float calm = smoothstep(0.0, 18.0, hullD) * 0.75 + 0.25;
        disp *= calm;
        p += disp;
        vH = disp.y;
        vN = normalize(cross(B, T));
        vW = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,fragmentShader:`
      uniform float uTime, uShip, uFogDensity;
      uniform vec3 uSunDir, uSunColor, uDeep, uShallow, uZen, uHor, uFog, uCam;
      varying vec3 vW; varying vec3 vN; varying float vH;
      ${Df}
      vec2 ripple(vec2 p, float t){
        // \u53E0\u52A0\u82E5\u5E72\u77ED\u6CE2\u7684\u89E3\u6790\u5BFC\u6570
        vec2 g = vec2(0.0);
        const int N = 8;
        for(int i=0;i<N;i++){
          float fi = float(i);
          float ang = fi * 2.399 + 0.3;
          vec2 d = vec2(cos(ang), sin(ang));
          float fr = 0.9 + fi * 0.55; float amp = 0.08 / (1.0 + fi * 0.6);
          float ph = dot(d, p) * fr + t * (1.2 + fi * 0.37);
          g += d * cos(ph) * fr * amp;
        }
        return g;
      }
      void main(){
        vec3 V = normalize(uCam - vW);
        float dist = length(uCam - vW);
        vec2 p = vW.xz + vec2(uShip, 0.0);
        vec2 g = ripple(p * 1.3, uTime) * smoothstep(400.0, 30.0, dist);
        vec3 N = normalize(vN + vec3(-g.x, 0.0, -g.y) * 0.9);
        float nv = max(dot(N, V), 0.0);
        float F = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 sky = mix(uHor, uZen, pow(clamp(R.y, 0.0, 1.0), 0.45));
        // \u53CD\u5C04\u4E2D\u7684\u4E91
        vec2 cuv = R.xz / max(R.y, 0.05) * 0.6 + vec2(uTime * 0.01, 0.0);
        float cl = smoothstep(0.5, 0.8, fbm4(cuv));
        sky = mix(sky, uHor * 1.15 + 0.1, cl * 0.5 * smoothstep(0.02, 0.2, R.y));
        // Keep distant water reflections readable instead of forming a bright streak.
        float spec = pow(max(dot(R, uSunDir), 0.0), 900.0) * 2.0 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 0.12;
        // \u6C34\u4F53\u989C\u8272 + \u6B21\u8868\u9762\u6563\u5C04
        float sss = pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 3.0) * clamp(vH * 0.6 + 0.3, 0.0, 1.0);
        vec3 body = mix(uDeep, uShallow, clamp(vH * 0.35 + 0.25, 0.0, 1.0) * 0.6 + sss * 0.5);
        body *= (0.55 + 0.45 * max(uSunDir.y, 0.1));
        vec3 col = mix(body, sky, F) + uSunColor * spec;
        // \u6CE1\u6CAB\uFF1A\u8239\u4F53\u8FB9\u7F18\u3001\u8239\u5934\u7834\u6D6A\u3001\u5C3E\u8FF9
        float ax = abs(vW.z);
        float bowT = clamp((vW.x - 58.0) / 28.0, 0.0, 1.0);
        float hullW = vW.x > 58.0 ? 12.25 * cos(bowT * 1.5707) : 12.25;
        float dh = ax - hullW;
        float n1 = fbm4(p * 0.35 + vec2(0.0, uTime * 0.3));
        float n2 = fbm4(p * 1.4 - vec2(uTime * 0.5, 0.0));
        float hullFoam = smoothstep(2.2, 0.0, dh) * step(-66.0, vW.x) * step(vW.x, 88.0) * (0.35 + 0.65 * smoothstep(-40.0, 60.0, vW.x));
        float bowFoam = smoothstep(45.0, 75.0, vW.x) * smoothstep(7.0, 0.0, dh - (86.0 - vW.x) * 0.1);
        float behind = -66.0 - vW.x;
        float wakeW = 9.0 + behind * 0.18;
        float wake = step(0.0, behind) * smoothstep(wakeW, wakeW * 0.1, ax) * exp(-behind / 300.0);
        // \u5F00\u5C14\u6587\u5C3E\u6CE2 V \u7EBF
        float kel = -vW.x + 60.0; float kz = ax - 12.0 - kel * 0.354;
        float kelvin = step(0.0, kel) * exp(-abs(kz) * 0.9) * exp(-kel / 200.0) * 0.35;
        float foam = clamp(hullFoam * 0.8 + bowFoam + wake * 0.9 + kelvin, 0.0, 1.5);
        foam *= smoothstep(0.45, 0.85, n1 * 0.6 + n2 * 0.55 + foam * 0.2);
        float crest = smoothstep(0.9, 1.6, vH) * smoothstep(0.55, 0.8, n2) * 0.5;
        foam = clamp(foam + crest, 0.0, 1.0);
        vec3 foamCol = vec3(0.92, 0.95, 0.97) * (0.6 + 0.4 * max(uSunDir.y, 0.2)) * (uSunColor * 0.4 + 0.6);
        col = mix(col, foamCol, foam * 0.9);
        // \u96FE\uFF08\u4E0E\u573A\u666F\u4E00\u81F4\uFF09
        float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        col = mix(col, uFog, fogF);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`}),l=new Yt(s,o);return l.position.y=Pf,l.frustumCulled=!1,l.renderOrder=-1,l}function $v(r){let t=new bi(6e4,6e4,1,1);t.rotateX(Math.PI/2);let e=new be({uniforms:{uTime:{value:0},uSunDir:{value:new R},uLit:{value:new zt(r.cloudLit)},uShade:{value:new zt(r.cloudShade)},uCover:{value:r.cloudCover},uFog:{value:new zt(r.fog)},uShip:{value:0}},vertexShader:`
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,fragmentShader:`
      uniform float uTime, uCover, uShip; uniform vec3 uSunDir, uLit, uShade, uFog;
      varying vec3 vW;
      ${Df}
      void main(){
        vec2 p = (vW.xz + vec2(uShip * 0.2 + uTime * 6.0, uTime * 2.0)) / 2600.0;
        float n = fbm6(p);
        float d = smoothstep(uCover, uCover + 0.28, n);
        float n2 = fbm4(p * 1.8 + vec2(3.1, 1.7) + uSunDir.xz * 0.05);
        float lit = clamp(0.55 + (n - n2) * 1.6, 0.0, 1.0);
        vec3 col = mix(uShade, uLit, lit);
        float distXZ = length(vW.xz - cameraPosition.xz);
        float fade = smoothstep(26000.0, 6000.0, distXZ);
        col = mix(uFog, col, smoothstep(24000.0, 4000.0, distXZ));
        // This cloud layer also sits in front of the sky shader, so clear the same sun-facing area.
        float sunClear = smoothstep(0.93, 0.995, dot(normalize(vW - cameraPosition), normalize(uSunDir)));
        gl_FragColor = vec4(col, d * fade * 0.95 * (1.0 - sunClear));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,transparent:!0,depthWrite:!1,side:Xe,fog:!1}),i=new Yt(t,e);return i.position.y=1800,i.frustumCulled=!1,i.renderOrder=-2,i}var Jl=class{constructor(t,e,i){this.renderer=t,this.scene=e,this.preset=$h.day,this.sky=new mr,this.sky.scale.setScalar(4e4),this.sky.material.depthWrite=!1,this.sky.renderOrder=-3,e.add(this.sky),this.clouds=$v(this.preset),this.clouds.visible=!1,e.add(this.clouds),this.ocean=Yv(this.preset),e.add(this.ocean),this.sunDir=new R,this.sun=new hs(16777215,3),this.sun.castShadow=!0;let n=i==="low"?1024:i==="medium"?2048:4096;this.sun.shadow.mapSize.set(n,n),this.sun.shadow.bias=-4e-4,this.sun.shadow.normalBias=.035,this.sun.target.position.set(-6,0,0),e.add(this.sun,this.sun.target),this.hemi=new cs(16777215,4473924,.4),e.add(this.hemi),e.fog=new Vr(this.preset.fog,this.preset.fogDensity),this.pmrem=new hr(t),this.envRT=null,this.shipDist=0,this.shipSpeed=6.5,this.apply("day")}apply(t){let e=this.preset=$h[t]||$h.day,i=$e.degToRad(90-e.elev),n=$e.degToRad(e.azim);this.sunDir.set(Math.sin(i)*Math.cos(n),Math.cos(i),Math.sin(i)*Math.sin(n)).normalize();let s=this.sky.material.uniforms;s.turbidity.value=e.turbidity,s.rayleigh.value=e.rayleigh,s.mieCoefficient.value=e.mie,s.mieDirectionalG.value=e.mieG,s.sunPosition.value.copy(this.sunDir),this.sun.color.set(e.sunColor),this.sun.intensity=e.sunInt,this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir,120);let a=this.sun.shadow.camera,l=new Kt().lookAt(this.sun.position,this.sun.target.position,new R(0,1,0)).clone().invert(),c=new fi,h=[];for(let p of[-58,40])for(let x of[-1,26])for(let m of[-15,15])h.push(new R(p,x,m));let u=new R;for(let p of h)u.copy(p).sub(this.sun.position).applyMatrix4(l),c.expandByPoint(u);a.left=c.min.x,a.right=c.max.x,a.bottom=c.min.y,a.top=c.max.y,a.near=1,a.far=-c.min.z+10,a.updateProjectionMatrix(),this.hemi.color.set(e.hemiSky),this.hemi.groundColor.set(e.hemiGround),this.hemi.intensity=e.hemiInt,this.scene.fog.color.set(e.fog),this.scene.fog.density=e.fogDensity;let d=this.ocean.material.uniforms;d.uSunDir.value.copy(this.sunDir),d.uSunColor.value.set(e.sunColor).multiplyScalar(e.sunInt/3),d.uDeep.value.set(e.deep),d.uShallow.value.set(e.shallow),d.uZen.value.set(e.skyZen),d.uHor.value.set(e.skyHor),d.uFog.value.set(e.fog),d.uFogDensity.value=e.fogDensity;let f=this.clouds.material.uniforms;f.uSunDir.value.copy(this.sunDir),f.uLit.value.set(e.cloudLit),f.uShade.value.set(e.cloudShade),f.uCover.value=e.cloudCover,f.uFog.value.set(e.fog),this.renderer.toneMappingExposure=e.exposure,this.buildEnvMap()}buildEnvMap(){let t=new sn,e=new mr;e.scale.setScalar(4e4);let i=e.material.uniforms,n=this.sky.material.uniforms;for(let a of["turbidity","rayleigh","mieCoefficient","mieDirectionalG"])i[a].value=n[a].value;i.sunPosition.value.copy(this.sunDir),t.add(e);let s=new Yt(new Zr(3e4,32),new pi({color:new zt(this.preset.deep).multiplyScalar(2.2)}));s.rotation.x=-Math.PI/2,s.position.y=-50,t.add(s),this.envRT&&this.envRT.dispose(),this.envRT=this.pmrem.fromScene(t,.02,1,6e4),this.scene.environment=this.envRT.texture,this.scene.environmentIntensity=this.preset.envInt;for(let a of this.extraScenes||[])a.environment=this.envRT.texture;e.material.dispose(),s.geometry.dispose(),s.material.dispose()}update(t,e,i){this.shipDist+=t*this.shipSpeed;let n=this.ocean.material.uniforms;n.uTime.value=e,n.uShip.value=this.shipDist,n.uCam.value.copy(i),this.ocean.position.x=0,this.ocean.position.z=0;let s=this.clouds.material.uniforms;s.uTime.value=e,s.uShip.value=this.shipDist}};