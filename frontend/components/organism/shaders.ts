// GLSL for the organism. Simplex noise: Ashima Arts / Stefan Gustavson (MIT).

const SNOISE = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

/**
 * The body: a dense cloud of points on a sphere, flowing with noise. Soft
 * round sprites + additive blending give a smooth, luminous edge at any size.
 */
export const orbVertex = /* glsl */ `
${SNOISE}
attribute float aSeed;
uniform float uTime; uniform float uAmp; uniform float uFlow; uniform float uSize; uniform float uDensity; uniform float uActivity;
varying float vHeat; varying float vFacing; varying float vSeed;
void main(){
  vec3 n = normalize(position);
  float t = uTime*uFlow;
  float d1 = snoise(n*1.5 + vec3(t*0.45, t*0.3, -t*0.2));
  float d2 = snoise(n*3.6 - vec3(t*0.7))*0.45;
  // Slow differential rotation: the equator drifts faster than the poles.
  float ang = t*0.25*(1.0 - 0.6*n.y*n.y) + aSeed*0.15;
  float c = cos(ang), s = sin(ang);
  vec3 p = n*(1.0 + (d1+d2)*uAmp + (aSeed-0.5)*0.035);
  p.xz = mat2(c,-s,s,c)*p.xz;
  vec3 nn = n; nn.xz = mat2(c,-s,s,c)*nn.xz;
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  vFacing = dot(normalize(normalMatrix*nn), normalize(-mv.xyz));
  vHeat = d1*0.5 + 0.5;
  vSeed = aSeed;
  float on = step(aSeed, uDensity);
  gl_PointSize = on*uSize*(0.55 + aSeed*0.9)*(1.0 + uActivity*0.35)/(-mv.z);
  gl_Position = projectionMatrix*mv;
}`;

export const orbFragment = /* glsl */ `
uniform vec3 uColor; uniform vec3 uHot; uniform float uEmissive; uniform float uFlash;
varying float vHeat; varying float vFacing; varying float vSeed;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float disc = smoothstep(0.5, 0.05, d);
  if (disc < 0.02) discard;
  // The front of the sphere is bright, the far side recedes: reads as volume.
  float depth = 0.16 + 0.84*smoothstep(-0.55, 0.75, vFacing);
  float rim = pow(1.0 - abs(vFacing), 2.0);
  vec3 col = mix(uColor*0.55, mix(uColor, uHot, 0.55), smoothstep(0.4, 1.0, vHeat));
  col += uHot*rim*0.22;
  col *= uEmissive*(0.75 + 0.35*vSeed);
  col += uHot*uFlash*0.5;
  gl_FragColor = vec4(col, disc*depth*0.5);
}`;

/** Camera-facing radial glow (nucleus and aura). Perfectly smooth, no geometry edge. */
export const spriteVertex = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`;

export const spriteFragment = /* glsl */ `
uniform vec3 uColor; uniform float uStrength; uniform float uFalloff;
varying vec2 vUv;
void main(){
  float r = length(vUv - 0.5)*2.0;
  float a = pow(max(1.0 - r, 0.0), uFalloff);
  gl_FragColor = vec4(uColor*a*uStrength, a*uStrength);
}`;

/** Edges of the neural lattice; pulses travel along each edge. Fades as a whole with density. */
export const latticeVertex = /* glsl */ `
attribute float aProg; attribute float aId;
varying float vProg; varying float vId; varying float vDepth;
void main(){
  vProg = aProg; vId = aId;
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vDepth = -mv.z;
  gl_Position = projectionMatrix*mv;
}`;

export const latticeFragment = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform float uDensity; uniform float uActivity; uniform float uSpeed; uniform float uBase;
varying float vProg; varying float vId; varying float vDepth;
void main(){
  float ph = fract(vProg - uTime*uSpeed - vId*9.17);
  float glow = smoothstep(0.0,0.08,ph)*smoothstep(0.3,0.08,ph);
  float depthFade = clamp(1.25 - (vDepth-7.5)*0.45, 0.2, 1.0);
  float a = (uBase + glow*(0.18 + uActivity*0.85)) * depthFade * smoothstep(0.1, 0.9, uDensity);
  gl_FragColor = vec4(uColor*(0.7 + glow*(1.1+uActivity*1.4)), a);
}`;

export const nodeVertex = /* glsl */ `
attribute float aId;
uniform float uDensity; uniform float uTime; uniform float uScale;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  float tw = 0.65 + 0.35*sin(uTime*1.7 + aId*40.0);
  vA = smoothstep(0.1, 0.9, uDensity)*tw*clamp(1.3 - (-mv.z-7.5)*0.5, 0.2, 1.0);
  gl_PointSize = uScale*(0.9 + aId*0.8)/(-mv.z);
  gl_Position = projectionMatrix*mv;
}`;

export const nodeFragment = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main(){
  float d = length(gl_PointCoord-0.5);
  float a = smoothstep(0.5,0.1,d)*vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.35)*1.2, a);
}`;

export const particleVertex = /* glsl */ `
attribute vec3 aStart; attribute vec3 aEnd; attribute float aT0; attribute float aDur; attribute vec3 aColor; attribute float aSeed;
uniform float uTime; uniform float uScale;
varying vec3 vColor; varying float vAlpha;
void main(){
  float t = (uTime - aT0)/aDur;
  float alive = step(0.0,t)*step(t,1.0);
  float e = t*t*(3.0-2.0*t);
  vec3 p = mix(aStart, aEnd, e);
  // Spiral in toward / out from the core, like nutrients in a current.
  float ang = aSeed*6.2831 + e*4.0;
  vec3 axis = normalize(aEnd - aStart + vec3(0.0001));
  vec3 side = normalize(cross(axis, vec3(0.0,1.0,0.0)) + vec3(0.0001));
  vec3 up = cross(axis, side);
  p += (side*cos(ang) + up*sin(ang))*0.22*sin(3.14159*e);
  vColor = aColor;
  vAlpha = alive*sin(3.14159*clamp(t,0.0,1.0));
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  gl_PointSize = alive*(2.2 + aSeed*2.6)*uScale/(-mv.z);
  gl_Position = projectionMatrix*mv;
}`;

export const particleFragment = /* glsl */ `
varying vec3 vColor; varying float vAlpha;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  if (a*vAlpha < 0.01) discard;
  gl_FragColor = vec4(vColor*1.4, a*vAlpha);
}`;

/** Fine, distant starfield. Small, dim, always behind the organism. */
export const dustVertex = /* glsl */ `
uniform float uTime; uniform float uScale;
attribute float aSeed;
varying float vA;
void main(){
  vec3 p = position;
  p.y += sin(uTime*0.03 + aSeed*20.0)*0.08;
  vec4 mv = modelViewMatrix*vec4(p,1.0);
  vA = (0.25 + 0.5*aSeed) * (0.6 + 0.4*sin(uTime*0.8 + aSeed*60.0));
  gl_PointSize = (0.6 + aSeed*1.1)*uScale/(-mv.z);
  gl_Position = projectionMatrix*mv;
}`;

export const dustFragment = /* glsl */ `
uniform vec3 uColor;
varying float vA;
void main(){
  float d = length(gl_PointCoord-0.5);
  float a = smoothstep(0.5,0.0,d)*vA*0.55;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;
