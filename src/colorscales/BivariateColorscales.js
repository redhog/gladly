import { register2DColorscale } from './ColorscaleRegistry.js'


//////////////////////////////
// 1. Bilinear 4-corner colormap
//////////////////////////////
register2DColorscale("bilinear4corner", `
vec4 colorscale_2d_bilinear4corner(vec2 t) {
    vec3 c00 = vec3(0.0, 0.0, 1.0);
    vec3 c10 = vec3(1.0, 0.0, 0.0);
    vec3 c01 = vec3(0.0, 1.0, 0.0);
    vec3 c11 = vec3(1.0, 1.0, 0.0);
    vec3 rgb = (1.0 - t.x)*(1.0 - t.y)*c00 +
               t.x*(1.0 - t.y)*c10 +
               (1.0 - t.x)*t.y*c01 +
               t.x*t.y*c11;
    return vec4(rgb,1.0);
}
`);

register2DColorscale("Gred", `
vec4 colorscale_2d_Gred(vec2 t) {
    vec3 c00 = vec3(0.0, 0.0, 0.0);
    vec3 c10 = vec3(1.0, 0.0, 0.0);
    vec3 c01 = vec3(0.0, 1.0, 0.0);
    vec3 c11 = vec3(1.0, 1.0, 1.0);
    vec3 rgb = (1.0 - t.x)*(1.0 - t.y)*c00 +
               t.x*(1.0 - t.y)*c10 +
               (1.0 - t.x)*t.y*c01 +
               t.x*t.y*c11;
    return vec4(rgb,1.0);
}
`);

register2DColorscale("Reen", `
vec4 colorscale_2d_Reen(vec2 t) {
    vec3 c00 = vec3(1.0, 0.0, 0.0);
    vec3 c10 = vec3(0.0, 0.0, 0.0);
    vec3 c01 = vec3(1.0, 1.0, 1.0);
    vec3 c11 = vec3(0.0, 1.0, 0.0);
    vec3 rgb = (1.0 - t.x)*(1.0 - t.y)*c00 +
               t.x*(1.0 - t.y)*c10 +
               (1.0 - t.x)*t.y*c01 +
               t.x*t.y*c11;
    return vec4(rgb,1.0);
}
`);


//////////////////////////////
// 2. HSV Phase-Magnitude Map
//////////////////////////////
register2DColorscale("hsv_phase_magnitude", `
vec4 colorscale_2d_hsv_phase_magnitude(vec2 t) {
    float angle = atan(t.y - 0.5, t.x - 0.5);
    float r = length(t - vec2(0.5));
    float H = (angle + 3.1415926)/(2.0*3.1415926);
    float S = 1.0;
    float V = clamp(r*1.4142136,0.0,1.0);
    float c = V*S;
    float h = H*6.0;
    float x = c*(1.0 - abs(mod(h,2.0)-1.0));
    vec3 rgb;
    if(h<1.0) rgb = vec3(c,x,0.0);
    else if(h<2.0) rgb = vec3(x,c,0.0);
    else if(h<3.0) rgb = vec3(0.0,c,x);
    else if(h<4.0) rgb = vec3(0.0,x,c);
    else if(h<5.0) rgb = vec3(x,0.0,c);
    else rgb = vec3(c,0.0,x);
    float m = V - c;
    rgb += vec3(m);
    return vec4(rgb,1.0);
}
`);

//////////////////////////////
// 3. Diverging × Diverging Map
//////////////////////////////
register2DColorscale("diverging_diverging", `
vec4 colorscale_2d_diverging_diverging(vec2 t) {
    vec3 blue = vec3(0.230,0.299,0.754);
    vec3 white = vec3(1.0);
    vec3 red = vec3(0.706,0.016,0.150);
    vec3 rgbX = (t.x<0.5) ? mix(blue,white,t.x*2.0) : mix(white,red,(t.x-0.5)*2.0);
    vec3 rgbY = (t.y<0.5) ? mix(blue,white,t.y*2.0) : mix(white,red,(t.y-0.5)*2.0);
    vec3 rgb = 0.5*(rgbX+rgbY);
    return vec4(rgb,1.0);
}
`);

//////////////////////////////
// 4. Lightness × Hue Map
//////////////////////////////
register2DColorscale("lightness_hue", `
vec4 colorscale_2d_lightness_hue(vec2 t) {
    float H = t.x;
    float L = t.y;
    float C = 1.0 - abs(2.0*L-1.0);
    float X = C*(1.0 - abs(mod(H*6.0,2.0)-1.0));
    vec3 rgb;
    if(H<1.0/6.0) rgb = vec3(C,X,0.0);
    else if(H<2.0/6.0) rgb = vec3(X,C,0.0);
    else if(H<3.0/6.0) rgb = vec3(0.0,C,X);
    else if(H<4.0/6.0) rgb = vec3(0.0,X,C);
    else if(H<5.0/6.0) rgb = vec3(X,0.0,C);
    else rgb = vec3(C,0.0,X);
    float m = L - 0.5*C;
    rgb += vec3(m);
    return vec4(rgb,1.0);
}
`);

