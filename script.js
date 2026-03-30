import * as THREE from 'three';

const container = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(container.clientWidth, container.clientHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');
const texEarth = loader.load('./assets/earth_2048x1024.jpg', (tex) => {
    tex.wrapS = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
});

const material = new THREE.ShaderMaterial({
    extensions: { derivatives: true },
    uniforms: { 
        uTexture: { value: texEarth }, 
        uMatrix: { value: new THREE.Matrix3() },
        uMode: { value: 2 },
        uSunLon: { value: 0 },
        uSunLat: { value: 0 },
        uShowDay: { value: 1.0 },
        uShowGrid: { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv; 
        void main() { 
            vUv = uv; 
            gl_Position = vec4(position, 1.0); 
        }`,
    fragmentShader: `
        uniform sampler2D uTexture;
        uniform mat3 uMatrix;
        uniform int uMode;
        uniform float uSunLon, uSunLat, uShowDay, uShowGrid;
        varying vec2 vUv;
        const float PI = 3.14159265358979;

        void main() {
            vec2 uv = vUv * 2.0 - 1.0;
            uv.x *= 2.0; 
            float phi, lam;
            bool discardPixel = false;

            if (uMode == 0) { phi = uv.y * (PI/2.0); lam = (uv.x/2.0) * PI; } 
            else if (uMode == 1) { 
                float dSq = (uv.x*uv.x/4.0) + (uv.y*uv.y); if (dSq > 1.0) discardPixel = true;
                float theta = asin(clamp(uv.y, -1.0, 1.0));
                phi = asin((2.0*theta + sin(2.0*theta))/PI); lam = (PI*uv.x)/(2.0*cos(theta));
            }
            else if (uMode == 2) { 
                float d = length(uv); if (d > 1.0) discardPixel = true;
                phi = asin(clamp(uv.y, -1.0, 1.0));
                lam = atan(uv.x, sqrt(max(0.0, 1.0 - uv.x*uv.x - uv.y*uv.y)));
            }
            else if (uMode == 3) {
                vec2 sUv = uv * 0.95; phi = sUv.y * (PI/2.0);
                lam = ((sUv.x/2.0)*PI)/cos(phi); if(abs(lam)>PI) discardPixel = true;
            }
            else if (uMode == 4) {
                vec2 hUv = uv * 0.85; float dSq = (hUv.x*hUv.x/16.0) + (hUv.y*hUv.y/4.0);
                if (dSq > 0.25) discardPixel = true;
                float w = sqrt(1.0 - dSq);
                phi = asin(clamp(hUv.y*w, -1.0, 1.0));
                lam = 2.0 * atan(hUv.x*w, 2.0*(2.0*w*w-1.0));
            }
            else { 
                lam = (uv.x/2.0) * PI; phi = 2.0 * atan(exp(uv.y * 2.0)) - PI/2.0;
            }

            if (discardPixel) discard;

            vec3 p = vec3(cos(phi)*cos(lam), cos(phi)*sin(lam), sin(phi));
            vec3 p_rot = uMatrix * p;
            float phi_rot = asin(clamp(p_rot.z, -1.0, 1.0));
            float lam_rot = atan(p_rot.y, p_rot.x);
            vec2 tC = vec2(fract(lam_rot/(2.0*PI)+0.5), phi_rot/PI+0.5);
            
            vec4 base = texture2D(uTexture, tC);
            
            if (uShowDay > 0.5) {
                vec3 sunDir = normalize(vec3(
                    cos(uSunLat) * cos(uSunLon),
                    cos(uSunLat) * sin(uSunLon),
                    sin(uSunLat)
                ));
                float light = smoothstep(-0.15, 0.15, dot(p_rot, sunDir));
                vec3 nightColor = base.rgb * vec3(0.05, 0.08, 0.15);
                base.rgb = mix(nightColor, base.rgb, light);
            }

            if (uShowGrid > 0.5) {
                vec2 deg = vec2(lam_rot, phi_rot) * (180.0 / PI);
                
                vec2 fw = fwidth(deg); 
                
                if (fw.x > 180.0) fw.x = 0.0;
                
                fw = max(fw, 0.05);

                vec2 minorDist = abs(fract(deg / 10.0 + 0.5) - 0.5) * 10.0;
                vec2 majorDist = abs(fract(deg / 30.0 + 0.5) - 0.5) * 30.0;
                
                float minorL = 1.0 - clamp(min(minorDist.x/fw.x, minorDist.y/fw.y), 0.0, 1.0);
                float majorL = 1.0 - clamp(min(majorDist.x/fw.x, majorDist.y/fw.y), 0.0, 1.0);
                float eqL = 1.0 - clamp(abs(deg.y)/fw.y, 0.0, 1.0); 
                float pmL = 1.0 - clamp(abs(deg.x)/fw.x, 0.0, 1.0); 

                vec3 gColor = vec3(0.4, 0.7, 1.0);
                base.rgb = mix(base.rgb, gColor, minorL * 0.12);
                base.rgb = mix(base.rgb, gColor, majorL * 0.35);
                base.rgb = mix(base.rgb, vec3(1.0, 0.8, 0.0), max(eqL, pmL) * 0.7);
            }

            gl_FragColor = vec4(base.rgb, 1.0);
        }
    `,
    transparent: true
});

scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

let currentRotation = new THREE.Quaternion();
let isDragging = false, isRolling = false;
let vStart = new THREE.Vector3(), lastAngle = 0, velocity = new THREE.Quaternion();

const inputs = {
    lon: document.getElementById('inp-lon'),
    lat: document.getElementById('inp-lat'),
    roll: document.getElementById('inp-roll'),
    proj: document.getElementById('sel-proj'),
    btnLocate: document.getElementById('btn-locate'),
    btnReset: document.getElementById('btn-reset')
};

// --- RESIZE LOGIC ---
window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w, h);
    
    camera.left = -1; camera.right = 1; camera.top = 1; camera.bottom = -1;
    camera.updateProjectionMatrix();
});

const updateUI = () => {
    if (document.activeElement.tagName === 'INPUT') return;
    const euler = new THREE.Euler().setFromQuaternion(currentRotation, 'ZYX');
    inputs.lon.value = Math.round(THREE.MathUtils.radToDeg(euler.z));
    inputs.lat.value = Math.round(THREE.MathUtils.radToDeg(-euler.y));
    inputs.roll.value = Math.round(THREE.MathUtils.radToDeg(euler.x));
};

const updateRotation = () => {
    const lon = THREE.MathUtils.degToRad(parseFloat(inputs.lon.value) || 0);
    const lat = THREE.MathUtils.degToRad(parseFloat(inputs.lat.value) || 0);
    const roll = THREE.MathUtils.degToRad(parseFloat(inputs.roll.value) || 0);
    currentRotation.setFromEuler(new THREE.Euler(roll, -lat, lon, 'ZYX'));
    velocity.set(0,0,0,1);
};

// --- BUTTONS ---
inputs.btnLocate.addEventListener('click', () => {
    navigator.geolocation.getCurrentPosition(pos => {
        inputs.lat.value = pos.coords.latitude.toFixed(1);
        inputs.lon.value = pos.coords.longitude.toFixed(1);
        updateRotation();
    });
});

inputs.btnReset.addEventListener('click', () => {
    inputs.lon.value = 0;
    inputs.lat.value = 0;
    inputs.roll.value = 0;
    updateRotation();
});

const bindToggle = (id, uniform) => {
    const el = document.getElementById(id);
    el.addEventListener('click', () => {
        const active = el.classList.toggle('active');
        el.innerText = active ? "ON" : "OFF";
        material.uniforms[uniform].value = active ? 1.0 : 0.0;
    });
};
bindToggle('tog-day', 'uShowDay');
bindToggle('tog-grid', 'uShowGrid');

inputs.proj.addEventListener('change', (e) => material.uniforms.uMode.value = parseInt(e.target.value));
[inputs.lon, inputs.lat, inputs.roll].forEach(i => i.addEventListener('input', updateRotation));

const getMouse = (cX, cY) => {
    const r = container.getBoundingClientRect();
    const x = ((cX - r.left - r.width/2) / (r.height * 0.475)) * 2.0;
    const y = -(cY - r.top - r.height/2) / (r.height * 0.475);
    const d = Math.sqrt((x*x/4.0) + y*y); 
    return { v: new THREE.Vector3(d < 1 ? Math.sqrt(1-d*d) : 0, x/2.0, y).normalize(), a: Math.atan2(y, x/2.0), isR: d > 1 };
};

const onStart = (e) => {
    if (e.target.closest('#data-deck')) return;
    const t = e.touches ? e.touches[0] : e;
    const s = getMouse(t.clientX, t.clientY);
    velocity.set(0,0,0,1);
    if (s.isR) { isRolling = true; lastAngle = s.a; }
    else { isDragging = true; vStart = s.v; }
};

const onMove = (e) => {
    if (!isDragging && !isRolling) return;
    const t = e.touches ? e.touches[0] : e;
    const s = getMouse(t.clientX, t.clientY);
    let dq = new THREE.Quaternion();
    if (isDragging) {
        dq.setFromUnitVectors(s.v, vStart);
        currentRotation.multiply(dq);
        vStart = s.v;
    } else {
        let diff = s.a - lastAngle;
        if (diff > Math.PI) diff -= Math.PI*2; if (diff < -Math.PI) diff += Math.PI*2;
        dq.setFromAxisAngle(new THREE.Vector3(-1, 0, 0), diff);
        currentRotation.multiply(dq);
        lastAngle = s.a;
    }
    velocity.copy(dq);
    updateUI();
};

window.addEventListener('mousedown', onStart);
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', () => { isDragging = isRolling = false; });
container.addEventListener('touchstart', e => { onStart(e); e.preventDefault(); }, {passive: false});
container.addEventListener('touchmove', e => { onMove(e); e.preventDefault(); }, {passive: false});
window.addEventListener('touchend', () => isDragging = isRolling = false);

function animate() {
    requestAnimationFrame(animate);
    
    // --- REAL-TIME SCIENTIFIC SUN ---
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((now - startOfYear) / (1000 * 60 * 60 * 24));
    
    // Solar Declination (Seasonal Tilt)
    const declination = 23.44 * Math.sin((Math.PI * 2 / 365) * (dayOfYear + 284));
    material.uniforms.uSunLat.value = THREE.MathUtils.degToRad(declination);

    // Solar Longitude (Time of Day)
    // Aligning 12:00 UTC with 0 deg Longitude
    const utcHours = now.getUTCHours() + now.getUTCMinutes()/60 + now.getUTCSeconds()/3600;
    const solarLon = (12 - utcHours) * (Math.PI / 12); 
    material.uniforms.uSunLon.value = solarLon;

    if (!isDragging && !isRolling && velocity.lengthSq() > 0.0000001) {
        currentRotation.multiply(velocity);
        velocity.slerp(new THREE.Quaternion(0, 0, 0, 1), 0.08);
        updateUI();
    }
    material.uniforms.uMatrix.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(currentRotation));
    renderer.render(scene, camera);
}
animate();
updateUI();