//////////////////////////////
// 5. Brewer 3x3 Bivariate Grid (no vec3 c[3][3])
//////////////////////////////
register2DColorscale("brewer_3x3", `
vec4 colorscale_2d_brewer_3x3(vec2 t) {
    float fx = clamp(t.x*2.0,0.0,2.0);
    float fy = clamp(t.y*2.0,0.0,2.0);
    int ix = int(fx);
    int iy = int(fy);
    vec3 rgb;
    if(ix==0 && iy==0) rgb = vec3(215.0,25.0,28.0)/255.0;
    else if(ix==1 && iy==0) rgb = vec3(253.0,174.0,97.0)/255.0;
    else if(ix==2 && iy==0) rgb = vec3(255.0,255.0,191.0)/255.0;
    else if(ix==0 && iy==1) rgb = vec3(224.0,130.0,20.0)/255.0;
    else if(ix==1 && iy==1) rgb = vec3(255.0,255.0,179.0)/255.0;
    else if(ix==2 && iy==1) rgb = vec3(171.0,221.0,164.0)/255.0;
    else if(ix==0 && iy==2) rgb = vec3(26.0,150.0,65.0)/255.0;
    else if(ix==1 && iy==2) rgb = vec3(166.0,217.0,106.0)/255.0;
    else rgb = vec3(102.0,194.0,165.0)/255.0;
    return vec4(rgb,1.0);
}
`);

//////////////////////////////
// 6. Moreland 5x5 Perceptual Grid (flattened)
//////////////////////////////
register2DColorscale("moreland_5x5", `
vec4 colorscale_2d_moreland_5x5(vec2 t) {
    float fx = clamp(t.x*4.0,0.0,4.0);
    float fy = clamp(t.y*4.0,0.0,4.0);
    int ix = int(fx);
    int iy = int(fy);
    vec3 rgb;
    if(ix==0 && iy==0) rgb = vec3(0.230,0.299,0.754);
    else if(ix==1 && iy==0) rgb = vec3(0.375,0.544,0.837);
    else if(ix==2 && iy==0) rgb = vec3(0.625,0.732,0.941);
    else if(ix==3 && iy==0) rgb = vec3(0.843,0.867,0.996);
    else if(ix==4 && iy==0) rgb = vec3(0.980,0.957,0.996);
    else if(ix==0 && iy==1) rgb = vec3(0.266,0.353,0.819);
    else if(ix==1 && iy==1) rgb = vec3(0.420,0.585,0.876);
    else if(ix==2 && iy==1) rgb = vec3(0.666,0.762,0.961);
    else if(ix==3 && iy==1) rgb = vec3(0.876,0.888,0.996);
    else if(ix==4 && iy==1) rgb = vec3(0.992,0.969,0.996);
    else if(ix==0 && iy==2) rgb = vec3(0.305,0.407,0.875);
    else if(ix==1 && iy==2) rgb = vec3(0.466,0.625,0.911);
    else if(ix==2 && iy==2) rgb = vec3(0.710,0.791,0.976);
    else if(ix==3 && iy==2) rgb = vec3(0.905,0.908,0.996);
    else if(ix==4 && iy==2) rgb = vec3(0.996,0.980,0.996);
    else if(ix==0 && iy==3) rgb = vec3(0.349,0.460,0.926);
    else if(ix==1 && iy==3) rgb = vec3(0.514,0.664,0.944);
    else if(ix==2 && iy==3) rgb = vec3(0.753,0.817,0.988);
    else if(ix==3 && iy==3) rgb = vec3(0.933,0.926,0.996);
    else if(ix==4 && iy==3) rgb = vec3(0.996,0.988,0.996);
    else if(ix==0 && iy==4) rgb = vec3(0.403,0.509,0.965);
    else if(ix==1 && iy==4) rgb = vec3(0.563,0.700,0.972);
    else if(ix==2 && iy==4) rgb = vec3(0.796,0.843,0.996);
    else if(ix==3 && iy==4) rgb = vec3(0.960,0.944,0.996);
    else rgb = vec3(1.000,1.000,1.000);
    return vec4(rgb,1.0);
}
`);

//////////////////////////////
// 7. Boy's Surface / Orientation Map
//////////////////////////////
register2DColorscale("boys_surface", `
vec4 colorscale_2d_boys_surface(vec2 t) {
    float u = t.x*2.0-1.0;
    float v = t.y*2.0-1.0;
    float x = u*(1.0-v*v/2.0);
    float y = v*(1.0-u*u/2.0);
    float z = (u*u-v*v)/2.0;
    vec3 rgb = normalize(vec3(abs(x),abs(y),abs(z)));
    return vec4(rgb,1.0);
}
`);

//////////////////////////////
// 8. Diverging × Sequential Map
//////////////////////////////
register2DColorscale("diverging_sequential", `
vec4 colorscale_2d_diverging_sequential(vec2 t) {
    vec3 blue = vec3(0.230,0.299,0.754);
    vec3 white = vec3(1.0);
    vec3 red = vec3(0.706,0.016,0.150);
    vec3 seqStart = vec3(1.0,1.0,0.8);
    vec3 seqEnd = vec3(0.2,0.8,0.2);
    vec3 rgbX = (t.x<0.5)? mix(blue,white,t.x*2.0) : mix(white,red,(t.x-0.5)*2.0);
    vec3 rgbY = mix(seqStart,seqEnd,t.y);
    vec3 rgb = 0.5*(rgbX+rgbY);
    return vec4(rgb,1.0);
}
`);
